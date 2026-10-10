import { describe, expect, it } from 'vitest'
import { clamp, decimalsOf, fmt, roundTo, wrapInto } from '../src/conv'

describe('number helpers', () => {
  it('decimalsOf counts the places a step needs', () => {
    expect(decimalsOf(1)).toBe(0)
    expect(decimalsOf(0.5)).toBe(1)
    expect(decimalsOf(0.01)).toBe(2)
    expect(decimalsOf(0.001)).toBe(3)
    expect(decimalsOf(0)).toBe(2)
    expect(decimalsOf(NaN)).toBe(2)
  })
  it('roundTo lands on the step grid without float noise', () => {
    expect(roundTo(0.30000000000000004, 0.1)).toBe(0.3)
    expect(roundTo(1.234, 0.01)).toBe(1.23)
    expect(roundTo(7, 5)).toBe(5)
    expect(roundTo(1.2345, 0)).toBe(1.2345)
  })
  it('fmt is short and stable', () => {
    expect(fmt(0.1 + 0.2)).toBe('0.3')
    expect(fmt(-0)).toBe('0')
    expect(fmt(Infinity)).toBe('0')
    expect(fmt(1e7)).toBe('1.00e+7')
    expect(fmt(0.00001)).toBe('1.00e-5')
  })
  it('wrapInto and clamp', () => {
    expect(wrapInto(7, 0, 6.28)).toBeCloseTo(0.72)
    expect(wrapInto(-1, 0, 10)).toBe(9)
    expect(wrapInto(3, 1, 1)).toBe(3)
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
  })
})
