// The workspace: scripts at their positions inside one transformed "world" layer.
//
// Touch model (documented in the README):
//   * one finger on empty workspace pans; two fingers pinch-zoom and pan; a quick two-finger tap is undo, three fingers redo;
//   * press a block and move: it comes off with every block under it (Scratch); press a hat: the whole script moves;
//   * a reporter (a wave, a pattern, o0, a variable) is picked up out of its slot the same way;
//   * places that take what you hold light up; the one under your finger glows; let go to snap;
//   * drop on the palette (or the bin that appears) to delete; drop on empty workspace to leave blocks loose.
// Pan and zoom write the transform straight to the DOM (no re-render).
import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks'
import { commit, metaNow, ui, useUi } from '../doc'
import { dragHooks, type Payload, type Target } from '../drag'
import { applyDrop } from '../drop'
import { ctx, useCatalogVersion, useRunner, useStore } from '../kit/ctx'
import { TAP_SLOP } from '../kit/gestures'
import { closeAllPopovers, toast } from '../kit/overlay'
import { attribute } from '../kit/problems'
import { fillPositions, scriptSize, type XY } from '../view'
import { Loose, Script, type Look } from './Blocks'

export interface Cam {
  x: number
  y: number
  k: number
}
const MIN_K = 0.2
const MAX_K = 2.2

type Gesture = { t: 'none' } | { t: 'pan'; id: number; x0: number; y0: number; cx: number; cy: number; moved: boolean } | { t: 'pinch'; d0: number; mid0: XY; cam0: Cam }

/** set by the workspace for the palette and the bars */
export const wsApi = {
  center: (): XY => ({ x: 200, y: 200 }),
  focus: (_id: string): void => {},
}

/** Commit a drop: the sketch and the view together (one undo step), or only the view when the code did not change. */
export function doDrop(p: Payload, t: Target, at: XY): void {
  if (p.t === 'new' && (t.t === 'trash' || t.t === 'none')) return
  const sk = ctx.store.sketch
  const r = applyDrop(sk, metaNow(sk), p, t, at, ctx.catalog)
  if (r.error) return void toast(r.error)
  if (r.sketch === sk) {
    if (Object.keys(r.view).length) ctx.store.setView(r.view)
  } else commit(r.sketch, r.view)
  if (r.select) ui.select(r.select)
  if (t.t === 'trash') toast('Deleted', { label: 'Undo', run: () => ctx.store.undo() })
}

export function Workspace() {
  useStore()
  useCatalogVersion()
  const runner = useRunner()
  const st = useUi()
  const sk = ctx.store.sketch
  const meta = metaNow(sk)
  const box = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const cam = useRef<Cam>(meta.cam ?? { x: 0, y: 0, k: 0.85 })
  const ges = useRef<Gesture>({ t: 'none' })
  const pointers = useRef(new Map<number, XY>())
  const camTimer = useRef<ReturnType<typeof setTimeout>>()

  // statements without a position (added in the code view or elsewhere) get one
  useEffect(() => {
    const filled = fillPositions(sk, meta, ctx.catalog)
    if (filled) ctx.store.setView({ pos: filled.pos })
  }, [sk])

  // ------------------------------------------------------------ camera
  const applyCam = () => {
    const c = cam.current
    if (world.current) world.current.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.k})`
    clearTimeout(camTimer.current)
    camTimer.current = setTimeout(() => {
      const m = metaNow()
      const v = { x: Math.round(c.x), y: Math.round(c.y), k: +c.k.toFixed(3) }
      if (!m.cam || m.cam.x !== v.x || m.cam.y !== v.y || m.cam.k !== v.k) ctx.store.setView({ cam: v })
    }, 700)
  }
  const toWorld = (cx: number, cy: number): XY => {
    const r = box.current!.getBoundingClientRect()
    const c = cam.current
    return { x: (cx - r.left - c.x) / c.k, y: (cy - r.top - c.y) / c.k }
  }
  const fit = () => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const s = ctx.store.sketch
    const m = metaNow(s)
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const st of s.stmts) {
      const p = m.pos[st.id]
      if (!p) continue
      const z = scriptSize(st, ctx.catalog, m.collapsed?.includes(st.id))
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x + z.w)
      y1 = Math.max(y1, p.y + z.h)
    }
    if (!isFinite(x0) || r.width < 10) return
    // the palette covers the left side in landscape: fit into what is visible
    const pal = document.querySelector('.palette')?.getBoundingClientRect()
    const left = pal && pal.right > r.left && pal.right < r.right && pal.height > r.height * 0.6 ? pal.right - r.left : 0
    const w = r.width - left
    const k = Math.max(MIN_K, Math.min(1, (w - 48) / (x1 - x0), (r.height - 48) / (y1 - y0)))
    cam.current = { k, x: left + Math.max(24, (w - (x1 - x0) * k) / 2) - x0 * k, y: 24 - y0 * k }
    applyCam()
  }
  useLayoutEffect(() => {
    dragHooks.toWorld = toWorld
    dragHooks.zoom = () => cam.current.k
    dragHooks.drop = doDrop
    wsApi.center = () => {
      const r = box.current!.getBoundingClientRect()
      return toWorld(r.left + r.width * 0.55 - 120, r.top + r.height * 0.4 - 60)
    }
    wsApi.focus = (id: string) => {
      const p = metaNow().pos[id]
      if (!p || !box.current) return
      const r = box.current.getBoundingClientRect()
      const k = Math.max(cam.current.k, 0.9)
      cam.current = { k, x: r.width * 0.45 - p.x * k, y: r.height * 0.3 - p.y * k }
      applyCam()
    }
    applyCam()
  }, [])
  // a new sketch: its own camera, or fit
  useLayoutEffect(() => {
    const c = metaNow().cam
    if (c) {
      cam.current = { ...c }
      applyCam()
    } else requestAnimationFrame(fit)
  }, [sk.id])
  useEffect(() => {
    if (st.fit) fit()
  }, [st.fit])

  // ------------------------------------------------------------ pan / pinch on empty workspace
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const cur = ges.current
    if (pointers.current.size === 2 && (cur.t === 'pan' || cur.t === 'none')) {
      const [a, b] = [...pointers.current.values()]
      ges.current = { t: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam0: { ...cam.current } }
      box.current!.setPointerCapture?.(e.pointerId)
      return
    }
    if (cur.t !== 'none' || pointers.current.size > 2) return
    box.current!.setPointerCapture?.(e.pointerId)
    ges.current = { t: 'pan', id: e.pointerId, x0: e.clientX, y0: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false }
  }
  const onMove = (e: PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const gs = ges.current
    if (gs.t === 'pan') {
      if (gs.id !== e.pointerId) return
      const dx = e.clientX - gs.x0
      const dy = e.clientY - gs.y0
      if (!gs.moved && Math.hypot(dx, dy) < TAP_SLOP) return
      gs.moved = true
      cam.current = { ...cam.current, x: gs.cx + dx, y: gs.cy + dy }
      applyCam()
    } else if (gs.t === 'pinch') {
      if (pointers.current.size < 2) return
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const r = box.current!.getBoundingClientRect()
      const k = Math.max(MIN_K, Math.min(MAX_K, gs.cam0.k * (d / Math.max(1, gs.d0))))
      const wx = (gs.mid0.x - r.left - gs.cam0.x) / gs.cam0.k
      const wy = (gs.mid0.y - r.top - gs.cam0.y) / gs.cam0.k
      cam.current = { k, x: mid.x - r.left - wx * k, y: mid.y - r.top - wy * k }
      applyCam()
    }
  }
  const onUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const gs = ges.current
    if (gs.t === 'pan') {
      if (gs.id !== e.pointerId) return
      ges.current = { t: 'none' }
      if (!gs.moved && e.type === 'pointerup') {
        closeAllPopovers()
        ui.select(undefined)
      }
    } else if (gs.t === 'pinch' && pointers.current.size === 0) ges.current = { t: 'none' }
  }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const r = box.current!.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      const c = cam.current
      const k = Math.max(MIN_K, Math.min(MAX_K, c.k * Math.exp(-e.deltaY * 0.01)))
      const wx = (e.clientX - r.left - c.x) / c.k
      const wy = (e.clientY - r.top - c.y) / c.k
      cam.current = { k, x: e.clientX - r.left - wx * k, y: e.clientY - r.top - wy * k }
    } else cam.current = { ...cam.current, x: cam.current.x - e.deltaX, y: cam.current.y - e.deltaY }
    applyCam()
  }
  useEffect(() => {
    const el = box.current!
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ------------------------------------------------------------ what to draw
  const errors = useMemo(() => {
    const m: Record<string, string> = {}
    for (const e of runner.currentErrors()) {
      const id = attribute(sk, e)
      if (id) m[id] = e.message
    }
    return m
  }, [runner.currentErrors().length, sk])
  // an output written twice: the earlier scripts are shadowed
  const shadowed = useMemo(() => {
    const s = new Set<string>()
    const last = new Map<string, string>()
    for (const x of sk.stmts) {
      if (x.k !== 'chain' || x.chain.out === null) continue
      const o = x.chain.out ?? 'o0'
      const prev = last.get(o)
      if (prev) s.add(prev)
      last.set(o, x.id)
    }
    return s
  }, [sk])
  const look: Look = { sel: st.sel, shadowed, errors }
  const collapsed = new Set(meta.collapsed ?? [])

  return (
    <div
      class={`workspace ${st.drag ? `dragging d-${st.drag}` : ''}`}
      ref={box}
      data-testid="workspace"
      onPointerDown={onDown as unknown as (e: Event) => void}
      onPointerMove={onMove as unknown as (e: Event) => void}
      onPointerUp={onUp as unknown as (e: Event) => void}
      onPointerCancel={onUp as unknown as (e: Event) => void}
    >
      <div class="world" ref={world}>
        {sk.stmts.map((s) => {
          const p = meta.pos[s.id]
          if (!p) return null
          return <Script key={s.id} s={s} x={p.x} y={p.y} collapsed={collapsed.has(s.id)} look={look} />
        })}
        {(meta.loose ?? []).map((l) => (
          <Loose key={l.id} l={l} />
        ))}
      </div>
      {sk.stmts.length === 0 && <div class="ws-empty">Drag a hat block (Sources) out of the palette to start a script, or roll the dice.</div>}
      {st.drag && (
        <div class="trash" data-drop="trash" data-testid="trash" aria-label="Drop here to delete">
          🗑
        </div>
      )}
    </div>
  )
}
