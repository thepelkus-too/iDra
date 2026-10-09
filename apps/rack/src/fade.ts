// Scene crossfades. A scene is the sketch's statements as they were when stored. Recalling one interpolates every number
// both versions share on core's live-parameter path (no recompile), then commits the stored statements at the end: when
// only numbers differ the code is the same and the runtime does not recompile; when the structure differs, the new
// structure swaps in at the end of the fade. The table maths is pure; `Fader` drives it frame by frame.
import { liveId, type Call, type Catalog, type Chain, type Stmt, type Value } from '@hydra-ipad/core'

const isLive = (fn: string, i: number, cat: Catalog) => cat.has(fn) && cat.inputs(fn)[i]?.type === 'float'

function eachCall(stmts: Stmt[], f: (c: Call) => void): void {
  const chain = (c: Chain) => {
    for (const call of [c.gen, ...c.mods]) {
      f(call)
      for (const a of call.args) if (a.k === 'tex') chain(a.chain)
    }
  }
  for (const s of stmts) {
    if (s.k === 'chain') chain(s.chain)
    else if (s.k === 'def' && s.value.k === 'tex') chain(s.value.chain)
  }
}

/** Every number the runtime reads from its live table (float inputs of known calls), by live id. */
export function liveTableOf(stmts: Stmt[], cat: Catalog): Record<string, number> {
  const t: Record<string, number> = {}
  eachCall(stmts, (c) => c.args.forEach((a, i) => a.k === 'num' && isLive(c.fn, i, cat) && (t[liveId(c.id, i)] = a.v)))
  return t
}

/** The statements with every live number blanked out (and source text dropped): equal shapes compile to the same code. */
export function shapeOf(stmts: Stmt[], cat: Catalog): string {
  const call = (c: Call): unknown => ({ id: c.id, fn: c.fn, args: c.args.map((a, i) => (a.k === 'num' && isLive(c.fn, i, cat) ? '#' : value(a))) })
  const chain = (c: Chain): unknown => ({ id: c.id, out: c.out, gen: call(c.gen), mods: c.mods.map(call) })
  const value = (v: Value): unknown => (v.k === 'tex' ? { k: 'tex', chain: chain(v.chain) } : v)
  return JSON.stringify(
    stmts.map((s) => {
      const { src: _src, ...rest } = s as Stmt & { src?: unknown }
      void _src
      if (s.k === 'chain') return { ...rest, chain: chain(s.chain) }
      if (s.k === 'def') return { ...rest, value: value(s.value) }
      return rest
    }),
  )
}

export const sameShape = (a: Stmt[], b: Stmt[], cat: Catalog): boolean => shapeOf(a, cat) === shapeOf(b, cat)

/** The live table between two versions at t ∈ [0, 1] (numbers present in both). */
export function lerpTable(a: Record<string, number>, b: Record<string, number>, t: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k in b) if (k in a) out[k] = a[k] + (b[k] - a[k]) * t
  return out
}

/** Beats → milliseconds at a bpm. */
export const beatsToMs = (beats: number, bpm: number): number => (Math.max(0, beats) * 60000) / (bpm > 0 ? bpm : 30)

/** Smoothstep easing, so a fade starts and lands gently. */
export const ease = (t: number): number => t * t * (3 - 2 * t)

export interface FadeHost {
  setLiveBatch(table: Record<string, number>): void
  now(): number
  frame(cb: () => void): void
}

/** One crossfade at a time; a new recall or a hand on any control stops the running one. */
export class Fader {
  private token = 0
  active = false
  constructor(private host: FadeHost) {}

  run(from: Record<string, number>, to: Record<string, number>, ms: number, done: () => void): void {
    const my = ++this.token
    const t0 = this.host.now()
    this.active = true
    const step = () => {
      if (my !== this.token) return
      const t = ms <= 0 ? 1 : Math.min(1, (this.host.now() - t0) / ms)
      this.host.setLiveBatch(lerpTable(from, to, ease(t)))
      if (t >= 1) {
        this.active = false
        done()
      } else this.host.frame(step)
    }
    step()
  }

  cancel(): void {
    this.token++
    this.active = false
  }
}
