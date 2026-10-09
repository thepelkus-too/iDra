// Modulators: the small set of moving values every editor offers (LFOs, time, mouse, audio, steps, expressions) and how they
// map to IR values. Every modulator is written as `() => SIGNAL * amp + off`, so a value read back from code (another
// editor, a pasted sketch) is recognised as the same modulator with its knobs; anything else is an "expression".
// Audio always goes through core's audioChip (contract §7). Pure; unit-tested.
import { audioChip, fmtNum, parseAudioChip, type ArrMods, type Value } from '@hydra-ipad/core'

export type ModKind = 'sine' | 'saw' | 'tri' | 'square' | 'rnd' | 'time' | 'mouseX' | 'mouseY' | 'audio' | 'vol' | 'steps' | 'expr'

export interface ModSpec {
  kind: ModKind
  /** frequency: radians/second for sine (as in `Math.sin(time * f)`), cycles/second for saw/tri/square/rnd */
  rate: number
  amp: number
  off: number
  /** audio: fft bin */
  bin?: number
  /** steps: the pattern */
  steps?: number[]
  mods?: ArrMods
  /** expr: the full function source */
  src?: string
}

export const MOD_LABEL: Record<ModKind, string> = {
  sine: 'Sine LFO',
  saw: 'Saw LFO',
  tri: 'Triangle LFO',
  square: 'Square LFO',
  rnd: 'Random steps',
  time: 'Time',
  mouseX: 'Mouse X',
  mouseY: 'Mouse Y',
  audio: 'Audio bin',
  vol: 'Volume',
  steps: 'Step pattern',
  expr: 'Expression',
}
export const MOD_ICON: Record<ModKind, string> = {
  sine: '∿', saw: '⩘', tri: '⋀', square: '⊓', rnd: '⁂', time: '⏱', mouseX: '↔', mouseY: '↕', audio: '♪', vol: '🔊', steps: '▥', expr: 'ƒ',
}
export const LFO_KINDS: ModKind[] = ['sine', 'saw', 'tri', 'square', 'rnd']

const n = (v: number) => fmtNum(+v.toFixed(4))

function signal(kind: ModKind, rate: number): string | undefined {
  const r = n(rate)
  switch (kind) {
    case 'sine': return `Math.sin(time * ${r})`
    case 'saw': return `(time * ${r} % 1)`
    case 'tri': return `Math.abs(time * ${r} % 1 * 2 - 1)`
    case 'square': return `(time * ${r} % 1 < 0.5 ? 1 : 0)`
    case 'rnd': return `(Math.sin(Math.floor(time * ${r}) * 78.233) * 43758.5453 % 1 + 1) % 1`
    case 'time': return 'time'
    case 'mouseX': return 'mouse.x / width'
    case 'mouseY': return 'mouse.y / height'
    case 'vol': return 'a.vol'
    default: return undefined
  }
}

export function defaultSpec(kind: ModKind, around = 0, span = 1): ModSpec {
  switch (kind) {
    case 'sine': return { kind, rate: 1, amp: span / 2, off: around }
    case 'saw':
    case 'tri':
    case 'square':
    case 'rnd': return { kind, rate: 0.5, amp: span, off: around }
    case 'time': return { kind, rate: 1, amp: 0.1, off: around }
    case 'mouseX':
    case 'mouseY': return { kind, rate: 1, amp: span, off: around }
    case 'audio': return { kind, rate: 1, amp: span, off: around, bin: 0 }
    case 'vol': return { kind, rate: 1, amp: span, off: around }
    case 'steps': return { kind, rate: 1, amp: 1, off: 0, steps: [around, around + span / 2, around + span], mods: {} }
    case 'expr': return { kind, rate: 1, amp: 1, off: 0, src: `() => ${n(around)} + Math.sin(time) * ${n(span / 2)}` }
  }
}

/** The IR value a modulator emits. */
export function modToValue(s: ModSpec): Value {
  if (s.kind === 'steps') return { k: 'arr', v: (s.steps ?? [0]).slice(), mods: { ...(s.mods ?? {}) } }
  if (s.kind === 'expr') return { k: 'fn', src: s.src ?? '() => 0' }
  if (s.kind === 'audio') return audioChip(s.bin ?? 0, s.amp, s.off)
  const sig = signal(s.kind, s.rate)!
  let src = `() => ${sig}`
  if (s.amp !== 1) src += ` * ${n(s.amp)}`
  if (s.off !== 0) src += s.off < 0 ? ` - ${n(-s.off)}` : ` + ${n(s.off)}`
  return { k: 'fn', src }
}

const NUM = '(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)'
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Recognise a value as a modulator. Numbers and textures are not modulators (undefined). */
export function valueToMod(v: Value): ModSpec | undefined {
  if (v.k === 'arr') return { kind: 'steps', rate: 1, amp: 1, off: 0, steps: v.v.slice(), mods: { ...v.mods } }
  if (v.k === 'js') return { kind: 'expr', rate: 1, amp: 1, off: 0, src: v.src }
  if (v.k !== 'fn') return undefined
  const chip = parseAudioChip(v)
  if (chip) return { kind: 'audio', rate: 1, amp: chip.scale, off: chip.offset, bin: chip.bin }
  const src = v.src.trim()
  const kinds: ModKind[] = ['sine', 'saw', 'tri', 'square', 'rnd', 'time', 'mouseX', 'mouseY', 'vol']
  for (const kind of kinds) {
    const sig = esc(signal(kind, 12345)!).replace('12345', NUM)
    const re = new RegExp(`^\\(\\)\\s*=>\\s*${sig.replace(/ /g, '\\s*')}(?:\\s*\\*\\s*${NUM})?(?:\\s*([+-])\\s*${NUM})?$`)
    const m = re.exec(src)
    if (!m) continue
    const hasRate = signal(kind, 12345)!.includes('12345')
    const g = m.slice(1)
    const rate = hasRate ? Number(g.shift()) : 1
    const amp = g[0] === undefined ? 1 : Number(g[0])
    const off = g[2] === undefined ? 0 : (g[1] === '-' ? -1 : 1) * Number(g[2])
    const spec: ModSpec = { kind, rate, amp, off }
    // only claim it when the round trip reproduces the text exactly (spacing differences stay expressions)
    const back = modToValue(spec)
    if (back.k === 'fn' && back.src === src) return spec
  }
  return { kind: 'expr', rate: 1, amp: 1, off: 0, src: v.src }
}

/** Approximate value of a modulator at time t (for meters and previews; audio/mouse read 0.5). */
export function sampleMod(s: ModSpec, t: number): number {
  const r = s.rate
  let sig = 0
  switch (s.kind) {
    case 'sine': sig = Math.sin(t * r); break
    case 'saw': sig = (t * r) % 1; break
    case 'tri': sig = Math.abs(((t * r) % 1) * 2 - 1); break
    case 'square': sig = (t * r) % 1 < 0.5 ? 1 : 0; break
    case 'rnd': sig = (((Math.sin(Math.floor(t * r) * 78.233) * 43758.5453) % 1) + 1) % 1; break
    case 'time': sig = t; break
    case 'steps': {
      const st = s.steps ?? [0]
      const fast = s.mods?.fast ?? 1
      return st[Math.floor(t * fast) % st.length] ?? 0
    }
    case 'expr': return 0
    default: sig = 0.5
  }
  return sig * s.amp + s.off
}
