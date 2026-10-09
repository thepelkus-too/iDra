// Structural edits of the graph. Each returns a new Graph (or an error the canvas shows as a red cable); the app then runs
// graphToIR and commits the sketch. Pure.
import { catalog as defaultCatalog, DEFAULT, makeCall, newId, num, type Catalog, type OutName, type Value } from '@hydra-ipad/core'
import { modToValue, valueToMod, type ModSpec } from './kit/mods'
import { isProvider, modId, nodeById, outId, reachesWithoutOutput, type GEdge, type GNode, type Graph, type Port } from './model'

export type OpResult = { graph: Graph; created?: string[]; error?: undefined } | { error: string; graph?: undefined; created?: undefined }

const clone = (g: Graph): Graph => ({ nodes: g.nodes.slice(), edges: g.edges.slice() })
const sameEdge = (a: GEdge, b: GEdge) => a.from === b.from && a.to === b.to && a.port === b.port

export function isGenerator(n: GNode | undefined, cat: Catalog = defaultCatalog): boolean {
  if (!n || n.kind !== 'call') return false
  const def = cat.get(n.call!.fn)
  return def ? def.type === 'src' : false
}

/** What a port accepts: textures, numbers (modulators, number variables), or anything (unknown functions). */
export function portType(n: GNode, port: Port, cat: Catalog = defaultCatalog): 'texture' | 'number' | 'any' | 'main' {
  if (port === 'in') return 'main'
  if (n.kind !== 'call') return 'any'
  const inp = cat.inputs(n.call!.fn)[port]
  if (!inp) return 'any'
  if (inp.type === 'sampler2D') return 'texture'
  if (inp.type === 'float') return 'number'
  return 'any'
}

/** Can `from`'s output go into `to`'s port at all (ignoring cycles)? */
export function accepts(g: Graph, from: string, to: string, port: Port, cat: Catalog = defaultCatalog): string | undefined {
  const f = nodeById(g, from)
  const t = nodeById(g, to)
  if (!f || !t) return 'missing node'
  if (from === to) return 'a node cannot feed itself'
  if (f.kind === 'def') {
    const v = (f.stmt as { value: Value }).value
    const texDef = v.k === 'tex' || v.k === 'default' || v.k === 'var'
    if (t.kind === 'call' && port !== 'in') {
      const pt = portType(t, port, cat)
      if (pt === 'texture' && !texDef) return 'this variable is a number; the input takes a texture'
      if (pt === 'number' && texDef && v.k !== 'var') return 'this variable is a texture; the input takes a number'
      return undefined
    }
    if (t.kind === 'def' && port === 'in') return undefined
    return 'a variable can feed an input of a node'
  }
  if (f.kind === 'mod') return t.kind === 'call' && port !== 'in' && portType(t, port, cat) !== 'texture' ? undefined : 'a modulator goes into a number input'
  if (t.kind === 'out') {
    if (port !== 'in') return 'outputs take a chain'
    return f.kind === 'call' ? undefined : 'only a chain can be written to an output'
  }
  if (t.kind === 'def') return port === 'in' && f.kind === 'call' ? undefined : 'a variable takes a chain'
  if (t.kind !== 'call') return 'this node has no inputs'
  if (port === 'in') {
    if (isGenerator(t, cat)) return `${t.call!.fn}() starts a chain; it has no main input`
    return f.kind === 'call' || f.kind === 'out' || f.kind === 'src' ? undefined : 'the main input takes a chain'
  }
  const pt = portType(t, port, cat)
  if (pt === 'number') return f.kind === 'call' || f.kind === 'out' || f.kind === 'src' ? 'this input takes a number: wire a modulator' : undefined
  if (pt === 'texture') return f.kind === 'call' || f.kind === 'out' || f.kind === 'src' ? undefined : 'this input takes a texture'
  return undefined
}

/** Connect `from` → `to.port`. Replaces whatever fed that port before (a main input or an argument has one source). */
export function connect(g0: Graph, from: string, to: string, port: Port, cat: Catalog = defaultCatalog): OpResult {
  const bad = accepts(g0, from, to, port, cat)
  if (bad) return { error: bad }
  const f = nodeById(g0, from)!
  const t = nodeById(g0, to)!
  const g = clone(g0)
  const created: string[] = []
  let src = from
  // an output or source into a main input: Hydra spells that `src(o0).rotate()`, so a src node goes in between
  if (port === 'in' && t.kind === 'call' && (f.kind === 'out' || f.kind === 'src')) {
    const s = newCallNode('src')
    g.nodes.push(s)
    g.edges.push({ from, to: s.id, port: 0 })
    created.push(s.id)
    src = s.id
  }
  // feedback is fine through an output node; any other loop is not
  if (nodeById(g, src)!.kind === 'call' && t.kind !== 'out' && reachesWithoutOutput(g, to, src)) return { error: 'This connection makes a loop. Loops must go through an output (o0–o3).' }
  const single = t.kind !== 'out'
  const dropped: GEdge[] = single ? g.edges.filter((e) => e.to === to && e.port === port) : []
  g.edges = g.edges.filter((e) => !dropped.includes(e))
  const e: GEdge = { from: src, to, port }
  if (!g.edges.some((x) => sameEdge(x, e))) g.edges.push(e)
  // a modulator belongs to one input: replacing it removes it
  for (const d of dropped) if (nodeById(g, d.from)?.kind === 'mod') g.nodes = g.nodes.filter((n) => n.id !== d.from)
  return { graph: g, created }
}

/** Remove a cable. A modulator's cable takes the modulator with it (the input goes back to the modulator's resting value). */
export function disconnect(g0: Graph, edge: GEdge): Graph {
  const g = clone(g0)
  g.edges = g.edges.filter((e) => !sameEdge(e, edge))
  const f = nodeById(g, edge.from)
  if (f?.kind === 'mod' && typeof edge.port === 'number') {
    g.nodes = g.nodes.filter((n) => n.id !== f.id)
    const spec = valueToMod(f.value!)
    setNodeArg(g, edge.to, edge.port, num(spec && spec.kind !== 'expr' && spec.kind !== 'steps' ? spec.off : 0))
  }
  return g
}

export function setNodeArg(g: Graph, id: string, i: number, v: Value): void {
  g.nodes = g.nodes.map((n) => {
    if (n.id !== id || n.kind !== 'call') return n
    const args = n.call!.args.slice()
    while (args.length <= i) args.push(DEFAULT)
    args[i] = v
    return { ...n, call: { ...n.call!, args } }
  })
}

export function updateNode(g0: Graph, id: string, f: (n: GNode) => GNode): Graph {
  return { nodes: g0.nodes.map((n) => (n.id === id ? f(n) : n)), edges: g0.edges }
}

/** A new call node with every input at its default (texture inputs are left for the user to wire). */
export function newCallNode(fn: string, args: Value[] = []): GNode {
  const call = makeCall(fn, args)
  return { id: call.id, kind: 'call', call }
}

export function addNode(g0: Graph, n: GNode): Graph {
  return { nodes: [...g0.nodes, n], edges: g0.edges }
}

/** Put a modulator on a number input (replacing a previous one). */
export function setModulator(g0: Graph, callId: string, i: number, spec: ModSpec | Value): Graph {
  const value = 'k' in spec ? spec : modToValue(spec)
  const id = modId(callId, i)
  let g: Graph = { nodes: g0.nodes.filter((n) => n.id !== id), edges: g0.edges.filter((e) => !(e.to === callId && e.port === i)) }
  g = addNode(g, { id, kind: 'mod', value })
  g.edges = [...g.edges, { from: id, to: callId, port: i }]
  setNodeArg(g, callId, i, DEFAULT)
  return g
}

/** Insert a modifier node into a cable: from → X → to. A cable that starts at an output or source gets a src() in front. */
export function splice(g0: Graph, edge: GEdge, node: GNode, cat: Catalog = defaultCatalog): OpResult {
  const f = nodeById(g0, edge.from)
  if (!f || (f.kind !== 'call' && f.kind !== 'out' && f.kind !== 'src')) return { error: 'only texture cables can take a node' }
  if (isGenerator(node, cat)) return { error: `${node.call!.fn}() starts a chain: it cannot go into a cable` }
  let g = addNode(g0, node)
  g.edges = g.edges.filter((e) => !sameEdge(e, edge))
  const created = [node.id]
  if (f.kind === 'call') g.edges.push({ from: edge.from, to: node.id, port: 'in' })
  else {
    const s = newCallNode('src')
    g = addNode(g, s)
    g.edges.push({ from: edge.from, to: s.id, port: 0 }, { from: s.id, to: node.id, port: 'in' })
    created.push(s.id)
  }
  g.edges.push({ from: node.id, to: edge.to, port: edge.port })
  return { graph: g, created }
}

/** Insert a modifier right after a node: everything that read the node now reads the new one. */
export function appendAfter(g0: Graph, after: string, node: GNode, cat: Catalog = defaultCatalog): OpResult {
  if (isGenerator(node, cat)) return { error: `${node.call!.fn}() starts a chain` }
  const a = nodeById(g0, after)
  if (!a || a.kind !== 'call') return { error: 'append after a chain node' }
  const g = addNode(g0, node)
  g.edges = g.edges.map((e) => (e.from === after && (e.port === 'in' || nodeById(g0, e.to)?.kind === 'call') ? { ...e, from: node.id } : e))
  g.edges.push({ from: after, to: node.id, port: 'in' })
  return { graph: g, created: [node.id] }
}

/** Delete nodes. A call in the middle of a chain is spliced out (its input is reconnected to what it fed). */
export function deleteNodes(g0: Graph, ids: string[]): Graph {
  let g = clone(g0)
  for (const id of ids) {
    const n = nodeById(g, id)
    if (!n) continue
    if (n.kind === 'call') {
      const up = g.edges.find((e) => e.to === id && e.port === 'in')?.from
      const downs = g.edges.filter((e) => e.from === id)
      const mods = g.edges.filter((e) => e.to === id && nodeById(g, e.from)?.kind === 'mod').map((e) => e.from)
      g.edges = g.edges.filter((e) => e.from !== id && e.to !== id)
      if (up) for (const d of downs) g.edges.push({ from: up, to: d.to, port: d.port })
      g.nodes = g.nodes.filter((x) => x.id !== id && !mods.includes(x.id))
    } else if (n.kind === 'mod') {
      const e = g.edges.find((x) => x.from === id)
      g = e ? disconnect(g, e) : { nodes: g.nodes.filter((x) => x.id !== id), edges: g.edges }
    } else {
      g.edges = g.edges.filter((e) => e.from !== id && e.to !== id)
      g.nodes = g.nodes.filter((x) => x.id !== id)
    }
  }
  return g
}

/** Copy nodes (and the cables between them, and what fed them from outside): the copies branch off the same sources. */
export function duplicateNodes(g0: Graph, ids: string[]): { graph: Graph; map: Record<string, string> } {
  const g = clone(g0)
  const map: Record<string, string> = {}
  const pick = g0.nodes.filter((n) => ids.includes(n.id) && (n.kind === 'call' || n.kind === 'mod'))
  for (const n of pick) map[n.id] = n.kind === 'call' ? newId('c') : ''
  // modulators feeding copied calls come along
  for (const e of g0.edges) {
    const f = nodeById(g0, e.from)
    if (f?.kind === 'mod' && map[e.to] && typeof e.port === 'number') map[f.id] = modId(map[e.to], e.port)
  }
  for (const n of g0.nodes) {
    if (!(n.id in map) || !map[n.id]) continue
    const copy: GNode = { ...n, id: map[n.id] }
    if (n.call) copy.call = { id: map[n.id], fn: n.call.fn, args: n.call.args.slice() }
    delete copy.bypassed
    g.nodes.push(copy)
  }
  for (const e of g0.edges) {
    const from = map[e.from] || e.from
    const to = map[e.to]
    if (!to) continue
    if (map[e.from] || e.port === 'in' || nodeById(g0, e.from)?.kind !== 'mod') g.edges.push({ from, to, port: e.port })
  }
  return { graph: g, map }
}

export function toggleBypass(g0: Graph, id: string, cat: Catalog = defaultCatalog): OpResult {
  const n = nodeById(g0, id)
  if (!n || n.kind !== 'call') return { error: 'only nodes in a chain can be bypassed' }
  if (!n.bypassed && isGenerator(n, cat)) return { error: 'a generator cannot be bypassed: it starts the chain' }
  return { graph: updateNode(g0, id, (x) => (x.bypassed ? { ...x, bypassed: undefined } : { ...x, bypassed: true })) }
}

/**
 * "Bake into an output buffer": a node that feeds several places is written once to a free output, and every place that
 * used it reads that output instead (`src(oN)` / `oN`), so the code no longer repeats it.
 */
export function bake(g0: Graph, id: string, free: OutName[]): OpResult {
  const o = free[0]
  if (!o) return { error: 'all four outputs are in use' }
  const n = nodeById(g0, id)
  if (!n || n.kind !== 'call') return { error: 'bake a chain node' }
  let g = clone(g0)
  const oid = outId(o)
  if (!nodeById(g, oid)) g.nodes.push({ id: oid, kind: 'out', name: o })
  const created: string[] = [oid]
  const uses = g.edges.filter((e) => e.from === id)
  g.edges = g.edges.filter((e) => e.from !== id)
  g.edges.push({ from: id, to: oid, port: 'in' })
  for (const u of uses) {
    const t = nodeById(g, u.to)
    if (!t) continue
    if (u.port === 'in' && (t.kind === 'call' || t.kind === 'out' || t.kind === 'def')) {
      const s = newCallNode('src')
      g = addNode(g, s)
      created.push(s.id)
      g.edges.push({ from: oid, to: s.id, port: 0 }, { from: s.id, to: u.to, port: u.port })
    } else g.edges.push({ from: oid, to: u.to, port: u.port })
  }
  return { graph: g, created }
}

/** Free outputs (not written by any cable), in order. */
export function freeOutputs(g: Graph): OutName[] {
  const written = new Set(g.edges.filter((e) => e.port === 'in' && nodeById(g, e.to)?.kind === 'out').map((e) => nodeById(g, e.to)!.name))
  return (['o0', 'o1', 'o2', 'o3'] as OutName[]).filter((o) => !written.has(o))
}

/** Which palette kinds make sense when a cable is dropped on empty canvas from this port. */
export function compatibleFor(g: Graph, nodeId: string, port: Port | 'out', cat: Catalog = defaultCatalog): 'mods' | 'gens' | 'modulators' | 'all' {
  const n = nodeById(g, nodeId)
  if (!n) return 'all'
  if (port === 'out') return isProvider(n) && n.kind !== 'out' && n.kind !== 'src' ? 'all' : 'mods'
  if (port === 'in') return 'gens'
  const t = portType(n, port, cat)
  return t === 'texture' ? 'gens' : t === 'number' ? 'modulators' : 'all'
}
