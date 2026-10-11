import { catalog as defaultCatalog, type Catalog, type InputDef } from './catalog'
import {
  contentHash,
  type ArrMods,
  type Call,
  type Chain,
  type Sketch,
  type Stmt,
  type Value,
} from './ir'
import { isSafeExpression } from './safe-expr'
import { loadScriptUrls } from './plugin-id'
import { activePrelude, knobInitial, MOTION_PLUGIN_ID } from './motion-core'
import { activeSketch } from './disable'

// ---------------------------------------------------------------- pieces with relative marks

export interface Mark {
  id: string
  from: number
  to: number
}
export interface Piece {
  t: string
  m: Mark[]
}
const lit = (t: string): Piece => ({ t, m: [] })
function cat(parts: Array<string | Piece>): Piece {
  let t = ''
  const m: Mark[] = []
  for (const p of parts) {
    if (typeof p === 'string') t += p
    else {
      for (const k of p.m) m.push({ id: k.id, from: k.from + t.length, to: k.to + t.length })
      t += p.t
    }
  }
  return { t, m }
}
function join(parts: Piece[], sep: string): Piece {
  const out: Array<string | Piece> = []
  parts.forEach((p, i) => {
    if (i) out.push(sep)
    out.push(p)
  })
  return cat(out)
}
function marked(id: string, p: Piece): Piece {
  return { t: p.t, m: [...p.m, { id, from: 0, to: p.t.length }] }
}

// ---------------------------------------------------------------- options

export interface CodegenOptions {
  catalog?: Catalog
  /** override semicolon style (default: what the sketch had on import, else none) */
  semicolons?: boolean
  /** ignore `src` records and regenerate everything (what the runtime does) */
  fresh?: boolean
}

export interface RunnableOptions extends CodegenOptions {
  /** skip raw code, plugins, unsafe expressions */
  safe?: boolean
  /** emit chain-call numeric args as `__hl["<callId>:<i>"]` closures so they can change without recompiling */
  live?: boolean
  /** name of the live table object in the sketch's global scope */
  liveName?: string
  /** leave out these `sN.initX(...)` statements (the runtime does this for sources it already initialised) */
  skipSource?: (s: Extract<Stmt, { k: 'source' }>) => boolean
}

interface Ctx {
  cat: Catalog
  semi: boolean
  fresh: boolean
  safe: boolean
  live: boolean
  liveName: string
  liveTable: Record<string, number>
  skipped: Array<{ id: string; reason: string }>
}

// ---------------------------------------------------------------- scalars

/** Id of a live-table slot: call id + argument index. Editors pass this to `runtime.setLive`. */
export const liveId = (callId: string, index: number): string => `${callId}:${index}`

export function fmtNum(v: number): string {
  if (!isFinite(v)) return '0'
  if (Object.is(v, -0)) return '0'
  return String(v)
}
export function quote(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r') + "'"
}

function defaultLiteral(input: InputDef | undefined): string {
  if (!input) return '0'
  if (input.type === 'sampler2D') return 'o0'
  const d = input.default
  if (Array.isArray(d)) return `[${d.map(fmtNum).join(', ')}]`
  if (typeof d === 'number') return fmtNum(d)
  return '0'
}

// ---------------------------------------------------------------- values

function emitMods(mods: ArrMods): string {
  let s = ''
  for (const key of Object.keys(mods) as Array<keyof ArrMods>) {
    const v = mods[key]
    if (v === undefined) continue
    switch (key) {
      case 'fast':
        s += `.fast(${fmtNum(v as number)})`
        break
      case 'smooth':
        s += `.smooth(${fmtNum(v as number)})`
        break
      case 'offset':
        s += `.offset(${fmtNum(v as number)})`
        break
      case 'ease':
        s += `.ease(${quote(v as string)})`
        break
      case 'fit':
        s += `.fit(${(v as [number, number]).map(fmtNum).join(', ')})`
        break
    }
  }
  return s
}

function emitValue(v: Value, ctx: Ctx, input?: InputDef): Piece {
  switch (v.k) {
    case 'num':
      return lit(fmtNum(v.v))
    case 'fn':
      if (ctx.safe && !isSafeExpression(v.src)) return lit(defaultLiteral(input))
      return lit(v.src)
    case 'js':
      if (ctx.safe && !isSafeExpression(v.src)) return lit(defaultLiteral(input))
      return lit(v.src)
    case 'arr':
      return lit(`[${v.v.map(fmtNum).join(', ')}]${emitMods(v.mods ?? {})}`)
    case 'vec4':
      return lit(`[${v.v.map(fmtNum).join(', ')}]`)
    case 'ref':
      return lit(v.name)
    case 'var':
      return lit(v.name)
    case 'default':
      return lit(defaultLiteral(input))
    case 'tex':
      return emitChainInline(v.chain, ctx)
  }
}

/** Trailing args that are `default` (or equal to the catalog default) are dropped. Live mode keeps explicit nums. */
function trimArgs(call: Call, ctx: Ctx, inputs: InputDef[]): Value[] {
  const out = call.args.slice()
  while (out.length) {
    const last = out[out.length - 1]
    const i = out.length - 1
    if (last.k === 'default') out.pop()
    else if (!ctx.live && last.k === 'num' && inputs[i] && inputs[i].default === last.v) out.pop()
    else break
  }
  return out
}

function emitCallArgs(call: Call, ctx: Ctx): Piece {
  const inputs = ctx.cat.inputs(call.fn)
  const args = trimArgs(call, ctx, inputs)
  const parts = args.map((a, i) => {
    const input = inputs[i]
    if (ctx.live && a.k === 'num' && input && input.type === 'float') {
      const id = liveId(call.id, i)
      ctx.liveTable[id] = a.v
      return lit(`() => ${ctx.liveName}[${JSON.stringify(id)}]`)
    }
    return emitValue(a, ctx, input)
  })
  return cat(['(', join(parts, ', '), ')'])
}

function emitCall(call: Call, position: 'gen' | 'mod', ctx: Ctx): Piece {
  const p = cat([position === 'mod' ? '.' : '', call.fn, emitCallArgs(call, ctx)])
  return marked(call.id, p)
}

function emitChainInline(chain: Chain, ctx: Ctx): Piece {
  const parts: Array<string | Piece> = [emitCall(chain.gen, 'gen', ctx)]
  for (const m of chain.mods) {
    // a chain inside a texture argument is written on one line, where a `//` comment would swallow the rest of the line.
    // `canDisable` refuses this case; should the IR carry it anyway, the call stays visible as a block comment.
    if (m.disabled) parts.push(marked(m.id, cat(['/* ', emitCall(m, 'mod', ctx), ' */'])))
    else parts.push(emitCall(m, 'mod', ctx))
  }
  return marked(chain.id, cat(parts))
}

function emitOut(out: Chain['out']): string {
  return out === 'o0' || out === undefined || out === null ? '.out()' : `.out(${out})`
}

/** Lead of a fresh disabled modifier line: `// .rotate(0.8)`. */
export const DISABLED_LEAD = '// '

interface Seg {
  p: Piece
  /** a disabled modifier (its call id): written after `lead` as a line comment */
  off?: string
  /** the call's own `//` lead as imported; `''` when it continued the previous call's comment line */
  lead?: string
}

/** The chain ends with a disabled modifier (a comment line), so nothing may follow it on that line, not even `;`. */
const endsDisabled = (chain: Chain) => chain.out == null && chain.mods.length > 0 && !!chain.mods[chain.mods.length - 1].disabled

/**
 * Lay out chain segments with the gaps between them. A disabled segment is a `//` line comment, so it must start on a
 * fresh line and whatever follows it must start on the next line; a disabled segment that directly follows another on
 * the same comment line (`// .rotate(1).kaleid(4)`) needs no second `//`.
 */
function assemble(segs: Seg[], gapAt: (i: number) => string): Piece {
  const parts: Array<string | Piece> = []
  let prevOff = false
  segs.forEach((sg, i) => {
    let g = i ? gapAt(i - 1) : ''
    const continuing = prevOff && !g.includes('\n')
    if (sg.off) {
      // `lead === ''`: imported as the second call on a comment line (`// .rotate(1).kaleid(4)`), and still is
      if (continuing && sg.lead === '') parts.push(g, sg.p)
      else {
        if (i && !/\n[ \t]*$/.test(g)) g += '\n  '
        parts.push(g, marked(sg.off, cat([sg.lead || DISABLED_LEAD, sg.p])))
      }
    } else {
      if (continuing) g += '\n  '
      if (i) parts.push(g)
      parts.push(sg.p)
    }
    prevOff = !!sg.off
  })
  return cat(parts)
}

/** Top-level chain: one modifier per line, preserving original per-call text and gaps where unchanged. */
function emitChainTop(chain: Chain, ctx: Ctx): Piece {
  const segs: Seg[] = []
  const callHashOk = (c: Call, pos: 'gen' | 'mod') =>
    !ctx.fresh && c.src && c.src.hash === contentHash({ fn: c.fn, args: c.args }) && c.src.text.startsWith('.') === (pos === 'mod')
  const segFor = (c: Call, pos: 'gen' | 'mod'): Seg => {
    let p = callHashOk(c, pos) ? marked(c.id, lit(c.src!.text)) : emitCall(c, pos, ctx)
    if (pos !== 'mod' || !c.disabled) return { p }
    // a disabled call is one comment line: a call written over several lines is written on one while it is off
    if (p.t.includes('\n')) p = emitCall(c, pos, { ...ctx, fresh: true })
    if (p.t.includes('\n')) p = { t: p.t.replace(/\r?\n/g, (nl) => nl + DISABLED_LEAD), m: [] }
    return { p, off: c.id, lead: ctx.fresh ? undefined : c.src?.lead }
  }
  segs.push(segFor(chain.gen, 'gen'))
  for (const m of chain.mods) segs.push(segFor(m, 'mod'))
  if (chain.out !== null && chain.out !== undefined) {
    const o = chain.src?.outText
    segs.push({ p: lit(!ctx.fresh && o !== undefined && chain.src?.outHash === contentHash(chain.out ?? null) ? o : emitOut(chain.out)) })
  }
  const gaps = !ctx.fresh ? chain.src?.gaps : undefined
  const defaultGap = chain.mods.length === 0 ? '' : '\n  '
  const gapAt = (i: number): string => {
    if (!gaps) return defaultGap
    if (i < gaps.length) return gaps[i]
    return gaps.length ? gaps[gaps.length - 1] : defaultGap
  }
  return marked(chain.id, assemble(segs, gapAt))
}

// ---------------------------------------------------------------- statements

/**
 * Content hash of a statement for format preservation. A statement's own `disabled` flag is left out: the original text
 * of a statement is kept whether it is switched on or off, and commented or uncommented as needed (`emitStmt`).
 */
export function stmtHash(s: Stmt): string {
  if (!('disabled' in s)) return contentHash(s)
  const { disabled: _d, ...rest } = s
  void _d
  return contentHash(rest)
}

/** `// ` before every line (`//` alone on an empty line): how a disabled statement is written. */
export function commentOut(text: string): string {
  return text
    .split(/(\r?\n)/)
    .map((l, i) => (i % 2 ? l : l.length && l !== '\r' ? DISABLED_LEAD + l : '//' + l))
    .join('')
}

/** Undo `commentOut` (and the importer's reading of a commented-out statement): drop `//` and one space from each line. */
export function uncommentOut(text: string): string {
  return text
    .split(/(\r?\n)/)
    .map((l, i) => (i % 2 ? l : l.replace(/^([ \t]*)\/\/ ?/, '$1')))
    .join('')
}

/** A (non-comment) statement's text is commented-out code: only disabled statements are, real code never starts with `//`. */
const isCommentedOut = (text: string) => text.startsWith('//')

/** `commentOut` for a piece: marks move with their text. */
function commentPiece(p: Piece): Piece {
  const t = commentOut(p.t)
  const lines = p.t.split('\n')
  const starts: number[] = []
  const added: number[] = []
  let pos = 0
  let acc = 0
  for (const line of lines) {
    starts.push(pos)
    acc += line.length && line !== '\r' ? DISABLED_LEAD.length : 2
    added.push(acc)
    pos += line.length + 1
  }
  const shift = (x: number) => {
    let k = 0
    while (k + 1 < starts.length && starts[k + 1] <= x) k++
    return x + added[k]
  }
  return { t, m: p.m.map((k) => ({ id: k.id, from: shift(k.from), to: k.to > k.from ? shift(k.to - 1) + 1 : shift(k.from) })) }
}

function emitStmtFresh(s: Stmt, ctx: Ctx): Piece {
  if (s.disabled) {
    const { disabled: _d, ...on } = s
    void _d
    return commentPiece(emitStmtFresh(on as Stmt, ctx))
  }
  // an edited statement keeps the semicolon habit it was imported with
  const semi = (s.src && !ctx.fresh ? /;\s*$/.test(s.src.text) : ctx.semi) ? ';' : ''
  switch (s.k) {
    case 'chain':
      return cat([emitChainTop(s.chain, ctx), endsDisabled(s.chain) ? '' : semi])
    case 'render':
      return lit(`render(${s.target === 'all' ? '' : s.target})${semi}`)
    case 'source': {
      const { kind, arg, argsSrc } = s.init
      if (kind === 'clear') return lit(`${s.slot}.clear()${semi}`)
      const fn = { cam: 'initCam', image: 'initImage', video: 'initVideo', screen: 'initScreen' }[kind]
      let a = ''
      if (argsSrc !== undefined) a = argsSrc
      else if (arg !== undefined) a = kind === 'image' || kind === 'video' ? quote(arg) : /^-?\d+(\.\d+)?$/.test(arg) ? arg : quote(arg)
      return lit(`${s.slot}.${fn}(${a})${semi}`)
    }
    case 'setting':
      return lit(`${s.name} = ${fmtNum(s.v)}${semi}`)
    case 'def': {
      const value = s.value.k === 'tex' ? emitChainTopLike(s.value.chain, ctx) : emitValue(s.value, ctx)
      const head = s.decl === 'bare' ? `${s.name} = ` : `${s.decl} ${s.name} = `
      return cat([head, value, s.value.k === 'tex' && endsDisabled(s.value.chain) ? '' : semi])
    }
    case 'comment':
      if (s.block) return lit(`/* ${s.text} */`)
      return lit(
        s.text
          .split('\n')
          .map((l) => `//${l.length ? ' ' : ''}${l}`)
          .join('\n'),
      )
    case 'raw':
      return lit(s.code)
  }
}

/** A chain used as a def value: same layout as a top-level chain but without .out */
function emitChainTopLike(chain: Chain, ctx: Ctx): Piece {
  const segs: Seg[] = [{ p: emitCall(chain.gen, 'gen', ctx) }, ...chain.mods.map((m): Seg => ({ p: emitCall(m, 'mod', ctx), off: m.disabled ? m.id : undefined }))]
  const gap = chain.mods.length ? '\n  ' : ''
  return marked(chain.id, assemble(segs, () => gap))
}

function defaultSep(prev: Stmt | undefined, cur: Stmt): string {
  if (!prev) return ''
  if (cur.k === 'comment' && cur.trailing) return ' '
  const big = (s: Stmt) => s.k === 'chain' || (s.k === 'def' && s.value.k === 'tex') || (s.k === 'raw' && s.code.includes('\n'))
  if (prev.k === 'comment' && !prev.trailing) return '\n'
  if (big(prev) || big(cur)) return '\n\n'
  return '\n'
}

/** Marks for a preserved top-level chain: lay the original segments (call texts + gaps) out again. */
function preservedChainMarks(chain: Chain, text: string, ctx: Ctx): Mark[] {
  const marks: Mark[] = [{ id: chain.id, from: 0, to: text.length }]
  const calls = [chain.gen, ...chain.mods]
  const gaps = chain.src?.gaps ?? []
  let pos = 0
  calls.forEach((c, i) => {
    if (i) pos += (gaps[i - 1] ?? '').length
    const t = c.src?.text
    if (t === undefined || text.slice(pos, pos + t.length) !== t) return
    marks.push({ id: c.id, from: pos, to: pos + t.length })
    // nested calls get ranges when the canonical formatting happens to equal the original text
    const fresh = emitCall(c, i === 0 ? 'gen' : 'mod', { ...ctx, fresh: true })
    if (fresh.t === t) for (const k of fresh.m) if (k.id !== c.id) marks.push({ id: k.id, from: pos + k.from, to: pos + k.to })
    pos += t.length
  })
  return marks
}

function emitStmt(s: Stmt, ctx: Ctx): Piece {
  if (!ctx.fresh && s.src && s.src.hash === stmtHash(s)) {
    // unchanged content: its original text, commented out or back in when only the statement's switch changed
    const had = s.k !== 'comment' && s.k !== 'raw' && isCommentedOut(s.src.text)
    const want = !!s.disabled
    const text = had === want ? s.src.text : want ? commentOut(s.src.text) : uncommentOut(s.src.text)
    const m: Mark[] = [{ id: s.id, from: 0, to: text.length }]
    const fresh = emitStmtFresh(s, { ...ctx, fresh: true, semi: /;\s*$/.test(text) })
    if (fresh.t === text) for (const k of fresh.m) m.push(k)
    else if (s.k === 'chain' && !want) m.push(...preservedChainMarks(s.chain, text, ctx))
    return { t: text, m }
  }
  return marked(s.id, emitStmtFresh(s, ctx))
}

function makeCtx(sketch: Sketch, opts: RunnableOptions): Ctx {
  return {
    cat: opts.catalog ?? defaultCatalog,
    semi: opts.semicolons ?? sketch.src?.semi ?? false,
    fresh: !!opts.fresh,
    safe: !!opts.safe,
    live: !!opts.live,
    liveName: opts.liveName ?? '__hl',
    liveTable: {},
    skipped: [],
  }
}

export interface CodeMap {
  [nodeId: string]: { from: number; to: number }
}

/** Idiomatic Hydra text plus source ranges per node id (stmts, chains, calls). */
export function toCodeWithMap(sketch: Sketch, opts: CodegenOptions = {}): { code: string; map: CodeMap } {
  const ctx = makeCtx(sketch, opts)
  const pieces: Piece[] = []
  let prev: Stmt | undefined
  const head = ctx.fresh ? undefined : activePrelude(sketch)
  let code = (head ?? '') + pluginPreamble(sketch, { skip: head ? MOTION_PLUGIN_ID : undefined })
  const map: CodeMap = {}
  sketch.stmts.forEach((s, i) => {
    let sep = !ctx.fresh && s.src ? s.src.before : defaultSep(prev, s)
    // a disabled statement is line comments: it starts on its own line, and so does what follows it (but a trailing comment)
    if (prev && (s.disabled || prev.disabled) && !sep.includes('\n') && !(s.k === 'comment' && s.trailing)) sep = '\n'
    const p = emitStmt(s, ctx)
    code += sep
    for (const k of p.m) map[k.id] = { from: code.length + k.from, to: code.length + k.to }
    code += p.t
    pieces.push(p)
    prev = s
  })
  const tail = !ctx.fresh && sketch.src ? sketch.src.tail : sketch.stmts.length ? '\n' : ''
  return { code: code + tail, map }
}

/**
 * Lines for plugins added through the plugin manager (`sketch.plugins`), so the exported text runs on hydra.ojack.xyz:
 * `await loadScript('<url>')` per URL plugin, unless a statement already loads that URL (imported text keeps its own
 * lines byte-for-byte), and a comment for pasted-code plugins, which plain text cannot carry.
 */
export function pluginPreamble(sketch: Sketch, opts: { skip?: string } = {}): string {
  const plugins = (sketch.plugins ?? []).filter((p) => p.id !== opts.skip)
  if (!plugins.length) return ''
  const already = new Set<string>()
  for (const s of sketch.stmts) if (s.k === 'raw') for (const u of loadScriptUrls(s.code)) already.add(u)
  let out = ''
  for (const p of plugins) {
    if (p.url && !already.has(p.url)) out += `await loadScript(${quote(p.url)})\n`
    else if (!p.url && p.src !== undefined) out += `// plugin "${(p.name || p.id).replace(/[\r\n]+/g, ' ')}" is pasted code saved with the sketch; plain text cannot include it\n`
  }
  return out && sketch.stmts.length ? out + '\n' : out
}

export function toCode(sketch: Sketch, opts: CodegenOptions = {}): string {
  return toCodeWithMap(sketch, opts).code
}

/** Code for a nested/def chain on its own (used by UIs for copy/paste of a single chain). */
export function chainToCode(chain: Chain, opts: CodegenOptions = {}): string {
  const ctx = makeCtx({} as Sketch, { ...opts, fresh: true })
  return emitChainTop({ ...chain, out: chain.out ?? undefined }, ctx).t
}

export interface Runnable {
  code: string
  /** initial values of the live table: pass to runtime.setLive / the frame before evaluating `code` */
  live: Record<string, number>
  /** statements left out (safe mode) */
  skipped: Array<{ id: string; reason: string }>
}

/**
 * What the runtime evaluates. Always regenerated from the IR (never from preserved text), comments dropped,
 * and — with `live` — numeric chain args become closures over a live table. The returned `code` does NOT contain
 * the live values, so editing a number leaves `code` byte-identical and the runtime can skip re-evaluation.
 */
export function toRunnable(input: Sketch, opts: RunnableOptions = {}): Runnable {
  // disabled statements and modifiers are comments: they never run
  const sketch = activeSketch(input)
  const ctx = makeCtx(sketch, { ...opts, fresh: true, semicolons: false })
  const out: string[] = []
  for (const s of sketch.stmts) {
    if (s.k === 'comment') continue
    if (s.k === 'source' && opts.skipSource?.(s)) continue
    if (ctx.safe) {
      // safe mode never loads plugins: a hydra-motion knob runs as its initial number, so the sketch still shows
      const knob = s.k === 'def' ? knobInitial(s.value) : undefined
      if (s.k === 'def' && knob !== undefined) {
        ctx.skipped.push({ id: s.id, reason: 'knob (needs the hydra-motion plugin): its initial number is used' })
        out.push(`${s.decl === 'bare' ? '' : s.decl + ' '}${s.name} = ${fmtNum(knob)}`)
        continue
      }
      if (s.k === 'raw') {
        ctx.skipped.push({ id: s.id, reason: 'raw code' })
        continue
      }
      if (s.k === 'def' && (s.value.k === 'js' || (s.value.k === 'fn' && !isSafeExpression(s.value.src)))) {
        ctx.skipped.push({ id: s.id, reason: 'arbitrary code in definition' })
        continue
      }
      if (s.k === 'source' && s.init.argsSrc !== undefined) {
        ctx.skipped.push({ id: s.id, reason: 'source arguments' })
        continue
      }
    }
    out.push(emitStmtFresh(s, ctx).t)
  }
  return { code: out.join('\n'), live: ctx.liveTable, skipped: ctx.skipped }
}
