// MIDI on the HOST side. The sandboxed frame never gets Web MIDI (opaque origin, no `midi` permission; iOS Safari has no
// Web MIDI at all), so the host owns it and forwards raw messages into the frame's shim (runtime/midi-shim.ts), where
// hydra-midi sees an ordinary `navigator.requestMIDIAccess()`. Inputs:
//   * real Web MIDI inputs, when the browser has the API and the owner allowed access (`hub.enableWebMidi()` from a tap);
//   * "Hydra Touch", the on-screen controller (mountMidiController): faders send CC 1–8, keys and pads send notes.
// Nothing here assumes what a browser supports: `webMidiAvailable()` checks the live API.

import type { Sketch, Value } from './ir'
import type { MidiPortInfo } from './runtime/protocol'

export type { MidiPortInfo } from './runtime/protocol'

export const TOUCH_INPUT: MidiPortInfo = { id: 'hydra-touch', name: 'Hydra Touch', manufacturer: 'hydra-ipad' }

/** Is the real Web MIDI API present in this page? (Our frame shim is never counted.) */
export function webMidiAvailable(nav: any = (globalThis as any).navigator): boolean {
  const f = nav?.requestMIDIAccess
  return typeof f === 'function' && !f.__hydraTouchShim
}

type MsgListener = (input: string, data: number[]) => void

export class MidiHub {
  private real = new Map<string, MidiPortInfo>()
  private inputListeners = new Set<(inputs: MidiPortInfo[]) => void>()
  private msgListeners = new Set<MsgListener>()
  private access?: any
  /** state of real Web MIDI: not asked yet, granted, denied/failed, or absent */
  webMidi: 'unavailable' | 'idle' | 'granted' | 'denied' = 'idle'
  webMidiError?: string
  touchEnabled = true

  constructor(private nav: any = (globalThis as any).navigator) {
    if (!webMidiAvailable(nav)) this.webMidi = 'unavailable'
  }

  inputs(): MidiPortInfo[] {
    return [...(this.touchEnabled ? [TOUCH_INPUT] : []), ...this.real.values()]
  }

  /** Ask for real Web MIDI access (call from a tap; browsers may prompt). Real inputs are then forwarded too. */
  async enableWebMidi(): Promise<boolean> {
    if (!webMidiAvailable(this.nav)) {
      this.webMidi = 'unavailable'
      return false
    }
    try {
      const access = await this.nav.requestMIDIAccess({ sysex: false })
      this.access = access
      this.webMidi = 'granted'
      const sync = () => {
        this.real.clear()
        for (const inp of access.inputs.values()) {
          if (inp.state === 'disconnected') continue
          this.real.set(inp.id, { id: inp.id, name: inp.name ?? inp.id, manufacturer: inp.manufacturer ?? '' })
          inp.onmidimessage = (e: { data: Uint8Array }) => this.emit(inp.id, Array.from(e.data))
        }
        this.emitInputs()
      }
      access.onstatechange = sync
      sync()
      return true
    } catch (e) {
      this.webMidi = 'denied'
      this.webMidiError = (e as Error)?.name || String(e)
      this.emitInputs()
      return false
    }
  }

  /** Send one message as the on-screen controller (or any input id). */
  send(data: number[], input: string = TOUCH_INPUT.id): void {
    this.emit(input, data.map((x) => x & 0xff))
  }
  cc(index: number, value01: number, channel = 0): void {
    this.send([0xb0 | (channel & 15), index & 127, Math.round(Math.max(0, Math.min(1, value01)) * 127)])
  }
  noteOn(note: number, velocity01 = 1, channel = 0): void {
    this.send([0x90 | (channel & 15), note & 127, Math.max(1, Math.round(Math.max(0, Math.min(1, velocity01)) * 127))])
  }
  noteOff(note: number, channel = 0): void {
    this.send([0x80 | (channel & 15), note & 127, 0])
  }

  onInputs(cb: (inputs: MidiPortInfo[]) => void): () => void {
    this.inputListeners.add(cb)
    return () => this.inputListeners.delete(cb)
  }
  onMessage(cb: MsgListener): () => void {
    this.msgListeners.add(cb)
    return () => this.msgListeners.delete(cb)
  }
  private emit(input: string, data: number[]) {
    for (const cb of [...this.msgListeners]) cb(input, data)
  }
  private emitInputs() {
    const list = this.inputs()
    for (const cb of [...this.inputListeners]) cb(list)
  }
  dispose() {
    if (this.access) this.access.onstatechange = null
    this.inputListeners.clear()
    this.msgListeners.clear()
  }
}

let shared: MidiHub | undefined
/** The page-wide hub. Pass it to createRuntime({ midi }) so MIDI-driven sketches get messages. */
export function getMidiHub(): MidiHub {
  return (shared ??= new MidiHub())
}
export function setMidiHub(h: MidiHub | undefined) {
  shared = h
}

// ------------------------------------------------------------------ sketches that use MIDI

const MIDI_CODE_RE = /\bmidi\s*\.\s*(start|show|hide|input|channel)\b|(^|[^\w.$])_?(cc|note)\s*\(/
const valueSrcs = (v: Value, out: string[]) => {
  if (v.k === 'fn' || v.k === 'js') out.push(v.src)
  else if (v.k === 'tex') for (const c of [v.chain.gen, ...v.chain.mods]) for (const a of c.args) valueSrcs(a, out)
}

/** Does this sketch use hydra-midi? (a plugin ref to it, `midi.start/show/…`, or `cc(…)` / `note(…)` in code) */
export function usesMidi(sketch: Sketch): boolean {
  if ((sketch.plugins ?? []).some((p) => /hydra-midi/i.test(p.id + ' ' + (p.url ?? '')))) return true
  const srcs: string[] = []
  for (const s of sketch.stmts) {
    if (s.k === 'raw') srcs.push(s.code)
    else if (s.k === 'def') valueSrcs(s.value, srcs)
    else if (s.k === 'chain') for (const c of [s.chain.gen, ...s.chain.mods]) for (const a of c.args) valueSrcs(a, srcs)
  }
  return srcs.some((x) => /hydra-midi/i.test(x) || MIDI_CODE_RE.test(x))
}

// ------------------------------------------------------------------ MIDI chips (hydra-midi expressions)

export interface MidiChipSpec {
  kind: 'cc' | 'note'
  /** CC number, or MIDI note number / name ('C3', '*') */
  index: number | string
  /** channel index 0–15 (hydra-midi: 0 → MIDI channel 1), or '*'; omitted → midi.start()'s default */
  channel?: number | '*'
  /** map 0…1 to min…max with hydra-midi's `.range(min, max)` */
  min?: number
  max?: number
}

const lit = (x: number | string) => (typeof x === 'number' ? String(x) : `'${String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)

/**
 * IR value for a hydra-midi input, from its README: `cc(index, channel?)` / `note(note, channel?)` return functions Hydra
 * calls every frame, and `.range(min, max)` maps them. So the value is the expression itself (`js`), e.g.
 * `cc(1).range(0, 1)`, which is also what importText produces for that text. (Wrapping it as `() => cc(1)…` would hand
 * Hydra a function that returns a function.)
 */
export function midiChip(spec: MidiChipSpec): Value {
  const args = [lit(spec.index)]
  if (spec.channel !== undefined) args.push(lit(spec.channel))
  let src = `${spec.kind}(${args.join(', ')})`
  if (spec.min !== undefined || spec.max !== undefined) src += `.range(${spec.min ?? 0}, ${spec.max ?? 1})`
  return { k: 'js', src }
}

const CHIP_RE = /^(cc|note)\(\s*(\d+|'[^']*'|"[^"]*")\s*(?:,\s*(\d+|'\*'|"\*")\s*)?\)(?:\.range\(\s*(-?[\d.]+(?:e[+-]?\d+)?)\s*,\s*(-?[\d.]+(?:e[+-]?\d+)?)\s*\))?$/i
const unq = (s: string) => (/^['"]/.test(s) ? s.slice(1, -1) : Number(s))

/** Inverse of midiChip (accepts `js` and `fn` values holding exactly that form). */
export function parseMidiChip(v: Value): MidiChipSpec | undefined {
  if (v.k !== 'js' && v.k !== 'fn') return undefined
  const m = CHIP_RE.exec(v.src.trim())
  if (!m) return undefined
  const spec: MidiChipSpec = { kind: m[1].toLowerCase() as 'cc' | 'note', index: unq(m[2]) as number | string }
  if (m[3] !== undefined) spec.channel = unq(m[3]) as number | '*'
  if (m[4] !== undefined) {
    spec.min = Number(m[4])
    spec.max = Number(m[5])
  }
  return spec
}
