// Pads: a parameter bound to a hydra-motion knob, played from floating pad buttons. Pure IR and meta helpers.
//
// Binding writes ordinary Hydra: `<name> = knob(<current>)` (core's knobDef: a bare assignment, so the running sketch and
// runtime.invoke can reach it) before the first statement that uses the parameter, and the argument becomes a reference to
// it. The pads' configuration is shared by every editor and lives in `sketch.meta.kit.pads`, a namespace owned by this kit
// and written only through the helpers here (the one exception to "an editor writes only meta[<app>]", see the contract).
import { catalog, findCall, knobArg, knobDef, knobDefs, num, parseKnobDef, setArg, withMotion, type Call, type Chain, type MotionMethod, type Sketch, type Stmt, type Value } from '@hydra-ipad/core'

export type PadMode = 'hold' | 'latch' | 'trigger'

export interface PadConfig {
  /** stable id; also the hold id passed to the knob, so two fingers on two pads of one knob stack */
  id: string
  /** the knob def's name */
  knob: string
  label: string
  mode: PadMode
  /** hold / trigger: where the press goes. latch: the "on" value */
  value: number
  /** latch: the "off" value (defaults to the knob's base) */
  value2?: number
  /** seconds to reach the value */
  attack: number
  /** seconds back (hold's release, latch's off) */
  release: number
  ease: string
  /** dock position as fractions of the viewport (0..1); absent = auto */
  x?: number
  y?: number
}

export interface KitMeta {
  pads?: PadConfig[]
  /** the dock is shown (per sketch, so a performance sketch opens with its pads) */
  dock?: boolean
}

export const KIT_META = 'kit'

export function kitMeta(sketch: Sketch): KitMeta {
  const m = sketch.meta?.[KIT_META]
  return m && typeof m === 'object' ? (m as KitMeta) : {}
}

/** Every pad of the sketch (including pads whose knob is gone: see livePads). */
export function padsOf(sketch: Sketch): PadConfig[] {
  const p = kitMeta(sketch).pads
  return Array.isArray(p) ? p.filter((x) => x && typeof x.id === 'string' && typeof x.knob === 'string') : []
}

/** Pads whose knob def is in the sketch (an undone bind leaves its pad config; it comes back with redo). */
export function livePads(sketch: Sketch): PadConfig[] {
  const names = new Set(knobDefs(sketch).map((k) => k.name))
  return padsOf(sketch).filter((p) => names.has(p.knob))
}

/** Write `meta.kit` (other keys of meta and of meta.kit are kept). */
export function withKitMeta(sketch: Sketch, patch: Partial<KitMeta>): Sketch {
  return { ...sketch, meta: { ...(sketch.meta ?? {}), [KIT_META]: { ...kitMeta(sketch), ...patch } } }
}

export function withPads(sketch: Sketch, pads: PadConfig[]): Sketch {
  return withKitMeta(sketch, { pads })
}

export function updatePad(sketch: Sketch, id: string, patch: Partial<PadConfig>): Sketch {
  return withPads(
    sketch,
    padsOf(sketch).map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)),
  )
}

// ---------------------------------------------------------------- binding

/** Globals a knob must never shadow: a bare `speed = knob(1)` would replace Hydra's own `speed`. */
const RESERVED = new Set(['time', 'speed', 'bpm', 'mouse', 'width', 'height', 'a', 'render', 'update', 'hush', 'setResolution', 'knob', 'gate', 'hydraMotion', 'window', 'document', 'Math', 'src', 'out', 'o0', 'o1', 'o2', 'o3', 's0', 's1', 's2', 's3'])

function inUse(sketch: Sketch): Set<string> {
  const names = new Set<string>(RESERVED)
  for (const s of sketch.stmts) if (s.k === 'def') names.add(s.name)
  for (const f of catalog.names()) names.add(f)
  return names
}

/** A free name for a knob on `fn`'s `input`: `rotateAngle`, `rotateAngle2`, … */
export function knobNameFor(sketch: Sketch, fn: string, input: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_$]/g, '')
  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
  let base = clean(fn) + cap(clean(input)) || 'knob'
  if (!/^[A-Za-z_$]/.test(base)) base = 'k' + base
  const used = inUse(sketch)
  if (!used.has(base)) return base
  for (let i = 2; ; i++) if (!used.has(base + i)) return base + i
}

function valueHasCall(v: Value, id: string): boolean {
  return v.k === 'tex' && chainHasCall(v.chain, id)
}
function callHas(c: Call, id: string): boolean {
  return c.id === id || c.args.some((a) => valueHasCall(a, id))
}
function chainHasCall(ch: Chain, id: string): boolean {
  return callHas(ch.gen, id) || ch.mods.some((m) => callHas(m, id))
}
function stmtHasCall(s: Stmt, id: string): boolean {
  if (s.k === 'chain') return chainHasCall(s.chain, id)
  if (s.k === 'def') return valueHasCall(s.value, id)
  return false
}

export interface BindResult {
  sketch: Sketch
  knob: string
  pad: PadConfig
}

/**
 * Bind argument `index` of call `callId` to a new knob and give it a pad. The argument must hold a plain number (or its
 * default, passed as `current`). Inserts the knob def before the first statement that uses the call, adds the hydra-motion
 * plugin, and appends a Hold pad going to `padValue` (default: the top of the hint range, or double the value).
 */
export function bindToPad(sketch: Sketch, callId: string, index: number, current: number, opts: { label?: string; padValue?: number; ease?: string; inputName?: string } = {}): BindResult | undefined {
  const call = findCall(sketch, callId)
  if (!call) return undefined
  const at = sketch.stmts.findIndex((s) => stmtHasCall(s, callId))
  if (at < 0) return undefined
  const input = opts.inputName ?? catalog.get(call.fn)?.inputs[index]?.name ?? `arg${index + 1}`
  const name = knobNameFor(sketch, call.fn, input)
  const def = knobDef(name, current)
  const stmts = sketch.stmts.slice()
  stmts.splice(at, 0, def)
  let next: Sketch = { ...sketch, stmts }
  next = setArg(next, callId, index, knobArg(name))
  next = withMotion(next)
  const pads = padsOf(next)
  const pad: PadConfig = {
    id: `pad-${name}-${Date.now().toString(36)}`,
    knob: name,
    label: opts.label ?? `${call.fn} ${input}`,
    mode: 'hold',
    value: opts.padValue ?? (current === 0 ? 1 : +(current * 2).toPrecision(6)),
    attack: 0,
    release: 0.15,
    ease: opts.ease ?? 'easeOutQuad',
  }
  next = withPads(next, [...pads, pad])
  return { sketch: next, knob: name, pad }
}

/** The knob's initial ("base") number, or undefined when there is no such knob def. */
export function knobBase(sketch: Sketch, knob: string): number | undefined {
  for (const s of sketch.stmts) {
    const k = parseKnobDef(s)
    if (k && k.name === knob) return k.initial
  }
  return undefined
}

/** Change a knob's base number (keeps the def's id, name and declaration). */
export function setKnobBase(sketch: Sketch, knob: string, v: number): Sketch {
  return {
    ...sketch,
    stmts: sketch.stmts.map((s) => {
      const k = parseKnobDef(s)
      if (!k || k.name !== knob || s.k !== 'def') return s
      return { ...s, value: knobDef(knob, v).value }
    }),
  }
}

/** Every argument bound to `knob` (a `var` reference to it). */
function replaceVar(v: Value, knob: string, by: Value): Value {
  if (v.k === 'var' && v.name === knob) return by
  if (v.k === 'tex') return { ...v, chain: replaceInChain(v.chain, knob, by) }
  return v
}
function replaceInChain(ch: Chain, knob: string, by: Value): Chain {
  const c = (x: Call): Call => ({ ...x, args: x.args.map((a) => replaceVar(a, knob, by)) })
  return { ...ch, gen: c(ch.gen), mods: ch.mods.map(c) }
}

/**
 * Unbind: every reference to the knob becomes its base number again, the knob def goes, and so do its pads. The plugin
 * stays when other knobs remain (and is removed with the last one only if this kit added it: we cannot tell, so it stays;
 * an unused plugin costs one script load).
 */
export function unbindKnob(sketch: Sketch, knob: string): Sketch {
  const base = knobBase(sketch, knob)
  if (base === undefined) return withPads(sketch, padsOf(sketch).filter((p) => p.knob !== knob))
  const by = num(base)
  const stmts = sketch.stmts
    .filter((s) => !(parseKnobDef(s)?.name === knob))
    .map((s) => {
      if (s.k === 'chain') return { ...s, chain: replaceInChain(s.chain, knob, by) }
      if (s.k === 'def') return { ...s, value: replaceVar(s.value, knob, by) }
      return s
    })
  return withPads({ ...sketch, stmts }, padsOf(sketch).filter((p) => p.knob !== knob))
}

// ---------------------------------------------------------------- playing

export type Invoke = (name: string, method: MotionMethod, args: Array<number | string>) => boolean

/** What a press does: Hold and Trigger go to the value; Latch toggles (`on` is the latch's state before the press). */
export function padPress(p: PadConfig, invoke: Invoke, base: number, on = false): { ok: boolean; on: boolean } {
  if (p.mode === 'hold') return { ok: invoke(p.knob, 'hold', [p.value, p.attack, p.ease, p.id]), on: true }
  if (p.mode === 'trigger') return { ok: invoke(p.knob, 'to', [p.value, p.attack, p.ease]), on: false }
  const off = p.value2 ?? base
  return on ? { ok: invoke(p.knob, 'to', [off, p.release, p.ease]), on: false } : { ok: invoke(p.knob, 'to', [p.value, p.attack, p.ease]), on: true }
}

/** What a release does: only Hold lets go (glides back over `release`). */
export function padRelease(p: PadConfig, invoke: Invoke): boolean {
  if (p.mode !== 'hold') return true
  return invoke(p.knob, 'release', [p.release, p.ease, p.id])
}
