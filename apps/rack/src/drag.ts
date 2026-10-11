// Dragging a mod tile onto a knob, or a lane chip onto a patch jack. A press that does not move is a tap. While something is
// held every target that takes it lights up (`body.dragging-<kind>`), the one under the finger glows (`.hot`).
import { TAP_SLOP } from '@hydra-ipad/kit'
import { ui } from './doc'

export type Payload = { t: 'mod'; kind: string; bin?: number } | { t: 'lane'; name: string }

/** Which drop targets take which payloads. */
const TAKES: Record<Payload['t'], string> = { mod: 'knob', lane: 'jack' }

export function targetAt(x: number, y: number, p: Payload): HTMLElement | undefined {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  const t = el?.closest<HTMLElement>(`[data-drop="${TAKES[p.t]}"]`)
  return t ?? undefined
}

export const dragHooks = {
  onDrop: (_p: Payload, _target: HTMLElement): void => {},
}

/** Start on pointerdown: tap → onTap, drag → ghost follows the finger, release over a target → dragHooks.onDrop. */
export function pressToDrag(e: PointerEvent, p: Payload, label: string, onTap?: () => void): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const src = e.currentTarget as HTMLElement
  const id = e.pointerId
  const x0 = e.clientX
  const y0 = e.clientY
  let ghost: HTMLElement | undefined
  let hot: HTMLElement | undefined
  src.setPointerCapture?.(id)
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < TAP_SLOP) return
      ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      ghost.textContent = label
      document.body.appendChild(ghost)
      document.body.classList.add(`dragging-${p.t}`)
      ui.set({ drag: p.t })
    }
    ghost.style.transform = `translate(${ev.clientX - 30}px, ${ev.clientY - 56}px)`
    const t = targetAt(ev.clientX, ev.clientY, p)
    if (t !== hot) {
      hot?.classList.remove('hot')
      t?.classList.add('hot')
      hot = t
    }
  }
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    src.removeEventListener('pointermove', move)
    src.removeEventListener('pointerup', end)
    src.removeEventListener('pointercancel', end)
    hot?.classList.remove('hot')
    if (!ghost) {
      if (ev.type === 'pointerup') onTap?.()
      return
    }
    ghost.remove()
    document.body.classList.remove(`dragging-${p.t}`)
    ui.set({ drag: undefined })
    const t = ev.type === 'pointerup' ? targetAt(ev.clientX, ev.clientY, p) : undefined
    if (t) dragHooks.onDrop(p, t)
  }
  src.addEventListener('pointermove', move)
  src.addEventListener('pointerup', end)
  src.addEventListener('pointercancel', end)
}
