import { describe, expect, test } from 'vitest'
import { describe as describeSketch, importText, toCode, withMeta, walkCalls, type Sketch } from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import { APP, autoView, defaultActive, metaOf, reconcile, rowKind, stripOf } from '../src/view'

describe('autoView over the corpus', () => {
  for (const entry of corpus) {
    describe(entry.name, () => {
      const sketch = importText(entry.code).sketch
      const view = autoView(sketch)
      const d = describeSketch(sketch)

      test('every statement is a row, in source order', () => {
        expect(view.rows.map((r) => r.id)).toEqual(sketch.stmts.map((s) => s.id))
        expect(view.rows.map((r) => r.kind)).toEqual(sketch.stmts.map(rowKind))
        expect(view.rows.filter((r) => r.kind === 'chain').length).toBe(d.chains.length)
        expect(view.rows.filter((r) => r.kind === 'var').length).toBe(d.defs.length)
        expect(view.rows.filter((r) => r.kind === 'raw').length).toBe(d.raws)
        expect(view.rows.filter((r) => r.kind === 'note').length).toBe(d.comments)
      })

      test('the strip lists the chains in source order, flags not-rendered and shadowed', () => {
        expect(view.chains.map((c) => c.id)).toEqual(d.chains.map((c) => c.stmtId))
        for (const c of view.chains) {
          const f = d.chains.find((x) => x.stmtId === c.id)!
          expect(c.flag).toBe(!f.rendered ? 'not-rendered' : f.shadowed ? 'shadowed' : undefined)
          expect(c.label).toBe(f.out ?? '—')
        }
        if (view.chains.length) expect(view.chains.some((c) => c.id === view.active)).toBe(true)
      })

      test('is deterministic and a pure function of the sketch', () => {
        expect(autoView(sketch)).toEqual(view)
        expect(autoView(structuredClone(sketch))).toEqual(view)
        expect(JSON.parse(JSON.stringify(view))).toEqual(view)
      })

      test('saving it leaves every other app\'s meta and the export untouched', () => {
        const withOthers: Sketch = { ...sketch, meta: { graph: { zoom: 2 }, harness: { tab: 'x' } } }
        const saved = withMeta(withOthers, APP, view as unknown as Record<string, unknown>)
        expect(saved.meta!.graph).toEqual({ zoom: 2 })
        expect(saved.meta!.harness).toEqual({ tab: 'x' })
        expect(metaOf(saved)).toEqual(view)
        expect(toCode(saved)).toBe(entry.code)
      })
    })
  }
})

describe('strip semantics', () => {
  test('a chain without .out is not rendered; the earlier of two writers is shadowed', () => {
    const s = importText('osc(5)\n\nnoise(3).out(o0)\nshape(4).out(o0)\n').sketch
    const strip = stripOf(s)
    expect(strip.map((x) => [x.label, x.flag])).toEqual([['—', 'not-rendered'], ['o0', 'shadowed'], ['o0', undefined]])
    expect(defaultActive(s)).toBe(s.stmts[2].id)
  })
})

describe('reconcile after a text edit', () => {
  const text = (extra = '') => `// a note\nconst amt = 0.3\nosc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .modulate(noise(3), amt)\n  .out()\n\nnoise(4).out(o1)\n${extra}`
  const prev = withMeta(importText(text()).sketch, APP, { v: 1, mode: 'blocks', rows: [], chains: [], renderMode: 'single' })

  test('keeps ids, call ids and meta for an edit inside one call', () => {
    const edited = importText(text().replace('rotate(0.8)', 'rotate(1.2)')).sketch
    const r = reconcile(prev, edited)
    expect(r.stmts.map((s) => s.id)).toEqual(prev.stmts.map((s) => s.id))
    const pc = (prev.stmts[2] as any).chain
    const rc = (r.stmts[2] as any).chain
    expect(rc.id).toBe(pc.id)
    expect(rc.gen.id).toBe(pc.gen.id)
    expect(rc.mods.map((m: any) => m.id)).toEqual(pc.mods.map((m: any) => m.id))
    expect(rc.mods[0].args[0]).toEqual({ k: 'num', v: 1.2 })
    expect(r.meta).toBe(prev.meta)
    expect(r.id).toBe(prev.id)
    expect(r.name).toBe(prev.name)
    expect(toCode(r)).toBe(text().replace('rotate(0.8)', 'rotate(1.2)'))
  })

  test('an inserted statement gets a new id and the others keep theirs', () => {
    const edited = importText(text('solid(1, 0, 0).out(o2)\n')).sketch
    const r = reconcile(prev, edited)
    expect(r.stmts.slice(0, prev.stmts.length).map((s) => s.id)).toEqual(prev.stmts.map((s) => s.id))
    expect(r.stmts.length).toBe(prev.stmts.length + 1)
    expect(prev.stmts.some((s) => s.id === r.stmts[r.stmts.length - 1].id)).toBe(false)
  })

  test('a deleted statement drops out and the rest keep their ids', () => {
    const edited = importText(text().replace('// a note\n', '')).sketch
    const r = reconcile(prev, edited)
    expect(r.stmts.map((s) => s.id)).toEqual(prev.stmts.slice(1).map((s) => s.id))
  })

  test('a changed function name keeps the statement id but renews the call', () => {
    const edited = importText(text().replace('.rotate(0.8)', '.kaleid(4)')).sketch
    const r = reconcile(prev, edited)
    const pc = (prev.stmts[2] as any).chain
    const rc = (r.stmts[2] as any).chain
    expect(r.stmts[2].id).toBe(prev.stmts[2].id)
    expect(rc.mods[0].fn).toBe('kaleid')
    expect(rc.mods[0].id).not.toBe(pc.mods[0].id)
    expect(rc.mods[1].id).toBe(pc.mods[1].id)
  })

  test('export of the reconciled sketch is the typed text, byte for byte', () => {
    for (const entry of corpus) {
      if (entry.broken) continue
      const a = importText(entry.code).sketch
      const b = importText(entry.code + '\n// end\n').sketch
      expect(toCode(reconcile(a, b))).toBe(entry.code + '\n// end\n')
    }
  })

  test('walkCalls ids are unique after reconcile', () => {
    const edited = importText(text('osc(1).out(o3)\n')).sketch
    const r = reconcile(prev, edited)
    const ids = [...walkCalls(r)].map((x) => x.call.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
