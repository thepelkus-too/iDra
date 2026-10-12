// The operator tray's model: where a tapped or dropped operator goes, and what the drop does to the sketch. Pure functions
// (unit-tested in test/tray.test.ts) plus the tray's small UI state (open, insertion target, recents, favourites).
import { makeCall, makeChain, num, tex, type Catalog, type Sketch, type Value } from '@hydra-ipad/core'
import { findCallDeep, findChain, getArg, insertMod, insertStmt, newCall, newChainStmt, replaceFn, setArg, stmtOf } from './model'

/** Where an operator lands. */
export type DropTarget =
  /** between two rows of a chain: inserted as modifier number `index` */
  | { kind: 'gap'; chainId: string; index: number }
  /** on a texture parameter (argument `i` of call `callId`): becomes or joins a nested pocket */
  | { kind: 'tex'; callId: string; i: number }
  /** between statements (generators): a new chain statement at statement index `index` */
  | { kind: 'stmt'; index: number }

export const isGenerator = (fn: string, cat: Catalog): boolean => cat.get(fn)?.type === 'src'

export interface DropResult {
  sketch: Sketch
  /** the call or statement to select afterwards */
  select?: string
  /** a refusal, in one plain sentence (the sketch is unchanged) */
  refused?: string
}

/** Apply operator `fn` at `target`. */
export function dropOperator(sketch: Sketch, target: DropTarget, fn: string, cat: Catalog): DropResult {
  const gen = isGenerator(fn, cat)
  if (target.kind === 'stmt') {
    if (!gen) return { sketch, refused: 'Only a generator starts a new chain; drop a modifier between two rows of a chain' }
    const st = newChainStmt(sketch, fn)
    return { sketch: insertStmt(sketch, Math.max(0, Math.min(target.index, sketch.stmts.length)), st), select: st.id }
  }
  if (target.kind === 'gap') {
    if (gen) return { sketch, refused: `${fn} is a generator: it starts a chain, so it can't go in the middle of one` }
    if (!findChain(sketch, target.chainId)) return { sketch, refused: 'That chain is gone' }
    const c = newCall(fn, cat)
    return { sketch: insertMod(sketch, target.chainId, target.index, c), select: c.id }
  }
  // a texture parameter
  const cur: Value | undefined = getArg(sketch, { call: target.callId, i: target.i })
  if (gen) {
    if (cur?.k === 'tex') {
      // a pocket already: swap its generator, keep its modifiers
      return { sketch: replaceFn(sketch, cur.chain.gen.id, fn, cat), select: cur.chain.gen.id }
    }
    const g = newCall(fn, cat)
    return { sketch: setArg(sketch, { call: target.callId, i: target.i }, tex(makeChain(g))), select: g.id }
  }
  const m = newCall(fn, cat)
  if (cur?.k === 'tex') return { sketch: insertMod(sketch, cur.chain.id, cur.chain.mods.length, m), select: m.id }
  if (cur?.k === 'var') return { sketch, refused: `This reads the variable ${cur.name}; add the modifier to its definition instead` }
  // an o/s reference keeps reading the same picture, through src(); anything else starts from a small noise
  const base = cur?.k === 'ref' ? makeCall('src', [cur]) : makeCall('noise', [num(3)])
  return { sketch: setArg(sketch, { call: target.callId, i: target.i }, tex(makeChain(base, [m]))), select: m.id }
}

/**
 * Where a tap (or the search field's Enter) inserts: after the selected row; at the end of the selected chain statement;
 * else at the end of the active chain, else of the first chain. Generators make a new chain after the selected statement.
 */
export function tapTarget(sketch: Sketch, fn: string, cat: Catalog, selection: string | undefined, activeStmt: string | undefined): DropTarget | undefined {
  const sel = selection ? stmtOf(sketch, selection) : undefined
  if (isGenerator(fn, cat)) {
    const i = sel ? sketch.stmts.findIndex((s) => s.id === sel.id) : -1
    return { kind: 'stmt', index: i >= 0 ? i + 1 : sketch.stmts.length }
  }
  if (selection) {
    const f = findCallDeep(sketch, selection)
    if (f) {
      if (f.chain.gen.id === selection) return { kind: 'gap', chainId: f.chain.id, index: 0 }
      return { kind: 'gap', chainId: f.chain.id, index: f.chain.mods.findIndex((m) => m.id === selection) + 1 }
    }
  }
  const chainOf = (id: string | undefined) => {
    const s = id ? sketch.stmts.find((x) => x.id === id) : undefined
    if (s?.k === 'chain') return s.chain
    if (s?.k === 'def' && s.value.k === 'tex') return s.value.chain
    return undefined
  }
  const c = chainOf(sel?.id) ?? chainOf(activeStmt) ?? chainOf(sketch.stmts.find((s) => s.k === 'chain')?.id)
  return c ? { kind: 'gap', chainId: c.id, index: c.mods.length } : undefined
}

// ---------------------------------------------------------------- UI state

export interface TrayTarget {
  /** a fixed insertion point (long-press "insert above/below"): taps go here until it is cleared */
  drop: DropTarget
  label: string
}

export interface TrayState {
  open: boolean
  target?: TrayTarget
  /** a row is being dragged: the tray shows its "drop here to delete" zone */
  rowDrag: boolean
  /** a row drag is over the tray */
  rowOver: boolean
}

const listeners = new Set<() => void>()
export const tray: TrayState = { open: false, rowDrag: false, rowOver: false }

export function setTray(patch: Partial<TrayState>): void {
  let changed = false
  for (const k of Object.keys(patch) as Array<keyof TrayState>) {
    if (tray[k] !== patch[k]) {
      ;(tray as unknown as Record<string, unknown>)[k] = patch[k]
      changed = true
    }
  }
  if (changed) listeners.forEach((l) => l())
}

/** Re-render the tray (its recents / favourites live in preferences, not in this state). */
export function bumpTray(): void {
  listeners.forEach((l) => l())
}

export function onTray(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Most recent first, without duplicates, at most `max`. */
export function pushRecent(list: string[], fn: string, max = 8): string[] {
  return [fn, ...list.filter((x) => x !== fn)].slice(0, max)
}
