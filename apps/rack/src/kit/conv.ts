// Number helpers shared by the editor's controls. Pure.

/** Decimal places needed to show a step like 0.01 / 0.5 / 1. */
export function decimalsOf(step: number): number {
  if (!(step > 0) || !isFinite(step)) return 2
  let d = 0
  let s = step
  while (d < 8 && Math.abs(Math.round(s) - s) > 1e-9) {
    s *= 10
    d++
  }
  return d
}

export function roundTo(v: number, step: number): number {
  if (!(step > 0)) return v
  const d = decimalsOf(step)
  return +(Math.round(v / step) * step).toFixed(Math.min(8, d))
}

/** Short, stable display for a number: at most 4 decimals, no trailing zeros. */
export function fmt(v: number): string {
  if (!isFinite(v)) return '0'
  if (Object.is(v, -0)) return '0'
  const a = Math.abs(v)
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) return v.toExponential(2)
  return String(+v.toFixed(4))
}

export function wrapInto(v: number, min: number, max: number): number {
  const span = max - min
  if (!(span > 0)) return v
  return ((((v - min) % span) + span) % span) + min
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
