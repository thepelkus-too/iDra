// The canvas: HTML node cards and SVG cables inside one transformed "world" layer.
//
// Touch model (documented in the README):
//   * one finger on empty canvas pans (or draws a selection rectangle in lasso mode; Apple Pencil always lassoes);
//   * two fingers pinch-zoom and pan; a quick two-finger tap is undo, three fingers redo (handled app-wide);
//   * hold on empty canvas to add a node there;
//   * drag a node by any part that is not a control; drag from a port to make a cable; drop on empty canvas for a menu of
//     nodes that fit; drag a cable's end off its input to move or remove it;
//   * tap a cable to select it, then its ✕ chip removes it.
// Pan and zoom write the transform straight to the DOM (no re-render) so a large graph stays smooth.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { applyGraph, compileOf, graphOf, metaNow, posOf, tryApply, ui, useUi } from '../doc'
import { ctx, useCatalogVersion, useRunner, useStore } from '../kit/ctx'
import { LONG_MS, TAP_SLOP } from '../kit/gestures'
import { closeAllPopovers, toast } from '../kit/overlay'
import { attribute } from '../kit/problems'
import { nodeById, type GEdge, type GNode, type Graph, type Port } from '../model'
import { accepts, compatibleFor, connect, disconnect } from '../ops'
import { sizeOf, type XY } from '../view'
import { cablePath, midpoint, portPos } from './geom'
import { NodeCard, Terminal } from './Nodes'
import { canvasApi, openAddMenu, placeItem, type DropTarget, type Item } from './Palette'

export interface Cam {
  x: number
  y: number
  k: number
}
const MIN_K = 0.15
const MAX_K = 2.5
const edgeKey = (e: GEdge) => `${e.from}|${e.to}|${e.port}`
const sameEdge = (a?: GEdge, b?: GEdge) => !!a && !!b && a.from === b.from && a.to === b.to && a.port === b.port

type Gesture =
  | { t: 'none' }
  | { t: 'pan'; id: number; x0: number; y0: number; cx: number; cy: number; moved: boolean; long?: ReturnType<typeof setTimeout> }
  | { t: 'pinch'; d0: number; k0: number; mid0: XY; cam0: Cam }
  | { t: 'lasso'; id: number; x0: number; y0: number; x1: number; y1: number }
  | { t: 'node'; id: number; node: string; x0: number; y0: number; moved: boolean; start: Record<string, XY> }
  | { t: 'wire'; id: number; from: string; fromPort: Port | 'out'; dir: 'out' | 'in'; lifted?: GEdge; x: number; y: number; moved: boolean }
  | { t: 'cable'; id: number; edge: GEdge; x0: number; y0: number }
  | { t: 'item'; id: number; item: Item; x: number; y: number }

/** Groups shown collapsed: member → group (display only; the code is flat). */
function collapsedMap(): Map<string, { id: string; ids: string[]; name?: string }> {
  const m = new Map<string, { id: string; ids: string[]; name?: string }>()
  for (const gr of metaNow().groups ?? []) if (!gr.open) for (const id of gr.ids) m.set(id, gr)
  return m
}

export function Canvas() {
  useStore()
  useCatalogVersion()
  const runner = useRunner()
  const st = useUi()
  const sk = ctx.store.sketch
  const g = graphOf(sk)
  const comp = compileOf(sk)
  const meta = metaNow(sk)
  const box = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const tempPath = useRef<SVGPathElement>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const lassoEl = useRef<HTMLDivElement>(null)
  const cam = useRef<Cam>(meta.cam ?? { x: 24, y: 24, k: 0.8 })
  const ges = useRef<Gesture>({ t: 'none' })
  const pointers = useRef(new Map<number, XY>())
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState<Record<string, XY>>({})
  const [wiring, setWiring] = useState<{ from: string; fromPort: Port | 'out'; dir: 'out' | 'in' } | undefined>()
  const camTimer = useRef<ReturnType<typeof setTimeout>>()

  // ------------------------------------------------------------ camera
  const applyCam = () => {
    const c = cam.current
    if (world.current) world.current.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.k})`
    if (box.current) box.current.style.setProperty('--k', String(c.k))
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
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const n of graphOf().nodes) {
      const p = posOf(n.id)
      const s = sizeOf(n, ctx.catalog)
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x + s.w)
      y1 = Math.max(y1, p.y + s.h)
    }
    if (!isFinite(x0) || r.width < 10) return
    const k = Math.max(MIN_K, Math.min(1, (r.width - 48) / (x1 - x0), (r.height - 48) / (y1 - y0)))
    cam.current = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: Math.max(16, (r.height - (y1 - y0) * k) / 2) - y0 * k }
    applyCam()
  }
  useLayoutEffect(() => {
    canvasApi.toWorld = toWorld
    canvasApi.center = () => {
      const r = box.current!.getBoundingClientRect()
      return toWorld(r.left + r.width / 2 - 100, r.top + r.height / 2 - 60)
    }
    canvasApi.focus = (id: string) => {
      const n = nodeById(graphOf(), id)
      if (!n || !box.current) return
      const r = box.current.getBoundingClientRect()
      const p = posOf(id)
      const sz = sizeOf(n, ctx.catalog)
      const k = Math.max(cam.current.k, 0.9)
      cam.current = { k, x: r.width * 0.4 - (p.x + sz.w / 2) * k, y: r.height * 0.4 - (p.y + sz.h / 2) * k }
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

  // ------------------------------------------------------------ what to draw
  const groups = collapsedMap()
  const shown = g.nodes.filter((n) => !groups.has(n.id))
  const pos = (id: string): XY => drag[id] ?? posOf(id)
  const errNodes = useMemo(() => {
    const m: Record<string, string> = {}
    for (const e of runner.currentErrors()) {
      const id = attribute(sk, e)
      if (id) m[id] = e.message
    }
    return m
  }, [runner.currentErrors().length, sk])
  // an output written twice: the earlier writers are shadowed
  const shadowed = useMemo(() => {
    const s = new Set<string>()
    const last = new Map<string, string>()
    for (const st of sk.stmts) {
      if (st.k !== 'chain' || st.chain.out === null) continue
      const o = st.chain.out ?? 'o0'
      const end = st.chain.mods.length ? st.chain.mods[st.chain.mods.length - 1].id : st.chain.gen.id
      const prev = last.get(o)
      if (prev) s.add(prev)
      last.set(o, end)
    }
    return s
  }, [sk])
  const targetsFor = useMemo(() => {
    const t: Record<string, string> = {}
    if (!wiring) return t
    for (const n of g.nodes) {
      const ok: string[] = []
      if (wiring.dir === 'out') {
        const ports: Port[] = n.kind === 'call' ? ['in', ...Array.from({ length: Math.max(n.call!.args.length, ctx.catalog.inputs(n.call!.fn).length) }, (_, i) => i)] : n.kind === 'out' || n.kind === 'def' ? ['in'] : []
        for (const p of ports) if (!accepts(g, wiring.from, n.id, p, ctx.catalog)) ok.push(String(p))
      } else if (!accepts(g, n.id, wiring.from, wiring.fromPort as Port, ctx.catalog)) ok.push('out')
      if (ok.length) t[n.id] = ok.join(',')
    }
    return t
  }, [wiring, g])

  // ------------------------------------------------------------ drops
  /** What is under a screen point: a port, a node, a cable or empty canvas. */
  const hit = (cx: number, cy: number): DropTarget & { el?: Element } => {
    const at = toWorld(cx, cy)
    const els = document.elementsFromPoint(cx, cy)
    for (const el of els) {
      if (!box.current?.contains(el)) {
        if (el.closest('.palette, .topbar, .selbar, .pip')) return { t: 'empty', at, el }
        continue
      }
      const port = el.closest<HTMLElement>('.port')
      if (port) {
        const p = port.dataset.p!
        return { t: 'port', id: port.dataset.node!, port: p === 'in' || p === 'out' ? (p as Port) : Number(p), at, el: port }
      }
      const edge = el.closest<SVGElement>('[data-edge]')
      if (edge) {
        const [from, to, p] = edge.dataset.edge!.split('|')
        return { t: 'edge', edge: { from, to, port: p === 'in' ? 'in' : Number(p) }, at }
      }
      const node = el.closest<HTMLElement>('.node')
      if (node?.dataset.node) return { t: 'node', id: node.dataset.node, at }
    }
    return { t: 'empty', at }
  }

  const finishWire = (gs: Extract<Gesture, { t: 'wire' }>, cx: number, cy: number) => {
    const base: Graph = gs.lifted ? disconnect(g, gs.lifted) : g
    const h = hit(cx, cy)
    if (gs.dir === 'out') {
      let to: string | undefined
      let port: Port | undefined
      if (h.t === 'port' && h.port !== ('out' as Port)) [to, port] = [h.id, h.port]
      else if (h.t === 'port' || h.t === 'node') {
        // dropped on a node (or its output): the first input that takes it
        const id = h.id
        const ok = targetsFor[id]?.split(',')[0]
        if (ok) [to, port] = [id, ok === 'in' ? 'in' : Number(ok)]
        else if (id !== gs.from) {
          const why = accepts(g, gs.from, id, 'in', ctx.catalog) ?? 'that node has no free input for this'
          ui.reject({ from: gs.from, to: id, port: 'in' })
          return void toast(why)
        }
      }
      if (to !== undefined && port !== undefined) {
        if (gs.lifted && gs.lifted.to === to && gs.lifted.port === port) return
        const r = connect(base, gs.from, to, port, ctx.catalog)
        tryApply(r, {}, { from: gs.from, to, port })
        return
      }
      if (h.t === 'empty') {
        if (gs.lifted) return void tryApply(base)
        const r = box.current!.getBoundingClientRect()
        openAddMenu({ x: Math.min(cx, r.right - 330), y: cy }, compatibleFor(g, gs.from, 'out', ctx.catalog), { t: 'from', id: gs.from, at: h.at })
      }
      return
    }
    // from an input backwards: drop on an output port or a node
    if ((h.t === 'port' && h.port === ('out' as Port)) || h.t === 'node') {
      const r = connect(base, h.id, gs.from, gs.fromPort as Port, ctx.catalog)
      tryApply(r, {}, { from: h.id, to: gs.from, port: gs.fromPort as Port })
      return
    }
    if (h.t === 'empty') {
      const r = box.current!.getBoundingClientRect()
      openAddMenu({ x: Math.min(cx, r.right - 330), y: cy }, compatibleFor(g, gs.from, gs.fromPort, ctx.catalog), { t: 'port', id: gs.from, port: gs.fromPort as Port, at: { x: h.at.x - 260, y: h.at.y } })
    }
  }

  /** Start dragging a palette item (called by the palette when a finger leaves an item). */
  canvasApi.dragItem = (item: Item, e: PointerEvent) => {
    ges.current = { t: 'item', id: e.pointerId, item, x: e.clientX, y: e.clientY }
    if (ghost.current) {
      ghost.current.textContent = item.label
      ghost.current.style.display = 'block'
      ghost.current.style.transform = `translate(${e.clientX - 60}px,${e.clientY - 24}px)`
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId || !ghost.current) return
      ghost.current.style.transform = `translate(${ev.clientX - 60}px,${ev.clientY - 24}px)`
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (ghost.current) ghost.current.style.display = 'none'
      ges.current = { t: 'none' }
      if (ev.type === 'pointercancel') return
      const r = box.current!.getBoundingClientRect()
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return
      const h = hit(ev.clientX, ev.clientY)
      if (h.el && !box.current!.contains(h.el)) return
      const at = { x: h.at.x - 30, y: h.at.y - 20 }
      placeItem(item, h.t === 'port' && h.port === ('out' as Port) ? { t: 'from', id: h.id, at } : { ...h, at } as DropTarget)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  // ------------------------------------------------------------ pointer handling
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const t = e.target as HTMLElement
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const cur = ges.current
    // a second finger turns a pan (or a pending hold) into a pinch
    if (pointers.current.size === 2 && (cur.t === 'pan' || cur.t === 'none' || cur.t === 'lasso')) {
      if (cur.t === 'pan') clearTimeout(cur.long)
      if (lassoEl.current) lassoEl.current.style.display = 'none'
      const [a, b] = [...pointers.current.values()]
      ges.current = { t: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), k0: cam.current.k, mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam0: { ...cam.current } }
      box.current!.setPointerCapture?.(e.pointerId)
      return
    }
    if (cur.t !== 'none' || pointers.current.size > 2) return
    if (t.closest('input, textarea, select, .cm-editor, .xchip, .numslider')) return
    const capture = () => box.current!.setPointerCapture?.(e.pointerId)

    const port = t.closest<HTMLElement>('.port')
    if (port) {
      e.preventDefault()
      const node = port.dataset.node!
      const p = port.dataset.p!
      const dir = port.dataset.dir as 'in' | 'out'
      const fromPort: Port | 'out' = p === 'out' ? 'out' : p === 'in' ? 'in' : Number(p)
      if (dir === 'in') {
        // an input with a cable: pick the cable up by its end
        const existing = g.edges.find((x) => x.to === node && String(x.port) === p)
        if (existing) {
          ges.current = { t: 'wire', id: e.pointerId, from: existing.from, fromPort: 'out', dir: 'out', lifted: existing, x: e.clientX, y: e.clientY, moved: false }
          setWiring({ from: existing.from, fromPort: 'out', dir: 'out' })
          capture()
          return
        }
      }
      ges.current = { t: 'wire', id: e.pointerId, from: node, fromPort, dir: dir === 'out' ? 'out' : 'in', x: e.clientX, y: e.clientY, moved: false }
      setWiring({ from: node, fromPort, dir: dir === 'out' ? 'out' : 'in' })
      capture()
      return
    }
    const edgeEl = t.closest<SVGElement>('[data-edge]')
    if (edgeEl) {
      const [from, to, p] = edgeEl.dataset.edge!.split('|')
      ges.current = { t: 'cable', id: e.pointerId, edge: { from, to, port: p === 'in' ? 'in' : Number(p) }, x0: e.clientX, y0: e.clientY }
      capture()
      return
    }
    const nodeEl = t.closest<HTMLElement>('.node, .macro')
    if (nodeEl?.dataset.node) {
      const id = nodeEl.dataset.node
      const sel = ui.state.sel.includes(id) ? ui.state.sel : [id]
      const start: Record<string, XY> = {}
      for (const s of sel) start[s] = posOf(s)
      const gr = metaNow().groups?.find((x) => x.id === id)
      if (gr) for (const m of gr.ids) start[m] = posOf(m)
      ges.current = { t: 'node', id: e.pointerId, node: id, x0: e.clientX, y0: e.clientY, moved: false, start }
      capture()
      return
    }
    if (t.closest('.term')) return
    // empty canvas
    capture()
    if (ui.state.mode === 'lasso' || e.pointerType === 'pen') {
      ges.current = { t: 'lasso', id: e.pointerId, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY }
      return
    }
    const pan: Extract<Gesture, { t: 'pan' }> = { t: 'pan', id: e.pointerId, x0: e.clientX, y0: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false }
    pan.long = setTimeout(() => {
      if (ges.current !== pan || pan.moved) return
      ges.current = { t: 'none' }
      pointers.current.delete(pan.id)
      openAddMenu({ x: pan.x0, y: pan.y0 }, 'all', { t: 'empty', at: toWorld(pan.x0, pan.y0) })
    }, LONG_MS + 140)
    ges.current = pan
  }

  const onMove = (e: PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const gs = ges.current
    switch (gs.t) {
      case 'pan': {
        if (gs.id !== e.pointerId) return
        const dx = e.clientX - gs.x0
        const dy = e.clientY - gs.y0
        if (!gs.moved && Math.hypot(dx, dy) < TAP_SLOP) return
        gs.moved = true
        clearTimeout(gs.long)
        cam.current = { ...cam.current, x: gs.cx + dx, y: gs.cy + dy }
        applyCam()
        return
      }
      case 'pinch': {
        if (pointers.current.size < 2) return
        const [a, b] = [...pointers.current.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const r = box.current!.getBoundingClientRect()
        const k = Math.max(MIN_K, Math.min(MAX_K, gs.k0 * (d / Math.max(1, gs.d0))))
        // keep the world point under the first midpoint under the fingers
        const wx = (gs.mid0.x - r.left - gs.cam0.x) / gs.cam0.k
        const wy = (gs.mid0.y - r.top - gs.cam0.y) / gs.cam0.k
        cam.current = { k, x: mid.x - r.left - wx * k, y: mid.y - r.top - wy * k }
        applyCam()
        return
      }
      case 'lasso': {
        if (gs.id !== e.pointerId) return
        gs.x1 = e.clientX
        gs.y1 = e.clientY
        const el = lassoEl.current
        if (el) {
          const r = box.current!.getBoundingClientRect()
          Object.assign(el.style, { display: 'block', left: `${Math.min(gs.x0, gs.x1) - r.left}px`, top: `${Math.min(gs.y0, gs.y1) - r.top}px`, width: `${Math.abs(gs.x1 - gs.x0)}px`, height: `${Math.abs(gs.y1 - gs.y0)}px` })
        }
        return
      }
      case 'node': {
        if (gs.id !== e.pointerId) return
        const dx = (e.clientX - gs.x0) / cam.current.k
        const dy = (e.clientY - gs.y0) / cam.current.k
        if (!gs.moved && Math.hypot(e.clientX - gs.x0, e.clientY - gs.y0) < TAP_SLOP) return
        gs.moved = true
        const next: Record<string, XY> = {}
        for (const [id, p] of Object.entries(gs.start)) next[id] = { x: Math.round(p.x + dx), y: Math.round(p.y + dy) }
        setDrag(next)
        return
      }
      case 'wire': {
        if (gs.id !== e.pointerId) return
        gs.moved = gs.moved || Math.hypot(e.clientX - gs.x, e.clientY - gs.y) > TAP_SLOP
        const n = nodeById(g, gs.from)
        if (!n || !tempPath.current) return
        const a = portPos(n, pos(n.id), gs.fromPort, ctx.catalog)
        const b = toWorld(e.clientX, e.clientY)
        tempPath.current.setAttribute('d', gs.dir === 'out' ? cablePath(a, b) : cablePath(b, a))
        tempPath.current.style.display = ''
        return
      }
    }
  }

  const onUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const gs = ges.current
    switch (gs.t) {
      case 'pan':
        if (gs.id !== e.pointerId) return
        clearTimeout(gs.long)
        ges.current = { t: 'none' }
        if (!gs.moved && e.type === 'pointerup') {
          closeAllPopovers()
          ui.select([])
        }
        return
      case 'pinch':
        if (pointers.current.size === 0) ges.current = { t: 'none' }
        return
      case 'lasso': {
        if (gs.id !== e.pointerId) return
        ges.current = { t: 'none' }
        if (lassoEl.current) lassoEl.current.style.display = 'none'
        if (Math.hypot(gs.x1 - gs.x0, gs.y1 - gs.y0) < TAP_SLOP) return ui.select([])
        const a = toWorld(Math.min(gs.x0, gs.x1), Math.min(gs.y0, gs.y1))
        const b = toWorld(Math.max(gs.x0, gs.x1), Math.max(gs.y0, gs.y1))
        const ids = shown
          .filter((n) => {
            const p = pos(n.id)
            const s = sizeOf(n, ctx.catalog)
            return p.x < b.x && p.x + s.w > a.x && p.y < b.y && p.y + s.h > a.y
          })
          .map((n) => n.id)
        ui.select(ids)
        if (ids.length) toast(`${ids.length} selected`)
        return
      }
      case 'node': {
        if (gs.id !== e.pointerId) return
        ges.current = { t: 'none' }
        if (!gs.moved) {
          // a tap: select (shift / ⌘ adds), or open a collapsed group
          const gr = metaNow().groups?.find((x) => x.id === gs.node)
          if (gr) return void ctx.store.setView({ groups: metaNow().groups!.map((x) => (x.id === gr.id ? { ...x, open: true } : x)) })
          const add = e.shiftKey || e.metaKey
          const cur = ui.state.sel
          ui.select(add ? (cur.includes(gs.node) ? cur.filter((x) => x !== gs.node) : [...cur, gs.node]) : [gs.node])
          return
        }
        suppressClick.current = true
        setTimeout(() => (suppressClick.current = false), 0)
        if (e.type === 'pointerup') {
          const moved = { ...drag }
          ctx.store.setView({ pos: { ...metaNow().pos, ...moved } })
        }
        setDrag({})
        return
      }
      case 'wire': {
        if (gs.id !== e.pointerId) return
        ges.current = { t: 'none' }
        setWiring(undefined)
        if (tempPath.current) tempPath.current.style.display = 'none'
        if (e.type !== 'pointerup') return
        if (!gs.moved) {
          // a tap on a port: show what it is
          if (gs.lifted) return void ui.select([], gs.lifted)
          return void toast(gs.dir === 'out' ? 'Drag from here to connect this node' : 'Drag from here to wire this input')
        }
        finishWire(gs, e.clientX, e.clientY)
        return
      }
      case 'cable': {
        if (gs.id !== e.pointerId) return
        ges.current = { t: 'none' }
        if (Math.hypot(e.clientX - gs.x0, e.clientY - gs.y0) < TAP_SLOP * 2) ui.select([], gs.edge)
        return
      }
    }
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
    const click = (e: MouseEvent) => {
      if (suppressClick.current) {
        e.stopPropagation()
        e.preventDefault()
      }
    }
    el.addEventListener('click', click, true)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('click', click, true)
    }
  }, [])

  // ------------------------------------------------------------ render
  const visible = (id: string) => groups.get(id)?.id ?? id
  const cables: Array<{ e: GEdge; a: XY; b: XY; cls: string }> = []
  for (const e of g.edges) {
    const fn = nodeById(g, e.from)
    const tn = nodeById(g, e.to)
    if (!fn || !tn) continue
    const vf = visible(e.from)
    const vt = visible(e.to)
    if (vf === vt && vf !== e.from) continue // inside a collapsed group
    const a = vf !== e.from ? macroPort(vf, 'out') : portPos(fn, pos(fn.id), 'out', ctx.catalog)
    const b = vt !== e.to ? macroPort(vt, 'in') : portPos(tn, pos(tn.id), e.port, ctx.catalog)
    const kind = fn.kind === 'mod' || (fn.kind === 'def' && tn.kind === 'call' && e.port !== 'in' && ctx.catalog.inputs(tn.call!.fn)[e.port as number]?.type === 'float') ? 'num' : 'tex'
    const fb = fn.kind === 'out' && b.x <= a.x + 20 ? 'fb' : ''
    const byp = (fn.kind === 'call' && fn.bypassed) || (tn.kind === 'call' && tn.bypassed) ? 'byp' : ''
    cables.push({ e, a, b, cls: `${kind} ${fb} ${byp} ${sameEdge(st.cable, e) ? 'sel' : ''}` })
  }
  function macroPort(gid: string, side: 'in' | 'out'): XY {
    const gr = (metaNow().groups ?? []).find((x) => x.id === gid)!
    const p = pos(gr.ids[0])
    return side === 'in' ? { x: p.x, y: p.y + 30 } : { x: p.x + 212, y: p.y + 30 }
  }
  const rej = st.rejected && nodeById(g, st.rejected.from) && nodeById(g, st.rejected.to) ? st.rejected : undefined
  // terminals: a chain that is not written anywhere
  const terms = shown.filter((n) => n.kind === 'call' && !g.edges.some((e) => e.from === n.id))
  // bounds for the SVG layer (hit testing needs a real box, not overflow)
  let bx0 = 0
  let by0 = 0
  let bx1 = 800
  let by1 = 600
  for (const n of shown) {
    const p = pos(n.id)
    const s = sizeOf(n, ctx.catalog)
    bx0 = Math.min(bx0, p.x - 400)
    by0 = Math.min(by0, p.y - 400)
    bx1 = Math.max(bx1, p.x + s.w + 600)
    by1 = Math.max(by1, p.y + s.h + 400)
  }
  const selCable = st.cable && g.edges.find((e) => sameEdge(e, st.cable)) ? cables.find((c) => sameEdge(c.e, st.cable)) : undefined
  const previews = meta.previews ?? []
  const gList = (meta.groups ?? []).filter((x) => !x.open)

  return (
    <div
      class={`canvas mode-${st.mode} ${wiring ? 'wiring' : ''}`}
      ref={box}
      data-testid="canvas"
      onPointerDown={onDown as unknown as (e: Event) => void}
      onPointerMove={onMove as unknown as (e: Event) => void}
      onPointerUp={onUp as unknown as (e: Event) => void}
      onPointerCancel={onUp as unknown as (e: Event) => void}
    >
      <div class="world" ref={world}>
        <svg class="cables" style={{ left: `${bx0}px`, top: `${by0}px`, width: `${bx1 - bx0}px`, height: `${by1 - by0}px` }} viewBox={`${bx0} ${by0} ${bx1 - bx0} ${by1 - by0}`}>
          {cables.map(({ e, a, b, cls }) => {
            const d = cablePath(a, b)
            return (
              <g key={edgeKey(e)} class={`cable ${cls}`}>
                <path class="hitpath" d={d} data-edge={edgeKey(e)} data-testid="cable" />
                <path class="line" d={d} />
              </g>
            )
          })}
          {rej && <path class="cable-rejected" d={cablePath(portPos(nodeById(g, rej.from)!, pos(rej.from), 'out', ctx.catalog), portPos(nodeById(g, rej.to)!, pos(rej.to), rej.port, ctx.catalog))} data-testid="cable-rejected" />}
          <path class="cable-temp" ref={tempPath} style={{ display: 'none' }} />
        </svg>
        {shown.map((n) => (
          <NodeCard
            key={n.id}
            n={n}
            x={pos(n.id).x}
            y={pos(n.id).y}
            selected={st.sel.includes(n.id)}
            targets={targetsFor[n.id]}
            dup={comp.dup[n.id] ?? 1}
            error={errNodes[n.id]}
            shadowed={shadowed.has(n.id)}
            preview={previews.includes(n.id)}
          />
        ))}
        {gList.map((gr) => {
          const p = pos(gr.ids[0])
          const fns = gr.ids.map((id) => nodeById(g, id)).filter((x): x is GNode => !!x && x.kind === 'call').map((x) => x.call!.fn)
          return (
            <div key={gr.id} class={`node macro ${st.sel.includes(gr.id) ? 'sel' : ''}`} style={{ transform: `translate(${p.x}px,${p.y}px)` }} data-node={gr.id} data-testid="macro">
              <span class="port in" />
              <b>{gr.name ?? 'group'}</b>
              <small>{fns.join(' → ')}</small>
              <span class="port out" />
            </div>
          )
        })}
        {terms.map((n) => {
          const p = pos(n.id)
          const s = sizeOf(n, ctx.catalog)
          return <Terminal key={`t-${n.id}`} end={n.id} x={p.x + s.w + 44} y={p.y + 4} />
        })}
        {selCable && (
          <button
            type="button"
            class="xchip"
            data-testid="cable-delete"
            aria-label="Remove cable"
            style={{ transform: `translate(${midpoint(selCable.a, selCable.b).x - 18}px,${midpoint(selCable.a, selCable.b).y - 18}px)` }}
            onClick={(ev) => {
              ev.stopPropagation()
              const e = selCable.e
              ui.select([])
              applyGraph(disconnect(g, e))
            }}
          >
            ✕
          </button>
        )}
      </div>
      <div class="lasso" ref={lassoEl} />
      <div class="drag-ghost" ref={ghost} />
    </div>
  )
}
