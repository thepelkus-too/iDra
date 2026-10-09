import { describe, expect, test } from 'vitest'
import { canonicalSketch, importText, newSketch, num, toCode, validate, type Sketch } from '@hydra-ipad/core'
import { graphToIR, irToGraph, nodeById, outId, type CompileMeta, type Graph } from '../src/model'
import { appendAfter, bake, connect, deleteNodes, disconnect, duplicateNodes, freeOutputs, newCallNode, setModulator, setNodeArg, splice, toggleBypass } from '../src/ops'
import { defaultSpec } from '../src/kit/mods'

/** a tiny driver: graph edits compiled straight back to the sketch, like the app does */
class Doc {
  sketch: Sketch
  meta: CompileMeta = {}
  constructor(code = '') {
    this.sketch = code ? importText(code).sketch : newSketch('t')
  }
  get g(): Graph {
    return irToGraph(this.sketch, this.meta)
  }
  apply(g: Graph): void {
    const r = graphToIR(g, this.sketch, this.meta)
    if (r.errors.length) throw new Error(r.errors[0].message)
    this.sketch = r.sketch
    this.meta = r.meta
  }
  ok<T extends { graph?: Graph; error?: string }>(r: T): T {
    if (r.error) throw new Error(r.error)
    this.apply(r.graph!)
    return r
  }
  code() {
    return toCode(this.sketch)
  }
  same(code: string) {
    expect(canonicalSketch(this.sketch)).toEqual(canonicalSketch(importText(code).sketch))
  }
}

describe('building by wiring (acceptance 1)', () => {
  test('osc → rotate → modulate(noise) → o0', () => {
    const d = new Doc()
    const osc = newCallNode('osc')
    d.apply({ ...d.g, nodes: [...d.g.nodes, osc] })
    expect(d.code()).toBe('osc()\n')
    let g = d.g
    for (const [i, v] of [20, 0.1, 0.8].entries()) setNodeArg(g, osc.id, i, num(v))
    d.apply(g)
    const rot = newCallNode('rotate')
    d.ok(connect({ ...d.g, nodes: [...d.g.nodes, rot] }, osc.id, rot.id, 'in'))
    g = d.g
    setNodeArg(g, rot.id, 0, num(0.8))
    d.apply(g)
    const mod = newCallNode('modulate')
    d.ok(connect({ ...d.g, nodes: [...d.g.nodes, mod] }, rot.id, mod.id, 'in'))
    const noise = newCallNode('noise')
    d.ok(connect({ ...d.g, nodes: [...d.g.nodes, noise] }, noise.id, mod.id, 0))
    g = d.g
    setNodeArg(g, noise.id, 0, num(3))
    setNodeArg(g, mod.id, 1, num(0.1))
    d.apply(g)
    d.ok(connect(d.g, mod.id, outId('o0'), 'in'))
    // codegen drops trailing defaults (modulate's amount is 0.1 by default), so compare canonically
    d.same('osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out()')
    expect(d.code().replace(/\s+/g, '')).toBe('osc(20,0.1,0.8).rotate(0.8).modulate(noise(3)).out()')
    expect(validate(d.sketch).filter((p) => p.severity === 'error')).toEqual([])
  })
})

describe('feedback and cycles (acceptance 2)', () => {
  test('src(o0).modulateRotate(osc(3),0.5).blend(osc(20),0.1).out(o0) round-trips as a loop through o0', () => {
    const code = 'src(o0).modulateRotate(osc(3), 0.5).blend(osc(20), 0.1).out(o0)\n'
    const d = new Doc(code)
    const g = d.g
    // the loop is visible: o0 → src, …, blend → o0
    expect(g.edges.some((e) => e.from === outId('o0') && e.port === 0)).toBe(true)
    expect(g.edges.some((e) => e.to === outId('o0') && e.port === 'in')).toBe(true)
    d.apply(g)
    expect(d.code()).toBe(code)
  })
  test('a cycle that does not pass through an output is rejected', () => {
    const d = new Doc('osc(10).rotate(1).kaleid(4).out()\n')
    const st = d.sketch.stmts[0] as Extract<Sketch['stmts'][0], { k: 'chain' }>
    const kaleid = st.chain.mods[1].id
    const rotate = st.chain.mods[0].id
    const blend = newCallNode('blend')
    const r1 = appendAfter(d.g, rotate, blend)
    d.ok(r1)
    // kaleid (downstream of blend) into blend's texture input: a loop
    const r = connect(d.g, kaleid, blend.id, 0)
    expect(r.error).toMatch(/loop/)
    // the same thing through o0 is fine: feedback
    const ok = connect(d.g, outId('o0'), blend.id, 0)
    expect(ok.error).toBeUndefined()
    d.apply(ok.graph!)
    expect(d.code().replace(/\s+/g, '')).toBe('osc(10).rotate(1).blend(o0).kaleid(4).out()')
  })
})

describe('modulators (acceptance 3)', () => {
  test('an LFO into rotate.angle is an arrow function; an Array into shape.sides is an array with modifiers', () => {
    const d = new Doc('shape(4).rotate(0.5).out()\n')
    const st = d.sketch.stmts[0] as Extract<Sketch['stmts'][0], { k: 'chain' }>
    d.apply(setModulator(d.g, st.chain.mods[0].id, 0, { kind: 'sine', rate: 2, amp: 0.5, off: 0.2 }))
    expect(d.code()).toContain('rotate(() => Math.sin(time * 2) * 0.5 + 0.2)')
    d.apply(setModulator(d.g, st.chain.gen.id, 0, { ...defaultSpec('steps'), steps: [3, 4, 6], mods: { fast: 2, smooth: 0.5 } }))
    expect(d.code()).toContain('shape([3, 4, 6].fast(2).smooth(0.5))')
    // and back: the modulator nodes are there after reading the code
    const g = irToGraph(importText(d.code()).sketch)
    expect(g.nodes.filter((n) => n.kind === 'mod').length).toBe(2)
    // unplugging the LFO leaves the resting value
    const e = d.g.edges.find((x) => x.to === st.chain.mods[0].id && x.port === 0)!
    d.apply(disconnect(d.g, e))
    expect(d.code()).toContain('rotate(0.2)')
  })
})

describe('duplication and baking', () => {
  test('one node feeding two places is written twice, shown once, and bakes into an output', () => {
    const d = new Doc('osc(10).rotate(1).out(o0)\n')
    const st = d.sketch.stmts[0] as Extract<Sketch['stmts'][0], { k: 'chain' }>
    const rot = st.chain.mods[0].id
    d.ok(connect(d.g, rot, outId('o1'), 'in'))
    expect(d.code().replace(/\s+/g, '')).toBe('osc(10).rotate(1).out(o0)osc(10).rotate(1).out(o1)')
    const r = graphToIR(d.g, d.sketch, d.meta)
    expect(r.dup[rot]).toBe(2)
    // reading the code back collapses the copy onto the node
    const g = d.g
    expect(g.nodes.filter((n) => n.kind === 'call').length).toBe(2)
    // a number edit on the shared node changes both copies
    const g2 = d.g
    setNodeArg(g2, rot, 0, num(2))
    d.apply(g2)
    expect(d.code().replace(/\s+/g, '')).toBe('osc(10).rotate(2).out(o0)osc(10).rotate(2).out(o1)')
    // bake: written once to a free output, read twice
    d.ok(bake(d.g, rot, freeOutputs(d.g)))
    const lines = d.code().replace(/\n\s+\./g, '.').trim().split('\n').filter(Boolean).sort()
    expect(lines).toEqual(['osc(10).rotate(2).out(o2)', 'src(o2).out()', 'src(o2).out(o1)'])
  })
})

describe('other edits', () => {
  test('splice a node into a cable, bypass it, delete it', () => {
    const d = new Doc('osc(10).out()\n')
    const st = d.sketch.stmts[0] as Extract<Sketch['stmts'][0], { k: 'chain' }>
    const e = d.g.edges.find((x) => x.from === st.chain.gen.id && x.to === outId('o0'))!
    const k = newCallNode('kaleid')
    d.ok(splice(d.g, e, k))
    expect(d.code()).toBe('osc(10).kaleid().out()\n')
    d.ok(toggleBypass(d.g, k.id))
    expect(d.code()).toBe('osc(10).out()\n')
    expect(nodeById(d.g, k.id)?.bypassed).toBe(true)
    d.ok(toggleBypass(d.g, k.id))
    expect(d.code().replace(/\s+/g, '')).toBe('osc(10).kaleid().out()')
    d.apply(deleteNodes(d.g, [k.id]))
    expect(d.code().replace(/\s+/g, '')).toBe('osc(10).out()')
  })
  test('duplicate branches from the same source', () => {
    const d = new Doc('osc(10).rotate(1).out()\n')
    const st = d.sketch.stmts[0] as Extract<Sketch['stmts'][0], { k: 'chain' }>
    const { graph } = duplicateNodes(d.g, [st.chain.mods[0].id])
    d.apply(graph)
    expect(d.code().replace(/\s+/g, '')).toBe('osc(10).rotate(1).out()osc(10).rotate(1)')
  })
  test('rewiring a main input leaves the old upstream as a not-rendered chain (nothing is lost)', () => {
    const d = new Doc('osc(10).rotate(1).out()\nnoise(3).out(o1)\n')
    const a = d.sketch.stmts[0] as Extract<Sketch['stmts'][0], { k: 'chain' }>
    const b = d.sketch.stmts[1] as Extract<Sketch['stmts'][0], { k: 'chain' }>
    d.ok(connect(d.g, b.chain.gen.id, a.chain.mods[0].id, 'in'))
    // the rewired chain keeps its place, noise is now written twice (it feeds two places), osc stays as a not-rendered chain
    expect(d.code().replace(/\s+/g, '')).toBe('noise(3).rotate(1).out()noise(3).out(o1)osc(10)')
  })
})
