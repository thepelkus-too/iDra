import { describe, expect, test } from 'vitest'
import { activeSketch, importText, newSketch, setDisabled, toCode, withMeta, type Call, type ChainStmt, type Sketch } from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import { graphToIR, irToGraph, nodeById, offNodes, outId, type CompileMeta, type Graph } from '../src/model'
import { deleteNodes, duplicateNodes, connect } from '../src/ops'
import { offTarget, revivedCount, syncCopies } from '../src/off'
import { migrateBypass } from '../src/migrate'
import { previewSpecFor } from '../src/peek'
import { autoView, metaOf } from '../src/view'

const chainAt = (s: Sketch, i: number) => s.stmts.filter((x): x is ChainStmt => x.k === 'chain')[i]
const flat = (code: string) => code.replace(/\s+/g, '')

/** compile a graph edit like the app does; returns the error message instead when it is refused */
function apply(sk: Sketch, g: Graph, meta: CompileMeta = {}): Sketch | string {
  const r = graphToIR(g, sk, meta)
  return r.errors.length ? r.errors[0].message : r.sketch
}

describe('switching nodes off', () => {
  test('a modifier: stays in the graph, flagged, cables kept; the code comments it; on again is byte-identical', () => {
    const sk = importText('osc(10).rotate(0.5).kaleid(4).out()\n').sketch
    const rot = chainAt(sk, 0).chain.mods[0]
    const g0 = irToGraph(sk)
    const t = offTarget(sk, nodeById(g0, rot.id)!)!
    expect(t).toEqual({ id: rot.id, what: 'rotate' })
    const off = setDisabled(sk, t.id, true)
    // only the switched-off call moves to a line of its own; its untouched siblings keep their text
    expect(toCode(off)).toBe('osc(10)\n  // .rotate(0.5)\n  .kaleid(4).out()\n')
    const g = irToGraph(off)
    expect(nodeById(g, rot.id)?.disabled).toBe(true)
    expect(g.edges).toEqual(g0.edges)
    // the compiler skips it: what runs is osc → kaleid
    expect(flat(toCode(activeSketch(off)))).toBe('osc(10).kaleid(4).out()')
    // a graph round trip keeps the flag and the text
    const back = apply(off, g) as Sketch
    expect(toCode(back)).toBe(toCode(off))
    expect(toCode(setDisabled(off, rot.id, false))).toBe('osc(10).rotate(0.5).kaleid(4).out()\n')
  })

  test('a generator switches its whole chain statement', () => {
    const sk = importText('osc(10).rotate(0.5).out()\nnoise(3).out(o1)\n').sketch
    const st = chainAt(sk, 0)
    const t = offTarget(sk, nodeById(irToGraph(sk), st.chain.gen.id)!)!
    expect(t).toEqual({ id: st.id, what: 'the o0 chain' })
    const off = setDisabled(sk, t.id, true)
    expect(toCode(off)).toBe('// osc(10).rotate(0.5).out()\nnoise(3).out(o1)\n')
    const g = irToGraph(off)
    expect(nodeById(g, st.chain.gen.id)?.disabled).toBe(true)
    expect(nodeById(g, st.chain.mods[0].id)?.disabled).toBe(true)
    expect(nodeById(g, chainAt(sk, 1).chain.gen.id)?.disabled).toBeUndefined()
    // a node inside a switched-off statement: its toggle switches the statement back on
    expect(offTarget(off, nodeById(g, st.chain.mods[0].id)!)?.id).toBe(st.id)
  })

  test('switching off a blend takes its texture argument (and the modulators feeding it) with it', () => {
    const sk = importText('osc(10).blend(noise(() => Math.sin(time) * 3).rotate(1), 0.5).out()\n').sketch
    const blend = chainAt(sk, 0).chain.mods[0]
    const tex = blend.args[0] as Extract<Call['args'][0], { k: 'tex' }>
    const off = setDisabled(sk, blend.id, true)
    const g = irToGraph(off)
    for (const id of [blend.id, tex.chain.gen.id, tex.chain.mods[0].id, `mod:${tex.chain.gen.id}:0`]) expect(nodeById(g, id)?.disabled, id).toBe(true)
    expect(nodeById(g, chainAt(sk, 0).chain.gen.id)?.disabled).toBeUndefined()
    // a call inside the texture argument can't be switched alone: core says so, naming the blend
    expect(offTarget(sk, nodeById(irToGraph(sk), tex.chain.mods[0].id)!)?.id).toBe(tex.chain.mods[0].id)
    expect(toCode(off)).toBe('osc(10)\n  // .blend(noise(() => Math.sin(time) * 3).rotate(1), 0.5)\n  .out()\n')
  })

  test('a node fed into two places is off only when every copy is', () => {
    const sk = importText('osc(10).out()\n').sketch
    expect(offNodes(sk).size).toBe(0)
    const two = importText('osc(10).rotate(1).out()\nnoise(2).out(o1)\n// solid().out(o2)\n').sketch
    const off = offNodes(two)
    expect(off.has(chainAt(two, 2).chain.gen.id)).toBe(true)
    expect(off.has(chainAt(two, 0).chain.gen.id)).toBe(false)
  })

  test('copies of a duplicated node follow the switch', () => {
    // rotate feeds two outputs: written twice, linked in meta
    const sk0 = importText('osc(10).rotate(1).out()\n').sketch
    const rot = chainAt(sk0, 0).chain.mods[0].id
    const g0 = irToGraph(sk0)
    const r = graphToIR({ ...g0, edges: [...g0.edges, { from: rot, to: outId('o1'), port: 'in' }] }, sk0)
    expect(r.errors).toEqual([])
    expect(Object.values(r.meta.links)).toContain(rot)
    const off = syncCopies(setDisabled(r.sketch, rot, true), r.meta.links, rot)
    expect(toCode(off).match(/\/\/ \.rotate\(1\)/g)?.length).toBe(2)
    expect(nodeById(irToGraph(off, r.meta), rot)?.disabled).toBe(true)
    // and a graph edit writes copies of a switched-off node switched off
    const again = graphToIR(irToGraph(off, r.meta), off, r.meta)
    expect(toCode(again.sketch)).toBe(toCode(off))
  })

  test('edits that would put a switched-off node where a // line cannot go are refused, with the reason', () => {
    const base = importText('osc(10).rotate(1).kaleid(3).out()\nshape(3).modulate(o0).out(o1)\n').sketch
    const rot = chainAt(base, 0).chain.mods[0].id
    const off = setDisabled(base, rot, true)
    // deleting the generator would make rotate start the chain
    const del = apply(off, deleteNodes(irToGraph(off), [chainAt(off, 0).chain.gen.id]))
    expect(del).toMatch(/can't start with a switched-off node/)
    // wiring kaleid (after the switched-off rotate) into modulate's texture input would nest it on one line
    const shape = chainAt(off, 1).chain
    const r = connect(irToGraph(off), chainAt(off, 0).chain.mods[1].id, shape.mods[0].id, 0)
    expect(r.error).toBeUndefined()
    expect(apply(off, r.graph!)).toMatch(/texture input is written on one line/)
  })

  test('duplicating a switched-off node gives a switched-on copy', () => {
    const sk = importText('osc(10).rotate(1).out()\n').sketch
    const rot = chainAt(sk, 0).chain.mods[0].id
    const off = setDisabled(sk, rot, true)
    const { graph, map } = duplicateNodes(irToGraph(off), [rot])
    expect(nodeById(graph, map[rot])?.disabled).toBeUndefined()
    const out = apply(off, graph) as Sketch
    expect(flat(toCode(out))).toBe('osc(10)//.rotate(1).out()osc(10).rotate(1)')
  })

  test('the corpus: switching every switchable modifier off and on again through the graph is byte-identical', () => {
    for (const entry of corpus) {
      const sk = importText(entry.code).sketch
      const g = irToGraph(sk)
      for (const n of g.nodes) {
        const t = offTarget(sk, n)
        if (!t || n.kind !== 'call' || t.id !== n.id) continue
        const off = setDisabled(sk, t.id, !n.call!.disabled)
        if (off === sk) continue
        const r = graphToIR(irToGraph(off), off)
        expect(r.errors, `${entry.name} ${n.call!.fn}`).toEqual([])
        expect(toCode(r.sketch)).toBe(toCode(off))
        expect(toCode(setDisabled(r.sketch, t.id, !!n.call!.disabled))).toBe(entry.code)
      }
    }
  })
})

describe('migrating the old bypass flag', () => {
  const bypassed = (code: string, entries: Record<string, { call: Call; after: string | null }>) => {
    const sk = importText(code).sketch
    return withMeta(sk, 'graph', { ...autoView(sk), bypass: entries, other: 1 })
  }

  test('a bypassed node goes back into its chain switched off, and meta.graph.bypass is removed', () => {
    const sk0 = importText('osc(10).rotate(1).out()\n').sketch
    const gen = chainAt(sk0, 0).chain.gen.id
    const rot = chainAt(sk0, 0).chain.mods[0].id
    const sk = withMeta(sk0, 'graph', { ...autoView(sk0), bypass: { k1: { call: { id: 'k1', fn: 'kaleid', args: [{ k: 'num', v: 5 }] }, after: gen }, k2: { call: { id: 'k2', fn: 'posterize', args: [] }, after: 'k1' } } })
    const m = migrateBypass(sk)
    expect(toCode(m)).toBe('osc(10)\n  // .kaleid(5)\n  // .posterize()\n  .rotate(1).out()\n')
    expect('bypass' in (m.meta!.graph as object)).toBe(false)
    expect(metaOf(m)?.pos).toEqual(metaOf(sk)?.pos)
    expect(nodeById(irToGraph(m, metaOf(m)), 'k1')?.disabled).toBe(true)
    expect(rot).toBeTruthy()
    // migrating again changes nothing
    expect(migrateBypass(m)).toBe(m)
  })

  test('a bypassed node whose neighbour is gone (or sits in a texture argument) is kept as a comment, never dropped', () => {
    const sk = bypassed('osc(10).modulate(noise(3)).out()\n', {
      a: { call: { id: 'a', fn: 'rotate', args: [{ k: 'num', v: 2 }] }, after: 'gone' },
      b: { call: { id: 'b', fn: 'kaleid', args: [] }, after: null },
    })
    const m = migrateBypass(sk)
    expect(toCode(m)).toBe('osc(10).modulate(noise(3)).out()\n\n// bypassed in the graph, its neighbour is gone: .rotate(2)\n// bypassed in the graph, its neighbour is gone: .kaleid()\n')
    expect((m.meta!.graph as Record<string, unknown>).other).toBe(1)
  })

  test('sketches without the old key are returned as they are', () => {
    const sk = newSketch('x')
    expect(migrateBypass(sk)).toBe(sk)
    const v = withMeta(sk, 'graph', { ...autoView(sk) })
    expect(migrateBypass(v)).toBe(v)
  })
})

describe('revived comments', () => {
  test('counts chunks the importer revived, not ones switched off in an editor', () => {
    const sk = importText('osc(10)\n  // .rotate(1)\n  .kaleid(4)\n  .out()\n\n// noise(3).out(o1)\n').sketch
    expect(revivedCount(sk)).toBe(2)
    const k = chainAt(sk, 0).chain.mods.find((m) => m.fn === 'kaleid')!
    expect(revivedCount(setDisabled(sk, k.id, true))).toBe(2)
    expect(revivedCount(importText('osc(10).rotate(1).out()\n').sketch)).toBe(0)
  })
})

describe('preview specs', () => {
  test('a call previews its chain up to itself; A/B only on a modifier; an output its last writer', () => {
    const sk = importText('osc(10).rotate(1).modulate(noise(3).pixelate(4)).out()\nshape(3).out()\n').sketch
    const a = chainAt(sk, 0).chain
    const g = irToGraph(sk)
    const nested = (a.mods[1].args[0] as Extract<Call['args'][0], { k: 'tex' }>).chain
    expect(previewSpecFor(sk, nodeById(g, a.mods[0].id)!)).toMatchObject({ spec: { kind: 'prefix', chainId: a.id, upToCallId: a.mods[0].id }, label: 'osc → rotate', mod: true })
    expect(previewSpecFor(sk, nodeById(g, a.mods[0].id)!, true)?.spec).toEqual({ kind: 'diff', callId: a.mods[0].id })
    expect(previewSpecFor(sk, nodeById(g, a.gen.id)!, true)?.spec).toEqual({ kind: 'prefix', chainId: a.id, upToCallId: a.gen.id })
    expect(previewSpecFor(sk, nodeById(g, nested.mods[0].id)!)?.spec).toEqual({ kind: 'prefix', chainId: nested.id, upToCallId: nested.mods[0].id })
    expect(previewSpecFor(sk, nodeById(g, outId('o0'))!)?.spec).toEqual({ kind: 'prefix', chainId: chainAt(sk, 1).chain.id })
    expect(previewSpecFor(sk, nodeById(g, outId('o2'))!)).toBeUndefined()
  })
})
