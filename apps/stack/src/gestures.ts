// Pointer-event gestures of the rows: swipe to delete and drag to reorder (tap vs long-press, TAP_SLOP and LONG_MS come from
// the kit). Everything uses Pointer Events, so mouse, finger and Apple Pencil go through one path (pointerType 'pen' behaves
// like touch). No hover-dependent behaviour anywhere.
import { TAP_SLOP } from '@hydra-ipad/kit'
import { useMemo, useRef } from 'preact/hooks'

// ---------------------------------------------------------------- swipe to delete

export interface SwipeConfig {
  /** distance (px, leftwards) at which release deletes */
  threshold?: number
  onCommit: () => void
  /** swiping is disabled for pinned rows */
  enabled?: boolean
}

/** Horizontal swipe on a row's free area. Tokens (data-token) and handles keep their own gestures. */
export function useSwipe(cfg: SwipeConfig) {
  const c = useRef(cfg)
  c.current = cfg
  return useMemo(() => {
    let s: { id: number; x: number; y: number; dx: number; active: boolean; el: HTMLElement } | null = null
    const reset = (el: HTMLElement, animate = true) => {
      el.style.transition = animate ? 'transform .18s ease, opacity .18s ease' : ''
      el.style.transform = ''
      el.style.opacity = ''
      el.classList.remove('swiping')
      el.removeAttribute('data-swipe')
    }
    return {
      onPointerDown(e: PointerEvent) {
        if (c.current.enabled === false) return
        if (e.pointerType === 'mouse' && e.button !== 0) return
        const t = e.target as HTMLElement
        if (t.closest('[data-scrub],button,input,textarea,select,.handle')) return
        // a pocket's rows sit inside the outer row: only the innermost row swipes
        if ((e as PointerEvent & { _swipe?: boolean })._swipe) return
        ;(e as PointerEvent & { _swipe?: boolean })._swipe = true
        s = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false, el: e.currentTarget as HTMLElement }
      },
      onPointerMove(e: PointerEvent) {
        if (!s || s.id !== e.pointerId) return
        const dx = e.clientX - s.x
        const dy = e.clientY - s.y
        if (!s.active) {
          if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.6) {
            s.active = true
            try {
              s.el.setPointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
            s.el.style.transition = 'none'
            s.el.classList.add('swiping')
          } else if (Math.abs(dy) > 12) {
            s = null
            return
          } else return
        }
        s.dx = Math.min(0, dx)
        s.el.style.transform = `translateX(${s.dx}px)`
        s.el.style.opacity = String(Math.max(0.35, 1 + s.dx / 400))
        s.el.setAttribute('data-swipe', Math.abs(s.dx) >= (c.current.threshold ?? 90) ? 'commit' : 'pending')
      },
      onPointerUp(e: PointerEvent) {
        if (!s || s.id !== e.pointerId) return
        const cur = s
        s = null
        if (!cur.active) return
        if (-cur.dx >= (c.current.threshold ?? 90)) {
          cur.el.style.transition = 'transform .15s ease, opacity .15s ease'
          cur.el.style.transform = 'translateX(-110%)'
          cur.el.style.opacity = '0'
          setTimeout(() => {
            reset(cur.el, false)
            c.current.onCommit()
          }, 120)
        } else reset(cur.el)
      },
      onPointerCancel() {
        if (s) reset(s.el)
        s = null
      },
    }
  }, [])
}

// ---------------------------------------------------------------- long-press drag reorder

export interface ReorderOptions {
  /** the handle that received the pointerdown (events are captured on it) */
  handle: HTMLElement
  /** the element that holds the items (children are the items) */
  container: HTMLElement
  index: number
  /** items that may not move (pinned) are skipped as targets; index range allowed for drops */
  min: number
  max: number
  onMove: (from: number, to: number) => void
  onEnd?: () => void
}

/**
 * Start a reorder drag from a handle. The dragged item follows the pointer, the others slide out of the way, and on release
 * `onMove(from, to)` is called once. Touch and pen need a long-press first (the caller decides); a mouse drag starts at once.
 */
export function startReorder(e: PointerEvent, o: ReorderOptions): void {
  const handle = o.handle
  const items = Array.from(o.container.children).filter((c) => (c as HTMLElement).dataset.reorder !== 'skip') as HTMLElement[]
  const item = items[o.index]
  if (!item) return
  const rects = items.map((i) => i.getBoundingClientRect())
  const startY = e.clientY
  const scroller = findScroller(o.container)
  let target = o.index
  let scrollDelta = 0
  let lastY = startY
  let raf = 0
  let done = false
  item.classList.add('dragging')
  item.style.zIndex = '5'
  item.style.transition = 'none'
  items.forEach((i) => {
    if (i !== item) i.style.transition = 'transform .14s ease'
  })
  try {
    handle.setPointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
  const apply = () => {
    const dy = lastY - startY + scrollDelta
    item.style.transform = `translateY(${dy}px)`
    const center = rects[o.index].top + rects[o.index].height / 2 + dy
    let t = o.index
    for (let i = 0; i < rects.length; i++) {
      const mid = rects[i].top + rects[i].height / 2
      if (i < o.index && center < mid) {
        t = i
        break
      }
      if (i > o.index && center > mid) t = i
    }
    t = Math.max(o.min, Math.min(o.max, t))
    target = t
    const h = rects[o.index].height
    items.forEach((el, i) => {
      if (el === item) return
      let shift = 0
      if (t < o.index && i >= t && i < o.index) shift = h
      if (t > o.index && i <= t && i > o.index) shift = -h
      el.style.transform = shift ? `translateY(${shift}px)` : ''
    })
  }
  const autoscroll = () => {
    if (done) return
    if (scroller) {
      const sr = scroller.getBoundingClientRect()
      const edge = 56
      let v = 0
      if (lastY < sr.top + edge) v = -((sr.top + edge - lastY) / edge) * 14
      else if (lastY > sr.bottom - edge) v = ((lastY - (sr.bottom - edge)) / edge) * 14
      if (v) {
        const before = scroller.scrollTop
        scroller.scrollTop += v
        scrollDelta += scroller.scrollTop - before
        apply()
      }
    }
    raf = requestAnimationFrame(autoscroll)
  }
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    lastY = ev.clientY
    apply()
  }
  const finish = (ev: PointerEvent | null, cancel: boolean) => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    handle.removeEventListener('pointercancel', cancelH)
    items.forEach((i) => {
      i.style.transform = ''
      i.style.transition = ''
      i.style.zIndex = ''
      i.classList.remove('dragging')
    })
    try {
      handle.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (!cancel && ev && target !== o.index) o.onMove(o.index, target)
    o.onEnd?.()
  }
  const up = (ev: PointerEvent) => finish(ev, false)
  const cancelH = (ev: PointerEvent) => finish(ev, true)
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
  handle.addEventListener('pointercancel', cancelH)
  raf = requestAnimationFrame(autoscroll)
  apply()
}

function findScroller(el: HTMLElement): HTMLElement | null {
  let p: HTMLElement | null = el
  while (p) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p
    p = p.parentElement
  }
  return null
}

/**
 * Handle gesture: a short tap calls `onTap`; a long-press (touch/pen) or a mouse drag starts the reorder.
 * Returns pointer handlers for the handle element.
 */
export function useHandle(getOptions: () => Omit<ReorderOptions, 'container' | 'handle'> & { container: () => HTMLElement | null }, onTap: (e: PointerEvent, el: HTMLElement) => void) {
  const g = useRef(getOptions)
  g.current = getOptions
  const tap = useRef(onTap)
  tap.current = onTap
  return useMemo(() => {
    let s: { id: number; x: number; y: number; started: boolean; moved: boolean; timer?: ReturnType<typeof setTimeout>; ev: PointerEvent; el: HTMLElement } | null = null
    const begin = () => {
      if (!s || s.started) return
      const o = g.current()
      const container = o.container()
      if (!container) return
      s.started = true
      startReorder(s.ev, { ...o, container, handle: s.el, onEnd: () => void (s = null) })
    }
    return {
      onPointerDown(e: PointerEvent) {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        s = { id: e.pointerId, x: e.clientX, y: e.clientY, started: false, moved: false, ev: e, el: e.currentTarget as HTMLElement }
        const me = s
        me.el.setPointerCapture?.(e.pointerId)
        me.timer = setTimeout(() => {
          if (s === me && !me.moved) begin()
        }, 260)
      },
      onPointerMove(e: PointerEvent) {
        if (!s || s.started || s.id !== e.pointerId) return
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > TAP_SLOP) {
          s.moved = true
          clearTimeout(s.timer)
          // a mouse drag starts straight away; a finger that moves first is just scrolling the handle: ignore
          if (e.pointerType === 'mouse') {
            s.ev = e
            begin()
          }
        }
      },
      onPointerUp(e: PointerEvent) {
        if (!s || s.started || s.id !== e.pointerId) return
        clearTimeout(s.timer)
        const moved = s.moved
        s = null
        if (!moved) tap.current(e, e.currentTarget as HTMLElement)
      },
      onPointerCancel() {
        if (s?.timer) clearTimeout(s.timer)
        if (s && !s.started) s = null
      },
      onContextMenu(e: Event) {
        e.preventDefault()
      },
    }
  }, [])
}
