// Picking blocks up and dropping them, with one finger, a Pencil or a mouse. A press that moves past a few points becomes a
// drag: a copy of the block follows the finger, every place that would take it lights up (by what it is), and the place
// under the finger is "hot". A press that does not move is a tap.
import type { Call, Value } from '@hydra-ipad/core'
import { ui, type DragCat } from './doc'
import { TAP_SLOP } from '@hydra-ipad/kit'
import type { ArgRef } from './kit/model'
import type { MathNode, MathPath } from './math'
import type { XY } from './view'

export type PItem =
  | { t: 'fn'; fn: string }
  | { t: 'value'; value: Value; label: string }
  | { t: 'math'; node: MathNode; label: string }
  | { t: 'setup'; what: 'bpm' | 'speed' | 'cam' | 'image' | 'video' | 'screen' | 'render' | 'raw' | 'comment' | 'var-num' | 'var-tex' }
  | { t: 'cap'; out: 'o0' | 'o1' | 'o2' | 'o3' }

export type Payload =
  | { t: 'stack'; chainId: string; from: number; calls: Call[] }
  | { t: 'script'; stmtId: string }
  | { t: 'nested'; from: ArgRef }
  | { t: 'loose'; id: string }
  | { t: 'value'; from: ArgRef; value: Value }
  | { t: 'new'; item: PItem }

export type Target =
  | { t: 'after'; chainId: string; index: number; top: boolean; stmtId?: string }
  | { t: 'socket'; ref: ArgRef }
  | { t: 'slot'; ref: ArgRef }
  | { t: 'math'; ref: ArgRef; path: MathPath }
  | { t: 'trash' }
  | { t: 'empty' }
  /** outside the workspace (bars, panels): nothing happens */
  | { t: 'none' }

export const parseRef = (s: string): ArgRef => (s.startsWith('d:') ? { def: s.slice(2) } : { call: s.slice(0, s.lastIndexOf(':')), i: Number(s.slice(s.lastIndexOf(':') + 1)) })
export const refAttr = (r: ArgRef): string => ('def' in r ? `d:${r.def}` : `${r.call}:${r.i}`)

/** What kind of thing a payload is, for lighting up the places that take it. */
export function catOf(p: Payload): DragCat {
  switch (p.t) {
    case 'stack':
    case 'loose': return 'stack'
    case 'script': return 'script'
    case 'nested': return 'tex'
    case 'value': return p.value.k === 'ref' || p.value.k === 'tex' || (p.value.k === 'var' && texVar(p.value.name)) ? 'tex' : 'value'
    case 'new': {
      const it = p.item
      if (it.t === 'fn') return isGen(it.fn) ? 'script' : 'stack'
      if (it.t === 'math') return 'math'
      if (it.t === 'value') return it.value.k === 'ref' || (it.value.k === 'var' && texVar(it.value.name)) ? 'tex' : 'value'
      if (it.t === 'cap') return 'cap'
      return 'setup'
    }
  }
}

/** set by the app: is this function a generator; is this variable a texture */
export const kinds = { isGen: (_fn: string) => false, texVar: (_name: string) => false }
const isGen = (fn: string) => kinds.isGen(fn)
const texVar = (name: string) => kinds.texVar(name)

/** The drop target under a screen point. With `cat`, a place that does not take that kind of thing is skipped for the one
 *  around it (a stack held over a number slot snaps under the block the slot is in). */
export function targetAt(x: number, y: number, cat?: DragCat): Target {
  for (const el of document.elementsFromPoint(x, y)) {
    let d = (el as HTMLElement).closest?.<HTMLElement>('[data-drop]')
    while (d) {
      const t = readTarget(d)
      if (!cat || takes(cat, t)) return t
      d = d.parentElement?.closest<HTMLElement>('[data-drop]') ?? null
    }
    if ((el as HTMLElement).closest?.('[data-testid=workspace]')) return { t: 'empty' }
  }
  return { t: 'none' }
}

/** The element that is the target under a point (for the highlight). */
export function targetElAt(x: number, y: number, cat: DragCat): HTMLElement | undefined {
  for (const el of document.elementsFromPoint(x, y)) {
    let d = (el as HTMLElement).closest?.<HTMLElement>('[data-drop]')
    while (d) {
      if (takes(cat, readTarget(d))) return d
      d = d.parentElement?.closest<HTMLElement>('[data-drop]') ?? null
    }
    if ((el as HTMLElement).closest?.('[data-testid=workspace]')) return undefined
  }
  return undefined
}

function readTarget(d: HTMLElement): Target {
  switch (d.dataset.drop) {
    case 'after': return { t: 'after', chainId: d.dataset.chain!, index: Number(d.dataset.index), top: d.dataset.top === '1', stmtId: d.dataset.stmt }
    case 'socket': return { t: 'socket', ref: parseRef(d.dataset.ref!) }
    case 'slot': return { t: 'slot', ref: parseRef(d.dataset.ref!) }
    case 'math': return { t: 'math', ref: parseRef(d.dataset.ref!), path: (d.dataset.path || '').split('').filter(Boolean) as MathPath }
    case 'trash': return { t: 'trash' }
    default: return { t: 'empty' }
  }
}

/** Does this target take this payload at all (for the hot highlight; the drop itself still checks)? */
export function takes(cat: DragCat, t: Target): boolean {
  switch (t.t) {
    case 'after': return cat === 'stack' || cat === 'cap'
    case 'socket': return cat === 'script' || cat === 'tex'
    case 'slot': return cat === 'value' || cat === 'math'
    case 'math': return cat === 'math' || cat === 'value'
    case 'trash': return true
    case 'empty': return true
    case 'none': return false
  }
}

export interface DragHooks {
  toWorld: (x: number, y: number) => XY
  drop: (p: Payload, t: Target, at: XY) => void
  /** current zoom, so the ghost matches the block's size */
  zoom: () => number
}
export const dragHooks: DragHooks = { toWorld: (x, y) => ({ x, y }), drop: () => {}, zoom: () => 1 }

let active = false
export const isDragging = (): boolean => active

/**
 * Wire a press on `el`: a tap calls `onTap`, a drag picks up `payload()` (computed when the drag starts).
 * Returns the pointerdown handler.
 */
export function pressToDrag(payload: () => Payload | undefined, onTap?: (e: PointerEvent) => void) {
  return (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (active) return
    // text fields keep their own touches (selecting text, moving the caret)
    if ((e.target as HTMLElement).closest?.('input, textarea, select, .cm-editor, .numslider')) return
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    const x0 = e.clientX
    const y0 = e.clientY
    const id = e.pointerId
    let ghost: HTMLElement | undefined
    let p: Payload | undefined
    let hot: Element | undefined
    let grab = { dx: 0, dy: 0 }
    let k = 1
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < TAP_SLOP) return
        p = payload()
        if (!p) return cleanup()
        active = true
        const r = el.getBoundingClientRect()
        k = el.closest('.world') ? dragHooks.zoom() : 1
        grab = { dx: x0 - r.left, dy: y0 - r.top }
        ghost = el.cloneNode(true) as HTMLElement
        ghost.classList.add('ghost')
        ghost.removeAttribute('data-testid')
        ghost.querySelectorAll('[data-testid],[data-drop]').forEach((n) => (n.removeAttribute('data-testid'), n.removeAttribute('data-drop')))
        Object.assign(ghost.style, { position: 'fixed', left: '0', top: '0', width: `${r.width / k}px`, height: `${r.height / k}px`, margin: '0', pointerEvents: 'none', zIndex: '80', transformOrigin: '0 0' })
        document.body.appendChild(ghost)
        el.classList.add('lifted')
        ui.set({ drag: catOf(p) })
      }
      ghost.style.transform = `translate(${ev.clientX - grab.dx}px,${ev.clientY - grab.dy}px) scale(${k})`
      const next = targetElAt(ev.clientX, ev.clientY, catOf(p!))
      if (next !== hot) {
        hot?.classList.remove('hot')
        next?.classList.add('hot')
        hot = next ?? undefined
      }
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      const dragged = !!ghost
      const pl = p
      cleanup()
      if (!dragged) {
        if (ev.type === 'pointerup' && onTap) onTap(ev)
        return
      }
      if (ev.type !== 'pointerup' || !pl) return
      const t = targetAt(ev.clientX, ev.clientY, catOf(pl))
      // the block's top-left lands where the ghost's top-left is
      const at = dragHooks.toWorld(ev.clientX - grab.dx, ev.clientY - grab.dy)
      dragHooks.drop(pl, t, { x: Math.round(at.x), y: Math.round(at.y) })
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      ghost?.remove()
      el.classList.remove('lifted')
      hot?.classList.remove('hot')
      if (active) ui.set({ drag: undefined })
      active = false
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
}
