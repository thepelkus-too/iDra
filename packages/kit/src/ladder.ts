// The ladder (TouchDesigner's "slider ladder"): pick a magnitude by sliding up or down, then change the value in whole steps
// of that magnitude by sliding left or right. Pure: the math and a small state machine fed with pointer positions, so the
// touch, pen, mouse and keyboard paths share it and the tests drive it without a DOM.
import type { Hint } from '@hydra-ipad/core'
import { clamp, decimalsOf, wrapInto } from './conv'

/** Horizontal travel (CSS px ≈ iPad points) for one step. Tuned on a 1180×820 viewport: 24 pt keeps a 0.1 ladder on a
 * 0..1 input at about ten steps per finger-width sweep, and stays above the iPad's ~10 pt touch jitter. */
export const LADDER_STEP_PX = 24
/** Vertical travel for one rung (the rungs are drawn this tall, so the highlighted rung stays under the finger). */
export const LADDER_ROW_PX = 40
/** Long-press time for the ladder, and how far the finger may wander before it counts as a drag instead. */
export const LADDER_LONG_MS = 350
export const LADDER_SLOP_PX = 8
/** At most this many rungs. */
const MAX_RUNGS = 10

const pow10 = (e: number) => +Math.pow(10, e).toPrecision(1)

/**
 * The rungs for an input, largest first: powers of ten from one decade above the hint's range down to one decade below
 * its step (integers stop at 1). A step that is not a power of ten (0.05) is a rung of its own. A value far outside the
 * range adds rungs above it.
 */
export function magnitudes(hint: Hint, value = 0): number[] {
  const step = hint.integer ? 1 : hint.step && hint.step > 0 ? hint.step : 0.01
  const finest = hint.integer ? 1 : step / 10
  const range = Math.max(Math.abs(hint.max - hint.min), Math.abs(value) || 0, step)
  const top = Math.floor(Math.log10(range) + 1e-9) + 1
  const out: number[] = []
  for (let e = top; ; e--) {
    const m = pow10(e)
    if (m < finest * (1 - 1e-9)) break
    out.push(m)
  }
  if (!out.some((m) => Math.abs(m - step) <= 1e-12 * Math.max(1, step))) {
    out.push(step)
    out.sort((x, y) => y - x)
  }
  // keep the finest rungs when there are too many (very wide ranges)
  return out.length > MAX_RUNGS ? out.slice(out.length - MAX_RUNGS) : out
}

/** The rung to start on: about a tenth of the range (ten steps across it), never finer than the value's own last digit. */
export function defaultRung(mags: number[], hint: Hint): number {
  const range = Math.abs(hint.max - hint.min)
  const target = range > 0 ? range / 10 : mags[mags.length - 1]
  let best = mags.length - 1
  for (let i = 0; i < mags.length; i++) {
    if (mags[i] <= target * (1 + 1e-9)) {
      best = i
      break
    }
  }
  return best
}

/** Round to the grid of `mag` without float noise. */
function onGrid(v: number, mag: number): number {
  return +(Math.round(v / mag) * mag).toFixed(Math.min(10, decimalsOf(mag)))
}

/**
 * The value `steps` whole steps of `mag` away from `start`. Zero steps leave `start` untouched; the first step lands on the
 * magnitude's grid (0.83 → 0.9 going up, → 0.8 going down), every further step moves by exactly `mag`. Angles wrap; other
 * inputs clamp to the hint's range, widened to keep a start value that already lies outside it reachable.
 */
export function ladderValue(start: number, mag: number, steps: number, hint: Hint): number {
  if (!steps || !(mag > 0)) return start
  const q = start / mag
  const eps = 1e-9
  const base = steps > 0 ? Math.floor(q + eps) : Math.ceil(q - eps)
  let v = (base + steps) * mag
  if (hint.wrap) {
    v = wrapInto(v, hint.min, hint.max)
    if (v >= hint.max - eps * mag) v = hint.min
  } else v = clamp(v, Math.min(hint.min, start), Math.max(hint.max, start))
  if (hint.integer) v = Math.round(v)
  return onGrid(v, Math.min(mag, hint.integer ? 1 : mag))
}

export interface LadderState {
  /** the rungs, largest first */
  mags: number[]
  /** index of the current rung */
  rung: number
  /** the value when the ladder opened (Esc / cancel goes back to it) */
  origin: number
  /** the value the current rung started from */
  start: number
  /** whole steps taken on the current rung */
  steps: number
  value: number
  /** pointer position the current rung's steps are measured from */
  x0: number
  /** pointer y the ladder opened at (the starting rung sits under it) */
  y0: number
  /** the rung the ladder opened on */
  rung0: number
}

export function openLadder(hint: Hint, value: number, x: number, y: number, rung?: number): LadderState {
  const mags = magnitudes(hint, value)
  const r = rung === undefined ? defaultRung(mags, hint) : clamp(rung, 0, mags.length - 1)
  return { mags, rung: r, origin: value, start: value, steps: 0, value, x0: x, y0: y, rung0: r }
}

/** A rung change keeps the value and measures the next steps from where the pointer is now. */
export function setRung(s: LadderState, rung: number, x: number): LadderState {
  const r = clamp(rung, 0, s.mags.length - 1)
  if (r === s.rung) return s
  return { ...s, rung: r, start: s.value, steps: 0, x0: x }
}

/**
 * Feed a pointer position. Up = larger rungs (the list is drawn largest at the top). Once the value has moved on a rung,
 * the rung is locked: sliding up or down does nothing until the finger brings the value back to where that rung started.
 */
export function moveLadder(s: LadderState, x: number, y: number, hint: Hint, stepPx = LADDER_STEP_PX, rowPx = LADDER_ROW_PX): LadderState {
  const locked = Math.trunc((x - s.x0) / stepPx) !== 0
  // back where the rung started: the value is its start again before any rung change
  if (!locked && s.steps !== 0) s = { ...s, steps: 0, value: s.start }
  const rung = locked ? s.rung : s.rung0 + Math.round((y - s.y0) / rowPx)
  let n = setRung(s, rung, x)
  const steps = Math.trunc((x - n.x0) / stepPx)
  if (steps === n.steps) return n
  return { ...n, steps, value: ladderValue(n.start, n.mags[n.rung], steps, hint) }
}

/** Keyboard (and the ladder tab's buttons): one step left/right, one rung up/down. */
export function keyLadder(s: LadderState, key: 'left' | 'right' | 'up' | 'down', hint: Hint): LadderState {
  if (key === 'up' || key === 'down') {
    const n = setRung(s, s.rung + (key === 'up' ? -1 : 1), s.x0)
    return n
  }
  const steps = s.steps + (key === 'right' ? 1 : -1)
  return { ...s, steps, value: ladderValue(s.start, s.mags[s.rung], steps, hint) }
}

/** "0.1", "10", "1000" — how a rung is labelled. */
export function rungLabel(m: number): string {
  if (m >= 1e6 || m < 1e-4) return m.toExponential(0)
  return String(+m.toPrecision(1))
}
