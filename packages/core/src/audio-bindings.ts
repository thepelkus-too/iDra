// AudioBindings: what an editor needs to offer "bind to audio" next to a control: the list of things a value can follow
// (`fft[0…n-1]`, `vol`, and Hydra's beat detector as a meter), the IR value for each (plain, smoothed, gated), and a
// throttled live value so a UI can draw a meter next to a bound control. Pure host-side; the sketch reads `a` itself.

import { getAudioEngine, type AudioEngine, type AudioFrame } from './audio'
import { audioSignalChip, parseAudioBinding, type AudioChipOptions } from './audio-chip'
import type { Value } from './ir'

export interface AudioBinding {
  /** `fft0` … `fftN`, `vol`, `beat` */
  id: string
  label: string
  /** short label for chips */
  short: string
  kind: 'fft' | 'vol' | 'beat'
  /** fft bin index */
  index?: number
  /** a rough range for meters (fft is 0…~1, vol is Meyda's total loudness, beat is 0/1) */
  range: [number, number]
  /** false for `beat`: Hydra exposes the detector only as an `a.onBeat` callback, so there is no value to bind */
  bindable: boolean
  experimental?: boolean
}

export interface AudioBindingsHandle {
  /** current list; `fft` entries follow the engine's bin count (`a.setBins`) */
  list(): AudioBinding[]
  /** IR value for a binding (undefined for non-bindable ones) */
  chip(id: string, opts?: AudioChipOptions): Value | undefined
  /** which binding (and options) an IR value is, if it is a chip */
  identify(v: Value): { id: string; opts: AudioChipOptions } | undefined
  /** live value of one binding, throttled to `fps` (default 30). Returns an unsubscribe function. */
  subscribe(id: string, cb: (value: number, frame: AudioFrame) => void, opts?: { fps?: number }): () => void
  /** the list changed (bin count) */
  onChange(cb: () => void): () => void
}

const BAND_NAMES: Record<number, string[]> = {
  1: ['all'],
  2: ['low', 'high'],
  3: ['low', 'mid', 'high'],
  4: ['low', 'low-mid', 'high-mid', 'high'],
}

export function audioBindings(engine: AudioEngine = getAudioEngine()): AudioBindingsHandle {
  const list = (): AudioBinding[] => {
    const n = engine.settings.bins
    const names = BAND_NAMES[n]
    const out: AudioBinding[] = []
    for (let i = 0; i < n; i++)
      out.push({ id: `fft${i}`, kind: 'fft', index: i, label: `a.fft[${i}]${names ? ` · ${names[i]}` : ''}`, short: `fft${i}`, range: [0, 1], bindable: true })
    out.push({ id: 'vol', kind: 'vol', label: 'a.vol · overall loudness', short: 'vol', range: [0, 30], bindable: true })
    out.push({ id: 'beat', kind: 'beat', label: 'beat (Hydra’s detector, meter only)', short: 'beat', range: [0, 1], bindable: false, experimental: true })
    return out
  }
  const read = (id: string, f: AudioFrame): number => {
    if (id === 'vol') return f.vol
    if (id === 'beat') return f.beat ? 1 : 0
    const m = /^fft(\d+)$/.exec(id)
    return m ? (f.fft[Number(m[1])] ?? 0) : 0
  }
  return {
    list,
    chip(id, opts = {}) {
      if (id === 'vol') return audioSignalChip({ kind: 'vol' }, opts)
      const m = /^fft(\d+)$/.exec(id)
      return m ? audioSignalChip({ kind: 'fft', bin: Number(m[1]) }, opts) : undefined
    },
    identify(v) {
      const p = parseAudioBinding(v)
      if (!p) return undefined
      const opts: AudioChipOptions = { scale: p.scale, offset: p.offset }
      if (p.smooth !== undefined) opts.smooth = p.smooth
      if (p.threshold !== undefined) opts.threshold = p.threshold
      return { id: p.signal.kind === 'vol' ? 'vol' : `fft${p.signal.bin}`, opts }
    },
    subscribe(id, cb, opts = {}) {
      const gap = 1000 / (opts.fps ?? 30)
      let last = -Infinity
      let held = 0 // beats are one-frame events: hold them until the next delivery so a throttled meter still flashes
      return engine.onFrame((f) => {
        if (id === 'beat' && f.beat) held = 1
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
        if (now - last < gap) return
        last = now
        const v = id === 'beat' ? held : read(id, f)
        held = 0
        cb(v, f)
      })
    },
    onChange(cb) {
      let bins = engine.settings.bins
      return engine.onSettings((s) => {
        if (s.bins !== bins) {
          bins = s.bins
          cb()
        }
      })
    },
  }
}
