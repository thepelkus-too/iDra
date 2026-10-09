// The graph model and the two translations the whole editor rests on. Pure, no DOM, unit-tested over the corpus.
//
//   irToGraph(sketch, meta)  → nodes + cables (what the canvas draws)
//   graphToIR(graph, prev)   → the sketch (what the code is)
//
// Every structural edit is an edit of the graph followed by graphToIR, so the compile rules live in exactly one place:
//   * a node whose output feeds one downstream main input is inlined into that chain (`.rotate()`);
//   * a node feeding a texture input becomes a nested chain in that argument (`modulate(noise(3))`);
//   * a node feeding several places is DUPLICATED in the code (Hydra has no texture variables): copies get stable ids that
//     are remembered in `meta.graph.links`, so reading the code back collapses them onto the one node again;
//   * outputs and sources are nodes: `out(o0)` is a cable into the o0 node, `src(o0)` a cable out of it, so feedback is a
//     visible loop; any other cycle is rejected;
//   * modulators (LFO, time, mouse, audio, steps, expression) are nodes wired into number inputs; they emit `fn`/`arr` values;
//   * bypassed nodes stay on the canvas but are left out of the code (kept in `meta.graph.bypass`).
// The sketch (IR) stays the single source of truth: the graph is rebuilt from it after every change.
import {
  DEFAULT,
  contentString,
  newId,
  OUT_NAMES,
  type Call,
  type Chain,
  type ChainStmt,
  type DefStmt,
  type OutName,
  type Sketch,
  type SourceName,
  type Stmt,
  type Value,
} from '@hydra-ipad/core'
import { respace } from './kit/model'

export type NodeKind = 'call' | 'out' | 'src' | 'def' | 'mod' | 'comment' | 'raw' | 'setting' | 'render' | 'source'
export type Port = 'in' | number

export interface GNode {
  id: string
  kind: NodeKind
  /** call nodes: the call; argument slots fed by a cable hold DEFAULT here (the cable is the value) */
  call?: Call
  bypassed?: boolean
  /** statement-backed nodes (def, comment, raw, setting, render, source); a def fed by a cable holds DEFAULT */
  stmt?: Stmt
  /** out / src nodes */
  name?: OutName | SourceName
  /** mod nodes: the value they emit */
  value?: Value
}

export interface GEdge {
  from: string
  to: string
  port: Port
}

export interface Graph {
  nodes: GNode[]
  edges: GEdge[]
}

/** What `meta.graph` remembers about the compile (the rest of the view state is in view.ts). */
export interface CompileMeta {
  /** copy call id → the node (call id) it duplicates */
  links?: Record<string, string>
  /** bypassed calls: the whole call (with its texture arguments) and the call it follows */
  bypass?: Record<string, { call: Call; after: string | null }>
}

export const outId = (o: string): string => `out:${o}`
export const srcId = (s: string): string => `src:${s}`
export const modId = (callId: string, i: number): string => `mod:${callId}:${i}`
export const isProvider = (n: GNode): boolean => n.kind === 'out' || n.kind === 'src' || n.kind === 'def' || n.kind === 'mod'

// ================================================================================================ IR → graph

export function irToGraph(sketch: Sketch, meta: CompileMeta = {}): Graph {
  const nodes = new Map<string, GNode>()
  const edges: GEdge[] = []
  const links = meta.links ?? {}
  const bypass = meta.bypass ?? {}
  const defByName = new Map<string, string>()
  for (const s of sketch.stmts) if (s.k === 'def') defByName.set(s.name, s.id)

  const add = (n: GNode): GNode => {
    if (!nodes.has(n.id)) nodes.set(n.id, n)
    return nodes.get(n.id)!
  }
  const ensureOut = (o: string) => add({ id: outId(o), kind: 'out', name: o as OutName }).id
  const ensureSrc = (s: string) => add({ id: srcId(s), kind: 'src', name: s as SourceName }).id
  const hasEdge = (e: GEdge) => edges.some((x) => x.from === e.from && x.to === e.to && x.port === e.port)
  const edge = (e: GEdge) => {
    if (!hasEdge(e)) edges.push(e)
  }

  /** the node a value feeds from, creating what it needs; undefined = the value stays on the node */
  const wire = (v: Value, owner: string, i: number): string | undefined => {
    switch (v.k) {
      case 'tex':
        return addChain(v.chain)
      case 'ref':
        return v.name.startsWith('o') ? ensureOut(v.name) : ensureSrc(v.name)
      case 'var':
        return defByName.get(v.name)
      case 'fn':
      case 'arr':
        return add({ id: modId(owner, i), kind: 'mod', value: v }).id
      default:
        return undefined
    }
  }

  const addCall = (c: Call, prev: string | undefined, bypassed = false): string => {
    // a linked copy that still matches its original collapses onto it (the original's cables already exist)
    const orig = links[c.id]
    const on = orig ? nodes.get(orig) : undefined
    if (on && on.kind === 'call' && sameCall(on, c, links)) {
      if (prev) edge({ from: prev, to: on.id, port: 'in' })
      return on.id
    }
    const args = c.args.slice()
    const wires: Array<[string, number]> = []
    c.args.forEach((a, i) => {
      const from = wire(a, c.id, i)
      if (from) {
        args[i] = DEFAULT
        wires.push([from, i])
      }
    })
    add({ id: c.id, kind: 'call', call: { ...c, args }, ...(bypassed ? { bypassed } : {}) })
    if (prev) edge({ from: prev, to: c.id, port: 'in' })
    for (const [from, i] of wires) edge({ from, to: c.id, port: i })
    return c.id
  }

  /** a chain's calls in flow order (bypassed calls re-inserted after the call they follow); returns the last node */
  const addChain = (chain: Chain): string => {
    let prev: string | undefined
    const calls = [chain.gen, ...chain.mods]
    const pending = Object.entries(bypass)
    const insertBypassed = (after: string | null) => {
      for (const [id, b] of pending) {
        if (b.after !== after || nodes.has(id)) continue
        prev = addCall(b.call, prev, true)
        insertBypassed(id)
      }
    }
    calls.forEach((c, k) => {
      prev = addCall(c, prev)
      if (k === 0 || prev === c.id) insertBypassed(c.id)
    })
    return prev!
  }

  for (const s of sketch.stmts) {
    switch (s.k) {
      case 'chain': {
        const last = addChain(s.chain)
        if (s.chain.out !== null) edge({ from: last, to: ensureOut(s.chain.out ?? 'o0'), port: 'in' })
        break
      }
      case 'def': {
        const v = s.value
        if (v.k === 'tex' || (v.k === 'var' && defByName.has(v.name))) {
          add({ id: s.id, kind: 'def', stmt: { ...s, value: DEFAULT } })
          const from = v.k === 'tex' ? addChain(v.chain) : defByName.get(v.name)!
          edge({ from, to: s.id, port: 'in' })
        } else add({ id: s.id, kind: 'def', stmt: s })
        break
      }
      case 'source':
        add({ id: s.id, kind: 'source', stmt: s })
        ensureSrc(s.slot)
        break
      default:
        add({ id: s.id, kind: s.k, stmt: s })
    }
  }
  // bypassed calls whose neighbour disappeared (edited elsewhere) are still shown, unconnected: never silently dropped
  for (const [id, b] of Object.entries(bypass)) if (!nodes.has(id)) addCall(b.call, undefined, true)
  // the four outputs are always there to be wired
  for (const o of OUT_NAMES) ensureOut(o)
  return { nodes: [...nodes.values()], edges }
}

/** Does call `c` (a copy) still say exactly what node `n` says? Texture arguments are compared as code. */
function sameCall(n: GNode, c: Call, links: Record<string, string>): boolean {
  const a = n.call!
  if (a.fn !== c.fn) return false
  void links
  // the node's wired slots are DEFAULT; compare only the slots that stay on the node
  const len = Math.max(a.args.length, c.args.length)
  for (let i = 0; i < len; i++) {
    const x = a.args[i]
    const y = c.args[i]
    if (x && x.k === 'default' && y && (y.k === 'tex' || y.k === 'ref' || y.k === 'var' || y.k === 'fn' || y.k === 'arr')) continue
    if (contentString(x ?? DEFAULT) !== contentString(y ?? DEFAULT)) return false
  }
  return true
}

// ================================================================================================ graph → IR

export interface CompileError {
  message: string
  /** the cable that closes a cycle, when known */
  edge?: GEdge
  node?: string
}

export interface CompileResult {
  sketch: Sketch
  meta: Required<CompileMeta>
  /** node id → how many times it is written in the code (>1 = duplicated) */
  dup: Record<string, number>
  errors: CompileError[]
}

class CycleError extends Error {
  constructor(public node: string) {
    super('cycle')
  }
}

export function graphToIR(g: Graph, prev: Sketch, prevMeta: CompileMeta = {}): CompileResult {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const inFlow = new Map<string, string>()
  const outs = new Map<string, GEdge[]>()
  const argIn = new Map<string, GEdge>()
  for (const e of g.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue
    if (e.port === 'in') {
      const to = byId.get(e.to)!
      if (to.kind === 'call' || to.kind === 'def') inFlow.set(e.to, e.from)
    } else argIn.set(`${e.to}:${e.port}`, e)
    outs.set(e.from, [...(outs.get(e.from) ?? []), e])
  }

  // ---- previous objects to carry ids, `src` and `meta` over
  const prevChainByGen = new Map<string, Chain>()
  const prevCall = new Map<string, Call>()
  const visitChain = (c: Chain) => {
    prevChainByGen.set(c.gen.id, c)
    for (const call of [c.gen, ...c.mods]) {
      prevCall.set(call.id, call)
      for (const a of call.args) if (a.k === 'tex') visitChain(a.chain)
    }
  }
  for (const s of prev.stmts) {
    if (s.k === 'chain') visitChain(s.chain)
    else if (s.k === 'def' && s.value.k === 'tex') visitChain(s.value.chain)
  }
  for (const b of Object.values(prevMeta.bypass ?? {})) visitChain({ id: '', gen: b.call, mods: [] })
  const prevCopies = new Map<string, string[]>()
  for (const [copy, orig] of Object.entries(prevMeta.links ?? {})) prevCopies.set(orig, [...(prevCopies.get(orig) ?? []), copy])

  const links: Record<string, string> = {}
  const dup: Record<string, number> = {}
  const emitted = new Map<string, number>()
  const errors: CompileError[] = []

  /** non-bypassed upstream of a node along main inputs */
  const upstream = (id: string | undefined): string | undefined => {
    let cur = id
    const seen = new Set<string>()
    while (cur && byId.get(cur)?.bypassed) {
      if (seen.has(cur)) throw new CycleError(cur)
      seen.add(cur)
      cur = inFlow.get(cur)
    }
    return cur
  }

  const building = new Set<string>()

  /** one emission of a call node: the original object the first time, a stable-id copy afterwards */
  const emitCall = (id: string): Call => {
    const n = byId.get(id)!
    if (building.has(id)) throw new CycleError(id)
    building.add(id)
    const base = n.call!
    const args = base.args.slice()
    const fill = (i: number) => {
      const e = argIn.get(`${id}:${i}`)
      if (!e) return
      while (args.length <= i) args.push(DEFAULT)
      args[i] = valueFrom(e.from)
    }
    for (let i = 0; i < args.length; i++) fill(i)
    for (const key of argIn.keys()) {
      const [nid, p] = splitKey(key)
      if (nid === id && p >= args.length) fill(p)
    }
    building.delete(id)
    const k = emitted.get(id) ?? 0
    emitted.set(id, k + 1)
    dup[id] = k + 1
    if (k === 0) return { ...base, args }
    const copyId = prevCopies.get(id)?.[k - 1] ?? newId('c')
    links[copyId] = id
    const was = prevCall.get(copyId)
    const copy: Call = { id: copyId, fn: base.fn, args: reIdValues(args) }
    if (was?.src) copy.src = was.src
    if (base.meta) copy.meta = base.meta
    return copy
  }

  /** the chain that ends at node `end` (walking main inputs up to its generator) */
  const buildChain = (end: string): Chain => {
    const ids: string[] = []
    const seen = new Set<string>()
    let cur = upstream(end)
    while (cur) {
      if (seen.has(cur)) throw new CycleError(cur)
      seen.add(cur)
      ids.unshift(cur)
      cur = upstream(inFlow.get(cur))
    }
    if (ids.length === 0) throw new Error('empty chain')
    const calls = ids.map(emitCall)
    const old = prevChainByGen.get(calls[0].id)
    const chain: Chain = old ? { ...old, gen: calls[0], mods: calls.slice(1) } : { id: newId('h'), gen: calls[0], mods: calls.slice(1) }
    delete chain.out
    return chain
  }

  const valueFrom = (from: string): Value => {
    const n = byId.get(from)!
    switch (n.kind) {
      case 'out':
      case 'src':
        return { k: 'ref', name: n.name! }
      case 'def':
        return { k: 'var', name: (n.stmt as DefStmt).name }
      case 'mod':
        return n.value!
      case 'call': {
        const chain = buildChain(from)
        return { k: 'tex', chain }
      }
      default:
        return DEFAULT
    }
  }

  // ---- top-level chain ends: every cable into an output, and every call nobody reads
  type End = { node: string; out: OutName | null }
  const ends: End[] = []
  for (const e of g.edges) {
    const to = byId.get(e.to)
    const from = byId.get(e.from)
    if (to?.kind === 'out' && e.port === 'in' && from?.kind === 'call') ends.push({ node: e.from, out: to.name as OutName })
  }
  for (const n of g.nodes) {
    if (n.kind !== 'call' || n.bypassed) continue
    const used = (outs.get(n.id) ?? []).some((e) => {
      const to = byId.get(e.to)
      // a texture argument of a bypassed node is kept with that node (in meta), not promoted to a chain of its own
      return !!to && (e.port !== 'in' || to.kind !== 'call' || !to.bypassed || hasLiveDownstream(e.to))
    })
    if (!used) ends.push({ node: n.id, out: null })
  }
  function hasLiveDownstream(id: string, seen = new Set<string>()): boolean {
    if (seen.has(id)) return false
    seen.add(id)
    return (outs.get(id) ?? []).some((e) => {
      const to = byId.get(e.to)
      if (!to) return false
      if (to.kind === 'call' && to.bypassed) return hasLiveDownstream(to.id, seen)
      return true
    })
  }
  // bypassed ends: a bypassed last node makes its upstream the end
  for (const end of ends) end.node = upstream(end.node) ?? end.node

  // ---- match ends with previous chain statements (keeps ids, text and order)
  const prevChains = prev.stmts.filter((s): s is ChainStmt => s.k === 'chain')
  const lastOf = (c: Chain) => (c.mods.length ? c.mods[c.mods.length - 1].id : c.gen.id)
  const callsOf = (c: Chain) => new Set([c.gen.id, ...c.mods.map((m) => m.id)])
  const owner = new Map<End, ChainStmt>()
  const used = new Set<string>()
  const tryMatch = (pred: (p: ChainStmt, e: End) => boolean) => {
    for (const p of prevChains) {
      if (used.has(p.id)) continue
      const e = ends.find((x) => !owner.has(x) && pred(p, x))
      if (e) {
        owner.set(e, p)
        used.add(p.id)
      }
    }
  }
  const outOf = (p: ChainStmt) => (p.chain.out === undefined ? 'o0' : p.chain.out)
  tryMatch((p, e) => lastOf(p.chain) === e.node && outOf(p) === e.out)
  tryMatch((p, e) => lastOf(p.chain) === e.node)
  tryMatch((p, e) => p.chain.gen.id === chainGen(e.node))
  tryMatch((p, e) => callsOf(p.chain).has(e.node))
  function chainGen(end: string): string | undefined {
    let cur: string | undefined = end
    const seen = new Set<string>()
    let last: string | undefined
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      last = cur
      cur = inFlow.get(cur)
    }
    return last
  }

  // ---- statements in order: previous ones keep their place, new ones go at the end
  const plan: Array<{ kind: 'stmt'; node: GNode } | { kind: 'chain'; end: End; prev?: ChainStmt }> = []
  const nodeStmtIds = new Set(g.nodes.filter((n) => n.stmt).map((n) => n.id))
  for (const s of prev.stmts) {
    if (s.k === 'chain') {
      const e = [...owner.entries()].find(([, p]) => p.id === s.id)?.[0]
      if (e) plan.push({ kind: 'chain', end: e, prev: s })
    } else if (nodeStmtIds.has(s.id)) plan.push({ kind: 'stmt', node: byId.get(s.id)! })
  }
  const known = new Set(prev.stmts.map((s) => s.id))
  for (const n of g.nodes) if (n.stmt && !known.has(n.id)) plan.push({ kind: 'stmt', node: n })
  for (const e of ends) if (!owner.has(e)) plan.push({ kind: 'chain', end: e })

  let stmts: Stmt[] = []
  const touched: string[] = []
  try {
    for (const p of plan) {
      if (p.kind === 'stmt') {
        const s = p.node.stmt!
        if (s.k === 'def') {
          const from = inFlow.get(p.node.id)
          if (from) {
            const fromNode = byId.get(from)!
            const value: Value = fromNode.kind === 'call' ? { k: 'tex', chain: buildChain(from) } : valueFrom(from)
            stmts.push({ ...s, value } as Stmt)
            continue
          }
          if (s.value.k === 'default') {
            // a texture variable whose cable was removed keeps a visible, valid placeholder
            stmts.push({ ...s, value: { k: 'num', v: 0 } })
            continue
          }
        }
        stmts.push(s)
        if (!known.has(s.id)) touched.push(s.id)
      } else {
        const chain = buildChain(p.end.node)
        const prevS = p.prev
        if (prevS) {
          const out = prevS.chain.out === undefined && p.end.out === 'o0' ? undefined : p.end.out
          const c: Chain = { ...chain, id: prevS.chain.id, out }
          if (prevS.chain.src) c.src = prevS.chain.src
          if (prevS.chain.meta) c.meta = prevS.chain.meta
          if (out === undefined) delete c.out
          stmts.push({ ...prevS, chain: c })
        } else {
          const id = newId('s')
          stmts.push({ id, k: 'chain', chain: { ...chain, out: p.end.out } })
          touched.push(id)
        }
      }
    }
  } catch (e) {
    if (e instanceof CycleError) {
      errors.push({ message: 'This connection makes a loop. Loops must go through an output (o0–o3): write with out(), read back with src().', node: e.node })
      return { sketch: prev, meta: { links: prevMeta.links ?? {}, bypass: prevMeta.bypass ?? {} }, dup: {}, errors }
    }
    throw e
  }

  // ---- bypassed calls: remember them whole, with what they follow (not counted as duplicates)
  const dupMain = { ...dup }
  const bypass: Record<string, { call: Call; after: string | null }> = {}
  for (const n of g.nodes) {
    if (n.kind !== 'call' || !n.bypassed) continue
    let call: Call
    try {
      const args = n.call!.args.slice()
      for (const [key, e] of argIn) {
        const [nid, p] = splitKey(key)
        if (nid !== n.id) continue
        while (args.length <= p) args.push(DEFAULT)
        args[p] = valueFrom(e.from)
      }
      call = { ...n.call!, args }
    } catch {
      call = n.call!
    }
    const up = inFlow.get(n.id)
    bypass[n.id] = { call, after: up ?? null }
  }

  stmts = hoistDefs(stmts)
  // whitespace before a statement travels with it: fix the ones whose predecessor changed
  const predBefore = new Map(prev.stmts.map((s, i) => [s.id, i ? prev.stmts[i - 1].id : '']))
  stmts.forEach((s, i) => {
    if (predBefore.get(s.id) !== (i ? stmts[i - 1].id : '')) touched.push(s.id)
  })
  const sketch = respace({ ...prev, stmts }, touched)
  return { sketch, meta: { links, bypass }, dup: dupMain, errors }
}

function splitKey(key: string): [string, number] {
  const i = key.lastIndexOf(':')
  return [key.slice(0, i), Number(key.slice(i + 1))]
}

/** Fresh ids inside copied argument values (nested chains in a duplicated call). */
function reIdValues(args: Value[]): Value[] {
  const walkChain = (c: Chain): Chain => ({
    ...c,
    id: newId('h'),
    gen: { ...c.gen, id: newId('c'), args: c.gen.args.map(walkValue) },
    mods: c.mods.map((m) => ({ ...m, id: newId('c'), args: m.args.map(walkValue) })),
  })
  const walkValue = (v: Value): Value => (v.k === 'tex' ? { ...v, chain: walkChain(v.chain) } : v)
  return args.map(walkValue)
}

/** A definition must come before its first use: move a def up to just before the first statement that uses it. */
export function hoistDefs(stmts: Stmt[]): Stmt[] {
  const out = stmts.slice()
  const uses = (s: Stmt, name: string): boolean => {
    const inVal = (v: Value): boolean => (v.k === 'var' && v.name === name) || (v.k === 'tex' && inChain(v.chain))
    const inChain = (c: Chain): boolean => [c.gen, ...c.mods].some((call) => call.args.some(inVal))
    if (s.k === 'chain') return inChain(s.chain)
    if (s.k === 'def') return inVal(s.value)
    return false
  }
  for (let guard = 0; guard < out.length * 2; guard++) {
    let moved = false
    for (let i = 0; i < out.length; i++) {
      const d = out[i]
      if (d.k !== 'def') continue
      const first = out.findIndex((s) => s !== d && uses(s, d.name))
      if (first >= 0 && first < i) {
        out.splice(i, 1)
        out.splice(first, 0, d)
        moved = true
        break
      }
    }
    if (!moved) break
  }
  return out
}

// ================================================================================================ queries

export function nodeById(g: Graph, id: string): GNode | undefined {
  return g.nodes.find((n) => n.id === id)
}

/** Every output name used by the graph, in o0..o3 order. */
export function outputsIn(g: Graph): OutName[] {
  return OUT_NAMES.filter((o) => g.nodes.some((n) => n.id === outId(o)))
}

/** Is `target` reachable from `start` following cables forward, without passing through an output node? */
export function reachesWithoutOutput(g: Graph, start: string, target: string): boolean {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length) {
    const id = stack.pop()!
    if (id === target) return true
    if (seen.has(id)) continue
    seen.add(id)
    const n = byId.get(id)
    if (n && n.kind === 'out' && id !== start) continue
    for (const e of g.edges) if (e.from === id) stack.push(e.to)
  }
  return false
}
