// A number you can drag. Horizontal drag changes the value; the further the finger is from where it started (vertically),
// the finer the steps (like scrubbing video on iOS). Tap = keypad. Long-press = the owner's menu (name, default, kind switch).
import type { Hint } from '@hydra-ipad/core'
import { useRef } from 'preact/hooks'
import { decimalsOf, fmt, roundTo } from '../conv'
import { LONG_MS, TAP_SLOP } from '../gestures'
import { hud } from '../overlay'
import { appPrefs } from '../prefs'

/** Vertical distance (px) → step multiplier. */
export const ZONES: Array<{ from: number; factor: number; label: string }> = [
  { from: 0, factor: 1, label: 'normal' },
  { from: 56, factor: 0.1, label: 'fine ×0.1' },
  { from: 120, factor: 0.01, label: 'finer ×0.01' },
  { from: 200, factor: 0.001, label: 'finest ×0.001' },
]
export function zoneFor(dy: number) {
  let z = ZONES[0]
  for (const q of ZONES) if (Math.abs(dy) >= q.from) z = q
  return z
}

export interface ScrubProps {
  value: number
  hint: Hint
  /** shown dim: the value is the catalog default, not set explicitly */
  dim?: boolean
  label: string
  testid?: string
  /** called while dragging and for keyboard nudges */
  onChange: (v: number, phase: 'drag' | 'end' | 'key') => void
  onTap?: (el: HTMLElement) => void
  onLong?: (el: HTMLElement) => void
  /** extra class */
  cls?: string
  /** unit-less suffix text (kept tiny) */
  suffix?: string
  /** drag starts the instant the finger moves (used inside popovers where there is no long-press) */
  onStart?: () => void
}

export function wrapInto(v: number, min: number, max: number): number {
  const span = max - min
  if (!(span > 0)) return v
  return ((((v - min) % span) + span) % span) + min
}

export function Scrub(p: ScrubProps) {
  const g = useRef<{
    id: number
    x: number
    y: number
    lastX: number
    acc: number
    state: 'pending' | 'scrub'
    timer?: ReturnType<typeof setTimeout>
    long: boolean
    el: HTMLElement
    lo: number
    hi: number
  } | null>(null)
  const pr = useRef(p)
  pr.current = p

  const base = (h: Hint) => (h.integer ? 1 / 14 : (h.max - h.min) / 320)

  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const h = pr.current.hint
    const v = pr.current.value
    const s = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      acc: v,
      state: 'pending' as 'pending' | 'scrub',
      long: false,
      el,
      lo: Math.min(h.min, v),
      hi: Math.max(h.max, v),
    }
    g.current = s
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (pr.current.onLong) {
      ;(s as { timer?: ReturnType<typeof setTimeout> }).timer = setTimeout(() => {
        if (g.current !== s || s.state === 'scrub') return
        s.long = true
        pr.current.onLong!(el)
      }, LONG_MS)
    }
  }

  const move = (e: PointerEvent) => {
    const s = g.current
    if (!s || s.id !== e.pointerId || s.long) return
    const dxTotal = e.clientX - s.x
    if (s.state === 'pending') {
      if (Math.abs(dxTotal) <= TAP_SLOP) return
      s.state = 'scrub'
      clearTimeout(s.timer)
      s.lastX = e.clientX
      pr.current.onStart?.()
      s.el.classList.add('scrubbing')
    }
    const h = pr.current.hint
    const dy = e.clientY - s.y
    let zone = zoneFor(dy).factor
    if (e.pointerType === 'pen' && appPrefs.get<boolean>('penPressure') && e.pressure > 0.75) zone *= 0.25
    const step = (h.step ?? 0.01) * zone
    s.acc += (e.clientX - s.lastX) * base(h) * (h.integer ? 1 : zone)
    s.lastX = e.clientX
    let v = s.acc
    if (h.wrap) v = wrapInto(v, h.min, h.max)
    else v = Math.max(s.lo, Math.min(s.hi, v))
    v = h.integer ? Math.round(v) : roundTo(v, step)
    if (h.wrap && v >= h.max) v = h.min
    if (h.integer && !h.wrap) v = Math.max(s.lo, Math.min(s.hi, v))
    pr.current.onChange(v, 'drag')
    const r = s.el.getBoundingClientRect()
    const z = zoneFor(dy)
    hud.show(Math.max(60, Math.min(window.innerWidth - 60, e.clientX)), Math.max(8, r.top - 74), fmt(v), z.label)
  }

  const finish = (e: PointerEvent, cancelled: boolean) => {
    const s = g.current
    if (!s || s.id !== e.pointerId) return
    clearTimeout(s.timer)
    g.current = null
    s.el.classList.remove('scrubbing')
    if (s.state === 'scrub') {
      hud.hide()
      pr.current.onChange(pr.current.value, 'end')
      return
    }
    if (!cancelled && !s.long) pr.current.onTap?.(s.el)
  }

  const key = (e: KeyboardEvent) => {
    const h = pr.current.hint
    const step = (h.step ?? 0.01) * (e.shiftKey ? 10 : 1)
    let d = 0
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') d = step
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') d = -step
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pr.current.onTap?.(e.currentTarget as HTMLElement)
      return
    } else return
    e.preventDefault()
    let v = pr.current.value + d
    if (h.wrap) v = wrapInto(v, h.min, h.max)
    v = roundTo(v, h.step ?? 0.01)
    pr.current.onChange(v, 'key')
    pr.current.onChange(v, 'end')
  }

  return (
    <span
      class={`tok num ${p.dim ? 'dim' : ''} ${p.cls ?? ''}`}
      data-token="num"
      data-scrub=""
      data-testid={p.testid}
      role="spinbutton"
      tabIndex={0}
      aria-label={p.label}
      aria-valuenow={p.value}
      aria-valuemin={p.hint.min}
      aria-valuemax={p.hint.max}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onKeyDown={key}
      onContextMenu={(e) => e.preventDefault()}
    >
      {fmt(p.value)}
      {p.suffix && <i>{p.suffix}</i>}
    </span>
  )
}

export { decimalsOf }
