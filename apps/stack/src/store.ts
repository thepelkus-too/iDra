// The document store: the current Sketch (the IR is the only source of truth), unlimited undo/redo, selection.
// View-only changes (mode, active chain) go to `sketch.meta.stack` but are not part of the undo history.
import { withMeta, type Sketch } from '@hydra-ipad/core'
import { APP, type StackMeta } from './view'

export interface CommitOpts {
  /** consecutive commits with the same key within `coalesceMs` become one undo step (scrubbing a number) */
  coalesce?: string
  /** view-only change: saved, not undoable, does not re-run the sketch */
  view?: boolean
  /** skip the preview run (the caller already pushed live values and will run when the gesture ends) */
  noRun?: boolean
  /** history/redo (set internally) */
  source?: 'edit' | 'undo' | 'redo' | 'load' | 'code'
}

export interface Change {
  sketch: Sketch
  prev: Sketch
  opts: CommitOpts
}

const raf = (cb: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(cb)
  else setTimeout(cb, 16)
}

export class Store {
  sketch: Sketch
  past: Sketch[] = []
  future: Sketch[] = []
  selection: string | undefined
  /** bumps on every change of anything the UI renders */
  version = 0
  coalesceMs = 900

  private lastKey: string | undefined
  private lastAt = 0
  private uiListeners = new Set<() => void>()
  private changeListeners = new Set<(c: Change) => void>()
  private scheduled = false

  constructor(sketch: Sketch) {
    this.sketch = sketch
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }
  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Fires synchronously on every sketch change (the runner and the saver listen here). */
  onChange(cb: (c: Change) => void): () => void {
    this.changeListeners.add(cb)
    return () => this.changeListeners.delete(cb)
  }
  /** Coalesced to one call per animation frame (the UI renders here). */
  subscribe(cb: () => void): () => void {
    this.uiListeners.add(cb)
    return () => this.uiListeners.delete(cb)
  }
  notify(): void {
    this.version++
    if (this.scheduled) return
    this.scheduled = true
    raf(() => {
      this.scheduled = false
      for (const cb of [...this.uiListeners]) cb()
    })
  }

  /** Replace the document (opening another sketch): history starts over. */
  load(sketch: Sketch): void {
    const prev = this.sketch
    this.sketch = sketch
    this.past = []
    this.future = []
    this.selection = undefined
    this.lastKey = undefined
    for (const cb of [...this.changeListeners]) cb({ sketch, prev, opts: { source: 'load' } })
    this.notify()
  }

  commit(next: Sketch, opts: CommitOpts = {}): void {
    const prev = this.sketch
    if (next === prev) return
    const source = opts.source ?? 'edit'
    if (!opts.view && source === 'edit') {
      const now = Date.now()
      const merge = !!opts.coalesce && this.lastKey === opts.coalesce && now - this.lastAt < this.coalesceMs && this.past.length > 0
      if (!merge) {
        this.past.push(prev)
        this.future = []
      }
      this.lastKey = opts.coalesce
      this.lastAt = now
    } else if (!opts.view) {
      this.lastKey = undefined
    }
    this.sketch = next
    for (const cb of [...this.changeListeners]) cb({ sketch: next, prev, opts: { ...opts, source } })
    this.notify()
  }

  /** Update `meta.stack` only. Never in the undo history. */
  setView(patch: Partial<StackMeta>): void {
    this.commit(withMeta(this.sketch, APP, patch), { view: true })
  }

  /** Close the current coalescing group (e.g. when a scrub gesture ends). */
  endGroup(): void {
    this.lastKey = undefined
  }

  private restore(from: Sketch, source: 'undo' | 'redo'): Sketch {
    // only the content comes back; names, plugins and every app's meta stay as they are now
    return { ...this.sketch, stmts: from.stmts, src: from.src }
  }

  undo(): boolean {
    const snap = this.past.pop()
    if (!snap) return false
    this.future.push(this.sketch)
    this.lastKey = undefined
    this.commit(this.restore(snap, 'undo'), { source: 'undo' })
    return true
  }
  redo(): boolean {
    const snap = this.future.pop()
    if (!snap) return false
    this.past.push(this.sketch)
    this.lastKey = undefined
    this.commit(this.restore(snap, 'redo'), { source: 'redo' })
    return true
  }

  select(id: string | undefined): void {
    if (this.selection === id) return
    this.selection = id
    this.notify()
  }
}
