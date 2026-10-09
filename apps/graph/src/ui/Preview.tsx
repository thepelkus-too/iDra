// Pinned node previews: a small live view of the texture at one point of a chain. Each pin gets its own low-resolution
// runtime (at most two at a time) that runs the whole sketch plus one extra cable from the pinned node into a spare output,
// and shows only that output. The main preview is never touched, so a preview cannot change what the sketch renders.
import { createRuntime, type Runtime, type Sketch } from '@hydra-ipad/core'
import { useEffect, useRef } from 'preact/hooks'
import { compileOf, graphOf, metaNow } from '../doc'
import { ctx } from '../kit/ctx'
import { toast } from '../kit/overlay'
import { graphToIR, nodeById, outId, type Graph } from '../model'
import { freeOutputs } from '../ops'

export const MAX_PREVIEWS = 2
const W = 192
const H = 108

/** The sketch a preview of `nodeId` runs: the compiled sketch, plus the node written to a spare output that is the only one shown. */
export function previewSketch(sk: Sketch, nodeId: string, g: Graph = graphOf(sk)): { sketch: Sketch; out: string } | undefined {
  const n = nodeById(g, nodeId)
  if (!n) return undefined
  if (n.kind === 'out') return { sketch: withRender(compileOf(sk).sketch, n.name as string), out: n.name as string }
  if (n.kind !== 'call') return undefined
  // o3 is the preview output unless the sketch already writes it and another output is free
  const free = freeOutputs(g)
  const o = free.includes('o3') ? 'o3' : (free[free.length - 1] ?? 'o3')
  const g2: Graph = { nodes: g.nodes, edges: [...g.edges.filter((e) => !(e.to === outId(o) && e.port === 'in')), { from: nodeId, to: outId(o), port: 'in' }] }
  if (!nodeById(g2, outId(o))) g2.nodes = [...g2.nodes, { id: outId(o), kind: 'out', name: o }]
  const r = graphToIR(g2, sk, metaNow(sk))
  if (r.errors.length) return undefined
  return { sketch: withRender(r.sketch, o), out: o }
}

function withRender(sk: Sketch, o: string): Sketch {
  return { ...sk, stmts: [...sk.stmts.filter((s) => s.k !== 'render'), { id: `preview-render`, k: 'render', target: o as 'o0' }], meta: {} }
}

// ---------------------------------------------------------------- the runtimes

const live = new Map<string, { rt: Runtime; ready: boolean; last?: Sketch }>()
let unsub: (() => void) | undefined
let timer: ReturnType<typeof setTimeout> | undefined

function runAll(): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    const sk = ctx.store.sketch
    for (const [id, p] of live) {
      if (!p.ready) continue
      const ps = previewSketch(sk, id)
      if (!ps) continue
      // the trust gate covers previews too: until the owner says yes, they run in safe mode like the main preview
      void p.rt.run(ps.sketch, { safe: ctx.runner.trust.pending }).catch(() => {})
    }
  }, 250)
}

function attach(id: string, el: HTMLElement): () => void {
  const rt = createRuntime(el, { audio: ctx.audio, catalog: ctx.catalog, width: W, height: H, precision: 'lowp', allowCamera: false })
  const p = { rt, ready: false }
  live.set(id, p)
  void rt.ready.then(
    () => {
      p.ready = true
      runAll()
    },
    () => {},
  )
  unsub ??= ctx.store.onChange(({ opts }) => {
    if (!opts.view) runAll()
  })
  return () => {
    rt.dispose()
    live.delete(id)
    if (!live.size) {
      unsub?.()
      unsub = undefined
    }
  }
}

export function PreviewSlot({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => (ref.current ? attach(id, ref.current) : undefined), [id])
  return (
    <div class="nthumb" data-testid="node-preview" aria-label="Live preview of this node" data-no-undo-tap>
      <div class="nthumb-frame" ref={ref} />
    </div>
  )
}

/** Pin or unpin a preview on a node (at most two: the oldest is unpinned). */
export function togglePreview(id: string): void {
  const meta = metaNow()
  const cur = meta.previews ?? []
  if (cur.includes(id)) return ctx.store.setView({ previews: cur.filter((x) => x !== id) })
  const n = nodeById(graphOf(), id)
  if (!n || (n.kind !== 'call' && n.kind !== 'out')) return void toast('Previews show a chain node or an output')
  const next = [...cur, id].slice(-MAX_PREVIEWS)
  if (cur.length >= MAX_PREVIEWS) toast(`At most ${MAX_PREVIEWS} previews: the oldest was unpinned`)
  ctx.store.setView({ previews: next })
}

export const previewStats = (): { active: number } => ({ active: live.size })
