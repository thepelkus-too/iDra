import type { Value } from './ir'

// Audio bindings as IR values. Every form here is plain Hydra JavaScript that also runs unchanged on hydra.ojack.xyz,
// and every form is recognised again by the parsers below after a text round trip (toCode → importText).

const n = (x: number) => (Object.is(x, -0) ? '0' : String(x))
function tail(scale: number, offset: number): string {
  let s = ''
  if (scale !== 1) s += ` * ${n(scale)}`
  if (offset !== 0) s += offset < 0 ? ` - ${n(-offset)}` : ` + ${n(offset)}`
  return s
}

/** The IR value for `() => a.fft[bin] * scale + offset`. Every editor binds audio through this. */
export function audioChip(bin: number, scale = 1, offset = 0): Value {
  const b = Math.max(0, Math.floor(bin))
  return { k: 'fn', src: `() => a.fft[${b}]${tail(scale, offset)}` }
}

export interface AudioChipOptions {
  scale?: number
  offset?: number
  /**
   * Per-chip smoothing 0…0.99 (on top of Hydra's own `a.setSmooth`): `v = v * smooth + fft * (1 - smooth)` each frame.
   * Emitted as a self-contained closure, so it is a `js` value (evaluated once, returns the function Hydra calls).
   */
  smooth?: number
  /** gate: 1 while `fft > threshold`, else 0 (then scaled/offset) */
  threshold?: number
}

export type AudioSignal = { kind: 'fft'; bin: number } | { kind: 'vol' }

const sig = (s: AudioSignal) => (s.kind === 'vol' ? 'a.vol' : `a.fft[${Math.max(0, Math.floor(s.bin))}]`)

/** General builder behind `audioChip` and the variants (`AudioBindings.chip`). */
export function audioSignalChip(s: AudioSignal, o: AudioChipOptions = {}): Value {
  const scale = o.scale ?? 1
  const offset = o.offset ?? 0
  const x = sig(s)
  if (o.smooth !== undefined && o.smooth > 0) {
    const k = Math.min(0.99, Math.max(0, o.smooth))
    return { k: 'js', src: `((v) => () => (v = v * ${n(k)} + ${x} * ${n(+(1 - k).toFixed(6))})${tail(scale, offset)})(0)` }
  }
  if (o.threshold !== undefined) return { k: 'fn', src: `() => (${x} > ${n(o.threshold)} ? 1 : 0)${tail(scale, offset)}` }
  return { k: 'fn', src: `() => ${x}${tail(scale, offset)}` }
}

/** `audioChip` with smoothing: `((v) => () => (v = v * 0.8 + a.fft[0] * 0.2) * 4)(0)` */
export function audioChipSmooth(bin: number, smooth: number, scale = 1, offset = 0): Value {
  return audioSignalChip({ kind: 'fft', bin }, { smooth, scale, offset })
}
/** `audioChip` with a threshold gate: `() => (a.fft[1] > 0.5 ? 1 : 0) * 2` */
export function audioChipThreshold(bin: number, threshold: number, scale = 1, offset = 0): Value {
  return audioSignalChip({ kind: 'fft', bin }, { threshold, scale, offset })
}

const NUM = '(-?[\\d.]+(?:e[+-]?\\d+)?)'
const SIG = '(a\\.fft\\[(\\d+)\\]|a\\.vol)'
const TAIL = `(?:\\s*\\*\\s*${NUM})?(?:\\s*([+-])\\s*([\\d.]+(?:e[+-]?\\d+)?))?`
const PLAIN_RE = new RegExp(`^\\(\\)\\s*=>\\s*${SIG}${TAIL}$`, 'i')
const GATE_RE = new RegExp(`^\\(\\)\\s*=>\\s*\\(\\s*${SIG}\\s*>\\s*${NUM}\\s*\\?\\s*1\\s*:\\s*0\\s*\\)${TAIL}$`, 'i')
const SMOOTH_RE = new RegExp(`^\\(\\(v\\)\\s*=>\\s*\\(\\)\\s*=>\\s*\\(v\\s*=\\s*v\\s*\\*\\s*${NUM}\\s*\\+\\s*${SIG}\\s*\\*\\s*${NUM}\\)${TAIL}\\)\\(0\\)$`, 'i')

export interface ParsedAudioBinding {
  signal: AudioSignal
  scale: number
  offset: number
  smooth?: number
  threshold?: number
}

function sigOf(full: string, bin: string | undefined): AudioSignal {
  return full.toLowerCase() === 'a.vol' ? { kind: 'vol' } : { kind: 'fft', bin: Number(bin) }
}
function tailOf(scaleS: string | undefined, sign: string | undefined, offS: string | undefined) {
  const scale = scaleS === undefined ? 1 : Number(scaleS)
  const offset = offS === undefined ? 0 : (sign === '-' ? -1 : 1) * Number(offS)
  return isFinite(scale) && isFinite(offset) ? { scale, offset } : undefined
}

/** Recognise any chip form built here (fft or vol; plain, gated or smoothed). */
export function parseAudioBinding(v: Value): ParsedAudioBinding | undefined {
  if (v.k !== 'fn' && v.k !== 'js') return undefined
  const src = v.src.trim()
  let m: RegExpExecArray | null
  if (v.k === 'fn' && (m = PLAIN_RE.exec(src))) {
    const t = tailOf(m[3], m[4], m[5])
    return t && { signal: sigOf(m[1], m[2]), ...t }
  }
  if (v.k === 'fn' && (m = GATE_RE.exec(src))) {
    const t = tailOf(m[4], m[5], m[6])
    return t && { signal: sigOf(m[1], m[2]), threshold: Number(m[3]), ...t }
  }
  if (v.k === 'js' && (m = SMOOTH_RE.exec(src))) {
    const t = tailOf(m[5], m[6], m[7])
    return t && { signal: sigOf(m[2], m[3]), smooth: Number(m[1]), ...t }
  }
  return undefined
}

/** True when `src` is exactly one of the chip forms (they only read `a`; the trust gate treats them as safe). */
export function isAudioChipSource(src: string): boolean {
  return !!(parseAudioBinding({ k: 'fn', src }) ?? parseAudioBinding({ k: 'js', src }))
}

/**
 * Inverse of audioChip: recognise an fft chip so UIs can show knobs for it instead of code. Smoothed and gated chips
 * are recognised too and carry `smooth` / `threshold`; `a.vol` chips are not (use parseAudioBinding).
 */
export function parseAudioChip(v: Value): { bin: number; scale: number; offset: number; smooth?: number; threshold?: number } | undefined {
  const p = parseAudioBinding(v)
  if (!p || p.signal.kind !== 'fft') return undefined
  const out: { bin: number; scale: number; offset: number; smooth?: number; threshold?: number } = { bin: p.signal.bin, scale: p.scale, offset: p.offset }
  if (p.smooth !== undefined) out.smooth = p.smooth
  if (p.threshold !== undefined) out.threshold = p.threshold
  return out
}
