// Disabling chunks of a sketch without deleting them. A disabled node is ordinary commented-out code in the exported
// text (`// .rotate(0.8)` inside a chain, `// ` before every line of a statement), so vanilla Hydra skips it exactly as
// iDra does, and the importer revives it (parse.ts). See docs/IR.md, "Disabled nodes".
import type { Call, Chain, Sketch, Stmt, Value } from './ir'

export type DisableKind = 'stmt' | 'call' | 'missing'

export interface DisableCheck {
  /** the toggle can flip this node on its own */
  ok: boolean
  /** the node is disabled now (so the toggle would enable it) */
  disabled: boolean
  kind: DisableKind
  /** why `ok` is false, in one plain sentence (for a tooltip or long-press) */
  reason?: string
  /**
   * Statements that would have to switch with it: when disabling a `def`, the statements that still use it; when enabling,
   * the disabled `def`s it needs. `setDisabled(…, { cascade: true })` switches them together.
   */
  cascade?: string[]
  /** the node to switch instead (a generator → its chain statement, a call inside a texture argument → the call taking it) */
  instead?: string
}

interface Located {
  stmt: Stmt
  stmtIndex: number
  call?: Call
  chain?: Chain
  position?: 'gen' | 'mod'
  /** the call is inside a texture argument (written inline, on one line) */
  nested?: boolean
  /** the call whose texture argument holds this chain (nested chains only) */
  parentCall?: Call
}

/** Find a statement or a call by id, with where it sits. */
export function locate(sketch: Sketch, id: string): Located | undefined {
  for (let i = 0; i < sketch.stmts.length; i++) {
    const s = sketch.stmts[i]
    if (s.id === id) return { stmt: s, stmtIndex: i }
    const inChain = (chain: Chain, nested: boolean, parentCall?: Call): Located | undefined => {
      const calls: Array<[Call, 'gen' | 'mod']> = [[chain.gen, 'gen'], ...chain.mods.map((m) => [m, 'mod'] as [Call, 'mod'])]
      for (const [c, position] of calls) {
        if (c.id === id) return { stmt: s, stmtIndex: i, call: c, chain, position, nested, parentCall }
        for (const a of c.args) {
          if (a.k !== 'tex') continue
          const r = inChain(a.chain, true, c)
          if (r) return r
        }
      }
      return undefined
    }
    let r: Located | undefined
    if (s.k === 'chain') r = inChain(s.chain, false)
    else if (s.k === 'def' && s.value.k === 'tex') r = inChain(s.value.chain, false)
    if (r) return r
  }
  return undefined
}

// ---------------------------------------------------------------- names used / defined

const IDENT_RE = /[A-Za-z_$][\w$]*/g

/** Every identifier a value mentions (var references, and identifiers inside function / JS source). */
function valueNames(v: Value, out: Set<string>) {
  switch (v.k) {
    case 'var':
      out.add(v.name)
      break
    case 'fn':
    case 'js':
      for (const m of v.src.match(IDENT_RE) ?? []) out.add(m)
      break
    case 'tex':
      chainNames(v.chain, out)
      break
  }
}
function chainNames(c: Chain, out: Set<string>) {
  for (const call of [c.gen, ...c.mods]) callNames(call, out)
}
function callNames(c: Call, out: Set<string>) {
  for (const a of c.args) valueNames(a, out)
}

/** Identifiers a statement reads. Disabled modifiers inside it count only when `withDisabled` is set. */
export function namesUsed(s: Stmt, withDisabled = false): Set<string> {
  const out = new Set<string>()
  const chain = (c: Chain) => {
    callNames(c.gen, out)
    for (const m of c.mods) if (withDisabled || !m.disabled) callNames(m, out)
  }
  switch (s.k) {
    case 'chain':
      chain(s.chain)
      break
    case 'def':
      if (s.value.k === 'tex') chain(s.value.chain)
      else valueNames(s.value, out)
      break
    case 'raw':
      for (const m of s.code.match(IDENT_RE) ?? []) out.add(m)
      break
    case 'source':
      for (const m of s.init.argsSrc?.match(IDENT_RE) ?? []) out.add(m)
      break
  }
  return out
}

const enabledDefines = (sketch: Sketch, name: string, except: string) =>
  sketch.stmts.some((s) => s.k === 'def' && s.name === name && !s.disabled && s.id !== except)

/** Enabled statements that read `name`, other than `except`. */
function usersOf(sketch: Sketch, name: string, except: Set<string>): Stmt[] {
  return sketch.stmts.filter((s) => !s.disabled && !except.has(s.id) && s.k !== 'comment' && namesUsed(s).has(name))
}

/** Disabling `def` statement `id`: the statements that would be left reading a name nobody defines (transitively). */
function disableCascade(sketch: Sketch, id: string): { ids: string[]; raw?: Extract<Stmt, { k: 'raw' }> } {
  const out = new Set<string>([id])
  const queue = [id]
  while (queue.length) {
    const sid = queue.shift()!
    const s = sketch.stmts.find((x) => x.id === sid)
    if (!s || s.k !== 'def') continue
    if (enabledDefines({ ...sketch, stmts: sketch.stmts.filter((x) => !out.has(x.id)) }, s.name, sid)) continue
    for (const u of usersOf(sketch, s.name, out)) {
      if (u.k === 'raw') return { ids: [...out].filter((x) => x !== id), raw: u }
      out.add(u.id)
      queue.push(u.id)
    }
  }
  out.delete(id)
  return { ids: sketch.stmts.filter((s) => out.has(s.id)).map((s) => s.id) }
}

/** Enabling statement or call `node`: disabled defs it needs whose name no enabled def provides (transitively). */
function enableCascade(sketch: Sketch, names: Set<string>, self?: string): string[] {
  const out = new Set<string>()
  const queue = [...names]
  const seen = new Set<string>()
  while (queue.length) {
    const n = queue.shift()!
    if (seen.has(n)) continue
    seen.add(n)
    if (enabledDefines(sketch, n, self ?? '')) continue
    // the closest disabled definition of the name (the last one, as later code wins in Hydra)
    const defs = sketch.stmts.filter((s) => s.k === 'def' && s.name === n && s.disabled && s.id !== self)
    const d = defs[defs.length - 1]
    if (!d || out.has(d.id)) continue
    out.add(d.id)
    for (const m of namesUsed(d)) queue.push(m)
  }
  return sketch.stmts.filter((s) => out.has(s.id)).map((s) => s.id)
}

/** A call whose arguments hold multi-line code (a function with a block body) cannot be one comment line. */
function callSpansLines(c: Call): boolean {
  const v = (x: Value): boolean => ((x.k === 'fn' || x.k === 'js') && /[\r\n]/.test(x.src)) || (x.k === 'tex' && [x.chain.gen, ...x.chain.mods].some(callSpansLines))
  return c.args.some(v)
}

// ---------------------------------------------------------------- the check

const DISABLEABLE: ReadonlyArray<Stmt['k']> = ['chain', 'def', 'source', 'setting', 'render']

/**
 * Can node `id` (a statement or a call) be switched off, or back on, by itself?
 * - modifiers of a chain statement or of a chain held by a `def`: yes (combine/combineCoord take their texture argument with them);
 * - a generator: no, switch off its chain statement (`instead`);
 * - a call inside a texture argument: no, that chain is written on one line; switch off the call taking it (`instead`);
 * - chain, source, setting, render statements: yes; disabling the last chain that draws anything is fine;
 * - a `def` that enabled code still uses: no, unless its users switch off with it (`cascade`); enabling a statement that
 *   needs a disabled `def` likewise lists that def in `cascade`;
 * - comments are already ignored by Hydra, and raw code is edited as code: no.
 */
export function canDisable(sketch: Sketch, id: string): DisableCheck {
  const at = locate(sketch, id)
  if (!at) return { ok: false, disabled: false, kind: 'missing', reason: 'nothing with this id is in the sketch' }
  if (at.call) {
    const call = at.call
    const disabled = !!call.disabled
    const base = { disabled, kind: 'call' as const }
    if (at.nested) {
      return {
        ...base,
        ok: false,
        reason: 'this is part of a texture argument, written on one line; switch off the call that takes it instead',
        instead: at.parentCall?.id,
      }
    }
    if (!disabled && callSpansLines(call)) {
      return { ...base, ok: false, reason: 'this call holds code written over several lines; switch off the whole statement instead', instead: at.stmt.id }
    }
    if (at.position === 'gen') {
      return { ...base, ok: false, reason: 'a generator starts its chain: switch off the whole chain instead', instead: at.stmt.id }
    }
    if (disabled) {
      const need = new Set<string>()
      callNames(call, need)
      const cascade = enableCascade(sketch, need)
      if (cascade.length) return { ...base, ok: false, reason: `it uses ${namesOf(sketch, cascade)}, which ${cascade.length > 1 ? 'are' : 'is'} switched off`, cascade }
    }
    return { ...base, ok: true }
  }
  const s = at.stmt
  const disabled = !!s.disabled
  const base = { disabled, kind: 'stmt' as const }
  if (s.k === 'comment') return { ...base, ok: false, reason: 'a comment is already ignored by Hydra' }
  if (s.k === 'raw') return { ...base, ok: false, reason: 'raw code is edited as code: comment it out in the code view' }
  if (!DISABLEABLE.includes(s.k)) return { ...base, ok: false, reason: 'this statement cannot be switched off' }
  if (!disabled && s.k === 'def') {
    const { ids, raw } = disableCascade(sketch, s.id)
    if (raw) return { ...base, ok: false, reason: `"${s.name}" is used by raw code (${raw.code.split('\n')[0].slice(0, 40)}); it cannot be switched off` }
    if (ids.length) return { ...base, ok: false, reason: `"${s.name}" is still used by ${ids.length} statement${ids.length > 1 ? 's' : ''}`, cascade: ids }
  }
  if (disabled) {
    const cascade = enableCascade(sketch, namesUsed(s), s.id)
    if (cascade.length) return { ...base, ok: false, reason: `it uses ${namesOf(sketch, cascade)}, which ${cascade.length > 1 ? 'are' : 'is'} switched off`, cascade }
  }
  return { ...base, ok: true }
}

function namesOf(sketch: Sketch, ids: string[]): string {
  return ids
    .map((id) => sketch.stmts.find((s) => s.id === id))
    .map((s) => (s && s.k === 'def' ? `"${s.name}"` : 'a statement'))
    .join(', ')
}

// ---------------------------------------------------------------- switching

const withFlag = <T extends { disabled?: boolean }>(n: T, on: boolean): T => {
  if (on) return { ...n, disabled: true }
  if (!('disabled' in n)) return n
  const { disabled: _d, ...rest } = n
  void _d
  return rest as T
}

function mapCallIn(s: Stmt, id: string, on: boolean): Stmt {
  const inChain = (c: Chain): Chain => ({ ...c, mods: c.mods.map((m) => (m.id === id ? withFlag(m, on) : m)) })
  if (s.k === 'chain') return { ...s, chain: inChain(s.chain) }
  if (s.k === 'def' && s.value.k === 'tex') return { ...s, value: { ...s.value, chain: inChain(s.value.chain) } }
  return s
}

export interface SetDisabledOptions {
  /** also switch the statements `canDisable` lists in `cascade` (a def's users, or the defs a statement needs) */
  cascade?: boolean
}

/**
 * Switch node `id` off (`on = true`) or back on. Returns the sketch unchanged when `canDisable` says no (and `cascade`
 * does not resolve it). Enabling deletes the flag, so `setDisabled(setDisabled(x, id, true), id, false)` is `x` again
 * and its text is byte-identical.
 */
export function setDisabled(sketch: Sketch, id: string, on: boolean, opts: SetDisabledOptions = {}): Sketch {
  const check = canDisable(sketch, id)
  if (check.disabled === on) return sketch
  if (!check.ok && !(opts.cascade && check.cascade?.length)) return sketch
  const also = new Set(opts.cascade ? (check.cascade ?? []) : [])
  const at = locate(sketch, id)!
  return {
    ...sketch,
    stmts: sketch.stmts.map((s) => {
      if (at.call && s.id === at.stmt.id) return mapCallIn(s, id, on)
      if (s.id === id || also.has(s.id)) return withFlag(s, on)
      return s
    }),
  }
}

/** Flip node `id`. */
export function toggleDisabled(sketch: Sketch, id: string, opts: SetDisabledOptions = {}): Sketch {
  const check = canDisable(sketch, id)
  return setDisabled(sketch, id, !check.disabled, opts)
}

export function isDisabled(sketch: Sketch, id: string): boolean {
  const at = locate(sketch, id)
  if (!at) return false
  return !!(at.call ? at.call.disabled || at.stmt.disabled : at.stmt.disabled)
}

/** Ids of every disabled statement and every disabled call (calls inside disabled statements included). */
export function disabledNodes(sketch: Sketch): { stmts: string[]; calls: string[] } {
  const stmts: string[] = []
  const calls: string[] = []
  const chain = (c: Chain) => {
    for (const m of [c.gen, ...c.mods]) {
      if (m.disabled) calls.push(m.id)
      for (const a of m.args) if (a.k === 'tex') chain(a.chain)
    }
  }
  for (const s of sketch.stmts) {
    if (s.disabled) stmts.push(s.id)
    if (s.k === 'chain') chain(s.chain)
    else if (s.k === 'def' && s.value.k === 'tex') chain(s.value.chain)
  }
  return { stmts, calls }
}

export function hasDisabled(sketch: Sketch): boolean {
  const d = disabledNodes(sketch)
  return d.stmts.length + d.calls.length > 0
}

function activeChain(c: Chain): Chain {
  const strip = (call: Call): Call => (call.args.some((a) => a.k === 'tex') ? { ...call, args: call.args.map((a) => (a.k === 'tex' ? { ...a, chain: activeChain(a.chain) } : a)) } : call)
  if (!c.mods.some((m) => m.disabled) && ![c.gen, ...c.mods].some((m) => m.args.some((a) => a.k === 'tex'))) return c
  return { ...c, gen: strip(c.gen), mods: c.mods.filter((m) => !m.disabled).map(strip) }
}

/**
 * What runs: the sketch with disabled statements and disabled calls removed (src records kept, so this is for analysis
 * and running, not for export). Returns the same object when nothing is disabled.
 */
export function activeSketch(sketch: Sketch): Sketch {
  if (!hasDisabled(sketch)) return sketch
  return {
    ...sketch,
    stmts: sketch.stmts
      .filter((s) => !s.disabled)
      .map((s): Stmt => {
        if (s.k === 'chain') return { ...s, chain: activeChain(s.chain) }
        if (s.k === 'def' && s.value.k === 'tex') return { ...s, value: { ...s.value, chain: activeChain(s.value.chain) } }
        return s
      }),
  }
}

/** Everything switched back on (the "as if nothing were disabled" view `describe` compares against). */
export function enableAll(sketch: Sketch): Sketch {
  if (!hasDisabled(sketch)) return sketch
  const chain = (c: Chain): Chain => {
    const fix = (m: Call): Call => {
      const n = withFlag(m, false)
      return n.args.some((a) => a.k === 'tex') ? { ...n, args: n.args.map((a) => (a.k === 'tex' ? { ...a, chain: chain(a.chain) } : a)) } : n
    }
    return { ...c, gen: fix(c.gen), mods: c.mods.map(fix) }
  }
  return {
    ...sketch,
    stmts: sketch.stmts.map((s0) => {
      const s = withFlag(s0, false)
      if (s.k === 'chain') return { ...s, chain: chain(s.chain) }
      if (s.k === 'def' && s.value.k === 'tex') return { ...s, value: { ...s.value, chain: chain(s.value.chain) } }
      return s
    }),
  }
}
