// A number you drag sideways. The bar shows where the value sits in the input's hint range. The further the finger is above or
// below the bar while dragging, the finer the steps (as when scrubbing video on iOS); Apple Pencil is always fine.
// Tap opens the number editor (keypad, ladder, pad); long-press opens the ladder under the finger; double-tap resets to the
// default. Every move reports through onChange(v, 'drag'), the release through 'end'.
import type { Hint } from '@hydra-ipad/core'
import { useMemo, useRef } from 'preact/hooks'
import { clamp, fmt, roundTo, wrapInto } from './conv'
import type { NumberField } from './field'
import { LadderGesture } from './Ladder'
import { openNumberEditor } from './NumberEditor'
import { closePopover, hud } from './overlay'

export interface NumSliderProps {
  value: number
  hint: Hint
  label: string
  def?: number
  testid?: string
  /** dimmed: the value is the catalog default, not written explicitly */
  dim?: boolean
  onChange: (v: number, phase: 'drag' | 'end' | 'key') => void
  /** px for the full range at normal speed (defaults to the element width) */
  span?: number
  compact?: boolean
  /** stable key for glides (defaults to testid or label) */
  id?: string
  /** push a value to the preview without an IR change (see NumberField.live) */
  live?: (v: number) => boolean
  /** this number is a call's argument: enables Loop and the Pad tab */
  arg?: NumberField['arg']
  /** a long-press released without moving (default: the number editor on its Ladder tab) */
  onLong?: (el: HTMLElement) => void
  /** the number editor's width */
  editorWidth?: number
  /** the slider sits in a popover: open the number editor on top of it instead of replacing it */
  stack?: boolean
}

/** The NumberField a NumSlider stands for (its props, read fresh on every call). */
export function sliderField(pr: { current: NumSliderProps }): NumberField {
  const p = () => pr.current
  return {
    get id() {
      return p().id ?? p().testid ?? p().label
    },
    get label() {
      return p().label
    },
    get def() {
      return p().def
    },
    get hint() {
      return p().hint
    },
    get arg() {
      return p().arg
    },
    get: () => p().value,
    onChange: (v, ph) => p().onChange(p().hint.integer && ph !== 'end' ? Math.round(v) : v, ph),
    live: (v) => p().live?.(v) ?? false,
  }
}

export function NumSlider(p: NumSliderProps) {
  const st = useRef<{ id: number; x0: number; y0: number; v0: number; moved: boolean; fine: number; w: number } | null>(null)
  const lastTap = useRef(0)
  const pr = useRef(p)
  pr.current = p
  const field = useMemo(() => sliderField(pr), [])
  const ladder = useMemo(
    () =>
      new LadderGesture(() => field, {
        onOpen: () => hud.hide(),
        onStill: (el) => (pr.current.onLong ? pr.current.onLong(el) : openNumberEditor(el, field, { tab: 'ladder', width: pr.current.editorWidth, stack: pr.current.stack })),
      }),
    [],
  )
  const h = p.hint
  const range = h.max - h.min || 1
  const frac = clamp((p.value - h.min) / range, 0, 1)
  const step = h.integer ? 1 : (h.step ?? 0.01)

  const openKeypad = (el: HTMLElement) => openNumberEditor(el, field, { width: p.editorWidth, stack: p.stack })

  return (
    <div
      class={`numslider ${p.dim ? 'dim' : ''} ${p.compact ? 'compact' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={p.label}
      aria-valuemin={h.min}
      aria-valuemax={h.max}
      aria-valuenow={p.value}
      data-testid={p.testid}
      data-no-undo-tap
      onPointerDown={(e) => {
        e.stopPropagation()
        if (e.pointerType === 'mouse' && e.button !== 0) return
        const el = e.currentTarget as HTMLElement
        el.setPointerCapture?.(e.pointerId)
        st.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, v0: p.value, moved: false, fine: e.pointerType === 'pen' ? 0.2 : 1, w: p.span ?? el.getBoundingClientRect().width }
        ladder.arm(e, el)
      }}
      onPointerMove={(e) => {
        const s = st.current
        if (!s || s.id !== e.pointerId) return
        if (ladder.active) return ladder.move(e)
        const dx = e.clientX - s.x0
        const dy = Math.abs(e.clientY - s.y0)
        if (!s.moved && Math.hypot(dx, dy) < 6) return
        ladder.disarm()
        s.moved = true
        const zone = dy > 160 ? 0.01 : dy > 70 ? 0.1 : 1
        const k = zone * s.fine
        let v = s.v0 + (dx / Math.max(60, s.w)) * range * k
        v = h.wrap ? wrapInto(v, h.min, h.max) : clamp(v, Math.min(h.min, s.v0), Math.max(h.max, s.v0))
        v = h.integer ? Math.round(v) : roundTo(v, step * (k < 1 ? k : 1))
        if (v !== p.value) p.onChange(v, 'drag')
        hud.show(e.clientX, Math.max(8, e.clientY - 84), fmt(v), k < 1 ? `fine ×${+(k).toFixed(2)}` : p.label)
      }}
      onPointerUp={(e) => {
        const s = st.current
        if (!s || s.id !== e.pointerId) return
        st.current = null
        hud.hide()
        if (ladder.up(e)) return
        if (s.moved) return p.onChange(p.value, 'end')
        const now = Date.now()
        if (now - lastTap.current < 320 && p.def !== undefined) {
          lastTap.current = 0
          closePopover()
          p.onChange(p.def, 'key')
          p.onChange(p.def, 'end')
          return
        }
        lastTap.current = now
        openKeypad(e.currentTarget as HTMLElement)
      }}
      onPointerCancel={() => {
        st.current = null
        hud.hide()
        ladder.cancel()
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
        if (!d) return
        e.preventDefault()
        const v = h.integer ? p.value + d : roundTo(p.value + d * (e.shiftKey ? step : step * 10), step)
        p.onChange(v, 'key')
      }}
    >
      <i class="fill" style={{ width: `${frac * 100}%` }} />
      <span class="nl">{p.label}</span>
      <b class="nv">{fmt(p.value)}</b>
    </div>
  )
}
