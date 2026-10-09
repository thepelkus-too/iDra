import { describe, expect, test } from 'vitest'
import { catalog } from '@hydra-ipad/core'
import { asPlainRef, composeFn, convertValue, decimalsOf, evalNumeric, fmt, hasTopLevelAddSub, isSimpleArith, kindOf, kindsFor, numFromFn, parseFnWrap, roundTo, valueToNumber } from '../src/conv'

const osc = catalog.get('osc')!
const rotate = catalog.get('rotate')!
const modulate = catalog.get('modulate')!

describe('number formatting', () => {
  test('decimalsOf / roundTo', () => {
    expect(decimalsOf(0.01)).toBe(2)
    expect(decimalsOf(0.5)).toBe(1)
    expect(decimalsOf(1)).toBe(0)
    expect(decimalsOf(0.001)).toBe(3)
    expect(roundTo(2.960000000000001, 0.01)).toBe(2.96)
    expect(roundTo(0.30000000000000004, 0.01)).toBe(0.3)
    expect(roundTo(7.4, 1)).toBe(7)
  })
  test('fmt', () => {
    expect(fmt(0.5)).toBe('0.5')
    expect(fmt(-0)).toBe('0')
    expect(fmt(1 / 3)).toBe('0.3333')
    expect(fmt(NaN)).toBe('0')
  })
})

describe('function expressions', () => {
  test('simple arithmetic and top-level add/sub detection', () => {
    expect(isSimpleArith('time * 2')).toBe(true)
    expect(isSimpleArith('a ? b : c')).toBe(false)
    expect(isSimpleArith('x || y')).toBe(false)
    expect(isSimpleArith('Math.max(a, b)')).toBe(true) // the comma is inside parentheses
    expect(hasTopLevelAddSub('a + b')).toBe(true)
    expect(hasTopLevelAddSub('-a')).toBe(false)
    expect(hasTopLevelAddSub('Math.sin(a + b)')).toBe(false)
    expect(hasTopLevelAddSub('1e-3 * x')).toBe(false)
  })

  test('parseFnWrap splits scale and offset only when that is exactly what the text means', () => {
    expect(parseFnWrap('() => time')).toEqual({ body: 'time', scale: 1, offset: 0 })
    expect(parseFnWrap('() => a.fft[0] * 4 + 0.5')).toEqual({ body: 'a.fft[0]', scale: 4, offset: 0.5 })
    expect(parseFnWrap('() => Math.sin(time) * 0.3 - 0.2')).toEqual({ body: 'Math.sin(time)', scale: 0.3, offset: -0.2 })
    // precedence: `time - 1 * 2` is time - 2, not (time - 1) * 2
    expect(parseFnWrap('() => time - 1 * 2')).toEqual({ body: 'time - 1 * 2', scale: 1, offset: 0 })
    // a ternary is never split
    expect(parseFnWrap('() => mouse.x > 3 ? 1 : 2 + 1')).toEqual({ body: 'mouse.x > 3 ? 1 : 2 + 1', scale: 1, offset: 0 })
    expect(parseFnWrap('time')).toBeUndefined()
    expect(parseFnWrap('(x) => x')).toBeUndefined()
    expect(parseFnWrap('() => { return 1 }')).toBeUndefined()
  })

  test('composeFn is the inverse and parenthesises when needed', () => {
    expect(composeFn('time')).toBe('() => time')
    expect(composeFn('a.fft[1]', 4, 0.5)).toBe('() => a.fft[1] * 4 + 0.5')
    expect(composeFn('time + 1', 2, 0)).toBe('() => (time + 1) * 2')
    expect(composeFn('c ? 1 : 2', 1, 3)).toBe('() => (c ? 1 : 2) + 3')
    expect(composeFn('x', 1, -2)).toBe('() => x - 2')
    for (const src of ['() => time', '() => Math.sin(time) * 0.5 + 0.5', '() => a.fft[2] * 3', '() => (time + 1) * 2', '() => x - 2']) {
      const p = parseFnWrap(src)!
      expect(composeFn(p.body, p.scale, p.offset)).toBe(src)
    }
  })

  test('evalNumeric only evaluates pure arithmetic', () => {
    expect(evalNumeric('0.5')).toBe(0.5)
    expect(evalNumeric('1 / 4')).toBe(0.25)
    expect(evalNumeric('Math.PI / 2')).toBeCloseTo(Math.PI / 2)
    expect(evalNumeric('time')).toBeUndefined()
    expect(evalNumeric('alert(1)')).toBeUndefined()
    expect(evalNumeric('2 ** 3')).toBe(8)
    expect(numFromFn('() => 0.75')).toBe(0.75)
    expect(numFromFn('() => time')).toBeUndefined()
  })
})

describe('value kinds', () => {
  const angle = rotate.inputs[0]
  test('number → array [n], number → function () => n', () => {
    expect(convertValue({ k: 'num', v: 0.5 }, 'array', angle)).toEqual({ k: 'arr', v: [0.5], mods: {} })
    expect(convertValue({ k: 'num', v: 0.5 }, 'function', angle)).toEqual({ k: 'fn', src: '() => 0.5' })
  })
  test('function → number evaluates once or uses the default', () => {
    expect(convertValue({ k: 'fn', src: '() => 0.25' }, 'number', angle)).toEqual({ k: 'num', v: 0.25 })
    expect(convertValue({ k: 'fn', src: '() => Math.sin(time)' }, 'number', angle)).toEqual({ k: 'num', v: 10 })
  })
  test('array → number takes the first step; default → number uses the catalog default', () => {
    expect(convertValue({ k: 'arr', v: [3, 4], mods: { fast: 2 } }, 'number', angle)).toEqual({ k: 'num', v: 3 })
    expect(convertValue({ k: 'default' }, 'number', osc.inputs[0])).toEqual({ k: 'num', v: 60 })
    expect(convertValue({ k: 'num', v: 3 }, 'default', angle)).toEqual({ k: 'default' })
  })
  test('texture: a ref becomes src(ref), anything else a small noise pocket; and back', () => {
    const tex = modulate.inputs[0]
    const p = convertValue({ k: 'ref', name: 'o1' }, 'texture', tex)
    expect(p.k).toBe('tex')
    expect(asPlainRef(p)).toBe('o1')
    const n = convertValue({ k: 'num', v: 1 }, 'texture', angle)
    expect(n.k === 'tex' && n.chain.gen.fn).toBe('noise')
    expect(convertValue(p, 'ref', tex)).toEqual({ k: 'ref', name: 'o1' })
  })
  test('kindsFor and kindOf', () => {
    expect(kindsFor(angle)).toEqual(['number', 'function', 'array', 'texture', 'default'])
    expect(kindsFor(modulate.inputs[0])).toContain('ref')
    expect(kindOf({ k: 'vec4', v: [1, 2] })).toBe('vec')
    expect(valueToNumber({ k: 'js', src: '1/2' })).toBe(0.5)
  })
})
