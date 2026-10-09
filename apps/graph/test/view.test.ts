import { describe, expect, test } from 'vitest'
import { importText, toCode, withMeta, type Sketch } from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import { irToGraph } from '../src/model'
import { APP, autoView, layoutGraph, metaOf, sizeOf, X0 } from '../src/view'

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('autoView over the corpus', () => {
  for (const entry of corpus) {
    describe(entry.name, () => {
      const sketch = importText(entry.code).sketch
      const view = autoView(sketch)
      const g = irToGraph(sketch)
      const boxes = layoutGraph(sketch, g)

      test('every node has a position and nothing overlaps', () => {
        for (const n of g.nodes) expect(view.pos[n.id], n.id).toBeDefined()
        const list = Object.entries(boxes)
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) expect(overlaps(list[i][1], list[j][1]), `${list[i][0]} overlaps ${list[j][0]}`).toBe(false)
      })

      test('setup and raw nodes are in the left column, chains right of it', () => {
        for (const n of g.nodes) {
          const b = boxes[n.id]
          if (n.kind === 'setting' || n.kind === 'render' || n.kind === 'raw' || n.kind === 'source') expect(b.x).toBe(0)
          if (n.kind === 'call') expect(b.x).toBeGreaterThanOrEqual(X0)
          expect(b.w).toBe(sizeOf(n).w)
        }
      })

      test('chains are stacked top to bottom in source order', () => {
        const tops = sketch.stmts.filter((s) => s.k === 'chain').map((s) => (s.k === 'chain' ? boxes[s.chain.gen.id]?.y : 0))
        const defined = tops.filter((y): y is number => y !== undefined)
        expect([...defined].sort((a, b) => a - b)).toEqual(defined)
      })

      test('deterministic, JSON-safe, other apps\' meta untouched, export unchanged', () => {
        expect(autoView(sketch)).toEqual(view)
        expect(autoView(structuredClone(sketch))).toEqual(view)
        expect(JSON.parse(JSON.stringify(view))).toEqual(view)
        const withOthers: Sketch = { ...sketch, meta: { stack: { v: 1 }, rack: { scenes: [1] } } }
        const saved = withMeta(withOthers, APP, view as unknown as Record<string, unknown>)
        expect(saved.meta!.stack).toEqual({ v: 1 })
        expect(saved.meta!.rack).toEqual({ scenes: [1] })
        expect(metaOf(saved)).toEqual(view)
        expect(toCode(saved)).toBe(entry.code)
      })
    })
  }
})
