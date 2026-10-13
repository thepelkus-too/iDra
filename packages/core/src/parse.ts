import * as acorn from 'acorn'
import { catalog as defaultCatalog, type Catalog } from './catalog'
import {
  contentHash,
  newId,
  OUT_NAMES,
  SOURCE_NAMES,
  type ArrMods,
  type Call,
  type CallSrc,
  type Chain,
  type OutName,
  type Sketch,
  type SourceInit,
  type Stmt,
  type Value,
} from './ir'
import { preludePluginRef, splitPrelude } from './motion-core'

// Text → IR. The guarantee: no code is ever lost. Every character outside whitespace is either
// part of a recognized node (and kept verbatim in `src` records) or inside a verbatim `raw` stmt.

export interface ImportOptions {
  catalog?: Catalog
  name?: string
  id?: string
  /** if the whole text fails to parse, split on blank lines and keep what parses (default false: one raw stmt) */
  recover?: boolean
}

export interface ImportReport {
  statements: number
  chains: number
  notRendered: number
  defs: number
  settings: number
  sources: number
  renders: number
  comments: number
  raw: number
  rawChars: number
  totalChars: number
  unknownCalls: string[]
  parseFailed: boolean
  /** commented-out code read back as disabled nodes: statements (`// osc().out()`) plus modifiers (`  // .rotate(1)`) */
  revived: number
}

export interface ImportResult {
  sketch: Sketch
  warnings: string[]
  report: ImportReport
}

type Node = any

const isOut = (n: string): n is OutName => (OUT_NAMES as string[]).includes(n)
const isSourceName = (n: string) => (SOURCE_NAMES as string[]).includes(n)
const REF_RE = /^[os][0-3]$/

interface Ctx {
  code: string
  cat: Catalog
  defs: Set<string>
  unknown: Set<string>
  warnings: string[]
  /** every comment of the text being parsed (positions in `code`) */
  comments: acorn.Comment[]
  revived: number
  /**
   * Set while converting a top-level statement that is directly followed by own-line comments holding only `.call(...)`
   * fragments: a chain without `.out()` (or a def holding a chain) takes them as its trailing disabled modifiers, up to
   * here. The converter that does so sets `absorbed` to the new end of the statement.
   */
  extendTo?: number
  absorbed?: number
}

const slice = (c: Ctx, n: { start: number; end: number }) => c.code.slice(n.start, n.end)

// ---------------------------------------------------------------- values

function numberOf(n: Node): number | undefined {
  if (n.type === 'Literal' && typeof n.value === 'number') return n.value
  if (n.type === 'UnaryExpression' && (n.operator === '-' || n.operator === '+') && n.argument.type === 'Literal' && typeof n.argument.value === 'number') {
    const v = n.operator === '-' ? -n.argument.value : n.argument.value
    return v === 0 ? 0 : v
  }
  return undefined
}

type Expect = 'float' | 'vec' | 'tex' | 'any'

function expectOf(type: string | undefined): Expect {
  if (!type) return 'any'
  if (type === 'sampler2D') return 'tex'
  if (type.startsWith('vec')) return 'vec'
  if (type === 'float') return 'float'
  return 'any'
}

const ARRAY_MODS = new Set(['fast', 'smooth', 'ease', 'offset', 'fit'])

function convertArray(n: Node, c: Ctx, expect: Expect): Value | undefined {
  // peel `.fast(2).smooth()` etc. off an array literal
  const modCalls: Node[] = []
  let base = n
  while (base.type === 'CallExpression' && base.callee.type === 'MemberExpression' && !base.callee.computed && !base.optional && !base.callee.optional && base.callee.property.type === 'Identifier' && ARRAY_MODS.has(base.callee.property.name)) {
    modCalls.unshift(base)
    base = base.callee.object
  }
  if (base.type !== 'ArrayExpression') return undefined
  const v: number[] = []
  for (const e of base.elements) {
    if (!e) return undefined
    const x = numberOf(e)
    if (x === undefined) return undefined
    v.push(x)
  }
  const mods: ArrMods = {}
  const set = <K extends keyof ArrMods>(k: K, val: ArrMods[K]) => {
    delete mods[k]
    mods[k] = val
  }
  for (const call of modCalls) {
    const name = call.callee.property.name as keyof ArrMods
    const args = call.arguments as Node[]
    const nums = args.map(numberOf)
    if (name === 'ease') {
      if (args.length === 0) set('ease', 'linear')
      else if (args.length === 1 && args[0].type === 'Literal' && typeof args[0].value === 'string') set('ease', args[0].value)
      else return undefined
    } else if (name === 'fit') {
      if (nums.some((x) => x === undefined) || args.length > 2) return undefined
      set('fit', [nums[0] ?? 0, nums[1] ?? 1])
    } else {
      if (nums.some((x) => x === undefined) || args.length > 1) return undefined
      const def = name === 'offset' ? 0.5 : 1
      set(name as 'fast' | 'smooth' | 'offset', (nums[0] ?? def) as number)
    }
  }
  if (expect === 'vec' && modCalls.length === 0 && v.length >= 2 && v.length <= 4) return { k: 'vec4', v }
  return { k: 'arr', v, mods }
}

interface FlatCall {
  name: string
  node: Node // the CallExpression
  dot?: number // index of '.' for member calls
  prevEnd: number // end of the expression this call is applied to (for gaps)
}

/** Flatten `a(1).b(2).c(3)` → base generator call + method calls. Returns undefined if the shape is unsupported. */
function flatten(expr: Node, c: Ctx): { gen: Node; mods: FlatCall[] } | undefined {
  const mods: FlatCall[] = []
  let cur = expr
  while (cur.type === 'CallExpression' && cur.callee.type === 'MemberExpression') {
    const m = cur.callee
    if (m.computed || cur.optional || m.optional || m.property.type !== 'Identifier') return undefined
    const region = c.code.slice(m.object.end, m.property.start)
    const dotRel = region.lastIndexOf('.')
    if (dotRel < 0) return undefined
    mods.unshift({ name: m.property.name, node: cur, dot: m.object.end + dotRel, prevEnd: m.object.end })
    cur = m.object
  }
  if (cur.type === 'CallExpression' && cur.callee.type === 'Identifier' && !cur.optional) return { gen: cur, mods }
  return undefined
}

function convertCall(name: string, node: Node, c: Ctx): Call {
  const inputs = c.cat.inputs(name)
  if (!c.cat.has(name)) c.unknown.add(name)
  const args = (node.arguments as Node[]).map((a, i) => convertArg(a, c, expectOf(inputs[i]?.type), c.cat.has(name)))
  return { id: newId('c'), fn: name, args }
}

/** Build a nested chain Value from a call-chain expression, or undefined if it does not look like Hydra. */
function convertChain(expr: Node, c: Ctx, expect: Expect): Chain | undefined {
  const flat = flatten(expr, c)
  if (!flat) return undefined
  if (flat.mods.some((m) => m.name === 'out')) return undefined
  const genName = flat.gen.callee.name as string
  const genDef = c.cat.get(genName)
  const accept = genDef ? genDef.type === 'src' : expect === 'tex' || (expect === 'any' && flat.mods.length >= 1)
  if (!accept) return undefined
  const gen = convertCall(genName, flat.gen, c)
  const mods = flat.mods.map((m) => convertCall(m.name, m.node, c))
  return { id: newId('h'), gen, mods }
}

function convertArg(n: Node, c: Ctx, expect: Expect, known = true): Value {
  const raw = () => ({ k: 'js', src: slice(c, n) }) as Value
  const x = numberOf(n)
  if (x !== undefined) return { k: 'num', v: x }
  switch (n.type) {
    case 'Identifier': {
      if (c.defs.has(n.name)) return { k: 'var', name: n.name }
      if (REF_RE.test(n.name)) return { k: 'ref', name: n.name as any }
      return raw()
    }
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return { k: 'fn', src: slice(c, n) }
    case 'ParenthesizedExpression':
      if (n.expression.type === 'ArrowFunctionExpression' || n.expression.type === 'FunctionExpression') return { k: 'fn', src: slice(c, n) }
      return raw()
    case 'ArrayExpression':
    case 'CallExpression': {
      const a = convertArray(n, c, expect)
      if (a) return a
      if (n.type === 'CallExpression') {
        const ch = convertChain(n, c, expect)
        if (ch) return { k: 'tex', chain: ch }
      }
      return raw()
    }
    default:
      return raw()
  }
}

function convertDefValue(n: Node, c: Ctx): Value {
  const v = convertArg(n, c, 'any')
  if (v.k !== 'tex') return v
  // a def holding a chain is written one call per line too: its commented-out modifiers are disabled calls
  const flat = flatten(n, c)
  if (!flat || flat.mods.length !== v.chain.mods.length) return v
  const mods: Call[] = []
  let prevEnd = flat.gen.end
  // def chains keep no per-call text: the def's own text is kept whole
  const revive = (to: number) => {
    for (const r of reviveCalls(c, prevEnd, to)) {
      mods.push({ id: r.call.id, fn: r.call.fn, args: r.call.args, disabled: true })
      prevEnd = r.end
    }
  }
  flat.mods.forEach((m, i) => {
    revive(m.dot!)
    mods.push(v.chain.mods[i])
    prevEnd = m.node.end
  })
  if (c.extendTo) {
    revive(c.extendTo)
    c.absorbed = prevEnd
  }
  return mods.length === v.chain.mods.length ? v : { ...v, chain: { ...v.chain, mods } }
}

// ---------------------------------------------------------------- revivable comments (disabled nodes)

/** Shift every node position of a sub-parse by `by` so slices of the whole text keep working. */
function shiftNodes(n: any, by: number): void {
  if (!n || typeof n !== 'object') return
  if (Array.isArray(n)) return n.forEach((x) => shiftNodes(x, by))
  if (typeof n.start === 'number') n.start += by
  if (typeof n.end === 'number') n.end += by
  for (const k of Object.keys(n)) if (k !== 'start' && k !== 'end' && n[k] && typeof n[k] === 'object') shiftNodes(n[k], by)
}

interface RevivedCall {
  call: Call
  /** where the segment's text starts: the `//` for the first call of a comment line, else the call's dot */
  start: number
  dot: number
  end: number
}

/**
 * Commented-out modifiers in the gap [from, to) between two segments of a chain written one call per line: a `//` comment
 * on a line of its own whose text parses in full as one or more `.call(...)` fragments (and nothing else) becomes
 * disabled calls. Anything else (prose, a partial line, a trailing comment, an `.out(...)`) stays a comment in the gap.
 */
function reviveCalls(c: Ctx, from: number, to: number): RevivedCall[] {
  const out: RevivedCall[] = []
  for (const cm of c.comments) {
    if (cm.type !== 'Line' || cm.start < from || cm.end > to) continue
    const nl = c.code.lastIndexOf('\n', cm.start - 1)
    if (nl < from || !/^[ \t]*$/.test(c.code.slice(nl + 1, cm.start))) continue
    const lead = /^\s*/.exec(cm.value)![0].length
    const dot = cm.start + 2 + lead
    if (c.code[dot] !== '.') continue
    const calls = parseFragments(c, dot, cm.end)
    if (!calls) continue
    c.revived += calls.length
    // the first call of a line keeps its exact `//` lead; the others continue that comment line (lead '')
    calls.forEach((r, i) => out.push({ ...r, start: i === 0 ? cm.start : r.start, call: { ...r.call, src: { text: '', hash: '', lead: i === 0 ? c.code.slice(cm.start, dot) : '' } } }))
  }
  return out
}

/** `.a(1).b(2)` at [dot, end) in full, as disabled calls, or undefined. */
function parseFragments(c: Ctx, dot: number, end: number): RevivedCall[] | undefined {
  let ast: Node
  try {
    ast = acorn.parse('_' + c.code.slice(dot, end), { ecmaVersion: 'latest', sourceType: 'script', preserveParens: true }) as unknown as Node
  } catch {
    return undefined
  }
  if (ast.body.length !== 1 || ast.body[0].type !== 'ExpressionStatement') return undefined
  const st = ast.body[0]
  if (st.expression.end !== st.end) return undefined // `;` would end the chain mid-way
  shiftNodes(st, dot - 1)
  const frags: Node[] = []
  let e = st.expression
  while (e.type === 'CallExpression' && !e.optional && e.callee.type === 'MemberExpression' && !e.callee.computed && !e.callee.optional && e.callee.property.type === 'Identifier') {
    frags.unshift(e)
    e = e.callee.object
  }
  if (e.type !== 'Identifier' || e.name !== '_' || e.start !== dot - 1 || !frags.length) return undefined
  const res: RevivedCall[] = []
  for (const f of frags) {
    const name = f.callee.property.name as string
    if (name === 'out' || c.cat.get(name)?.type === 'src') return undefined
    const region = c.code.slice(f.callee.object.end, f.callee.property.start)
    const d = f.callee.object.end + region.lastIndexOf('.')
    const call = { ...convertCall(name, f, c), disabled: true }
    res.push({ call, start: d, dot: d, end: f.end })
  }
  return res
}

const REVIVABLE: ReadonlyArray<Stmt['k']> = ['chain', 'def', 'source', 'setting', 'render']
/** longest comment run tried line by line; longer runs are revived only as a whole */
const MAX_SPLIT_LINES = 40

/**
 * A run of own-line `//` comments (consecutive lines) → the statements it stands for. Each maximal stretch of lines whose
 * uncommented text parses in full as complete, recognised statements (chain, def, source, setting, render; each starting
 * its line, one per line, optionally followed by a one-line trailing comment) becomes disabled statements; everything
 * else stays comment statements. Raw code, prose and lines that only partly parse are never revived.
 */
function reviveRun(code: string, run: acorn.Comment[], before: string, c: Ctx): Stmt[] {
  const texts = run.map((cm) => commentText(cm))
  const contentStart = run.map((cm) => cm.start + 2 + (cm.value.startsWith(' ') ? 1 : 0))
  const out: Stmt[] = []
  let endT = -1 // end (in code) of the last stmt pushed
  const beforeOf = (startT: number) => (endT < 0 ? before : code.slice(endT, startT))
  const pushProse = (i: number, j: number) => {
    if (j <= i) return
    out.push(commentStmt(texts.slice(i, j).join('\n'), false, false, code.slice(run[i].start, run[j - 1].end), beforeOf(run[i].start)))
    endT = run[j - 1].end
  }
  const tryRange = (i: number, j: number): Stmt[] | undefined => {
    const lines = texts.slice(i, j)
    const U = lines.join('\n')
    if (!/^[ \t]*[A-Za-z_$]/.test(U)) return undefined
    const uStart: number[] = []
    let acc = 0
    for (const l of lines) {
      uStart.push(acc)
      acc += l.length + 1
    }
    const lineOf = (u: number) => {
      let k = 0
      while (k + 1 < uStart.length && uStart[k + 1] <= u) k++
      return k
    }
    const toT = (u: number) => {
      const k = lineOf(u)
      return contentStart[i + k] + (u - uStart[k])
    }
    const sub: Ctx = { code: U, cat: c.cat, defs: new Set(c.defs), unknown: new Set(), warnings: [], comments: [], revived: 0 }
    let r: { stmts: Stmt[]; tail: string }
    try {
      r = importProgram(U, sub)
    } catch {
      return undefined
    }
    if (!r.stmts.length || !/^[ \t]*$/.test(r.tail)) return undefined
    const res: Stmt[] = []
    let u = 0
    let prevT = -1
    let prevKind: 'stmt' | 'trailing' | undefined
    for (const st of r.stmts) {
      const b = st.src!.before
      const a = u + b.length
      const e = a + st.src!.text.length
      u = e
      const isTrailing = st.k === 'comment' && !!st.trailing
      if (isTrailing) {
        if (prevKind !== 'stmt' || !/^[ \t]*$/.test(b) || st.src!.text.includes('\n')) return undefined
        const startT = toT(a)
        res.push({ ...st, src: { ...st.src!, text: code.slice(startT, toT(e)), before: code.slice(prevT, startT) } })
        prevT = toT(e)
        prevKind = 'trailing'
        continue
      }
      if (!REVIVABLE.includes(st.k) || st.disabled) return undefined
      // each statement starts its own line: the first one at the top of the stretch, the next ones one line apart
      if (prevKind === undefined ? !/^[ \t]*$/.test(b) : !/^[ \t]*\n[ \t]*$/.test(b)) return undefined
      const la = lineOf(a)
      const startT = run[i + la].start
      const endTpos = toT(e)
      const text = code.slice(startT, endTpos)
      // hash of the statement switched on (the `disabled` flag is not part of a statement's text hash)
      const on = { ...st, src: undefined }
      delete (on as { src?: unknown }).src
      res.push({ ...st, disabled: true, src: { text, hash: contentHash(on), before: prevT < 0 ? '' : code.slice(prevT, startT) } })
      prevT = endTpos
      prevKind = 'stmt'
    }
    // the stretch ends with its last line (no blank comment lines after the last statement)
    if (!/^[ \t]*$/.test(code.slice(prevT, run[j - 1].end))) return undefined
    for (const d of sub.defs) c.defs.add(d)
    for (const x of sub.unknown) c.unknown.add(x)
    c.revived += sub.revived + res.filter((x) => x.k !== 'comment').length
    return res
  }
  let p = 0
  let i = 0
  const n = run.length
  while (i < n) {
    let got: Stmt[] | undefined
    let jj = 0
    const tops = n > MAX_SPLIT_LINES ? (i === 0 ? [n] : []) : Array.from({ length: n - i }, (_, k) => n - k)
    for (const j of tops) {
      got = tryRange(i, j)
      if (got) {
        jj = j
        break
      }
    }
    if (!got) {
      i++
      continue
    }
    pushProse(p, i)
    got[0] = { ...got[0], src: { ...got[0].src!, before: beforeOf(run[i].start) } }
    out.push(...got)
    endT = run[jj - 1].end
    i = p = jj
  }
  pushProse(p, n)
  return out
}

// ---------------------------------------------------------------- statements

interface Item {
  start: number
  end: number
  node?: Node
  comment?: acorn.Comment
}

function srcFor(c: Ctx, stmt: Stmt, text: string, before: string): Stmt {
  return { ...stmt, src: { text, hash: contentHash(stmt), before } }
}

function unquoteArgs(args: Node[], c: Ctx): { arg?: string; argsSrc?: string } {
  if (args.length === 0) return {}
  if (args.length === 1) {
    const a = args[0]
    if (a.type === 'Literal' && typeof a.value === 'string') return { arg: a.value }
    if (a.type === 'Literal' && typeof a.value === 'number') return { arg: String(a.value) }
    if (a.type === 'TemplateLiteral' && a.expressions.length === 0 && a.quasis.length === 1) return { arg: a.quasis[0].value.cooked }
  }
  return { argsSrc: c.code.slice(args[0].start, args[args.length - 1].end) }
}

/** Where each argument of a call sits in the call's own text (which starts at `base`), with its content hash. */
function argSpans(call: Call, node: Node, base: number): NonNullable<CallSrc['args']> {
  return (node.arguments as Node[]).map((a, i) => ({ from: a.start - base, to: a.end - base, hash: contentHash(call.args[i]) }))
}

function convertExpressionStatement(node: Node, c: Ctx): { stmt?: Stmt; chainSrc?: Chain['src']; why?: string } {
  const e = node.expression
  if (e.type === 'AssignmentExpression' && e.operator === '=' && e.left.type === 'Identifier') {
    const name = e.left.name as string
    if (name === 'update' || name === 'afterUpdate') return { why: 'update function' }
    const v = numberOf(e.right)
    if ((name === 'speed' || name === 'bpm') && v !== undefined) return { stmt: { id: newId('s'), k: 'setting', name, v } }
    const value = convertDefValue(e.right, c)
    c.defs.add(name)
    return { stmt: { id: newId('s'), k: 'def', name, decl: 'bare', value } }
  }
  if (e.type !== 'CallExpression') return { why: 'expression' }

  // render(...)
  if (e.callee.type === 'Identifier' && e.callee.name === 'render') {
    if (e.arguments.length === 0) return { stmt: { id: newId('s'), k: 'render', target: 'all' } }
    if (e.arguments.length === 1 && e.arguments[0].type === 'Identifier' && isOut(e.arguments[0].name))
      return { stmt: { id: newId('s'), k: 'render', target: e.arguments[0].name } }
    return { why: 'render(expression)' }
  }
  // sN.initCam(...)
  if (
    e.callee.type === 'MemberExpression' &&
    !e.callee.computed &&
    e.callee.object.type === 'Identifier' &&
    isSourceName(e.callee.object.name) &&
    e.callee.property.type === 'Identifier' &&
    !e.optional
  ) {
    const kinds: Record<string, SourceInit['kind']> = { initCam: 'cam', initImage: 'image', initVideo: 'video', initScreen: 'screen', clear: 'clear' }
    const kind = kinds[e.callee.property.name]
    if (kind) {
      const init: SourceInit = { kind, ...unquoteArgs(e.arguments, c) }
      if (kind === 'clear' && e.arguments.length) return { why: 'clear(args)' }
      return { stmt: { id: newId('s'), k: 'source', slot: e.callee.object.name as any, init } }
    }
  }

  // chain
  const flat = flatten(e, c)
  if (!flat) return { why: 'call' }
  const outIdx = flat.mods.findIndex((m) => m.name === 'out')
  if (outIdx >= 0 && outIdx !== flat.mods.length - 1) return { why: 'out() mid-chain' }
  const hasOut = outIdx >= 0
  const genName = flat.gen.callee.name as string
  const genDef = c.cat.get(genName)
  if (!(genDef?.type === 'src') && !hasOut) return { why: 'not a hydra chain' }

  let out: OutName | null = null
  let outCall: FlatCall | undefined
  let modCalls = flat.mods
  if (hasOut) {
    outCall = flat.mods[outIdx]
    modCalls = flat.mods.slice(0, outIdx)
    const args = outCall.node.arguments as Node[]
    if (args.length === 0) out = 'o0'
    else if (args.length === 1 && args[0].type === 'Identifier' && isOut(args[0].name)) out = args[0].name as OutName
    else return { why: 'out(expression)' }
  }
  const gen = convertCall(genName, flat.gen, c)
  // per-call source records so an edit to one call only rewrites that call
  gen.src = { text: slice(c, flat.gen), hash: contentHash({ fn: gen.fn, args: gen.args }), args: argSpans(gen, flat.gen, flat.gen.start) }
  const gaps: string[] = []
  const mods: Call[] = []
  // `start` is where the segment's text begins (the `//` of a revived modifier's comment line), `end` where it ends
  let prevEnd = flat.gen.end
  const take = (call: Call, start: number, dot: number, end: number, node?: Node) => {
    call.src = { ...call.src, text: c.code.slice(dot, end), hash: contentHash({ fn: call.fn, args: call.args }) }
    if (node) call.src.args = argSpans(call, node, dot)
    gaps.push(c.code.slice(prevEnd, start))
    mods.push(call)
    prevEnd = end
  }
  const reviveUpTo = (next: number) => {
    for (const r of reviveCalls(c, prevEnd, next)) take(r.call, r.start, r.dot, r.end)
  }
  for (const m of modCalls) {
    reviveUpTo(m.dot!)
    take(convertCall(m.name, m.node, c), m.dot!, m.dot!, m.node.end, m.node)
  }
  if (!outCall && c.extendTo) {
    reviveUpTo(c.extendTo)
    c.absorbed = prevEnd
  }
  const chainSrc: Chain['src'] = { gaps }
  if (outCall) {
    reviveUpTo(outCall.dot!)
    gaps.push(c.code.slice(prevEnd, outCall.dot!))
    chainSrc.outText = c.code.slice(outCall.dot!, outCall.node.end)
    chainSrc.outHash = contentHash(out)
  }
  const chain: Chain = { id: newId('h'), gen, mods, out, src: chainSrc }
  return { stmt: { id: newId('s'), k: 'chain', chain } }
}

function convertDeclaration(node: Node, c: Ctx): Stmt | undefined {
  if (node.declarations.length !== 1) return undefined
  const d = node.declarations[0]
  if (d.id.type !== 'Identifier' || !d.init) return undefined
  const value = convertDefValue(d.init, c)
  c.defs.add(d.id.name)
  return { id: newId('s'), k: 'def', name: d.id.name, decl: node.kind, value }
}

/** An own-line comment that is nothing but `.call(...)` fragments (what a trailing disabled modifier looks like). */
function fragmentLine(c: Ctx, cm: acorn.Comment): boolean {
  if (cm.type !== 'Line') return false
  const dot = cm.start + 2 + /^\s*/.exec(cm.value)![0].length
  if (c.code[dot] !== '.') return false
  const calls = parseFragments({ ...c, unknown: new Set() }, dot, cm.end)
  return !!calls && /^\s*$/.test(c.code.slice(calls[calls.length - 1].end, cm.end))
}

function convertStatement(node: Node, c: Ctx, before: string): Stmt {
  c.absorbed = undefined
  const nodeText = slice(c, node)
  const rawStmt = (why?: string): Stmt => {
    c.absorbed = undefined
    if (why && why !== 'expression' && why !== 'call') c.warnings.push(`kept as raw code (${why}): ${nodeText.slice(0, 60).replace(/\s+/g, ' ')}`)
    return srcFor(c, { id: newId('s'), k: 'raw', code: nodeText }, nodeText, before)
  }
  let stmt: Stmt | undefined
  let why: string | undefined
  try {
    if (node.type === 'ExpressionStatement') {
      const r = convertExpressionStatement(node, c)
      stmt = r.stmt
      why = r.why
    } else if (node.type === 'VariableDeclaration') {
      stmt = convertDeclaration(node, c)
      if (!stmt) why = 'declaration'
    }
  } catch (err) {
    why = 'internal: ' + (err as Error).message
  }
  if (!stmt) return rawStmt(why)
  return srcFor(c, stmt, c.code.slice(node.start, Math.max(node.end, c.absorbed ?? 0)), before)
}

function commentStmt(text: string, block: boolean, trailing: boolean, raw: string, before: string): Stmt {
  const s: Stmt = { id: newId('s'), k: 'comment', text, ...(block ? { block: true } : {}), ...(trailing ? { trailing: true } : {}) }
  return { ...s, src: { text: raw, hash: contentHash(s), before } }
}

function commentText(cm: acorn.Comment): string {
  if (cm.type === 'Line') return cm.value.startsWith(' ') ? cm.value.slice(1) : cm.value
  return cm.value.replace(/^ /, '').replace(/ $/, '')
}

// ---------------------------------------------------------------- program

function importProgram(code: string, c: Ctx, base = 0): { stmts: Stmt[]; tail: string } {
  const comments: acorn.Comment[] = []
  const ast = acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    preserveParens: true,
    onComment: comments,
  }) as unknown as Node
  const saved = c.code
  const savedComments = c.comments
  c.code = code
  c.comments = comments
  const stmtItems: Item[] = (ast.body as Node[]).map((n) => ({ start: n.start, end: n.end, node: n }))
  const inside = (cm: acorn.Comment) => stmtItems.some((s) => cm.start >= s.start && cm.end <= s.end)
  const items: Item[] = [...stmtItems, ...comments.filter((cm) => !inside(cm)).map((cm) => ({ start: cm.start, end: cm.end, comment: cm }))]
  items.sort((a, b) => a.start - b.start)

  const stmts: Stmt[] = []
  let pos = 0
  let i = 0
  while (i < items.length) {
    const it = items[i]
    const before = code.slice(pos, it.start)
    if (it.node) {
      // own-line comments right after it that hold only `.call(...)` fragments may be its trailing disabled modifiers
      let ext = it.end
      let k = i + 1
      if (!code.slice(it.start, it.end).trimEnd().endsWith(';')) {
        while (k < items.length) {
          const nx = items[k]
          if (!nx.comment || !/^\r?\n[ \t]*$/.test(code.slice(ext, nx.start)) || !fragmentLine(c, nx.comment)) break
          ext = nx.end
          k++
        }
      }
      c.extendTo = ext > it.end ? ext : undefined
      stmts.push(convertStatement(it.node, c, before))
      c.extendTo = undefined
      pos = Math.max(it.end, c.absorbed ?? 0)
      c.absorbed = undefined
      i++
      while (i < items.length && items[i].start < pos) i++
      continue
    }
    const cm = it.comment!
    const trailing = stmts.length > 0 && !before.includes('\n') && pos > 0
    if (cm.type === 'Block') {
      stmts.push(commentStmt(commentText(cm), true, trailing, code.slice(it.start, it.end), before))
      pos = it.end
      i++
      continue
    }
    // group consecutive own-line `//` comments (single newline apart)
    let lastEnd = it.end
    const lines = [commentText(cm)]
    const run = [cm]
    let j = i + 1
    if (!trailing) {
      while (j < items.length) {
        const nx = items[j]
        if (!nx.comment || nx.comment.type !== 'Line') break
        const gap = code.slice(lastEnd, nx.start)
        if (!/^\r?\n[ \t]*$/.test(gap)) break
        lines.push(commentText(nx.comment))
        run.push(nx.comment)
        lastEnd = nx.end
        j++
      }
    }
    // commented-out code becomes disabled statements; prose stays a comment
    if (!trailing) stmts.push(...reviveRun(code, run, before, c))
    else stmts.push(commentStmt(lines.join('\n'), false, trailing, code.slice(it.start, lastEnd), before))
    pos = lastEnd
    i = j
  }
  c.code = saved
  c.comments = savedComments
  void base
  return { stmts, tail: code.slice(pos) }
}

function detectSemi(stmts: Stmt[]): boolean {
  let yes = 0
  let total = 0
  for (const s of stmts) {
    if (s.k === 'raw' || s.k === 'comment' || !s.src) continue
    total++
    if (s.src.text.trimEnd().endsWith(';')) yes++
  }
  return total > 0 && yes / total > 0.5
}

function emptyReport(): ImportReport {
  return { statements: 0, chains: 0, notRendered: 0, defs: 0, settings: 0, sources: 0, renders: 0, comments: 0, raw: 0, rawChars: 0, totalChars: 0, unknownCalls: [], parseFailed: false, revived: 0 }
}

function rawFallback(code: string, ctxWarnings: string[], why: string): { stmts: Stmt[]; tail: string } {
  ctxWarnings.push(why)
  const lead = code.match(/^\s*/)![0]
  const body = code.slice(lead.length).replace(/\s+$/, '')
  const tail = code.slice(lead.length + body.length)
  if (!body) return { stmts: [], tail: code }
  const s: Stmt = { id: newId('s'), k: 'raw', code: body }
  return { stmts: [{ ...s, src: { text: body, hash: contentHash(s), before: lead } }], tail }
}

export function importText(text: string, opts: ImportOptions = {}): ImportResult {
  // an inlined hydra-motion block ("self-contained" export) is the plugin, not code: it becomes a plugin ref, and the exact
  // text is kept so an untouched sketch exports byte for byte
  const prelude = splitPrelude(text)
  const code = prelude ? prelude.rest : text
  const c: Ctx = { code, cat: opts.catalog ?? defaultCatalog, defs: new Set(), unknown: new Set(), warnings: [], comments: [], revived: 0 }
  const report = emptyReport()
  let result: { stmts: Stmt[]; tail: string }
  try {
    result = importProgram(code, c)
  } catch (err) {
    report.parseFailed = true
    const msg = (err as Error).message
    if (opts.recover) result = recoverBlocks(code, c, msg)
    else result = rawFallback(code, c.warnings, `could not parse the sketch (${msg}); kept verbatim as one raw block`)
  }
  // safety net: the original text must be reproducible from the parts
  const rebuilt = result.stmts.map((s) => (s.src?.before ?? '') + (s.src?.text ?? '')).join('') + result.tail
  if (rebuilt !== code) {
    result = rawFallback(code, c.warnings, 'internal consistency check failed; kept verbatim as one raw block')
    report.parseFailed = true
  }
  const t = Date.now()
  const sketch: Sketch = {
    version: 1,
    id: opts.id ?? newId('k'),
    name: opts.name ?? 'Imported sketch',
    createdAt: t,
    modifiedAt: t,
    stmts: result.stmts,
    src: { tail: result.tail, semi: detectSemi(result.stmts) },
  }
  if (prelude) {
    sketch.src!.head = prelude.block
    sketch.plugins = [preludePluginRef(prelude)]
  }
  report.statements = sketch.stmts.length
  report.totalChars = text.length
  for (const s of sketch.stmts) {
    switch (s.k) {
      case 'chain':
        report.chains++
        if (s.chain.out === null && !s.disabled) report.notRendered++
        break
      case 'def': report.defs++; break
      case 'setting': report.settings++; break
      case 'source': report.sources++; break
      case 'render': report.renders++; break
      case 'comment': report.comments++; break
      case 'raw': report.raw++; report.rawChars += s.code.length; break
    }
  }
  report.unknownCalls = [...c.unknown].sort()
  report.revived = report.parseFailed ? 0 : c.revived
  if (report.notRendered) c.warnings.push(`${report.notRendered} chain(s) have no .out() and are not rendered`)
  if (report.unknownCalls.length) c.warnings.push(`unknown function(s): ${report.unknownCalls.join(', ')}`)
  return { sketch, warnings: c.warnings, report }
}

function recoverBlocks(code: string, c: Ctx, firstError: string): { stmts: Stmt[]; tail: string } {
  c.warnings.push(`could not parse the sketch as a whole (${firstError}); recovered block by block`)
  const parts = code.split(/(\n[ \t]*\n\s*)/)
  const stmts: Stmt[] = []
  let pending = ''
  let tail = ''
  let rawRun: { text: string; before: string } | undefined
  const flushRaw = () => {
    if (!rawRun) return
    const s: Stmt = { id: newId('s'), k: 'raw', code: rawRun.text }
    stmts.push({ ...s, src: { text: rawRun.text, hash: contentHash(s), before: rawRun.before } })
    rawRun = undefined
  }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i % 2 === 1) {
      if (rawRun) rawRun.text += part
      else pending += part
      continue
    }
    if (part.trim() === '') {
      if (rawRun) rawRun.text += part
      else pending += part
      continue
    }
    const lead = part.match(/^\s*/)![0]
    const body = part.slice(lead.length)
    try {
      const r = importProgram(body, c)
      if (rawRun) {
        // keep the text between a failed block and this one inside the raw run, then start fresh
        const trimmed = rawRun.text.replace(/\s+$/, '')
        const trailingWs = rawRun.text.slice(trimmed.length)
        rawRun.text = trimmed
        flushRaw()
        pending = trailingWs
      }
      r.stmts.forEach((s, k) => {
        if (k === 0 && s.src) s.src.before = pending + lead + s.src.before
        stmts.push(s)
      })
      pending = ''
      if (r.stmts.length === 0) pending = lead + body
      else tail = r.tail
      if (r.tail) {
        pending = r.tail
      }
    } catch {
      if (rawRun) rawRun.text += lead + body
      else rawRun = { text: body, before: pending + lead }
      if (!rawRun.before.length && pending) rawRun.before = pending
      pending = ''
    }
  }
  const finalRaw = rawRun as { text: string; before: string } | undefined
  if (finalRaw) {
    const trimmed = finalRaw.text.replace(/\s+$/, '')
    tail = finalRaw.text.slice(trimmed.length)
    finalRaw.text = trimmed
    flushRaw()
  } else {
    tail = pending
  }
  return { stmts, tail }
}

/** Thin alias returning just the sketch. */
export function fromCode(code: string, opts: ImportOptions = {}): Sketch {
  return importText(code, opts).sketch
}
