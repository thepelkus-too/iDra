// Pure, identity-preserving edits of the IR. Every function returns the *same object* for untouched subtrees, so
// memoised rows only re-render when their own data changed. Nothing here touches the DOM.
import {
  DEFAULT,
  catalog as defaultCatalog,
  chainStmt,
  makeCall,
  makeChain,
  num,
  reId,
  tex,
  newId,
  OUT_NAMES,
  type Call,
  type Catalog,
  type Chain,
  type DefStmt,
  type FnDef,
  type OutName,
  type Sketch,
  type Stmt,
  type Value,
} from '@hydra-ipad/core'

// ---------------------------------------------------------------- stable traversal

function mapValue(v: Value, fc: (c: Chain) => Chain): Value {
  if (v.k !== 'tex') return v
  const chain = mapChain(v.chain, fc)
  return chain === v.chain ? v : { ...v, chain }
}
function mapCall(c: Call, fc: (c: Chain) => Chain): Call {
  let changed = false
  const args = c.args.map((a) => {
    const n = mapValue(a, fc)
    if (n !== a) changed = true
    return n
  })
  return changed ? { ...c, args } : c
}
function mapChain(chain: Chain, fc: (c: Chain) => Chain): Chain {
  const gen = mapCall(chain.gen, fc)
  let changed = gen !== chain.gen
  const mods = chain.mods.map((m) => {
    const n = mapCall(m, fc)
    if (n !== m) changed = true
    return n
  })
  return fc(changed ? { ...chain, gen, mods } : chain)
}

/** Apply `fc` to every chain (top-level, def values, nested textures), children first. Untouched statements keep identity. */
export function mapChains(sketch: Sketch, fc: (c: Chain) => Chain): Sketch {
  let changed = false
  const stmts = sketch.stmts.map((s): Stmt => {
    if (s.k === 'chain') {
      const chain = mapChain(s.chain, fc)
      if (chain === s.chain) return s
      changed = true
      return { ...s, chain }
    }
    if (s.k === 'def') {
      const value = mapValue(s.value, fc)
      if (value === s.value) return s
      changed = true
      return { ...s, value }
    }
    return s
  })
  return changed ? { ...sketch, stmts } : sketch
}

export function updateCall(sketch: Sketch, callId: string, f: (c: Call) => Call): Sketch {
  return mapChains(sketch, (chain) => {
    if (chain.gen.id === callId) {
      const gen = f(chain.gen)
      return gen === chain.gen ? chain : { ...chain, gen }
    }
    const i = chain.mods.findIndex((m) => m.id === callId)
    if (i < 0) return chain
    const next = f(chain.mods[i])
    if (next === chain.mods[i]) return chain
    const mods = chain.mods.slice()
    mods[i] = next
    return { ...chain, mods }
  })
}

export function updateChain(sketch: Sketch, chainId: string, f: (c: Chain) => Chain): Sketch {
  return mapChains(sketch, (c) => (c.id === chainId ? f(c) : c))
}

export function updateStmt(sketch: Sketch, stmtId: string, f: (s: Stmt) => Stmt): Sketch {
  let changed = false
  const stmts = sketch.stmts.map((s) => {
    if (s.id !== stmtId) return s
    const n = f(s)
    if (n !== s) changed = true
    return n
  })
  return changed ? { ...sketch, stmts } : sketch
}

export function findChain(sketch: Sketch, chainId: string): Chain | undefined {
  let found: Chain | undefined
  mapChains(sketch, (c) => {
    if (c.id === chainId) found = c
    return c
  })
  return found
}

export function findCallDeep(sketch: Sketch, callId: string): { call: Call; chain: Chain } | undefined {
  let found: { call: Call; chain: Chain } | undefined
  mapChains(sketch, (c) => {
    if (c.gen.id === callId) found = { call: c.gen, chain: c }
    for (const m of c.mods) if (m.id === callId) found = { call: m, chain: c }
    return c
  })
  return found
}

/** The statement (chain or def) that contains this call or chain id, and whether the id is its top-level chain. */
export function stmtOf(sketch: Sketch, id: string): Stmt | undefined {
  for (const s of sketch.stmts) {
    if (s.id === id) return s
    if (s.k === 'chain') {
      if (s.chain.id === id) return s
      if (findInChain(s.chain, id)) return s
    } else if (s.k === 'def' && s.value.k === 'tex' && findInChain(s.value.chain, id)) return s
  }
  return undefined
}
function findInChain(chain: Chain, id: string): boolean {
  if (chain.id === id) return true
  for (const c of [chain.gen, ...chain.mods]) {
    if (c.id === id) return true
    for (const a of c.args) if (a.k === 'tex' && findInChain(a.chain, id)) return true
  }
  return false
}

// ---------------------------------------------------------------- argument references

/** Where a Value lives: argument `i` of a call, or the value of a def statement. */
export type ArgRef = { call: string; i: number } | { def: string }

export const refKey = (r: ArgRef): string => ('def' in r ? `d:${r.def}` : `${r.call}:${r.i}`)

export function getArg(sketch: Sketch, r: ArgRef): Value | undefined {
  if ('def' in r) {
    const s = sketch.stmts.find((x) => x.id === r.def)
    return s && s.k === 'def' ? s.value : undefined
  }
  return findCallDeep(sketch, r.call)?.call.args[r.i]
}

export function setArg(sketch: Sketch, r: ArgRef, value: Value): Sketch {
  if ('def' in r) return updateStmt(sketch, r.def, (s) => (s.k === 'def' ? { ...s, value } : s))
  return updateCall(sketch, r.call, (c) => {
    const args = c.args.slice()
    while (args.length < r.i) args.push(DEFAULT)
    args[r.i] = value
    return { ...c, args }
  })
}

// ---------------------------------------------------------------- calls and chains

/** A fresh call with every input at its default. Texture inputs get a small pocket so the sketch stays valid. */
export function newCall(fn: FnDef | string, cat: Catalog = defaultCatalog): Call {
  const def = typeof fn === 'string' ? cat.get(fn) : fn
  const name = typeof fn === 'string' ? fn : fn.name
  const args: Value[] = []
  if (def) {
    def.inputs.forEach((inp, i) => {
      if (inp.type === 'sampler2D') {
        args[i] = name === 'src' ? { k: 'ref', name: 's0' } : tex(makeChain(makeCall('noise', [num(3)])))
      }
    })
    for (let i = 0; i < args.length; i++) if (!args[i]) args[i] = DEFAULT
  }
  return makeCall(name, args)
}

function sameKindOk(a: Value | undefined, input: { type: string } | undefined): boolean {
  if (!a || !input) return false
  if (a.k === 'default') return false
  if (input.type === 'sampler2D') return a.k === 'tex' || a.k === 'ref' || a.k === 'var'
  if (input.type === 'float') return a.k === 'num' || a.k === 'fn' || a.k === 'arr' || a.k === 'js' || a.k === 'var'
  if (input.type.startsWith('vec')) return a.k === 'vec4'
  return true
}

/** Swap the function of a call, keeping every argument whose slot is still compatible (same index, same sort of value). */
export function replaceFn(sketch: Sketch, callId: string, fn: string, cat: Catalog = defaultCatalog): Sketch {
  return updateCall(sketch, callId, (c) => {
    if (c.fn === fn) return c
    // renaming to a name the catalog does not know (a plugin that has not loaded): the arguments are the user's, keep them as written
    if (!cat.has(fn)) return { ...c, fn }
    const inputs = cat.inputs(fn)
    const fresh = newCall(fn, cat)
    const args: Value[] = inputs.map((inp, i) => (sameKindOk(c.args[i], inp) ? c.args[i] : (fresh.args[i] ?? DEFAULT)))
    while (args.length && args[args.length - 1].k === 'default') args.pop()
    return { ...c, fn, args }
  })
}

export function insertMod(sketch: Sketch, chainId: string, index: number, call: Call): Sketch {
  return updateChain(sketch, chainId, (c) => {
    const mods = c.mods.slice()
    mods.splice(Math.max(0, Math.min(index, mods.length)), 0, call)
    return { ...c, mods }
  })
}

export function removeMod(sketch: Sketch, chainId: string, callId: string): Sketch {
  return updateChain(sketch, chainId, (c) => ({ ...c, mods: c.mods.filter((m) => m.id !== callId) }))
}

export function moveMod(sketch: Sketch, chainId: string, from: number, to: number): Sketch {
  return updateChain(sketch, chainId, (c) => {
    if (from === to || from < 0 || from >= c.mods.length) return c
    const mods = c.mods.slice()
    const [m] = mods.splice(from, 1)
    mods.splice(Math.max(0, Math.min(to, mods.length)), 0, m)
    return { ...c, mods }
  })
}

export function duplicateMod(sketch: Sketch, chainId: string, callId: string): Sketch {
  return updateChain(sketch, chainId, (c) => {
    const i = c.mods.findIndex((m) => m.id === callId)
    if (i < 0) return c
    const mods = c.mods.slice()
    const copy = reId(structuredClone(c.mods[i]))
    delete copy.src
    mods.splice(i + 1, 0, copy)
    return { ...c, mods }
  })
}

export function setOut(sketch: Sketch, chainId: string, out: OutName | null): Sketch {
  return updateChain(sketch, chainId, (c) => (c.out === out ? c : { ...c, out }))
}

// ---------------------------------------------------------------- statements

/**
 * The whitespace that precedes a statement lives on the statement itself (`src.before`), so it travels with it when it is moved,
 * and a statement inserted in front of the first one would be glued to it. After any structural change, fix the spacing of the
 * statements whose predecessor changed: first stays flush, an unseparated one gets core's default separator.
 */
function defaultSep(prev: Stmt, cur: Stmt): string {
  if (cur.k === 'comment' && cur.trailing) return ' '
  const big = (s: Stmt) => s.k === 'chain' || (s.k === 'def' && s.value.k === 'tex') || (s.k === 'raw' && s.code.includes('\n'))
  if (prev.k === 'comment' && !prev.trailing) return '\n'
  if (big(prev) || big(cur)) return '\n\n'
  return '\n'
}

export function respace(sketch: Sketch, touched: Iterable<string>): Sketch {
  const ids = new Set(touched)
  let changed = false
  const stmts = sketch.stmts.map((s, i) => {
    if (!ids.has(s.id) || !s.src) return s
    const newlines = (t: string) => (t.match(/\n/g) ?? []).length
    let before = ''
    if (i > 0) {
      // keep the author's spacing when it already separates enough (a blank line between chains), otherwise use core's default
      const want = defaultSep(sketch.stmts[i - 1], s)
      before = newlines(s.src.before) >= newlines(want) && (want === ' ' || s.src.before.length > 0) ? s.src.before : want
    }
    if (before === s.src.before) return s
    changed = true
    return { ...s, src: { ...s.src, before } } as Stmt
  })
  return changed ? { ...sketch, stmts } : sketch
}

export function insertStmt(sketch: Sketch, index: number, stmt: Stmt): Sketch {
  const at = Math.max(0, Math.min(index, sketch.stmts.length))
  const stmts = sketch.stmts.slice()
  stmts.splice(at, 0, stmt)
  return respace({ ...sketch, stmts }, [stmt.id, stmts[at + 1]?.id].filter(Boolean) as string[])
}
export function removeStmt(sketch: Sketch, stmtId: string): Sketch {
  const i = sketch.stmts.findIndex((s) => s.id === stmtId)
  if (i < 0) return sketch
  const stmts = sketch.stmts.filter((s) => s.id !== stmtId)
  return respace({ ...sketch, stmts }, [stmts[i]?.id].filter(Boolean) as string[])
}
export function moveStmt(sketch: Sketch, stmtId: string, to: number): Sketch {
  const from = sketch.stmts.findIndex((s) => s.id === stmtId)
  if (from < 0 || from === to) return sketch
  const stmts = sketch.stmts.slice()
  const [s] = stmts.splice(from, 1)
  const at = Math.max(0, Math.min(to, stmts.length))
  stmts.splice(at, 0, s)
  // the moved statement, whoever now follows it, and whoever followed it before
  const touched = [s.id, stmts[at + 1]?.id, sketch.stmts[from + 1]?.id].filter(Boolean) as string[]
  return respace({ ...sketch, stmts }, touched)
}
export function duplicateStmt(sketch: Sketch, stmtId: string): Sketch {
  const i = sketch.stmts.findIndex((s) => s.id === stmtId)
  if (i < 0) return sketch
  const copy = reId(structuredClone(sketch.stmts[i])) as Stmt
  delete (copy as { src?: unknown }).src
  const strip = (c: Chain) => {
    delete c.src
    for (const call of [c.gen, ...c.mods]) {
      delete call.src
      for (const a of call.args) if (a.k === 'tex') strip(a.chain)
    }
  }
  if (copy.k === 'chain') strip(copy.chain)
  else if (copy.k === 'def') {
    // a duplicate def needs its own name
    copy.name = uniqueName(sketch, copy.name)
    if (copy.value.k === 'tex') strip(copy.value.chain)
  }
  return insertStmt(sketch, i + 1, copy)
}

export function uniqueName(sketch: Sketch, base: string): string {
  const taken = new Set(sketch.stmts.filter((s): s is DefStmt => s.k === 'def').map((s) => s.name))
  const stem = base.replace(/\d+$/, '') || 'x'
  if (!taken.has(base)) return base
  for (let n = 2; n < 1000; n++) if (!taken.has(stem + n)) return stem + n
  return stem + newId('')
}

/** Rename a def and every `var` reference to it (references in raw code cannot be followed and are left alone). */
export function renameDef(sketch: Sketch, stmtId: string, name: string): Sketch {
  const s = sketch.stmts.find((x) => x.id === stmtId)
  if (!s || s.k !== 'def' || s.name === name) return sketch
  const old = s.name
  const fixValue = (v: Value): Value => {
    if (v.k === 'var' && v.name === old) return { ...v, name }
    return v
  }
  let next = mapChains(sketch, (c) => {
    const fixCall = (call: Call): Call => {
      if (!call.args.some((a) => a.k === 'var' && a.name === old)) return call
      return { ...call, args: call.args.map(fixValue) }
    }
    const gen = fixCall(c.gen)
    const mods = c.mods.map(fixCall)
    return gen === c.gen && mods.every((m, i) => m === c.mods[i]) ? c : { ...c, gen, mods }
  })
  next = {
    ...next,
    stmts: next.stmts.map((x) => {
      if (x.id === stmtId && x.k === 'def') return { ...x, name }
      if (x.k === 'def') {
        const v = fixValue(x.value)
        return v === x.value ? x : { ...x, value: v }
      }
      return x
    }),
  }
  return next
}

export function defsBefore(sketch: Sketch, stmtId: string | undefined): DefStmt[] {
  const out: DefStmt[] = []
  for (const s of sketch.stmts) {
    if (s.id === stmtId) break
    if (s.k === 'def') out.push(s)
  }
  return out
}

export function freeOutputs(sketch: Sketch): OutName[] {
  const used = new Set<OutName>()
  for (const s of sketch.stmts) if (s.k === 'chain' && s.chain.out) used.add(s.chain.out)
  return OUT_NAMES.filter((o) => !used.has(o))
}

export function newChainStmt(sketch: Sketch, gen = 'osc', out?: OutName | null): Stmt {
  const o = out === undefined ? (freeOutputs(sketch)[0] ?? 'o0') : out
  return chainStmt(makeChain(newCall(gen), [], o))
}

/** Index to insert a setup statement (source/setting): after leading comments and other setup statements, before the first chain. */
export function setupInsertIndex(sketch: Sketch): number {
  let i = 0
  let last = 0
  for (; i < sketch.stmts.length; i++) {
    const s = sketch.stmts[i]
    if (s.k === 'source' || s.k === 'setting') last = i + 1
    else if (s.k === 'chain' || s.k === 'def' || s.k === 'raw' || s.k === 'render') break
  }
  return last
}
