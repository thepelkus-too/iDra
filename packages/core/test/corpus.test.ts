import { describe, expect, test } from 'vitest'
import { corpus } from '../src/corpus'
import { importText, fromCode } from '../src/parse'
import { toCode } from '../src/codegen'
import { canonicalSketch } from '../src/normalize'
import { validate } from '../src/validate'

describe('corpus', () => {
  test('has at least 25 sketches', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(25)
  })

  for (const entry of corpus) {
    describe(entry.name, () => {
      const { sketch, warnings, report } = importText(entry.code)

      test('imports without throwing and loses no code', () => {
        const rebuilt = sketch.stmts.map((s) => (s.src?.before ?? '') + (s.src?.text ?? '')).join('') + (sketch.src?.tail ?? '')
        expect(rebuilt).toBe(entry.code)
        for (const s of sketch.stmts) if (s.k === 'raw') expect(s.src!.text).toBe(s.code)
        // non-whitespace, non-comment characters are covered by stmts
        expect(report.totalChars).toBe(entry.code.length)
      })

      test('exports byte-identical text when untouched', () => {
        expect(toCode(sketch)).toBe(entry.code)
      })

      test('fresh export re-imports to the same IR and is idempotent', () => {
        const fresh1 = toCode(sketch, { fresh: true })
        const again = fromCode(fresh1)
        expect(canonicalSketch(again)).toEqual(canonicalSketch(sketch))
        expect(toCode(again, { fresh: true })).toBe(fresh1)
        // and the real export of the re-import is the text itself
        expect(toCode(again)).toBe(fresh1)
      })

      test('validation never throws', () => {
        expect(() => validate(sketch)).not.toThrow()
        void warnings
      })
    })
  }

  test('the broken sketch becomes one raw block with a warning', () => {
    const e = corpus.find((c) => c.broken)!
    const r = importText(e.code)
    expect(r.sketch.stmts).toHaveLength(1)
    expect(r.sketch.stmts[0].k).toBe('raw')
    expect(r.report.parseFailed).toBe(true)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  test('recover mode keeps the parts that parse', () => {
    const e = corpus.find((c) => c.broken)!
    const r = importText(e.code, { recover: true })
    expect(r.sketch.stmts.some((s) => s.k === 'chain')).toBe(true)
    expect(r.sketch.stmts.some((s) => s.k === 'raw')).toBe(true)
    expect(toCode(r.sketch)).toBe(e.code)
  })
})
