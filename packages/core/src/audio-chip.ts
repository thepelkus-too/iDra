import type { Value } from './ir'

/** The IR value for `() => a.fft[bin] * scale + offset`. Every editor binds audio through this. */
export function audioChip(bin: number, scale = 1, offset = 0): Value {
  const b = Math.max(0, Math.floor(bin))
  let src = `() => a.fft[${b}]`
  if (scale !== 1) src += ` * ${scale}`
  if (offset !== 0) src += offset < 0 ? ` - ${-offset}` : ` + ${offset}`
  return { k: 'fn', src }
}

const CHIP_RE = /^\(\)\s*=>\s*a\.fft\[(\d+)\](?:\s*\*\s*(-?[\d.]+(?:e[+-]?\d+)?))?(?:\s*([+-])\s*([\d.]+(?:e[+-]?\d+)?))?$/i

/** Inverse of audioChip: recognise a chip so UIs can show knobs for it instead of code. */
export function parseAudioChip(v: Value): { bin: number; scale: number; offset: number } | undefined {
  if (v.k !== 'fn') return undefined
  const m = CHIP_RE.exec(v.src.trim())
  if (!m) return undefined
  const scale = m[2] === undefined ? 1 : Number(m[2])
  const offset = m[4] === undefined ? 0 : (m[3] === '-' ? -1 : 1) * Number(m[4])
  if (!isFinite(scale) || !isFinite(offset)) return undefined
  return { bin: Number(m[1]), scale, offset }
}
