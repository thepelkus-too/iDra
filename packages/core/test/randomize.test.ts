// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { randomSketch } from '../src/randomize'
import { validate } from '../src/validate'
import { toCode, toRunnable } from '../src/codegen'
import { fromCode } from '../src/parse'
import { canonicalSketch } from '../src/normalize'
import { MockHydra } from './helpers/mock-hydra'

describe('randomSketch', () => {
  const seeds = Array.from({ length: 150 }, (_, i) => i + 1)

  test('is deterministic per seed', () => {
    const a = toCode(randomSketch(7), { fresh: true })
    const b = toCode(randomSketch(7), { fresh: true })
    expect(a).toBe(b)
    expect(toCode(randomSketch(8), { fresh: true })).not.toBe(a)
  })

  test('always validates (no errors) and has 2–5 modifiers', () => {
    for (const seed of seeds) {
      const s = randomSketch(seed)
      const errors = validate(s).filter((p) => p.severity === 'error')
      expect(errors, `seed ${seed}`).toEqual([])
      const chain = (s.stmts[0] as any).chain
      expect(chain.mods.length).toBeGreaterThanOrEqual(2)
      expect(chain.mods.length).toBeLessThanOrEqual(5)
    }
  })

  test('round-trips through text', () => {
    for (const seed of seeds) {
      const s = randomSketch(seed)
      const again = fromCode(toCode(s))
      expect(canonicalSketch(again), `seed ${seed}\n${toCode(s)}`).toEqual(canonicalSketch(s))
    }
  })

  test('always runs without throwing in the mock runtime (real generator + sandbox), plain and live', () => {
    for (const seed of seeds) {
      for (const live of [false, true]) {
        const s = randomSketch(seed, { fnP: 0.2, arrP: 0.2 })
        const r = toRunnable(s, { live })
        const h = new MockHydra({ makeGlobal: true })
        expect(() => h.eval(r.code), `seed ${seed} live=${live}\n${r.code}`).not.toThrow()
        // live closures read this table
        ;(window as any).__hl = { ...r.live }
        const f = h.frame(0)
        expect(f, `seed ${seed}`).toBeDefined()
        for (const v of Object.values(f!.values)) expect(typeof v === "number" || (v as any)?.fake !== undefined || Array.isArray(v)).toBe(true)
      }
    }
  })
})
