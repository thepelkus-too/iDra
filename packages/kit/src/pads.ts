// Pads: a parameter bound to a hydra-motion knob, played from floating pad buttons. Pure IR and meta helpers.
//
// Binding writes ordinary Hydra: `<name> = knob(<current>, { pads: [...] })` (core's knobDef: a bare assignment, so the
// running sketch and runtime.invoke can reach it) before the first statement that uses the parameter, and the argument
// becomes a reference to it. The pads themselves are that plain data in the code (hydra-motion ignores it), so they travel
// with a copy or an export and undo with the code. Only where each pad sits on screen, and whether the dock is open, live in
// `sketch.meta.kit`, a namespace owned by this kit and written only through the helpers here (the one exception to "an
// editor writes only meta[<app>]", see the contract).
import { catalog, findCall, knobArg, knobDef, knobDefs, num, parseKnobDef, setArg, withMotion, type Call, type Chain, type KnobPad, type MotionMethod, type Sketch, type Stmt, type Value } from '@hydra-ipad/core'

export type PadMode = 'hold' | 'latch' | 'trigger'

export interface PadConfig {
  /** `<knob>#<n>` (its place among the knob's pads); also the hold id passed to the knob, so two fingers on two pads stack */
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
  /** where each pad sits in the dock, by pad id (fractions of the viewport) */
  layout?: Record<string, { x: number; y: number }>
  /** the dock is shown (per sketch, so a performance sketch opens with its pads) */
  dock?: boolean
  /** before pads moved into the code: read once, written back as code on the next pad edit */
  pads?: PadConfig[]
}

export const KIT_META = 'kit'
export const PAD_DEFAULTS = { attack: 0, release: 0.15, ease: 'easeOutQuad' } as const

export function kitMeta(sketch: Sketch): KitMeta {
  const m = sketch.meta?.[KIT_META]
  return m && typeof m === 'object' ? (m as KitMeta) : {}
}

const padId = (knob: string, i: number) => `${knob}#${i + 1}`

function fromCode(knob: string, i: number, p: KnobPad, layout: KitMeta['layout']): PadConfig {
  const id = padId(knob, i)
  const at = layout?.[id]
  return {
    id,
    knob,
    label: i ? `${knob} ${i + 1}` : knob,
    mode: p.mode ?? 'hold',
    value: p.to,
    value2: p.off,
    attack: p.attack ?? PAD_DEFAULTS.attack,
    release: p.release ?? PAD_DEFAULTS.release,
    ease: p.ease ?? PAD_DEFAULTS.ease,
    ...(at ? { x: at.x, y: at.y } : {}),
  }
}

/** What the code says for a pad: mode and value always, the rest when it matters. */
export function toKnobPad(p: PadConfig): KnobPad {
  const k: KnobPad = { mode: p.mode, to: p.value }
  if (p.mode === 'latch' && p.value2 !== undefined) k.off = p.value2
  if (p.attack) k.attack = p.attack
  if (p.mode !== 'trigger') k.release = p.release
  k.ease = p.ease
  return k
}

/** Every pad of the sketch, read from its knob defs, in code order. */
export function padsOf(sketch: Sketch): PadConfig[] {
  const meta = kitMeta(sketch)
  const legacy = Array.isArray(meta.pads) ? meta.pads.filter((x) => x && typeof x.id === 'string' && typeof x.knob === 'string') : []
  const out: PadConfig[] = []
  for (const k of knobDefs(sketch)) {
    if (k.pads.length) k.pads.forEach((p, i) => out.push(fromCode(k.name, i, p, meta.layout)))
    else legacy.filter((p) => p.knob === k.name).forEach((p, i) => out.push({ ...p, id: padId(k.name, i), label: i ? `${k.name} ${i + 1}` : k.name }))
  }
  return out
}

/** The pads (every pad has its knob now: the knob def holds them). */
export const livePads = padsOf

/** Write `meta.kit` (other keys of meta and of meta.kit are kept). */
export function withKitMeta(sketch: Sketch, patch: Partial<KitMeta>): Sketch {
  return { ...sketch, meta: { ...(sketch.meta ?? {}), [KIT_META]: { ...kitMeta(sketch), ...patch } } }
}

/**
 * Make the sketch's pads exactly `pads`: each knob def's `{ pads: [...] }` is rewritten (a def whose code comes out the
 * same is kept as it is), and the dock positions go to `meta.kit.layout` under the pads' new ids.
 */
export function withPads(sketch: Sketch, pads: PadConfig[]): Sketch {
  const by = new Map<string, PadConfig[]>()
  for (const p of pads) by.set(p.knob, [...(by.get(p.knob) ?? []), p])
  const layout: Record<string, { x: number; y: number }> = {}
  let changed = false
  const stmts = sketch.stmts.map((s) => {
    const k = parseKnobDef(s)
    if (!k || s.k !== 'def') return s
    const mine = by.get(k.name) ?? []
    mine.forEach((p, i) => {
      if (p.x !== undefined && p.y !== undefined) layout[padId(k.name, i)] = { x: p.x, y: p.y }
    })
    const value = knobDef(k.name, k.initial, mine.map(toKnobPad)).value
    if (value.k === 'js' && s.value.k === 'js' && value.src === s.value.src) return s
    changed = true
    return { ...s, value }
  })
  const meta = kitMeta(sketch)
  const { pads: _legacy, ...rest } = meta
  const next = changed ? { ...sketch, stmts } : sketch
  return { ...next, meta: { ...(sketch.meta ?? {}), [KIT_META]: { ...rest, layout } } }
}

export function updatePad(sketch: Sketch, id: string, patch: Partial<PadConfig>): Sketch {
  return withPads(
    sketch,
    padsOf(sketch).map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)),
  )
}

/**
 * Another pad on the same knob (pads stack: each has its own hold id). It copies the last pad's mode, times and curve and
 * goes to `value` (default: the knob's base, so a row of Trigger pads can always jump back).
 */
export function addPad(sketch: Sketch, knob: string, value?: number): { sketch: Sketch; pad?: PadConfig } {
  const all = padsOf(sketch)
  const mine = all.filter((p) => p.knob === knob)
  const last = mine[mine.length - 1]
  const base = knobBase(sketch, knob)
  if (!last || base === undefined) return { sketch }
  const pad: PadConfig = {
    ...last,
    id: padId(knob, mine.length),
    label: `${knob} ${mine.length + 1}`,
    value: value ?? base,
    value2: undefined,
    x: undefined,
    y: undefined,
  }
  const after = all.indexOf(last) + 1
  return { sketch: withPads(sketch, [...all.slice(0, after), pad, ...all.slice(after)]), pad }
}

/** Remove one pad (the knob and its other pads stay). */
export function removePad(sketch: Sketch, id: string): Sketch {
  return withPads(
    sketch,
    padsOf(sketch).filter((p) => p.id !== id),
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
  const pad: PadConfig = {
    id: padId(name, 0),
    knob: name,
    label: name,
    mode: 'hold',
    value: opts.padValue ?? (current === 0 ? 1 : +(current * 2).toPrecision(6)),
    attack: PAD_DEFAULTS.attack,
    release: PAD_DEFAULTS.release,
    ease: opts.ease ?? PAD_DEFAULTS.ease,
  }
  const def = knobDef(name, current, [toKnobPad(pad)])
  const stmts = sketch.stmts.slice()
  // the def has no source text, so the statement it goes before must start on a new line (a first statement's recorded
  // leading whitespace is empty, which would glue the two together)
  const nextStmt = stmts[at]
  if (nextStmt.src && !nextStmt.src.before.includes('\n')) stmts[at] = { ...nextStmt, src: { ...nextStmt.src, before: '\n' } } as Stmt
  stmts.splice(at, 0, def)
  let next: Sketch = { ...sketch, stmts }
  next = setArg(next, callId, index, knobArg(name))
  next = withMotion(next)
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
      return { ...s, value: knobDef(knob, v, k.pads).value }
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
  const layout = Object.fromEntries(Object.entries(kitMeta(sketch).layout ?? {}).filter(([id]) => !id.startsWith(knob + '#')))
  if (base === undefined) return withKitMeta(sketch, { layout })
  const by = num(base)
  const stmts = sketch.stmts
    .filter((s) => !(parseKnobDef(s)?.name === knob))
    .map((s) => {
      if (s.k === 'chain') return { ...s, chain: replaceInChain(s.chain, knob, by) }
      if (s.k === 'def') return { ...s, value: replaceVar(s.value, knob, by) }
      return s
    })
  return withKitMeta({ ...sketch, stmts }, { layout, pads: kitMeta(sketch).pads?.filter((p) => p.knob !== knob) })
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
