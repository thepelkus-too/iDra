// The bridge between the store (the sketch) and the graph: the current graph and compile facts (memoised per sketch), applying
// a graph edit (compile → commit with the view state), positions, and UI-only state (selection, modes) with a tiny pub/sub.
import { liveId, withMeta, type Sketch } from '@hydra-ipad/core'
import { useEffect, useState } from 'preact/hooks'
import { ctx } from './kit/ctx'
import { toast } from './kit/overlay'
import type { CommitOpts } from './kit/store'
import { graphToIR, irToGraph, type CompileResult, type GEdge, type Graph } from './model'
import type { OpResult } from './ops'
import { APP, autoView, layoutGraph, metaOf, type GraphMeta, type XY } from './view'

// ---------------------------------------------------------------- memoised per sketch

let memoSketch: Sketch | undefined
let memoGraph: Graph = { nodes: [], edges: [] }
let memoCompile: CompileResult | undefined
let memoBoxes: ReturnType<typeof layoutGraph> = {}

function refresh(sk: Sketch): void {
  if (sk === memoSketch) return
  memoSketch = sk
  const meta = metaOf(sk)
  memoGraph = irToGraph(sk, meta ?? {})
  memoCompile = undefined
  memoBoxes = {}
}

export function graphOf(sk: Sketch = ctx.store.sketch): Graph {
  refresh(sk)
  return memoGraph
}

export function compileOf(sk: Sketch = ctx.store.sketch): CompileResult {
  refresh(sk)
  memoCompile ??= graphToIR(memoGraph, sk, metaOf(sk) ?? {})
  return memoCompile
}

export function metaNow(sk: Sketch = ctx.store.sketch): GraphMeta {
  return metaOf(sk) ?? { v: 1, pos: {} }
}

/** Position of a node: stored, else where the default layout would put it. */
export function posOf(id: string, sk: Sketch = ctx.store.sketch): XY {
  const p = metaNow(sk).pos[id]
  if (p) return p
  refresh(sk)
  if (!Object.keys(memoBoxes).length) memoBoxes = layoutGraph(sk, memoGraph, ctx.catalog)
  const b = memoBoxes[id]
  return b ? { x: b.x, y: b.y } : { x: 0, y: 0 }
}

/** Compile a graph edit into the sketch and commit it with the view state. Returns an error message instead when it is rejected. */
export function applyGraph(g: Graph, opts: CommitOpts & { placed?: Record<string, XY>; meta?: Partial<GraphMeta> } = {}): string | undefined {
  const sk = ctx.store.sketch
  const meta = metaNow(sk)
  const r = graphToIR(g, sk, meta)
  if (r.errors.length) return r.errors[0].message
  const pos = { ...meta.pos, ...(opts.placed ?? {}) }
  const next = withMeta(r.sketch, APP, { ...meta, ...(opts.meta ?? {}), v: 1, pos, links: r.meta.links, bypass: r.meta.bypass })
  const { placed: _p, meta: _m, ...commit } = opts
  void _p
  void _m
  ctx.store.commit(next, commit)
  return undefined
}

/** Apply or explain: a rejected edit shows its reason and flashes the offending cable. */
export function tryApply(r: Graph | OpResult | { error: string } | undefined, opts: Parameters<typeof applyGraph>[1] = {}, reject?: GEdge): boolean {
  if (!r) return false
  const g = 'nodes' in r ? r : 'graph' in r ? r.graph : undefined
  if (!g) {
    ui.reject(reject)
    toast('error' in r && r.error ? r.error : 'That does not fit here')
    return false
  }
  const err = applyGraph(g, opts)
  if (err) {
    ui.reject(reject)
    toast(err)
    return false
  }
  return true
}

/** Live ids of a number on a node and on every copy of it (duplicated nodes are written several times). */
export function liveIdsFor(nodeId: string, i: number, sk: Sketch = ctx.store.sketch): string[] {
  const links = metaNow(sk).links ?? {}
  return [nodeId, ...Object.keys(links).filter((k) => links[k] === nodeId)].map((id) => liveId(id, i))
}

export function arrange(): void {
  const sk = ctx.store.sketch
  const keep = metaNow(sk)
  ctx.store.setView({ ...autoView(sk, ctx.catalog, keep), cam: undefined })
  ui.set({ fit: ui.state.fit + 1 })
  toast('Arranged')
}

// ---------------------------------------------------------------- UI-only state

export interface UiState {
  /** selected nodes */
  sel: string[]
  /** a selected cable */
  cable?: GEdge
  /** one finger on empty canvas: pan, or draw a selection rectangle */
  mode: 'pan' | 'lasso'
  /** a cable that was just refused (drawn red for a moment) */
  rejected?: GEdge
  code: boolean
  perform: boolean
  palette: boolean
  /** bumps to ask the canvas to fit the content */
  fit: number
}

const listeners = new Set<() => void>()
export const ui = {
  state: { sel: [], mode: 'pan', code: false, perform: false, palette: false, fit: 0 } as UiState,
  set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch }
    listeners.forEach((l) => l())
  },
  select(ids: string[], cable?: GEdge): void {
    this.set({ sel: ids, cable })
    ctx.store.select(ids[ids.length - 1])
  },
  reject(e?: GEdge): void {
    this.set({ rejected: e ?? { from: '', to: '', port: 'in' } })
    setTimeout(() => this.set({ rejected: undefined }), 1600)
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
