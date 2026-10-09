// Copied from apps/stack and made app-agnostic. The document store: the current Sketch (the IR is the only source of truth),
// undo/redo, selection. View-only changes go to `sketch.meta[APP]` but are not part of the undo history.
import { withMeta, type Sketch } from '@hydra-ipad/core'
import { APP } from '../app'

export interface CommitOpts {
  /** consecutive commits with the same key within `coalesceMs` become one undo step (dragging a number) */
  coalesce?: string
  /** view-only change: saved, not undoable, does not re-run the sketch */
  view?: boolean
  /** skip the preview run (the caller already pushed live values) */
  noRun?: boolean
  /** view state that should still be part of undo (e.g. a scene recall that is mostly numbers) */
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
  version = 0
  coalesceMs = 900
  /** keys of this app's view state that undo/redo leave as they are now (rack: stored scenes and pins are not edits) */
  keepOnUndo: string[] = []

  private lastKey: string | undefined
  private lastAt = 0
  /** a gesture in progress (a drag, a keypad): its commits merge whatever the time between them, until endGroup() */
  private held: string | undefined
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

  onChange(cb: (c: Change) => void): () => void {
    this.changeListeners.add(cb)
    return () => this.changeListeners.delete(cb)
  }
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
    if (!opts.view && (source === 'edit' || source === 'code')) {
      const now = Date.now()
      const merge = !!opts.coalesce && this.lastKey === opts.coalesce && (this.held === opts.coalesce || now - this.lastAt < this.coalesceMs) && this.past.length > 0
      if (!merge) {
        this.past.push(prev)
        if (this.past.length > 200) this.past.shift()
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

  /** Update `meta[APP]` only. Never in the undo history. */
  setView(patch: Record<string, unknown>): void {
    this.commit(withMeta(this.sketch, APP, patch), { view: true })
  }

  /** Keep merging commits with this coalesce key into one undo step until endGroup(). */
  hold(key: string): void {
    this.held = key
  }

  endGroup(): void {
    this.lastKey = undefined
    this.held = undefined
  }

  /** Undo restores statements and this app's own view state (positions, scenes): other apps' meta stays as it is now. */
  private restore(from: Sketch): Sketch {
    const meta = { ...(this.sketch.meta ?? {}) }
    if (from.meta && APP in from.meta) {
      const cur = (this.sketch.meta?.[APP] ?? {}) as Record<string, unknown>
      const kept = Object.fromEntries(this.keepOnUndo.filter((k) => k in cur).map((k) => [k, cur[k]]))
      meta[APP] = { ...(from.meta[APP] as Record<string, unknown>), ...kept }
    }
    return { ...this.sketch, stmts: from.stmts, src: from.src, meta }
  }

  undo(): boolean {
    const snap = this.past.pop()
    if (!snap) return false
    this.future.push(this.sketch)
    this.lastKey = undefined
    this.commit(this.restore(snap), { source: 'undo' })
    return true
  }
  redo(): boolean {
    const snap = this.future.pop()
    if (!snap) return false
    this.past.push(this.sketch)
    this.lastKey = undefined
    this.commit(this.restore(snap), { source: 'redo' })
    return true
  }

  select(id: string | undefined): void {
    if (this.selection === id) return
    this.selection = id
    this.notify()
  }
}
