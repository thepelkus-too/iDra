// View state (`sketch.meta.graph`), node sizes and the default layout of any sketch, including one imported from plain text.
// Pure: no DOM, unit-tested against the whole corpus (test/view.test.ts).
//
// Default layout (autoView):
//   * a setup column on the left holds settings, sources, render() and raw JS, in source order;
//   * each chain is a left-to-right run of nodes; chains are stacked top to bottom in source order; a chain's texture arguments
//     and modulators sit in rows below it, ending just left of the node they feed;
//   * an output node sits at the end of the first chain that writes it, so later `src(oN)` reads and feedback are cables back to it;
//   * a comment is a sticky note placed above the chain that follows it; a variable is a node in source order.
import { catalog as defaultCatalog, type Catalog, type Sketch } from '@hydra-ipad/core'
import { APP } from './app'
import { irToGraph, outId, srcId, type CompileMeta, type GEdge, type GNode, type Graph } from './model'
import { valueToMod } from './kit/mods'

export { APP }

export interface XY {
  x: number
  y: number
}

export interface GraphMeta extends CompileMeta {
  v: 1
  /** node id → top-left corner in canvas units */
  pos: Record<string, XY>
  /** display-only groups ("macro" nodes); flattened in the code */
  groups?: Array<{ id: string; ids: string[]; open?: boolean; name?: string }>
  /** nodes with a pinned live thumbnail (at most two) */
  previews?: string[]
  /** controls shown in performance mode: a call input or a modulator */
  pins?: Array<{ node: string; port: number }>
  /** pan/zoom */
  cam?: { x: number; y: number; k: number }
}

export function metaOf(sketch: Sketch): GraphMeta | undefined {
  const m = sketch.meta?.[APP] as Partial<GraphMeta> | undefined
  return m && m.v === 1 && m.pos ? (m as GraphMeta) : undefined
}

// ---------------------------------------------------------------- sizes (canvas units = CSS px at zoom 1)

export const HEAD = 44
export const ROW = 40
export const CALL_W = 212
export const SETUP_W = 250
export const X0 = SETUP_W + 60
const GAP_X = 56
const GAP_Y = 22
const GAP_BAND = 52
export const TERM = { w: 120, h: 56 }

export function lineCount(s: string, max: number): number {
  return Math.min(max, Math.max(1, s.split('\n').length))
}

/** How many input rows a call node shows: every catalog input, or every argument for a function the catalog does not know. */
export function rowsOf(n: GNode, cat: Catalog = defaultCatalog): number {
  const c = n.call!
  const def = cat.get(c.fn)
  return Math.max(def ? def.inputs.length : c.args.length, c.args.length)
}

export function sizeOf(n: GNode, cat: Catalog = defaultCatalog): { w: number; h: number } {
  switch (n.kind) {
    case 'call':
      return { w: CALL_W, h: HEAD + Math.max(1, rowsOf(n, cat)) * ROW + 8 }
    case 'out':
      return { w: 128, h: 84 }
    case 'src':
      return { w: 128, h: 64 }
    case 'def': {
      const s = n.stmt as Extract<GNode['stmt'], { k: 'def' }>
      const v = s.value
      if (v.k === 'default' || v.k === 'tex' || v.k === 'var') return { w: 200, h: 64 }
      if (v.k === 'num') return { w: 200, h: HEAD + ROW + 12 }
      return { w: 220, h: HEAD + 3 * ROW + 12 }
    }
    case 'mod': {
      const spec = valueToMod(n.value!)
      const rows = !spec ? 1 : spec.kind === 'steps' ? 2.4 : spec.kind === 'expr' ? 2 : spec.kind === 'audio' ? 3.6 : spec.kind === 'time' || spec.kind === 'mouseX' || spec.kind === 'mouseY' || spec.kind === 'vol' ? 2 : 3
      return { w: 184, h: Math.round(HEAD + rows * ROW + 8) }
    }
    case 'comment': {
      const s = n.stmt as Extract<GNode['stmt'], { k: 'comment' }>
      return { w: 240, h: 30 + lineCount(s.text, 8) * 18 }
    }
    case 'raw': {
      const s = n.stmt as Extract<GNode['stmt'], { k: 'raw' }>
      return { w: SETUP_W, h: HEAD + lineCount(s.code, 8) * 17 + 14 }
    }
    case 'source': {
      const s = n.stmt as Extract<GNode['stmt'], { k: 'source' }>
      return { w: SETUP_W, h: s.init.kind === 'image' || s.init.kind === 'video' ? 156 : 116 }
    }
    default:
      return { w: SETUP_W, h: 76 }
  }
}

// ---------------------------------------------------------------- default layout

export const termId = (endNode: string): string => `term:${endNode}`

export function layoutGraph(sketch: Sketch, g: Graph, cat: Catalog = defaultCatalog): Record<string, XY & { w: number; h: number }> {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const inFlow = new Map<string, string>()
  const flowOut = new Map<string, string[]>()
  const argsInto = new Map<string, GEdge[]>()
  for (const e of g.edges) {
    if (e.port === 'in') {
      const to = byId.get(e.to)
      if (to?.kind === 'call') inFlow.set(e.to, e.from)
      flowOut.set(e.from, [...(flowOut.get(e.from) ?? []), e.to])
    } else argsInto.set(e.to, [...(argsInto.get(e.to) ?? []), e])
  }
  const boxes: Record<string, XY & { w: number; h: number }> = {}
  const placed = (id: string) => id in boxes
  const put = (id: string, x: number, y: number) => {
    const n = byId.get(id)
    const s = n ? sizeOf(n, cat) : TERM
    boxes[id] = { x: Math.round(x), y: Math.round(y), w: s.w, h: s.h }
  }

  // ---- setup column
  let sy = 0
  const column = (id: string) => {
    if (placed(id) || !byId.has(id)) return
    put(id, 0, sy)
    sy += boxes[id].h + GAP_Y
  }
  for (const s of sketch.stmts) {
    if (s.k === 'setting' || s.k === 'render' || s.k === 'raw' || s.k === 'source') column(s.id)
    if (s.k === 'source') column(srcId(s.slot))
  }

  // ---- bands
  let my = 0
  /** the run of calls ending at `end` (walking main inputs), unplaced ones only */
  const runTo = (end: string): string[] => {
    const ids: string[] = []
    const seen = new Set<string>()
    let cur: string | undefined = end
    while (cur && !seen.has(cur) && byId.get(cur)?.kind === 'call') {
      seen.add(cur)
      if (placed(cur)) break
      ids.unshift(cur)
      cur = inFlow.get(cur)
    }
    return ids
  }

  const band = (rowIds: string[], tail: string | undefined) => {
    const bandIds: string[] = []
    let cursor = my
    const placeRow = (ids: string[], endRight: number | undefined) => {
      if (!ids.length) return
      const sizes = ids.map((id) => sizeOf(byId.get(id)!, cat))
      const total = sizes.reduce((a, s) => a + s.w, 0) + GAP_X * (ids.length - 1)
      let x = endRight === undefined ? X0 : endRight - total
      // a run that continues a node placed earlier starts right after it
      const up = inFlow.get(ids[0])
      if (endRight === undefined && up && boxes[up]) x = boxes[up].x + boxes[up].w + GAP_X
      const y = cursor
      const h = Math.max(...sizes.map((s) => s.h))
      ids.forEach((id) => {
        put(id, x, y)
        bandIds.push(id)
        x += boxes[id].w + GAP_X
      })
      cursor = y + h + GAP_Y
      // texture arguments and modulators of this run, in rows below
      for (const id of ids) {
        for (const e of (argsInto.get(id) ?? []).sort((a, b) => (a.port as number) - (b.port as number))) {
          const from = byId.get(e.from)
          if (!from || placed(e.from)) continue
          if (from.kind === 'call') placeRow(runTo(e.from), boxes[id].x - GAP_X)
          else if (from.kind === 'mod') {
            const s = sizeOf(from, cat)
            put(e.from, boxes[id].x - GAP_X - s.w, cursor)
            bandIds.push(e.from)
            cursor += s.h + GAP_Y
          }
        }
      }
      return x
    }
    const rowEnd = placeRow(rowIds, undefined)
    if (tail && rowIds.length && !placed(tail)) {
      const last = boxes[rowIds[rowIds.length - 1]]
      put(tail, (rowEnd ?? last.x + last.w + GAP_X), last.y)
      bandIds.push(tail)
    }
    // keep the band right of the setup column
    let minX = Infinity
    let maxY = my
    for (const id of bandIds) {
      minX = Math.min(minX, boxes[id].x)
      maxY = Math.max(maxY, boxes[id].y + boxes[id].h)
    }
    if (minX < X0) for (const id of bandIds) boxes[id].x += X0 - minX
    if (bandIds.length) my = maxY + GAP_BAND
  }

  const lastOfChain = (c: { gen: { id: string }; mods: Array<{ id: string }> }): string => {
    // follow the flow from the last call through bypassed nodes
    let id = c.mods.length ? c.mods[c.mods.length - 1].id : c.gen.id
    for (;;) {
      const next = (flowOut.get(id) ?? []).find((t) => byId.get(t)?.kind === 'call' && byId.get(t)?.bypassed)
      if (!next) return id
      id = next
    }
  }

  for (const s of sketch.stmts) {
    switch (s.k) {
      case 'comment':
        put(s.id, X0, my)
        my += boxes[s.id].h + GAP_Y
        break
      case 'chain': {
        const end = lastOfChain(s.chain)
        const tail = s.chain.out === null ? termId(end) : outId(s.chain.out ?? 'o0')
        band(runTo(end), tail)
        break
      }
      case 'def': {
        const from = g.edges.find((e) => e.to === s.id && e.port === 'in')?.from
        if (from && byId.get(from)?.kind === 'call') band(runTo(from), s.id)
        else {
          put(s.id, X0, my)
          my += boxes[s.id].h + GAP_BAND
        }
        break
      }
    }
  }
  // bypassed calls left unconnected, outputs only read, sources never initialised
  for (const n of g.nodes) if (n.kind === 'call' && !placed(n.id)) band(runTo(n.id), undefined)
  for (const n of g.nodes) if ((n.kind === 'out' || n.kind === 'src' || n.kind === 'def') && !placed(n.id)) column(n.id)
  for (const n of g.nodes) if (!placed(n.id)) column(n.id)
  return boxes
}

/** Deterministic default view for a sketch that has none (or for "Arrange"). Never reads or touches other apps' meta. */
export function autoView(sketch: Sketch, cat: Catalog = defaultCatalog, keep: Partial<GraphMeta> = {}): GraphMeta {
  const g = irToGraph(sketch, keep)
  const boxes = layoutGraph(sketch, g, cat)
  const pos: Record<string, XY> = {}
  for (const id of Object.keys(boxes).sort()) pos[id] = { x: boxes[id].x, y: boxes[id].y }
  const meta: GraphMeta = { v: 1, pos }
  if (keep.links && Object.keys(keep.links).length) meta.links = keep.links
  if (keep.bypass && Object.keys(keep.bypass).length) meta.bypass = keep.bypass
  if (keep.groups?.length) meta.groups = keep.groups
  if (keep.previews?.length) meta.previews = keep.previews
  if (keep.pins?.length) meta.pins = keep.pins
  return meta
}
