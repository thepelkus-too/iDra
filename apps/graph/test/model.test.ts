import { describe, expect, test } from 'vitest'
import { canonicalSketch, describe as describeSketch, importText, toCode } from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import { graphToIR, irToGraph } from '../src/model'

describe('graph ↔ IR round trip over the corpus', () => {
  for (const entry of corpus) {
    test(entry.name, () => {
      const sketch = importText(entry.code).sketch
      const g = irToGraph(sketch)
      const r = graphToIR(g, sketch)
      expect(r.errors).toEqual([])
      expect(toCode(r.sketch)).toBe(entry.code)
      expect(canonicalSketch(r.sketch)).toEqual(canonicalSketch(sketch))
      const g2 = irToGraph(r.sketch, r.meta)
      expect(g2.nodes.map((n) => n.id)).toEqual(g.nodes.map((n) => n.id))
      expect(g2.edges).toEqual(g.edges)
      // every statement is a node or a chain of nodes
      const d = describeSketch(sketch)
      expect(g.nodes.filter((n) => n.kind === 'def').length).toBe(d.defs.length)
      expect(g.nodes.filter((n) => n.kind === 'raw').length).toBe(d.raws)
      expect(g.nodes.filter((n) => n.kind === 'comment').length).toBe(d.comments)
    })
  }
})
