// The operator tray's model: where taps and drops land and what they do to the IR.
import { describe, expect, test } from 'vitest'
import { catalog, importText, toCode, type Sketch } from '@hydra-ipad/core'
import { dropOperator, pushRecent, tapTarget, type DropTarget } from '../src/tray'

const sk = (code: string) => importText(code).sketch
const chainOf = (s: Sketch, i = 0) => {
  const st = s.stmts.filter((x) => x.k === 'chain')[i]
  if (st?.k !== 'chain') throw new Error('no chain')
  return st.chain
}
const drop = (s: Sketch, t: DropTarget, fn: string) => dropOperator(s, t, fn, catalog)

describe('dropping an operator', () => {
  test('a modifier into a gap becomes one new line, in place', () => {
    const s = sk('osc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .out()\n')
    const r = drop(s, { kind: 'gap', chainId: chainOf(s).id, index: 0 }, 'kaleid')
    expect(toCode(r.sketch)).toBe('osc(20, 0.1, 0.8)\n  .kaleid()\n  .rotate(0.8)\n  .out()\n')
    expect(r.select).toBe(chainOf(r.sketch).mods[0].id)
    const end = drop(s, { kind: 'gap', chainId: chainOf(s).id, index: 1 }, 'kaleid')
    expect(toCode(end.sketch)).toBe('osc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .kaleid()\n  .out()\n')
  })

  test('a combine or modulate modifier comes with a texture pocket', () => {
    const s = sk('osc().out()\n')
    const r = drop(s, { kind: 'gap', chainId: chainOf(s).id, index: 0 }, 'modulate')
    expect(toCode(r.sketch)).toContain('modulate(noise(3))')
  })

  test('a generator can not go in the middle of a chain', () => {
    const s = sk('osc().out()\n')
    const r = drop(s, { kind: 'gap', chainId: chainOf(s).id, index: 0 }, 'noise')
    expect(r.refused).toMatch(/generator/)
    expect(r.sketch).toBe(s)
  })

  test('a generator between statements is a new chain to a free output', () => {
    const s = sk('osc().out()\n')
    const r = drop(s, { kind: 'stmt', index: 1 }, 'noise')
    expect(r.sketch.stmts.length).toBe(2)
    expect(chainOf(r.sketch, 1).gen.fn).toBe('noise')
    expect(chainOf(r.sketch, 1).out).toBe('o1')
    expect(drop(s, { kind: 'stmt', index: 0 }, 'rotate').refused).toBeTruthy()
  })

  test('on a texture parameter: a generator makes a pocket, or swaps the pocket’s generator', () => {
    const s = sk('osc().modulate(o1, 0.2).out()\n')
    const mod = chainOf(s).mods[0]
    const r = drop(s, { kind: 'tex', callId: mod.id, i: 0 }, 'shape')
    expect(toCode(r.sketch)).toBe('osc().modulate(shape(), 0.2).out()\n')
    const again = drop(r.sketch, { kind: 'tex', callId: mod.id, i: 0 }, 'voronoi')
    expect(toCode(again.sketch)).toBe('osc().modulate(voronoi(), 0.2).out()\n')
  })

  test('on a texture parameter: a modifier joins the pocket, or wraps the o/s reference in src()', () => {
    const s = sk('osc().modulate(o1, 0.2).out()\n')
    const mod = chainOf(s).mods[0]
    const r = drop(s, { kind: 'tex', callId: mod.id, i: 0 }, 'kaleid')
    expect(toCode(r.sketch)).toBe('osc().modulate(src(o1).kaleid(), 0.2).out()\n')
    const p = sk('osc().modulate(noise(3), 0.2).out()\n')
    const r2 = drop(p, { kind: 'tex', callId: chainOf(p).mods[0].id, i: 0 }, 'rotate')
    expect(toCode(r2.sketch)).toBe('osc().modulate(noise(3).rotate(), 0.2).out()\n')
  })

  test('a variable texture is left alone (the modifier belongs in its definition)', () => {
    const s = sk('const b = noise(3)\nosc().modulate(b).out()\n')
    const r = drop(s, { kind: 'tex', callId: chainOf(s).mods[0].id, i: 0 }, 'rotate')
    expect(r.refused).toMatch(/variable b/)
  })
})

describe('where a tap inserts', () => {
  const s = sk('osc()\n  .rotate()\n  .kaleid()\n  .out()\nnoise().out(o1)\n')
  const c0 = chainOf(s)
  test('after the selected row; after the generator means first', () => {
    expect(tapTarget(s, 'scale', catalog, c0.mods[0].id, undefined)).toEqual({ kind: 'gap', chainId: c0.id, index: 1 })
    expect(tapTarget(s, 'scale', catalog, c0.gen.id, undefined)).toEqual({ kind: 'gap', chainId: c0.id, index: 0 })
  })
  test('at the end of the selected chain statement, else of the active chain, else the first', () => {
    expect(tapTarget(s, 'scale', catalog, s.stmts[1].id, undefined)).toEqual({ kind: 'gap', chainId: chainOf(s, 1).id, index: 0 })
    expect(tapTarget(s, 'scale', catalog, undefined, s.stmts[1].id)).toEqual({ kind: 'gap', chainId: chainOf(s, 1).id, index: 0 })
    expect(tapTarget(s, 'scale', catalog, undefined, undefined)).toEqual({ kind: 'gap', chainId: c0.id, index: 2 })
  })
  test('a generator makes a new chain after the selected statement, or at the end', () => {
    expect(tapTarget(s, 'noise', catalog, c0.mods[1].id, undefined)).toEqual({ kind: 'stmt', index: 1 })
    expect(tapTarget(s, 'noise', catalog, undefined, undefined)).toEqual({ kind: 'stmt', index: 2 })
  })
  test('no chain: nowhere for a modifier', () => {
    expect(tapTarget(sk('// nothing\n'), 'rotate', catalog, undefined, undefined)).toBeUndefined()
  })
})

test('recents: most recent first, no duplicates, capped', () => {
  expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
})
