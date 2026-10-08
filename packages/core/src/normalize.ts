import { catalog as defaultCatalog, type Catalog } from './catalog'
import { canonicalArgs, mapCalls, stripVolatile, type Sketch } from './ir'

/**
 * Canonical comparison form: ids/src/timestamps removed, trailing default args trimmed everywhere.
 * `canonicalSketch(fromCode(toCode(x)))` deep-equals `canonicalSketch(x)` is the round-trip contract.
 */
export function canonicalSketch(sketch: Sketch, cat: Catalog = defaultCatalog, opts: { meta?: boolean } = {}): unknown {
  const trimmed = mapCalls(sketch, (c) => {
    const defs = cat.inputs(c.fn).map((i) => i.default)
    return { ...c, args: canonicalArgs(c.args, defs) }
  })
  const s = stripVolatile(trimmed, opts) as any
  delete s.name
  delete s.plugins
  return s
}
