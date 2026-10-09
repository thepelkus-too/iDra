// Pointer-event helpers shared by the editor: tap vs long-press, undo/redo taps, keyboard shortcuts, layout.
// Everything uses Pointer Events, so mouse, finger and Apple Pencil go through one path. No hover-dependent behaviour.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ctx } from './ctx'
import { toast } from './overlay'

export const TAP_SLOP = 8
export const LONG_MS = 460

export interface PressConfig {
  onTap?: (e: PointerEvent, el: HTMLElement) => void
  onLong?: (e: PointerEvent, el: HTMLElement) => void
  longMs?: number
  onDown?: (e: PointerEvent, el: HTMLElement) => void
}

/** Tap vs long-press on one element. Handlers are stable across renders. */
export function usePress(cfg: PressConfig) {
  const c = useRef(cfg)
  c.current = cfg
  const st = useRef<{ id: number; x: number; y: number; fired: boolean; moved: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null)
  return useMemo(() => {
    const clear = () => {
      if (st.current?.timer) clearTimeout(st.current.timer)
    }
    return {
      onPointerDown(e: PointerEvent) {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        const el = e.currentTarget as HTMLElement
        st.current = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false, moved: false }
        c.current.onDown?.(e, el)
        if (c.current.onLong) {
          const s = st.current
          s.timer = setTimeout(() => {
            if (st.current !== s || s.moved) return
            s.fired = true
            c.current.onLong!(e, el)
          }, c.current.longMs ?? LONG_MS)
        }
      },
      onPointerMove(e: PointerEvent) {
        const s = st.current
        if (!s || s.id !== e.pointerId || s.moved) return
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > TAP_SLOP) {
          s.moved = true
          clear()
        }
      },
      onPointerUp(e: PointerEvent) {
        const s = st.current
        if (!s || s.id !== e.pointerId) return
        clear()
        st.current = null
        if (!s.fired && !s.moved) c.current.onTap?.(e, e.currentTarget as HTMLElement)
      },
      onPointerCancel() {
        clear()
        st.current = null
      },
      onContextMenu(e: Event) {
        e.preventDefault()
      },
    }
  }, [])
}

export const isTextTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  if (!el || !el.closest) return false
  return !!el.closest('input:not([type=range]),textarea,[contenteditable="true"],.cm-editor')
}

/** Two-finger tap = undo, three-finger tap = redo (the iPadOS convention). A tap, not a drag, not a long hold. */
export function useTapGestures(): void {
  useEffect(() => {
    let t0 = 0
    let max = 0
    let moved = false
    let start: Array<{ x: number; y: number }> = []
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === e.changedTouches.length) {
        t0 = Date.now()
        max = 0
        moved = false
        start = []
      }
      max = Math.max(max, e.touches.length)
      if (e.touches.length >= 2) start = Array.from(e.touches).map((t) => ({ x: t.clientX, y: t.clientY }))
    }
    const onMove = (e: TouchEvent) => {
      if (!start.length) return
      const now = Array.from(e.touches)
      for (let i = 0; i < Math.min(now.length, start.length); i++) if (Math.hypot(now[i].clientX - start[i].x, now[i].clientY - start[i].y) > 14) moved = true
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return
      const quick = Date.now() - t0 < 380
      const n = max
      max = 0
      if (n < 2 || moved || !quick || isTextTarget(e.target)) return
      // a multi-finger tap that started on a control (two knobs at once) is not an undo
      if ((e.target as HTMLElement | null)?.closest?.('[data-no-undo-tap]')) return
      if (n === 2) {
        if (ctx.store.undo()) toast('Undo')
      } else if (n === 3) {
        if (ctx.store.redo()) toast('Redo')
      }
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
    }
  }, [])
}

/** ⌘Z / ⇧⌘Z / ⌘Y / ⌘Enter plus app-specific keys (called with the key when ⌘/Ctrl is held, or for plain keys when `plain`). */
export function useShortcuts(extra: (e: KeyboardEvent, mod: boolean) => boolean = () => false, flush: () => void = () => {}): void {
  const ex = useRef(extra)
  ex.current = extra
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'enter') {
        e.preventDefault()
        flush()
        ctx.runner.run(true)
        return
      }
      if (isTextTarget(e.target)) return
      if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) ctx.store.redo()
        else ctx.store.undo()
        return
      }
      if (mod && k === 'y') {
        e.preventDefault()
        ctx.store.redo()
        return
      }
      if (ex.current(e, mod)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export type Layout = 'land' | 'port'

export function useLayout(): Layout {
  const calc = (): Layout => (window.innerWidth >= 700 && window.innerWidth > window.innerHeight * 1.05 ? 'land' : 'port')
  const [l, setL] = useState<Layout>(calc)
  useEffect(() => {
    const on = () => setL(calc())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    window.visualViewport?.addEventListener('resize', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
      window.visualViewport?.removeEventListener('resize', on)
    }
  }, [])
  return l
}

/** Width of the window, for components that change shape in Slide Over / narrow Split View. */
export function useNarrow(px = 600): boolean {
  const [n, set] = useState(() => window.innerWidth < px)
  useEffect(() => {
    const on = () => set(window.innerWidth < px)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [px])
  return n
}
