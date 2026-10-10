import { describe, expect, it } from 'vitest'
import { defaultRung, keyLadder, LADDER_ROW_PX, LADDER_STEP_PX, ladderValue, magnitudes, moveLadder, openLadder, rungLabel } from '../src/ladder'

const unit = { min: 0, max: 1, step: 0.01 }
const freq = { min: 0, max: 100, step: 0.1 }
const angle = { min: 0, max: 6.28, step: 0.01, wrap: true }
const sides = { min: 3, max: 12, step: 1, integer: true }

describe('magnitudes', () => {
  it('go from about the range down to the step', () => {
    expect(magnitudes(unit)).toEqual([1, 0.1, 0.01])
    expect(magnitudes(freq)).toEqual([100, 10, 1, 0.1])
    expect(magnitudes(angle)).toEqual([1, 0.1, 0.01])
  })
  it('stop at 1 for integers', () => {
    expect(magnitudes(sides)).toEqual([1])
    expect(magnitudes({ min: 0, max: 1000, step: 1, integer: true })).toEqual([1000, 100, 10, 1])
  })
  it('end on a step that is not a power of ten', () => {
    expect(magnitudes({ min: 0, max: 10, step: 0.05 })).toEqual([10, 1, 0.1, 0.05])
  })
  it('grow for a value far outside the range, and keep at most eight rungs (the finest)', () => {
    expect(magnitudes(unit, 2500)[0]).toBe(1000)
    const m = magnitudes({ min: 0, max: 1e9, step: 0.001 })
    expect(m.length).toBe(8)
    expect(m[m.length - 1]).toBe(0.001)
  })
  it('start about a tenth of the range', () => {
    expect(magnitudes(unit)[defaultRung(magnitudes(unit), unit)]).toBe(0.1)
    expect(magnitudes(freq)[defaultRung(magnitudes(freq), freq)]).toBe(10)
    expect(magnitudes(sides)[defaultRung(magnitudes(sides), sides)]).toBe(1)
  })
  it('labels', () => {
    expect([1000, 1, 0.1, 0.001].map(rungLabel)).toEqual(['1000', '1', '0.1', '0.001'])
  })
})

describe('ladderValue', () => {
  it('leaves the value alone until a whole step', () => {
    expect(ladderValue(0.83, 0.1, 0, unit)).toBe(0.83)
  })
  it('lands on the grid after the first step, then moves by whole steps', () => {
    expect(ladderValue(0.83, 0.1, 1, unit)).toBe(0.9)
    expect(ladderValue(0.83, 0.1, -1, unit)).toBe(0.8)
    expect(ladderValue(0.8, 0.1, 1, unit)).toBe(0.9)
    expect(ladderValue(0.8, 0.1, -2, unit)).toBe(0.6)
    expect(ladderValue(37.3, 10, 2, freq)).toBe(50)
    expect(ladderValue(37.3, 10, -1, freq)).toBe(30)
  })
  it('has no float noise', () => {
    expect(ladderValue(0.1, 0.1, 2, unit)).toBe(0.3)
    expect(ladderValue(0.7, 0.01, 3, unit)).toBe(0.73)
  })
  it('clamps to the range', () => {
    expect(ladderValue(0.95, 0.1, 5, unit)).toBe(1)
    expect(ladderValue(0.05, 0.1, -5, unit)).toBe(0)
  })
  it('keeps a value already outside the range reachable', () => {
    expect(ladderValue(1.5, 0.1, -1, unit)).toBe(1.4)
    expect(ladderValue(1.5, 0.1, 3, unit)).toBe(1.5)
    expect(ladderValue(-2, 1, 1, unit)).toBe(-1)
  })
  it('wraps angles', () => {
    expect(ladderValue(6.2, 0.1, 1, angle)).toBe(0)
    expect(ladderValue(6.2, 0.1, 2, angle)).toBe(0.1) // wrapped values stay on the step's grid
    expect(ladderValue(0.05, 0.1, -1, angle)).toBe(0)
    expect(ladderValue(0, 0.1, -1, angle)).toBe(6.2)
  })
  it('rounds integers', () => {
    expect(ladderValue(4, 1, 3, sides)).toBe(7)
    expect(ladderValue(11, 1, 5, sides)).toBe(12)
  })
})

describe('the gesture model', () => {
  it('needs a full step of travel before the value changes', () => {
    let s = openLadder(unit, 0.83, 100, 300)
    s = moveLadder(s, 100 + LADDER_STEP_PX - 1, 300, unit)
    expect(s.value).toBe(0.83)
    s = moveLadder(s, 100 + LADDER_STEP_PX, 300, unit)
    expect(s.value).toBe(0.9)
    s = moveLadder(s, 100 + LADDER_STEP_PX * 3, 300, unit)
    expect(s.value).toBe(1)
  })
  it('sliding up picks a larger rung and re-bases the steps there', () => {
    let s = openLadder(freq, 37.3, 100, 300) // starts on 10
    expect(s.mags[s.rung]).toBe(10)
    s = moveLadder(s, 100 + LADDER_STEP_PX, 300, freq) // +10 → 40
    expect(s.value).toBe(40)
    s = moveLadder(s, 100 + LADDER_STEP_PX, 300 + LADDER_ROW_PX * 2, freq) // two rungs down: 0.1
    expect(s.mags[s.rung]).toBe(0.1)
    expect(s.value).toBe(40)
    s = moveLadder(s, 100 + LADDER_STEP_PX * 3, 300 + LADDER_ROW_PX * 2, freq) // +2 × 0.1
    expect(s.value).toBe(40.2)
    s = moveLadder(s, 100 + LADDER_STEP_PX * 3, 300 - LADDER_ROW_PX, freq) // up to 100
    expect(s.mags[s.rung]).toBe(100)
    s = moveLadder(s, 100 + LADDER_STEP_PX * 2, 300 - LADDER_ROW_PX, freq) // one step left: down to the grid
    expect(s.value).toBe(0)
    expect(s.origin).toBe(37.3)
  })
  it('keyboard: left/right step, up/down change the rung', () => {
    let s = openLadder(unit, 0.5, 0, 0)
    s = keyLadder(s, 'right', unit)
    expect(s.value).toBe(0.6)
    s = keyLadder(s, 'down', unit)
    expect(s.mags[s.rung]).toBe(0.01)
    s = keyLadder(s, 'left', unit)
    s = keyLadder(s, 'left', unit)
    expect(s.value).toBe(0.58)
    s = keyLadder(s, 'up', unit)
    s = keyLadder(s, 'up', unit)
    expect(s.mags[s.rung]).toBe(1)
    s = keyLadder(s, 'up', unit)
    expect(s.mags[s.rung]).toBe(1)
  })
})
