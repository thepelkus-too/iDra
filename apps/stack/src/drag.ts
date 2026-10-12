// Dragging an operator chip from the tray into the stack. While the finger (or Pencil, or mouse) moves, thin insertion
// gaps open between rows (the target gap highlights and the rows below it part), texture parameters light up for a drop,
// and the stack auto-scrolls near its edges. Pointer Events only; the DOM is read, the sketch is changed once, on release.
import type { DropTarget } from './tray'

const GAP = 18
const EDGE = 56

export interface ChipDrag {
  fn: string
  generator: boolean
  /** the drop: `target` is undefined when the chip is released where nothing takes it */
  onDrop(target: DropTarget | undefined): void
}

interface Found {
  target: DropTarget
  /** where to draw the insertion line (page coordinates), or the element to outline */
  line?: { x: number; y: number; w: number }
  outline?: HTMLElement
  /** rows that part to open the gap */
  part?: HTMLElement[]
}

const shifted = new Map<HTMLElement, number>()
const rectOf = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  const s = shifted.get(el) ?? 0
  return { left: r.left, right: r.right, width: r.width, top: r.top - s, bottom: r.bottom - s, height: r.height }
}

/** the call rows of a chain's row container: generator first, then the modifiers (not `.out`, not peeks) */
const callRows = (rows: HTMLElement) => Array.from(rows.querySelectorAll<HTMLElement>(':scope > .crow[data-call]'))

function chainAt(list: HTMLElement, x: number, y: number): HTMLElement | undefined {
  const chains = Array.from(list.querySelectorAll<HTMLElement>('.chain[data-chain]'))
  let best: HTMLElement | undefined
  let bestDepth = -1
  for (const c of chains) {
    const r = rectOf(c)
    if (x < r.left || x > r.right || y < r.top || y > r.bottom + GAP) continue
    const d = Number(c.dataset.depth ?? 0)
    if (d > bestDepth) {
      best = c
      bestDepth = d
    }
  }
  if (best) return best
  // between statements: the nearest top-level chain above or below
  let dist = Infinity
  for (const c of chains) {
    if (c.dataset.depth !== '0') continue
    const r = rectOf(c)
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
    if (d < dist) {
      dist = d
      best = c
    }
  }
  return dist < 120 ? best : undefined
}

/** What is under (x, y) for this chip. Exported for the e2e run (`__stack.dropTargetAt`). */
export function findTarget(x: number, y: number, generator: boolean): Found | undefined {
  const list = document.querySelector<HTMLElement>('.stack-list')
  if (!list) return undefined
  const hit = document.elementFromPoint(x, y) as HTMLElement | null
  if (hit?.closest('[data-tray]')) return undefined
  const slot = hit?.closest<HTMLElement>('[data-tex-call]')
  const inPocketRows = !!hit?.closest('.pocket .rows')
  if (slot && (generator || !inPocketRows)) {
    const box = slot.querySelector<HTMLElement>('.pocket,.tok') ?? slot
    return { target: { kind: 'tex', callId: slot.dataset.texCall!, i: Number(slot.dataset.texI) }, outline: box }
  }
  if (generator) {
    // a new chain statement between two statements
    const stmts = Array.from(list.querySelectorAll<HTMLElement>(':scope > .stmt'))
    if (!stmts.length) {
      const r = rectOf(list)
      return { target: { kind: 'stmt', index: 0 }, line: { x: r.left, y: r.top + 4, w: r.width } }
    }
    let index = stmts.length
    for (let i = 0; i < stmts.length; i++) {
      const r = rectOf(stmts[i])
      if (y < r.top + r.height / 2) {
        index = i
        break
      }
    }
    const lr = rectOf(list)
    const ly = index < stmts.length ? rectOf(stmts[index]).top - 4 : rectOf(stmts[stmts.length - 1]).bottom + 4
    return { target: { kind: 'stmt', index }, line: { x: lr.left, y: ly, w: lr.width }, part: stmts.slice(index) }
  }
  const chain = chainAt(list, x, y)
  if (!chain) return undefined
  const rows = chain.querySelector<HTMLElement>(':scope > .rows')
  if (!rows) return undefined
  const crows = callRows(rows)
  if (!crows.length) return undefined
  let k = 0
  for (const r of crows) if (rectOf(r).top + rectOf(r).height / 2 < y) k++
  k = Math.max(1, Math.min(crows.length, k))
  const above = rectOf(crows[k - 1])
  const rr = rectOf(rows)
  // everything in the container after the row above the gap moves down (later rows, .out, an open peek)
  const kids = Array.from(rows.children) as HTMLElement[]
  const part = kids.slice(kids.indexOf(crows[k - 1]) + 1)
  return { target: { kind: 'gap', chainId: chain.dataset.chain!, index: k - 1 }, line: { x: rr.left + 12, y: above.bottom + GAP / 2, w: rr.width - 12 }, part }
}

const sameTarget = (a?: DropTarget, b?: DropTarget) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Start dragging `d` from the pointerdown/move `e` on `chipEl` (which keeps the pointer capture). Returns a function that
 * cancels the drag.
 */
export function startChipDrag(e: PointerEvent, chipEl: HTMLElement, d: ChipDrag): () => void {
  const ghost = document.createElement('div')
  ghost.className = 'drag-ghost'
  ghost.dataset.testid = 'drag-ghost'
  ghost.textContent = d.generator ? `${d.fn}()` : `.${d.fn}()`
  const line = document.createElement('div')
  line.className = 'drop-line'
  line.dataset.testid = 'drop-line'
  document.body.append(ghost, line)
  document.documentElement.classList.add('chip-dragging')
  const scroller = document.querySelector<HTMLElement>('[data-testid=stack-scroll]')
  let x = e.clientX
  let y = e.clientY
  let cur: Found | undefined
  let outlined: HTMLElement | undefined
  let parted: HTMLElement[] = []
  let raf = 0
  let done = false

  const unpart = () => {
    for (const el of parted) {
      el.style.transform = ''
      shifted.delete(el)
    }
    parted = []
  }
  const paint = () => {
    ghost.style.transform = `translate(${x + 14}px, ${y - 30}px)`
    const f = findTarget(x, y, d.generator)
    if (!sameTarget(f?.target, cur?.target)) {
      unpart()
      outlined?.classList.remove('drop-on')
      outlined = undefined
      if (f?.part) {
        for (const el of f.part) {
          el.style.transform = `translateY(${GAP}px)`
          shifted.set(el, GAP)
        }
        parted = f.part
      }
      if (f?.outline) {
        f.outline.classList.add('drop-on')
        outlined = f.outline
      }
    }
    cur = f
    if (f?.line) {
      line.style.display = 'block'
      line.style.transform = `translate(${f.line.x}px, ${f.line.y - 2}px)`
      line.style.width = `${Math.max(40, f.line.w)}px`
    } else line.style.display = 'none'
    ghost.classList.toggle('nowhere', !f)
  }
  const tick = () => {
    if (done) return
    if (scroller) {
      const r = scroller.getBoundingClientRect()
      let v = 0
      if (x >= r.left && x <= r.right) {
        if (y < r.top + EDGE) v = -((r.top + EDGE - y) / EDGE) * 14
        else if (y > r.bottom - EDGE && y < r.bottom + EDGE) v = ((y - (r.bottom - EDGE)) / EDGE) * 14
      }
      if (v) {
        scroller.scrollTop += v
        paint()
      }
    }
    raf = requestAnimationFrame(tick)
  }
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    x = ev.clientX
    y = ev.clientY
    paint()
  }
  const finish = (drop: boolean) => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    chipEl.removeEventListener('pointermove', move)
    chipEl.removeEventListener('pointerup', up)
    chipEl.removeEventListener('pointercancel', cancel)
    try {
      chipEl.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    unpart()
    outlined?.classList.remove('drop-on')
    ghost.remove()
    line.remove()
    document.documentElement.classList.remove('chip-dragging')
    if (drop) d.onDrop(cur?.target)
  }
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    x = ev.clientX
    y = ev.clientY
    cur = findTarget(x, y, d.generator)
    finish(true)
  }
  const cancel = () => finish(false)
  try {
    chipEl.setPointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
  chipEl.addEventListener('pointermove', move)
  chipEl.addEventListener('pointerup', up)
  chipEl.addEventListener('pointercancel', cancel)
  paint()
  raf = requestAnimationFrame(tick)
  return cancel
}
