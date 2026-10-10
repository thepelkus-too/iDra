// Popovers, sheets, toasts and the scrub HUD. One of each at a time; contents are closures that read the store when they
// render, so an open editor follows the sketch (undo while it is open, the preview updating, ...): the editor tells the kit
// what to follow with setOverlaySource (its store's subscribe), once, before it renders.
import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { LadderLayer } from './Ladder'
import { PadDock } from './PadDock'

type Render = (close: () => void) => ComponentChildren

interface PopoverSpec {
  id: number
  anchor: { left: number; top: number; right: number; bottom: number; width: number; height: number }
  render: Render
  width: number
  label?: string
  onClose?: () => void
}
interface SheetSpec {
  id: number
  title: string
  render: Render
  onClose?: () => void
  wide?: boolean
}
interface ToastSpec {
  id: number
  message: string
  action?: { label: string; run: () => void }
  until: number
}

const state = {
  popovers: [] as PopoverSpec[],
  sheet: null as SheetSpec | null,
  toasts: [] as ToastSpec[],
  hud: null as { x: number; y: number; text: string; sub?: string } | null,
}
const listeners = new Set<() => void>()

type Subscribe = (cb: () => void) => () => void
let source: Subscribe = () => () => {}
/** What open popovers and sheets re-render on (the editor's document store). */
export function setOverlaySource(subscribe: Subscribe): void {
  source = subscribe
}
/** Re-render the calling component whenever the overlay source changes. */
export function useOverlaySource(): void {
  const [, set] = useState(0)
  useEffect(() => source(() => set((v) => v + 1)), [])
}
let seq = 1
const emit = () => listeners.forEach((l) => l())

type RectLike = { left: number; top: number; right: number; bottom: number; width: number; height: number }
const rectOf = (a: Element | RectLike): RectLike => {
  if ('getBoundingClientRect' in a) {
    const r = a.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }
  return a
}

export function openPopover(anchor: Element | RectLike, render: Render, opts: { width?: number; label?: string; onClose?: () => void; stack?: boolean } = {}): void {
  // a popover opened from another popover (the keypad over a function editor) sits on top of it; anything else replaces what is open
  if (!opts.stack) closeAllPopovers()
  state.popovers = [...state.popovers, { id: seq++, anchor: rectOf(anchor), render, width: opts.width ?? 320, label: opts.label, onClose: opts.onClose }]
  emit()
}
/** Close the topmost popover. */
export function closePopover(): void {
  const p = state.popovers[state.popovers.length - 1]
  if (!p) return
  state.popovers = state.popovers.slice(0, -1)
  emit()
  p.onClose?.()
}
export function closeAllPopovers(): void {
  while (state.popovers.length) closePopover()
}
export function popoverOpen(): boolean {
  return state.popovers.length > 0
}

export function openSheet(title: string, render: Render, opts: { onClose?: () => void; wide?: boolean } = {}): void {
  closeSheet()
  state.sheet = { id: seq++, title, render, onClose: opts.onClose, wide: opts.wide }
  emit()
}
export function closeSheet(): void {
  const s = state.sheet
  if (!s) return
  state.sheet = null
  emit()
  s.onClose?.()
}
export function sheetOpen(): boolean {
  return !!state.sheet
}

export function toast(message: string, action?: { label: string; run: () => void }, ms = 5000): void {
  const t: ToastSpec = { id: seq++, message, action, until: Date.now() + ms }
  state.toasts = [...state.toasts.slice(-2), t]
  emit()
  setTimeout(() => {
    state.toasts = state.toasts.filter((x) => x.id !== t.id)
    emit()
  }, ms)
}

export const hud = {
  show(x: number, y: number, text: string, sub?: string): void {
    state.hud = { x, y, text, sub }
    emit()
  },
  hide(): void {
    if (!state.hud) return
    state.hud = null
    emit()
  },
}

export function closeAllOverlays(): void {
  closeAllPopovers()
  closeSheet()
}

function useOverlays(): void {
  const [, set] = useState(0)
  useEffect(() => {
    const l = () => set((v) => v + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
}

const MARGIN = 8

function Popover({ spec, level }: { spec: PopoverSpec; level: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number; arrowX: number; above: boolean }>({ left: 0, top: 0, maxH: 400, arrowX: 20, above: false })
  useOverlaySource() // follow the sketch while open
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = Math.min(spec.width, vw - MARGIN * 2)
    const a = spec.anchor
    const h = el.scrollHeight
    const below = vh - a.bottom - MARGIN
    const above = a.top - MARGIN
    const useAbove = h > below && above > below
    const maxH = Math.max(160, useAbove ? above - 6 : below - 6)
    const hh = Math.min(h, maxH)
    let left = a.left + a.width / 2 - w / 2
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN))
    const top = useAbove ? Math.max(MARGIN, a.top - hh - 6) : a.bottom + 6
    setPos({ left, top, maxH, arrowX: Math.max(16, Math.min(w - 16, a.left + a.width / 2 - left)), above: useAbove })
  }, [spec.id, spec.anchor, spec.width])
  return (
    <>
      <div class="scrim clear" data-testid="popover-scrim" style={{ zIndex: 2 + level * 2 }} onPointerDown={closePopover} />
      <div
        ref={ref}
        class="popover"
        role="dialog"
        aria-label={spec.label}
        style={{ zIndex: 3 + level * 2, left: `${pos.left}px`, top: `${pos.top}px`, width: `${Math.min(spec.width, window.innerWidth - MARGIN * 2)}px`, maxHeight: `${pos.maxH}px` }}
      >
        <div class={`arrow ${pos.above ? 'down' : 'up'}`} style={{ left: `${pos.arrowX}px` }} />
        {spec.render(closePopover)}
      </div>
    </>
  )
}

function Sheet({ spec }: { spec: SheetSpec }) {
  useOverlaySource()
  return (
    <>
      <div class="scrim" onPointerDown={closeSheet} />
      <div class={`sheet ${spec.wide ? 'wide' : ''}`} role="dialog" aria-label={spec.title}>
        <div class="sheet-head">
          <strong>{spec.title}</strong>
          <button type="button" class="icon" aria-label="Close" onClick={closeSheet}>
            ✕
          </button>
        </div>
        <div class="sheet-body">{spec.render(closeSheet)}</div>
      </div>
    </>
  )
}

export function OverlayHost() {
  useOverlays()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (state.popovers.length) closePopover()
        else if (state.sheet) closeSheet()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const { popovers, sheet, toasts, hud: h } = state
  return (
    <div class="overlays">
      <PadDock />
      {sheet && <Sheet key={sheet.id} spec={sheet} />}
      {popovers.map((p, i) => (
        <Popover key={p.id} spec={p} level={i} />
      ))}
      <LadderLayer />
      {h && (
        <div class="hud" style={{ left: `${h.x}px`, top: `${h.y}px` }}>
          <b>{h.text}</b>
          {h.sub && <small>{h.sub}</small>}
        </div>
      )}
      <div class="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div class="toast" key={t.id}>
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.run()
                  state.toasts = state.toasts.filter((x) => x.id !== t.id)
                  emit()
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

