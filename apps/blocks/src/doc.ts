// The bridge between the store and the workspace: view state, committing an edit together with positions, number edits on
// the live path, per-script history for the scrubber, and UI-only state (selection, drag in progress, panels).
import { liveId, withMeta, type Sketch, type Stmt, type Value } from '@hydra-ipad/core'
import { useEffect, useState } from 'preact/hooks'
import { ctx } from './kit/ctx'
import { setArg, type ArgRef } from './kit/model'
import type { CommitOpts } from './kit/store'
import { topStmtOf } from './edit'
import { APP, autoView, metaOf, type BlocksMeta } from './view'

export function metaNow(sk: Sketch = ctx.store.sketch): BlocksMeta {
  return metaOf(sk) ?? { v: 1, pos: {} }
}

/** Commit a sketch edit with a view patch in one undo step. */
export function commit(next: Sketch, view: Partial<BlocksMeta> = {}, opts: CommitOpts = {}): void {
  const meta = metaNow(ctx.store.sketch)
  const out = Object.keys(view).length ? withMeta(next, APP, { ...meta, ...view, v: 1 }) : next
  ctx.store.commit(out, opts)
}

/** Set a value (number, reporter, socket content). Numbers go out on the live path first so dragging never waits for a compile. */
export function setValue(ref: ArgRef, v: Value, coalesce?: string): void {
  if (v.k === 'num' && 'call' in ref) ctx.runner.setLive(liveId(ref.call, ref.i), v.v)
  if (coalesce) ctx.store.hold(coalesce)
  commit(setArg(ctx.store.sketch, ref, v), {}, { coalesce })
}

export function tidy(): void {
  const sk = ctx.store.sketch
  const m = metaNow(sk)
  ctx.store.setView({ ...autoView(sk, ctx.catalog, m), cam: undefined })
  ui.set({ fit: ui.state.fit + 1 })
}

// ---------------------------------------------------------------- per-script history (the ↶ scrubber)

const HISTORY = 20
const history = new Map<string, Stmt[]>()
let scrubbing = false

export function trackHistory(): () => void {
  return ctx.store.onChange(({ sketch, prev, opts }) => {
    if (opts.source === 'load') return history.clear()
    if (scrubbing || opts.view) return
    const before = new Map(prev.stmts.map((s) => [s.id, s]))
    for (const s of sketch.stmts) {
      const p = before.get(s.id)
      if (!p || p === s) continue
      const h = history.get(s.id) ?? []
      // a coalesced drag replaces its own last entry instead of filling the history with every frame
      if (opts.coalesce && h.length && (h as Array<Stmt & { _k?: string }>)[h.length - 1]._k === opts.coalesce) continue
      h.push(Object.assign(structuredClone(p), { _k: opts.coalesce }))
      if (h.length > HISTORY) h.shift()
      history.set(s.id, h)
    }
  })
}

export function historyOf(stmtId: string): Stmt[] {
  return history.get(stmtId) ?? []
}

/** Show version k of a script's history (k = length means "now", which the caller keeps). */
export function scrubTo(stmtId: string, version: Stmt): void {
  scrubbing = true
  try {
    const { _k, ...clean } = version as Stmt & { _k?: string }
    void _k
    const sk = ctx.store.sketch
    ctx.store.commit({ ...sk, stmts: sk.stmts.map((s) => (s.id === stmtId ? (clean as Stmt) : s)) }, { coalesce: `hist:${stmtId}` })
  } finally {
    scrubbing = false
  }
}

// ---------------------------------------------------------------- UI-only state

export type DragCat = 'stack' | 'script' | 'tex' | 'value' | 'math' | 'setup' | 'cap'

export interface UiState {
  /** selected block (call id) or statement id */
  sel?: string
  /** the top-level statement of the selection */
  stmt?: string
  palette: boolean
  code: boolean
  perform: boolean
  /** what kind of thing is being dragged (drop targets light up) */
  drag?: DragCat
  fit: number
}

const listeners = new Set<() => void>()
export const ui = {
  state: { palette: true, code: false, perform: false, fit: 0 } as UiState,
  set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch }
    listeners.forEach((l) => l())
  },
  select(sel?: string, stmt?: string): void {
    this.set({ sel, stmt: stmt ?? (sel ? (topStmtOf(ctx.store.sketch, sel)?.id ?? sel) : undefined) })
    ctx.store.select(sel)
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
}

export function useUi(): UiState {
  const [, set] = useState(0)
  useEffect(() => ui.subscribe(() => set((v) => v + 1)), [])
  return ui.state
}
