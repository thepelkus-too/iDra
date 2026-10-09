import dagre from '@dagrejs/dagre'
import type { Call, Chain, OutName, Sketch, Value } from './ir'

// Generic layered left-to-right layout for node-style UIs.
//   nodes: one per Call, one per `def`, one per output (o0..o3) that is written or read, one per source (s0..s3) read,
//          one per raw/comment stmt (so nothing is hidden)
//   edges: gen → mod → mod → … → out;  nested chain's last call → the call whose texture arg it is;
//          def → each call/def that uses it as a var;  out(oN) → each call reading `oN` (feedback makes cycles)

export type GraphNodeKind = 'call' | 'def' | 'out' | 'source' | 'raw' | 'comment' | 'setting' | 'render'
export interface GraphNode {
  id: string
  kind: GraphNodeKind
  label: string
  /** the stmt this node belongs to */
  stmtId?: string
  chainId?: string
  w: number
  h: number
}
export interface GraphEdge {
  from: string
  to: string
  /** which input of `to` (argument index) or -1 for the main signal flow */
  port: number
}
export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface LayoutOptions {
  nodeWidth?: number
  nodeHeight?: number
  gapX?: number
  gapY?: number
  /** place sketch-level notes (raw/comment/setting/render) at the bottom */
  includeNotes?: boolean
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}
export interface Layout {
  positions: Record<string, Box>
  /** bounding box per chain id / def stmt id / note stmt id */
  boxes: Record<string, Box>
  size: { w: number; h: number }
  graph: Graph
}

export function outNodeId(o: OutName | string) {
  return `out:${o}`
}
export function srcNodeId(s: string) {
  return `src:${s}`
}

export function buildGraph(sketch: Sketch, opts: LayoutOptions = {}): Graph {
  const W = opts.nodeWidth ?? 168
  const H = opts.nodeHeight ?? 64
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const addNode = (n: GraphNode) => nodes.set(n.id, n)
  const ensureOut = (o: string) => {
    if (!nodes.has(outNodeId(o))) addNode({ id: outNodeId(o), kind: 'out', label: o, w: W * 0.6, h: H * 0.7 })
    return outNodeId(o)
  }
  const ensureSrc = (s: string) => {
    if (!nodes.has(srcNodeId(s))) addNode({ id: srcNodeId(s), kind: 'source', label: s, w: W * 0.6, h: H * 0.7 })
    return srcNodeId(s)
  }
  const valueEdges = (call: Call, stmtId: string) => {
    call.args.forEach((a, i) => {
      if (a.k === 'ref') edges.push({ from: a.name.startsWith('o') ? ensureOut(a.name) : ensureSrc(a.name), to: call.id, port: i })
      else if (a.k === 'var') edges.push({ from: `def:${a.name}`, to: call.id, port: i })
      else if (a.k === 'tex') {
        const last = addChain(a.chain, stmtId)
        edges.push({ from: last, to: call.id, port: i })
      }
    })
  }
  const addChain = (chain: Chain, stmtId: string): string => {
    const calls = [chain.gen, ...chain.mods]
    let prev: string | undefined
    for (const c of calls) {
      addNode({ id: c.id, kind: 'call', label: c.fn, stmtId, chainId: chain.id, w: W, h: H })
      if (prev) edges.push({ from: prev, to: c.id, port: -1 })
      valueEdges(c, stmtId)
      prev = c.id
    }
    return prev!
  }
  // defs must exist before edges to them are resolved; ids are `def:<name>`
  for (const s of sketch.stmts) {
    switch (s.k) {
      case 'def': {
        addNode({ id: `def:${s.name}`, kind: 'def', label: s.name, stmtId: s.id, w: W, h: H })
        if (s.value.k === 'tex') {
          const last = addChain(s.value.chain, s.id)
          edges.push({ from: last, to: `def:${s.name}`, port: -1 })
        } else if (s.value.k === 'var') edges.push({ from: `def:${s.value.name}`, to: `def:${s.name}`, port: -1 })
        break
      }
      case 'chain': {
        const last = addChain(s.chain, s.id)
        const out = s.chain.out
        if (out !== null && out !== undefined) edges.push({ from: last, to: ensureOut(out), port: -1 })
        else if (out === undefined) edges.push({ from: last, to: ensureOut('o0'), port: -1 })
        break
      }
      case 'raw':
        if (opts.includeNotes !== false) addNode({ id: `raw:${s.id}`, kind: 'raw', label: s.code.split('\n')[0].slice(0, 28), stmtId: s.id, w: W, h: H * 0.8 })
        break
      case 'comment':
        if (opts.includeNotes !== false) addNode({ id: `comment:${s.id}`, kind: 'comment', label: s.text.split('\n')[0].slice(0, 28), stmtId: s.id, w: W, h: H * 0.8 })
        break
      case 'setting':
        if (opts.includeNotes !== false) addNode({ id: `setting:${s.id}`, kind: 'setting', label: `${s.name} = ${s.v}`, stmtId: s.id, w: W, h: H * 0.6 })
        break
      case 'render':
        if (opts.includeNotes !== false) addNode({ id: `render:${s.id}`, kind: 'render', label: `render(${s.target === 'all' ? '' : s.target})`, stmtId: s.id, w: W, h: H * 0.6 })
        break
      case 'source':
        addNode({ id: srcNodeId(s.slot), kind: 'source', label: `${s.slot}.${s.init.kind}`, stmtId: s.id, w: W * 0.8, h: H * 0.7 })
        break
    }
  }
  // drop edges whose endpoints do not exist (var used but never defined)
  const list = [...nodes.values()]
  const ids = new Set(list.map((n) => n.id))
  return { nodes: list, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)) }
}

/** Layered left-to-right layout (dagre). Notes without edges are stacked below the graph. */
export function autoLayout(sketch: Sketch, opts: LayoutOptions = {}): Layout {
  const graph = buildGraph(sketch, opts)
  const gapX = opts.gapX ?? 48
  const gapY = opts.gapY ?? 24
  const g = new dagre.graphlib.Graph({ multigraph: false })
  g.setGraph({ rankdir: 'LR', nodesep: gapY, ranksep: gapX, marginx: 16, marginy: 16, acyclicer: 'greedy', ranker: 'network-simplex' })
  g.setDefaultEdgeLabel(() => ({}))
  const connected = new Set<string>()
  for (const e of graph.edges) {
    connected.add(e.from)
    connected.add(e.to)
  }
  const main = graph.nodes.filter((n) => connected.has(n.id) || n.kind === 'call' || n.kind === 'def')
  const notes = graph.nodes.filter((n) => !main.includes(n))
  for (const n of main) g.setNode(n.id, { width: n.w, height: n.h })
  for (const e of graph.edges) if (e.from !== e.to) g.setEdge(e.from, e.to)
  dagre.layout(g)
  const positions: Record<string, Box> = {}
  let maxX = 0
  let maxY = 0
  for (const n of main) {
    const p = g.node(n.id)
    positions[n.id] = { x: Math.round(p.x - n.w / 2), y: Math.round(p.y - n.h / 2), w: n.w, h: n.h }
    maxX = Math.max(maxX, positions[n.id].x + n.w)
    maxY = Math.max(maxY, positions[n.id].y + n.h)
  }
  let y = maxY + gapY * 2
  let col = 16
  for (const n of notes) {
    positions[n.id] = { x: col, y, w: n.w, h: n.h }
    col += n.w + gapX
    if (col > Math.max(maxX, 640)) {
      col = 16
      y += n.h + gapY
    }
    maxX = Math.max(maxX, positions[n.id].x + n.w)
    maxY = Math.max(maxY, y + n.h)
  }
  const boxes: Record<string, Box> = {}
  const grow = (key: string, b: Box) => {
    const cur = boxes[key]
    if (!cur) boxes[key] = { ...b }
    else {
      const x2 = Math.max(cur.x + cur.w, b.x + b.w)
      const y2 = Math.max(cur.y + cur.h, b.y + b.h)
      cur.x = Math.min(cur.x, b.x)
      cur.y = Math.min(cur.y, b.y)
      cur.w = x2 - cur.x
      cur.h = y2 - cur.y
    }
  }
  for (const n of graph.nodes) {
    const b = positions[n.id]
    if (!b) continue
    if (n.chainId) grow(n.chainId, b)
    if (n.stmtId) grow(n.stmtId, b)
  }
  return { positions, boxes, size: { w: maxX + 16, h: maxY + 16 }, graph }
}
