import { describe, expect, test } from 'vitest'
import { catalog, importText } from '@hydra-ipad/core'
import { attribute, problemMap, unattributed } from '../src/problems'
import { mutateChain } from '../src/mutate'
import { toCode, walkCalls } from '@hydra-ipad/core'

describe('problems', () => {
  test('validate() problems land on the call that owns them', () => {
    const s = importText('osc(5).modulate().out()\nfoo(3).out(o1)\n').sketch
    const m = problemMap(s, [], catalog)
    const mod = (s.stmts[0] as any).chain.mods[0]
    expect(m.get(mod.id)?.[0].code).toBe('texture-missing')
    expect(m.get(mod.id)?.[0].severity).toBe('error')
    const foo = (s.stmts[1] as any).chain.gen
    expect(m.get(foo.id)?.[0].severity).toBe('warning')
  })

  test('a thrown "x is not defined" goes to the call that uses x', () => {
    const s = importText('osc(5).rotate(() => nothere + 1).out()\n').sketch
    const rot = (s.stmts[0] as any).chain.mods[0]
    expect(attribute(s, { kind: 'eval', message: 'ReferenceError: nothere is not defined' })).toBe(rot.id)
    expect(attribute(s, { kind: 'eval', message: 'osc is not a function' })).toBe((s.stmts[0] as any).chain.gen.id)
    expect(attribute(s, { kind: 'shader', message: 'Error compiling fragment shader' })).toBeUndefined()
  })

  test('what no row can take stays in the banner list', () => {
    const s = importText('osc(5).out()\n').sketch
    const errs = [{ kind: 'shader', message: 'shader could not compile' }, { kind: 'eval', message: 'osc is not a function' }]
    expect(unattributed(s, errs).map((e) => e.kind)).toEqual(['shader'])
  })
})

describe('mutate', () => {
  const s = importText('osc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .kaleid(4)\n  .modulate(noise(3), 0.1)\n  .out()\n\nnoise(3).out(o1)\n').sketch
  test('is deterministic per seed and changes only numbers of the chosen statement', () => {
    const a = mutateChain(s, s.stmts[0].id, { seed: 7, catalog })
    const b = mutateChain(s, s.stmts[0].id, { seed: 7, catalog })
    const c = mutateChain(s, s.stmts[0].id, { seed: 8, catalog })
    expect(toCode(a)).toBe(toCode(b))
    expect(toCode(a)).not.toBe(toCode(s))
    expect(toCode(c)).not.toBe(toCode(a))
    expect(a.stmts[1]).toBe(s.stmts[1])
    const names = (x: typeof s) => [...walkCalls(x)].map((k) => k.call.fn)
    expect(names(a)).toEqual(names(s))
  })
  test('values stay inside the hinted range and integers stay integers', () => {
    let cur = s
    for (let i = 0; i < 60; i++) cur = mutateChain(cur, cur.stmts[0].id, { seed: i, strength: 2, catalog })
    for (const { call } of walkCalls(cur)) {
      call.args.forEach((a, i) => {
        const inp = catalog.inputs(call.fn)[i]
        if (a.k !== 'num' || inp?.type !== 'float') return
        const h = catalog.hint(call.fn, inp.name)
        expect(a.v).toBeGreaterThanOrEqual(Math.min(h.min, a.v))
        if (h.integer) expect(Number.isInteger(a.v)).toBe(true)
        if (!h.wrap) expect(a.v).toBeLessThanOrEqual(Math.max(h.max, 0.8, 20, 4, 3, 0.1))
      })
    }
  })
})
