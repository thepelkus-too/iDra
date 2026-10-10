// The ladder on screen: the long-press gesture any number control can attach, the floating rung column it draws under the
// finger, and the same control as a panel (the number editor's Ladder tab) for people who won't discover the long-press.
import { useEffect, useRef, useState } from 'preact/hooks'
import { fmt } from './conv'
import { Session, type NumberField } from './field'
import { keyLadder, LADDER_LONG_MS, LADDER_ROW_PX, LADDER_SLOP_PX, LADDER_STEP_PX, moveLadder, openLadder, rungLabel, setRung, type LadderState } from './ladder'

// ---------------------------------------------------------------- the floating column

interface View {
  x: number
  y: number
  st: LadderState
  label: string
  /** bumps on every step and rung change: restarts the tick animation */
  tick: number
}
let view: View | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function show(v: View | null): void {
  view = v
  emit()
}

/** Drawn by OverlayHost. Pointer-transparent: the control that started the gesture keeps the pointer. */
export function LadderLayer() {
  const [, set] = useState(0)
  useEffect(() => {
    const l = () => set((n) => n + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  if (!view) return null
  const { x, y, st, label, tick } = view
  const top = y - st.rung0 * LADDER_ROW_PX - LADDER_ROW_PX / 2
  return (
    <div class="ladder" data-testid="ladder" style={{ left: `${x}px`, top: `${top}px` }} aria-hidden="true">
      <div class="ladder-value" style={{ top: `${-58}px` }}>
        <b data-testid="ladder-value">{fmt(st.value)}</b>
        <small>
          {label} · ±{rungLabel(st.mags[st.rung])}
        </small>
      </div>
      {st.mags.map((m, i) => (
        <div key={i === st.rung ? `on-${tick}` : `r-${i}`} class={`rung ${i === st.rung ? 'on' : ''}`} data-rung={rungLabel(m)} style={{ height: `${LADDER_ROW_PX}px` }}>
          <span>{rungLabel(m)}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- the long-press gesture

export interface LadderGestureOpts {
  /** released without moving after the long-press: the control's own long-press action (a menu), or the editor's Ladder tab */
  onStill?: (el: HTMLElement) => void
  /** the ladder opened (the control should stop its own drag and selection handling) */
  onOpen?: () => void
  longMs?: number
}

/**
 * Attach to a number control's pointer handlers: `arm` on pointerdown, `disarm` as soon as the control starts its own drag,
 * then while `active` route moves to `move` and the release to `up`. A long-press without movement opens the ladder under
 * the finger; the first movement after it belongs to the ladder; the release commits once (one undo step); Esc cancels.
 */
export class LadderGesture {
  private timer: ReturnType<typeof setTimeout> | undefined
  private st: LadderState | undefined
  private session: Session | undefined
  private start = { x: 0, y: 0, id: -1 }
  private el: HTMLElement | undefined
  private moved = false
  private tick = 0
  private onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !this.st) return
    e.preventDefault()
    e.stopImmediatePropagation()
    this.cancel()
  }
  // the finger has not moved yet when the ladder opens, so no scroll has started: holding off the browser's pan here keeps
  // the ladder's vertical moves (rung changes) inside controls that otherwise allow scrolling (touch-action: pan-y)
  private noScroll = (e: TouchEvent) => {
    if (this.st && e.cancelable) e.preventDefault()
  }

  constructor(private field: () => NumberField, private opts: LadderGestureOpts = {}) {}

  get active(): boolean {
    return !!this.st
  }

  arm(e: PointerEvent, el: HTMLElement): void {
    this.disarm()
    this.start = { x: e.clientX, y: e.clientY, id: e.pointerId }
    this.el = el
    this.moved = false
    this.timer = setTimeout(() => this.open(), this.opts.longMs ?? LADDER_LONG_MS)
  }

  /** Before the long-press fires: a move past the slop disarms it (the control drags instead). Returns true when disarmed. */
  check(e: PointerEvent): boolean {
    if (this.st || this.timer === undefined || e.pointerId !== this.start.id) return false
    if (Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) > LADDER_SLOP_PX) {
      this.disarm()
      return true
    }
    return false
  }

  disarm(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private open(): void {
    this.timer = undefined
    const f = this.field()
    this.session = new Session(f)
    this.st = openLadder(f.hint, this.session.origin, this.start.x, this.start.y)
    this.opts.onOpen?.()
    window.addEventListener('keydown', this.onKey, true)
    window.addEventListener('touchmove', this.noScroll, { passive: false, capture: true })
    this.paint()
  }

  private paint(): void {
    if (!this.st) return show(null)
    show({ x: this.start.x, y: this.start.y, st: this.st, label: this.field().label, tick: this.tick })
  }

  move(e: PointerEvent): void {
    if (!this.st || e.pointerId !== this.start.id) return
    if (!this.moved && Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) <= LADDER_SLOP_PX / 2) return
    this.moved = true
    const f = this.field()
    const next = moveLadder(this.st, e.clientX, e.clientY, f.hint)
    if (next === this.st) return
    const stepped = next.value !== this.st.value
    if (next.rung !== this.st.rung || stepped) this.tick++
    this.st = next
    if (stepped) this.session!.push(next.value)
    this.paint()
  }

  /** The release. Returns true when the ladder handled it (the control must not treat it as a tap). */
  up(e: PointerEvent): boolean {
    this.disarm()
    if (!this.st || e.pointerId !== this.start.id) return false
    const st = this.st
    this.close()
    if (!this.moved) {
      this.session?.revert()
      if (this.el) this.opts.onStill?.(this.el)
      return true
    }
    this.session?.commit(st.value)
    return true
  }

  cancel(): void {
    this.disarm()
    if (!this.st) return
    this.close()
    this.session?.revert()
  }

  private close(): void {
    this.st = undefined
    window.removeEventListener('keydown', this.onKey, true)
    window.removeEventListener('touchmove', this.noScroll, true)
    show(null)
  }
}

// ---------------------------------------------------------------- the ladder as a panel (the editor's Ladder tab)

export function LadderPanel({ field }: { field: NumberField }) {
  const ref = useRef<HTMLDivElement>(null)
  const [st, setSt] = useState<LadderState>(() => openLadder(field.hint, field.get(), 0, 0))
  const sess = useRef<Session | undefined>(undefined)
  const drag = useRef<{ id: number; st: LadderState } | null>(null)
  const [tick, setTick] = useState(0)

  // whatever is pending commits when the panel goes away (tab switch, popover closed)
  useEffect(() => () => sess.current?.commit(), [])

  const begin = () => {
    if (!sess.current) sess.current = new Session(field)
    return sess.current
  }
  const apply = (next: LadderState) => {
    if (next.value !== st.value) begin().push(next.value)
    if (next.value !== st.value || next.rung !== st.rung) setTick((t) => t + 1)
    setSt(next)
  }
  const commit = () => {
    sess.current?.commit()
    sess.current = undefined
    setSt((s) => ({ ...s, origin: s.value, start: s.value, steps: 0 }))
  }
  const cancel = () => {
    if (!sess.current) return false
    sess.current.revert()
    sess.current = undefined
    setSt((s) => ({ ...s, value: s.origin, start: s.origin, steps: 0 }))
    return true
  }

  return (
    <div class="ladder-panel" data-testid="ladder-panel">
      <div class="lp-value">
        <b data-testid="lp-value">{fmt(st.value)}</b>
        <small>steps of {rungLabel(st.mags[st.rung])}</small>
      </div>
      <div
        ref={ref}
        class="lp-body"
        tabIndex={0}
        role="slider"
        aria-label={`${field.label} ladder: left and right step by ${rungLabel(st.mags[st.rung])}, up and down change the step`}
        aria-valuenow={st.value}
        data-testid="lp-body"
        data-no-undo-tap
        onKeyDown={(e) => {
          const k = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : undefined
          if (k) {
            e.preventDefault()
            e.stopPropagation()
            return apply(keyLadder(st, k, field.hint))
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            return commit()
          }
          if (e.key === 'Escape' && cancel()) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          const el = e.currentTarget as HTMLElement
          el.setPointerCapture?.(e.pointerId)
          const row = (e.target as HTMLElement).closest?.('[data-i]') as HTMLElement | null
          const rung = row ? Number(row.dataset.i) : st.rung
          const s0 = { ...setRung(st, rung, e.clientX), x0: e.clientX, y0: e.clientY, rung0: rung, rung, start: st.value, steps: 0 }
          drag.current = { id: e.pointerId, st: s0 }
          apply(s0)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || d.id !== e.pointerId) return
          const next = moveLadder(d.st, e.clientX, e.clientY, field.hint)
          d.st = next
          apply(next)
        }}
        onPointerUp={(e) => {
          const d = drag.current
          if (!d || d.id !== e.pointerId) return
          drag.current = null
          commit()
        }}
        onPointerCancel={() => {
          drag.current = null
          cancel()
        }}
      >
        {st.mags.map((m, i) => (
          <div key={i === st.rung ? `on-${tick}` : `r-${i}`} class={`rung ${i === st.rung ? 'on' : ''}`} data-i={i} data-rung={rungLabel(m)} style={{ height: `${LADDER_ROW_PX}px` }}>
            <span>{rungLabel(m)}</span>
          </div>
        ))}
      </div>
      <div class="lp-steps">
        <button type="button" class="btn" data-testid="lp-minus" onClick={() => (apply(keyLadder(st, 'left', field.hint)), commitSoon())}>
          − {rungLabel(st.mags[st.rung])}
        </button>
        <button type="button" class="btn" data-testid="lp-plus" onClick={() => (apply(keyLadder(st, 'right', field.hint)), commitSoon())}>
          + {rungLabel(st.mags[st.rung])}
        </button>
      </div>
      <p class="lp-hint">
        Drag on the ladder: up and down pick the step, left and right change the value ({LADDER_STEP_PX} pt per step). Or long-press any number.
      </p>
    </div>
  )

  // a tap on − / + is its own little gesture: commit right after this render
  function commitSoon() {
    queueMicrotask(() => {
      if (!drag.current) {
        sess.current?.commit()
        sess.current = undefined
      }
    })
  }
}
