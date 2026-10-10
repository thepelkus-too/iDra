// Glides: a number animates from where it is to a target over a duration with a curve, frame by frame, then settles.
// Pure scheduling with an injectable clock (the tests use a fake one); NumberEditor ties it to a field (live path every
// frame, one commit at the end).
import { ease } from './easing'

export interface Clock {
  /** milliseconds */
  now(): number
  /** call `cb` on the next frame; returns a handle for `cancel` */
  frame(cb: () => void): unknown
  cancel(handle: unknown): void
}

export const realClock: Clock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  frame: (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 16)),
  cancel: (h) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(h as number) : clearTimeout(h as ReturnType<typeof setTimeout>)),
}

/** Hydra's default bpm (the beat its arrays step on). */
export const DEFAULT_BPM = 30

/**
 * A duration as typed: `2` or `2s` seconds, `250ms`, `2b` beats at `bpm` (60 / bpm seconds per beat, as hydra-motion
 * reads them). Undefined when it is not one of those or is negative.
 */
export function parseDuration(text: string | number, bpm = DEFAULT_BPM): number | undefined {
  if (typeof text === 'number') return Number.isFinite(text) && text >= 0 ? text : undefined
  const m = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*(b|s|ms)?\s*$/i.exec(text)
  if (!m) return undefined
  const n = Number(m[1])
  const unit = (m[2] ?? 's').toLowerCase()
  if (unit === 'ms') return n / 1000
  if (unit === 'b') return (n * 60) / (bpm > 0 ? bpm : DEFAULT_BPM)
  return n
}

export interface GlideSpec {
  from: number
  to: number
  /** seconds */
  seconds: number
  ease: string
  /** every frame, with the eased value (not called again with the same value) */
  onFrame(v: number): void
  /** once, with `to`, when the glide reaches it */
  onDone(v: number): void
  /** once, with the value it had, when cancelled */
  onCancel?(v: number): void
}

export class Glide {
  value: number
  running = false
  private t0 = 0
  private handle: unknown
  private readonly curve: (t: number) => number

  constructor(readonly spec: GlideSpec, private readonly clock: Clock = realClock) {
    this.value = spec.from
    this.curve = ease(spec.ease)
  }

  start(): this {
    this.running = true
    this.t0 = this.clock.now()
    if (!(this.spec.seconds > 0) || this.spec.from === this.spec.to) {
      this.finish()
      return this
    }
    this.handle = this.clock.frame(this.tick)
    return this
  }

  /** The value at `ms` after the start (pure; the tests read it). */
  at(ms: number): number {
    const d = this.spec.seconds * 1000
    const t = d > 0 ? Math.min(1, Math.max(0, ms / d)) : 1
    if (t >= 1) return this.spec.to
    return this.spec.from + (this.spec.to - this.spec.from) * this.curve(t)
  }

  private tick = (): void => {
    if (!this.running) return
    const el = this.clock.now() - this.t0
    if (el >= this.spec.seconds * 1000) return this.finish()
    const v = this.at(el)
    if (v !== this.value) {
      this.value = v
      this.spec.onFrame(v)
    }
    if (this.running) this.handle = this.clock.frame(this.tick)
  }

  private finish(): void {
    this.running = false
    this.value = this.spec.to
    this.spec.onDone(this.spec.to)
  }

  cancel(): void {
    if (!this.running) return
    this.running = false
    this.clock.cancel(this.handle)
    this.spec.onCancel?.(this.value)
  }
}

// ---------------------------------------------------------------- one glide per number

const running = new Map<string, Glide>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Start a glide for the number `id`, cancelling one already running for it. */
export function startGlide(id: string, spec: GlideSpec, clock?: Clock): Glide {
  running.get(id)?.cancel()
  const g = new Glide(
    {
      ...spec,
      onDone: (v) => {
        if (running.get(id) === g) running.delete(id)
        spec.onDone(v)
        emit()
      },
      onCancel: (v) => {
        if (running.get(id) === g) running.delete(id)
        spec.onCancel?.(v)
        emit()
      },
    },
    clock,
  )
  running.set(id, g)
  emit()
  g.start()
  return g
}

export function cancelGlide(id: string): void {
  running.get(id)?.cancel()
}

export function glideOf(id: string): Glide | undefined {
  return running.get(id)
}

export function subscribeGlides(cb: () => void): () => void {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}
