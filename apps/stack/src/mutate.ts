// "Mutate the current chain by small random steps": jitter numbers and array steps inside their catalog range.
// Deterministic for a given seed, so a mutation can be repeated (and tested).
import { rng, type Catalog, type Chain, type Sketch, type Value } from '@hydra-ipad/core'
import { roundTo } from './conv'
import { mapChains } from './model'

export interface MutateOptions {
  seed: number
  /** 0.5 = gentle, 1 = normal, 2 = bold */
  strength?: number
  /** limit to this chain; default every chain of the statement */
  chainId?: string
  catalog: Catalog
}

export function mutateChain(sketch: Sketch, stmtId: string, o: MutateOptions): Sketch {
  const r = rng(o.seed)
  const k = o.strength ?? 1
  const jitter = (fn: string, input: string, v: number): number => {
    const h = o.catalog.hint(fn, input)
    const span = h.max - h.min
    const step = h.step ?? 0.01
    let n = v + (r.next() - 0.5) * 2 * span * 0.08 * k
    if (h.integer) n = Math.round(v + (r.chance(0.5) ? 1 : -1) * (r.chance(0.3) ? 1 : 0))
    if (h.wrap) n = ((((n - h.min) % span) + span) % span) + h.min
    else n = Math.min(Math.max(n, Math.min(h.min, v)), Math.max(h.max, v))
    return h.integer ? Math.round(n) : roundTo(n, step)
  }
  const mutateValue = (fn: string, input: string, v: Value): Value => {
    if (v.k === 'num') return r.chance(0.7) ? { k: 'num', v: jitter(fn, input, v.v) } : v
    if (v.k === 'arr') return { ...v, v: v.v.map((x) => (r.chance(0.6) ? jitter(fn, input, x) : x)) }
    return v
  }
  const apply = (chain: Chain): Chain => {
    const mapCall = (c: Chain['gen']): Chain['gen'] => {
      const inputs = o.catalog.inputs(c.fn)
      let changed = false
      const args = c.args.map((a, i) => {
        const inp = inputs[i]
        if (!inp || inp.type !== 'float') return a
        const n = mutateValue(c.fn, inp.name, a)
        if (n !== a) changed = true
        return n
      })
      return changed ? { ...c, args } : c
    }
    return { ...chain, gen: mapCall(chain.gen), mods: chain.mods.map(mapCall) }
  }
  const stmt = sketch.stmts.find((s) => s.id === stmtId)
  if (!stmt || stmt.k !== 'chain') return sketch
  // mapChains visits children first; only touch the chains inside this statement
  const inside = new Set<string>()
  const collect = (c: Chain) => {
    inside.add(c.id)
    for (const call of [c.gen, ...c.mods]) for (const a of call.args) if (a.k === 'tex') collect(a.chain)
  }
  collect(stmt.chain)
  return mapChains(sketch, (c) => (inside.has(c.id) ? apply(c) : c))
}
