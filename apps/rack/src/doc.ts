// The bridge between the store and the rack: view state, committing an edit with a view patch in one undo step, knob
// values on the live path, scenes (store, recall with a crossfade) and UI-only state (selection, armed mod tile, panels).
import { liveId, withMeta, type OutName, type Sketch, type Stmt, type Value } from '@hydra-ipad/core'
import { useEffect, useState } from 'preact/hooks'
import { ctx } from './kit/ctx'
import { getArg, setArg, type ArgRef } from './kit/model'
import type { CommitOpts } from './kit/store'
import { toast } from '@hydra-ipad/kit'
import { beatsToMs, Fader, liveTableOf, sameShape } from './fade'
import { APP, bpmOf, metaOf, type RackMeta } from './view'

export function metaNow(sk: Sketch = ctx.store.sketch): RackMeta {
  return metaOf(sk) ?? { v: 1 }
}

/** Commit a sketch edit together with a view patch, as one undo step. */
export function commit(next: Sketch, view: Partial<RackMeta> = {}, opts: CommitOpts = {}): void {
  const meta = metaNow(ctx.store.sketch)
  const out = Object.keys(view).length ? withMeta(next, APP, { ...meta, ...view, v: 1 }) : next
  fader.cancel()
  ctx.store.commit(out, opts)
}

/** View state only (saved, not undoable). */
export function setView(patch: Partial<RackMeta>): void {
  ctx.store.setView({ ...metaNow(), ...patch, v: 1 })
}

/**
 * A knob value. Numbers go out on the live path first (no recompile: core compiles numeric arguments as closures over its
 * live table), then into the IR as a plain number, so the code stays readable and one knob is one changed line.
 */
export function setValue(ref: ArgRef, v: Value, coalesce?: string): void {
  if (v.k === 'num' && 'call' in ref) ctx.runner.setLive(liveId(ref.call, ref.i), v.v)
  if (coalesce) ctx.store.hold(coalesce)
  commit(setArg(ctx.store.sketch, ref, v), {}, { coalesce })
}

export const valueAt = (ref: ArgRef): Value | undefined => getArg(ctx.store.sketch, ref)

// ---------------------------------------------------------------- scenes

const raf = (cb: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 16))

export const fader = new Fader({
  setLiveBatch: (t) => ctx.runner.rt?.setLiveBatch(t),
  now: () => performance.now(),
  frame: raf,
})

export function storeScene(slot: string): void {
  const m = metaNow()
  setView({ scenes: { ...(m.scenes ?? {}), [slot]: { stmts: structuredClone(ctx.store.sketch.stmts), at: Date.now() } } })
  toast(`Scene ${slot} stored`)
}

export function clearScene(slot: string): void {
  const scenes = { ...(metaNow().scenes ?? {}) }
  delete scenes[slot]
  setView({ scenes })
}

export interface RecallInfo {
  /** only numbers differ: interpolated live, no recompile */
  numeric: boolean
  ms: number
}

/** Recall a scene: crossfade the shared numbers over `fade` beats, then commit (one undo step). */
export function recallScene(slot: string, beats = metaNow().fade ?? 4): RecallInfo | undefined {
  const sc = metaNow().scenes?.[slot]
  if (!sc) return undefined
  return fadeTo(sc.stmts, beats, slot)
}

/** Fade from the current statements to `stmts` over `beats`, then commit them. */
export function fadeTo(stmts: Stmt[], beats: number, label = 'morph'): RecallInfo {
  const sk = ctx.store.sketch
  const cat = ctx.catalog
  const numeric = sameShape(sk.stmts, stmts, cat)
  const ms = beatsToMs(beats, bpmOf(sk))
  ui.set({ fading: label })
  const target = structuredClone(stmts)
  const id = sk.id
  fader.run(liveTableOf(sk.stmts, cat), liveTableOf(target, cat), ms, () => {
    ui.set({ fading: undefined })
    if (ctx.store.sketch.id !== id) return
    // the store's own commit (ours cancels the running fade)
    ctx.store.commit({ ...ctx.store.sketch, stmts: target })
  })
  return { numeric, ms }
}

// ---------------------------------------------------------------- UI-only state

export interface UiState {
  /** selected module (call id) or statement id */
  sel?: string
  code: boolean
  perform: boolean
  /** a mod tile picked up by tap, waiting for a knob tap */
  armed?: string
  /** something is being dragged: drop targets light up */
  drag?: 'mod' | 'lane'
  /** the scene being faded to */
  fading?: string
  /** lane rows scroll: which lane is visible in portrait */
  bay: boolean
}

const listeners = new Set<() => void>()
export const ui = {
  state: { code: false, perform: false, bay: true } as UiState,
  set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch }
    listeners.forEach((l) => l())
  },
  select(sel?: string): void {
    this.set({ sel })
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

export type { OutName }
