// A number the kit edits, as the editor describes it, and the two gestures that move it over time: glides and the ladder.
// Both push intermediate values on the live path when the editor offers one (no recompile, no IR change) and commit the
// final number once, so a whole glide or ladder gesture is one undo step. Without a live path they fall back to the
// editor's drag path (its commits coalesce into one undo step, exactly like dragging the number).
import { catalog as defaultCatalog, findCall, type Catalog, type Hint, type Sketch } from '@hydra-ipad/core'
import { kitHost } from './host'
import { cancelGlide, glideOf, startGlide, type Clock, type Glide } from './glide'

export { cancelGlide, glideOf }

export type NumPhase = 'drag' | 'end' | 'key'

export interface NumberField {
  /** stable key of this number (one glide per key; "return" remembers per key) */
  id: string
  label: string
  /** the committed value now (read from the editor's store) */
  get(): number
  def?: number
  hint: Hint
  /** the editor's commit path, as for NumSlider: 'drag' while moving, 'key' for a typed value, 'end' closes the undo step */
  onChange(v: number, phase: NumPhase): void
  /** push a value to the preview without touching the IR; false when this number has no live slot */
  live?(v: number): boolean
  /** the number is argument `index` of call `callId` in the IR: enables "Loop between values" and the Pad tab */
  arg?: { callId: string; index: number; fn?: string; input?: string }
}

const tidy = (f: NumberField, v: number) => (f.hint.integer ? Math.round(v) : +v.toPrecision(12))
const tolerance = (f: NumberField) => (f.hint.integer ? 0.5 : Math.max(1e-6, (f.hint.step ?? 0.01) / 2))

/**
 * One gesture's worth of updates to a field: `push` every intermediate value, then `commit` or `revert` once.
 * `expected` is what the field should read while the gesture runs; anything else means another edit happened.
 */
export class Session {
  private dragged = false
  private closed = false
  origin: number
  last: number

  constructor(readonly field: NumberField) {
    this.origin = field.get()
    this.last = this.origin
  }

  get expected(): number {
    return this.dragged ? this.last : this.origin
  }

  push(v: number): void {
    if (this.closed) return
    v = tidy(this.field, v)
    this.last = v
    if (!this.dragged && this.field.live?.(v)) return
    this.dragged = true
    this.field.onChange(v, 'drag')
  }

  commit(v = this.last): void {
    if (this.closed) return
    this.closed = true
    v = tidy(this.field, v)
    this.last = v
    if (v === this.origin && !this.dragged) {
      this.field.live?.(v)
      return
    }
    this.field.onChange(v, this.dragged ? 'drag' : 'key')
    this.field.onChange(v, 'end')
  }

  /** Back to where it started, leaving the document as it was (the live slot is reset too). */
  revert(): void {
    if (this.closed) return
    this.closed = true
    if (this.dragged) {
      this.field.onChange(this.origin, 'drag')
      this.field.onChange(this.origin, 'end')
    } else this.field.live?.(this.origin)
    this.last = this.origin
  }

  /** Hand the gesture to a new one on the same number (a glide retargeted): nothing is committed or reverted here. */
  handoff(): boolean {
    const was = this.dragged
    this.closed = true
    return was
  }

  /** The new session continues a handed-off one: it already wrote drag commits (same undo step). */
  adopt(dragged: boolean, origin: number): void {
    this.dragged = dragged
    this.origin = origin
  }

  /** Stop where it is without committing (another edit took over the number). */
  abandon(): void {
    if (this.closed) return
    this.closed = true
    if (this.dragged) this.field.onChange(this.field.get(), 'end')
  }

  /** True when the document no longer holds what this gesture expects: someone else edited the number. */
  overridden(): boolean {
    return Math.abs(this.field.get() - this.expected) > tolerance(this.field)
  }
}

// ---------------------------------------------------------------- glides

/** The value each field had before its last glide (the "return" button glides back to it). */
const before = new Map<string, number>()

export function returnValue(id: string): number | undefined {
  return before.get(id)
}

export interface GlideOpts {
  seconds: number
  ease: string
  clock?: Clock
  /** watch the document and cancel when the number is edited elsewhere (default: the kit host's store) */
  subscribe?: (cb: () => void) => () => void
}

/** Glide a field to `to`; commits once when it arrives. Any edit of the number meanwhile cancels it where it is. */
const sessions = new Map<string, Session>()

export function glideField(field: NumberField, to: number, o: GlideOpts, remember = true): Glide {
  const running = glideOf(field.id)
  const prev = running ? sessions.get(field.id) : undefined
  // retargeting mid-glide starts from where it is now, continues the same undo step, and "return" still goes back to
  // where the first glide started
  const from = running ? running.value : field.get()
  const dragged = prev ? prev.handoff() : false
  if (running) cancelGlide(field.id)
  if (remember && !running) before.set(field.id, field.get())
  const s = new Session(field)
  if (prev) s.adopt(dragged, prev.origin)
  sessions.set(field.id, s)
  const sub = o.subscribe ?? kitHost()?.subscribe
  let un: (() => void) | undefined
  const g = startGlide(
    field.id,
    {
      from,
      to: tidy(field, to),
      seconds: o.seconds,
      ease: o.ease,
      onFrame: (v) => s.push(v),
      onDone: (v) => {
        un?.()
        if (sessions.get(field.id) === s) sessions.delete(field.id)
        s.commit(v)
      },
      onCancel: () => {
        un?.()
        if (sessions.get(field.id) === s) sessions.delete(field.id)
        if (s.overridden()) s.abandon()
        else s.commit()
      },
    },
    o.clock,
  )
  if (g.running && sub) {
    un = sub(() => {
      if (g.running && s.overridden()) g.cancel()
    })
  }
  return g
}

/** Glide back to the value before the last glide of this field. */
export function glideBack(field: NumberField, o: GlideOpts): Glide | undefined {
  const v = before.get(field.id)
  if (v === undefined) return undefined
  return glideField(field, v, o, false)
}

/** A NumberField for a number that is not a call's argument (a setting, a modulator's rate, an array step, …). */
export function simpleField(o: { id: string; label: string; hint: Hint; def?: number; get: () => number; set: (v: number) => void; end?: () => void }): NumberField {
  return {
    id: o.id,
    label: o.label,
    hint: o.hint,
    def: o.def,
    get: o.get,
    onChange: (v, ph) => (ph === 'end' ? o.end?.() : o.set(o.hint.integer ? Math.round(v) : v)),
  }
}

/**
 * Whether argument `i` of call `callId` has a live slot in the compiled code: a plain number of a catalog-known float input
 * (docs/live-edit.md). Only then may a field's `live` push values without a recompile.
 */
export function hasLiveSlot(sketch: Sketch, callId: string, i: number, cat: Catalog = defaultCatalog): boolean {
  const c = findCall(sketch, callId)
  if (!c || c.args[i]?.k !== 'num' || !cat.get(c.fn)) return false
  return cat.inputs(c.fn)[i]?.type === 'float'
}
