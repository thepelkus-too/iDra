import { catalog as defaultCatalog, type Catalog } from './catalog'
import { canonicalArgs, mapCalls, stripVolatile, type Sketch, type Value } from './ir'

/**
 * Canonical comparison form: ids/src/timestamps removed, trailing default args trimmed everywhere.
 * `canonicalSketch(fromCode(toCode(x)))` deep-equals `canonicalSketch(x)` is the round-trip contract.
 */
export function canonicalSketch(sketch: Sketch, cat: Catalog = defaultCatalog, opts: { meta?: boolean } = {}): unknown {
  const trimmed = mapCalls(sketch, (c) => {
    const inputs = cat.inputs(c.fn)
    const defs = inputs.map((i) => i.default)
    // a `default` placeholder in the middle is emitted as the catalog default literal, so it re-imports as that value
    const filled = c.args.map((a, i): Value => {
      const d = defs[i]
      if (a.k !== 'default') return a
      if (typeof d === 'number') return { k: 'num', v: d }
      if (Array.isArray(d)) return { k: 'vec4', v: d }
      if (inputs[i]?.type === 'sampler2D') return { k: 'ref', name: 'o0' }
      return { k: 'num', v: 0 }
    })
    return { ...c, args: canonicalArgs(filled, defs) }
  })
  const s = stripVolatile(trimmed, opts) as any
  delete s.name
  delete s.plugins
  return s
}
