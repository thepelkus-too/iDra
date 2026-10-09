// The add-node palette (a docked bottom drawer: grouped, searchable, recent and favourites; tap to add, or drag onto the canvas,
// a node or a cable), the filtered add menu that opens where a cable is dropped on empty canvas, and the function picker that
// swaps a node's function (keeping inputs whose names match).
import { DEFAULT, insertStmt, newId, num, rawStmt, type FnDef, type Stmt, type Value } from '@hydra-ipad/core'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { appPrefs } from '../prefs'
import { applyGraph, graphOf, metaNow, posOf, tryApply, ui, useUi } from '../doc'
import { ctx, edit, useCatalogVersion } from '../kit/ctx'
import { defaultSpec, MOD_ICON, MOD_LABEL, type ModKind } from '../kit/mods'
import { setupInsertIndex } from '../kit/model'
import { closePopover, openPopover, toast } from '../kit/overlay'
import { thumbs } from '../kit/thumbs'
import { nodeById, type GEdge, type Graph, type Port } from '../model'
import { appendAfter, connect, isGenerator, newCallNode, setModulator, splice, updateNode } from '../ops'
import { withMeta } from '@hydra-ipad/core'
import { APP, CALL_W, type XY } from '../view'
import { TYPE_ICON, TYPE_LABEL, firstNumberPort } from './Nodes'

export type ItemKind = 'fn' | 'mod' | 'stmt'
export interface Item {
  key: string
  label: string
  group: string
  kind: ItemKind
  fn?: FnDef
  mod?: ModKind
  stmt?: 'var-num' | 'var-tex' | 'comment' | 'raw' | 'bpm' | 'speed' | 'cam' | 'image' | 'video' | 'render'
}

export const GROUPS = ['Recent', 'Sources', 'Geometry', 'Color', 'Blend', 'Modulate', 'Modulators', 'Setup', 'Plugins'] as const

const STMT_ITEMS: Array<[Item['stmt'], string]> = [
  ['var-num', 'Variable (number)'],
  ['var-tex', 'Variable (texture)'],
  ['comment', 'Sticky note'],
  ['raw', 'JS code'],
  ['bpm', 'bpm'],
  ['speed', 'speed'],
  ['cam', 'Camera → s0'],
  ['image', 'Image → s0'],
  ['video', 'Video → s0'],
  ['render', 'render()'],
]
const MOD_KINDS: ModKind[] = ['sine', 'saw', 'tri', 'square', 'rnd', 'time', 'mouseX', 'mouseY', 'audio', 'vol', 'steps', 'expr']

export function allItems(): Item[] {
  const out: Item[] = []
  for (const f of ctx.catalog.list()) {
    const plugin = f.origin.startsWith('plugin:')
    const group = plugin ? 'Plugins' : TYPE_LABEL[f.type] === 'Source' ? 'Sources' : TYPE_LABEL[f.type]
    out.push({ key: `fn:${f.name}`, label: f.name, group, kind: 'fn', fn: f })
  }
  for (const m of MOD_KINDS) out.push({ key: `mod:${m}`, label: MOD_LABEL[m], group: 'Modulators', kind: 'mod', mod: m })
  for (const [s, label] of STMT_ITEMS) out.push({ key: `stmt:${s}`, label, group: 'Setup', kind: 'stmt', stmt: s })
  return out
}

function remember(key: string): void {
  const r = (appPrefs.get<string[]>('recent') ?? []).filter((k) => k !== key)
  appPrefs.set('recent', [key, ...r].slice(0, 10))
}

// ---------------------------------------------------------------- placing an item

export type DropTarget =
  | { t: 'empty'; at: XY }
  | { t: 'node'; id: string; at: XY }
  | { t: 'port'; id: string; port: Port; at: XY }
  | { t: 'edge'; edge: GEdge; at: XY }
  | { t: 'from'; id: string; at: XY }

/** Add a palette item at a drop target. Returns false (with a toast) when it does not fit there. */
export function placeItem(item: Item, target: DropTarget): boolean {
  remember(item.key)
  const g = graphOf()
  const at = { x: Math.round(target.at.x), y: Math.round(target.at.y) }
  if (item.kind === 'stmt') return addStmt(item, at)
  if (item.kind === 'mod') {
    let id: string | undefined
    let port: number | undefined
    if (target.t === 'port' && typeof target.port === 'number') [id, port] = [target.id, target.port]
    else if (target.t === 'node') [id, port] = [target.id, firstNumberPort(nodeById(g, target.id)!)]
    if (!id || port === undefined) return void toast('Drop a modulator on a number input of a node') ?? false
    const n = nodeById(g, id)!
    const inp = ctx.catalog.inputs(n.call!.fn)[port]
    if (inp && inp.type === 'sampler2D') return void toast('That input takes a texture') ?? false
    const hint = inp ? ctx.catalog.hint(n.call!.fn, inp.name) : { min: 0, max: 1 }
    const cur = n.call!.args[port]
    const around = cur && cur.k === 'num' ? cur.v : typeof inp?.default === 'number' ? inp.default : 0
    const spec = defaultSpec(item.mod!, around, (hint.max - hint.min) / 4)
    const p = posOf(id)
    return tryApply(setModulator(g, id, port, spec), { placed: { [`mod:${id}:${port}`]: { x: p.x - 230, y: p.y + 40 + port * 30 } } })
  }
  const fn = item.fn!
  const node = newCallNode(fn.name, defaultArgs(fn))
  const gen = isGenerator(node)
  const placed: Record<string, XY> = { [node.id]: at }
  if (target.t === 'empty') {
    if (!gen) {
      const sel = ui.state.sel[0]
      const sn = sel ? nodeById(g, sel) : undefined
      if (sn && sn.kind === 'call') return placeItem(item, { t: 'node', id: sel, at: { x: posOf(sel).x + CALL_W + 60, y: posOf(sel).y } })
      return void toast(`${fn.name}() changes a texture: drop it on a node or a cable`) ?? false
    }
    return tryApply({ nodes: [...g.nodes, node], edges: g.edges }, { placed })
  }
  if (target.t === 'edge') return tryApply(spliceOr(g, target.edge, node), { placed }, target.edge)
  if (target.t === 'node') {
    const tn = nodeById(g, target.id)
    if (!tn) return false
    if (gen) {
      // a generator dropped on a node goes into its first free texture input
      const tp = firstTexPort(tn)
      if (tp === undefined) return void toast(`${fn.name}() starts a chain: drop it on empty canvas or a texture input`) ?? false
      return tryApply(connect({ nodes: [...g.nodes, node], edges: g.edges }, node.id, target.id, tp), { placed })
    }
    if (tn.kind === 'out' || tn.kind === 'src') {
      const e = g.edges.find((x) => x.to === tn.id && x.port === 'in')
      if (e) return tryApply(spliceOr(g, e, node), { placed })
      return void toast('Drop it on a cable or a chain node') ?? false
    }
    return tryApply(appendAfter(g, target.id, node), { placed })
  }
  if (target.t === 'port') return tryApply(connect({ nodes: [...g.nodes, node], edges: g.edges }, node.id, target.id, target.port), { placed })
  if (target.t === 'from') {
    // a cable dragged out of `id` and dropped here: the new node reads it
    const from = nodeById(g, target.id)
    if (!from) return false
    if (gen) {
      const tp = firstTexPort(node)
      if (tp === undefined) return void toast(`${fn.name}() has no texture input`) ?? false
      return tryApply(connect({ nodes: [...g.nodes, node], edges: g.edges }, target.id, node.id, tp), { placed })
    }
    return tryApply(connect({ nodes: [...g.nodes, node], edges: g.edges }, target.id, node.id, 'in'), { placed })
  }
  return false
}

const spliceOr = (g: Graph, e: GEdge, node: ReturnType<typeof newCallNode>) => splice(g, e, node)

function firstTexPort(n: { kind: string; call?: { fn: string } }): number | undefined {
  if (n.kind !== 'call') return undefined
  const ins = ctx.catalog.inputs(n.call!.fn)
  const g = graphOf()
  const free = ins.findIndex((inp, i) => inp.type === 'sampler2D' && !g.edges.some((e) => e.to === (n as { id: string }).id && e.port === i))
  return free >= 0 ? free : undefined
}

/** A fresh call: defaults stay implicit (dim) so the code is as short as the user typed it. */
function defaultArgs(_f: FnDef): Value[] {
  return []
}

function addStmt(item: Item, at: XY): boolean {
  const sk = ctx.store.sketch
  let stmt: Stmt
  const name = (base: string) => {
    const taken = new Set(sk.stmts.flatMap((s) => (s.k === 'def' ? [s.name] : [])))
    for (let i = 1; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`
  }
  switch (item.stmt) {
    case 'var-num': stmt = { id: newId('s'), k: 'def', name: name('amount'), decl: 'const', value: num(0.5) }; break
    case 'var-tex': stmt = { id: newId('s'), k: 'def', name: name('tex'), decl: 'const', value: { k: 'tex', chain: { id: newId('h'), gen: { id: newId('c'), fn: 'noise', args: [num(3)] }, mods: [] } } }; break
    case 'comment': stmt = { id: newId('s'), k: 'comment', text: 'a note' }; break
    case 'raw': stmt = rawStmt('// any JavaScript'); break
    case 'bpm': stmt = { id: newId('s'), k: 'setting', name: 'bpm', v: 120 }; break
    case 'speed': stmt = { id: newId('s'), k: 'setting', name: 'speed', v: 1 }; break
    case 'cam': stmt = { id: newId('s'), k: 'source', slot: 's0', init: { kind: 'cam' } }; break
    case 'image': stmt = { id: newId('s'), k: 'source', slot: 's0', init: { kind: 'image', arg: 'https://' } }; break
    case 'video': stmt = { id: newId('s'), k: 'source', slot: 's0', init: { kind: 'video', arg: 'https://' } }; break
    case 'render': stmt = { id: newId('s'), k: 'render', target: 'all' }; break
    default: return false
  }
  const setup = stmt.k === 'setting' || stmt.k === 'source'
  const idx = setup ? setupInsertIndex(sk) : stmt.k === 'def' ? 0 : sk.stmts.length
  const meta = metaNow(sk)
  edit((s) => withMeta(insertStmt(s, idx, stmt), APP, { ...meta, pos: { ...meta.pos, [stmt.id]: at } }))
  return true
}

// ---------------------------------------------------------------- the drawer

export function Palette({ onDragItem }: { onDragItem: (item: Item, e: PointerEvent) => void }) {
  useCatalogVersion()
  const st = useUi()
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string>(() => appPrefs.get<string>('group') ?? 'Sources')
  const items = useMemo(allItems, [ctx.catalog.version])
  const recent = appPrefs.get<string[]>('recent') ?? []
  const favs = appPrefs.get<string[]>('favs') ?? []
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase()
    if (ql) return items.filter((i) => i.label.toLowerCase().includes(ql) || i.group.toLowerCase().includes(ql))
    if (group === 'Recent') return [...favs, ...recent.filter((k) => !favs.includes(k))].map((k) => items.find((i) => i.key === k)).filter((x): x is Item => !!x)
    return items.filter((i) => i.group === group)
  }, [q, group, items, recent.join(), favs.join()])
  if (!st.palette) return null
  return (
    <div class="palette" data-testid="palette" role="dialog" aria-label="Add a node">
      <div class="pal-head">
        <input
          class="pal-search"
          type="search"
          placeholder="Search functions…"
          aria-label="Search"
          data-testid="pal-search"
          value={q}
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="button" class="icon" aria-label="Close palette" data-testid="pal-close" onClick={() => ui.set({ palette: false })}>
          ✕
        </button>
      </div>
      <div class="pal-tabs" role="tablist">
        {GROUPS.filter((g) => g !== 'Plugins' || items.some((i) => i.group === 'Plugins')).map((g) => (
          <button
            type="button"
            role="tab"
            key={g}
            aria-selected={!q && group === g}
            class={!q && group === g ? 'on' : ''}
            data-testid={`pal-tab-${g}`}
            onClick={() => {
              setQ('')
              setGroup(g)
              appPrefs.set('group', g)
            }}
          >
            {g}
          </button>
        ))}
      </div>
      <div class="pal-items">
        {shown.length === 0 && <div class="empty">{group === 'Recent' ? 'Nodes you add show up here. Hold one to make it a favourite.' : 'Nothing matches.'}</div>}
        {shown.map((it) => (
          <PalItem key={it.key} item={it} fav={favs.includes(it.key)} onDrag={onDragItem} />
        ))}
      </div>
      <div class="pal-hint">Tap to add · drag onto the canvas, a node or a cable · hold for favourite</div>
    </div>
  )
}

function PalItem({ item, fav, onDrag }: { item: Item; fav: boolean; onDrag: (item: Item, e: PointerEvent) => void }) {
  const [thumb, setThumb] = useState<string | undefined>(() => (item.fn ? thumbs.peek(item.fn.name) : undefined))
  useEffect(() => {
    if (item.fn && !thumb) void thumbs.get(item.fn.name).then((u) => u && setThumb(u))
  }, [item.key])
  const st = useRef<{ id: number; x: number; y: number; t: number; drag: boolean; long?: ReturnType<typeof setTimeout>; longFired?: boolean } | null>(null)
  const icon = item.kind === 'fn' ? TYPE_ICON[item.fn!.origin.startsWith('plugin:') ? 'plugin' : item.fn!.type] : item.kind === 'mod' ? MOD_ICON[item.mod!] : '＋'
  return (
    <button
      type="button"
      class={`pal-item k-${item.kind} ${item.fn ? `t-${item.fn.type}` : ''}`}
      data-item={item.key}
      data-testid="pal-item"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        const s = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), drag: false } as NonNullable<typeof st.current>
        s.long = setTimeout(() => {
          if (s.drag) return
          s.longFired = true
          const f = appPrefs.get<string[]>('favs') ?? []
          appPrefs.set('favs', f.includes(item.key) ? f.filter((k) => k !== item.key) : [item.key, ...f])
          toast(f.includes(item.key) ? `${item.label}: no longer a favourite` : `${item.label}: favourite`)
          ui.set({})
        }, 550)
        st.current = s
      }}
      onPointerMove={(e) => {
        const s = st.current
        if (!s || s.drag || s.id !== e.pointerId) return
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) {
          s.drag = true
          clearTimeout(s.long)
          onDrag(item, e)
        }
      }}
      onPointerUp={() => {
        const s = st.current
        st.current = null
        if (!s) return
        clearTimeout(s.long)
        if (s.drag || s.longFired) return
        addByTap(item)
      }}
      onPointerCancel={() => {
        if (st.current) clearTimeout(st.current.long)
        st.current = null
      }}
    >
      <span class="pthumb">{thumb ? <img src={thumb} alt="" /> : <i>{icon}</i>}</span>
      <span class="plabel">
        {fav && '★ '}
        {item.label}
      </span>
    </button>
  )
}

/** Tap: generators and statements go to the middle of the screen; modifiers go after the selected node. */
export function addByTap(item: Item): void {
  const center = canvasCenter()
  const sel = ui.state.sel[0]
  if (item.kind === 'mod') {
    if (!sel) return void toast('Select a node first (or drag the modulator onto an input)')
    placeItem(item, { t: 'node', id: sel, at: center })
    return
  }
  if (item.kind === 'fn' && item.fn!.type !== 'src' && sel) {
    const p = posOf(sel)
    placeItem(item, { t: 'node', id: sel, at: { x: p.x + CALL_W + 60, y: p.y } })
    return
  }
  placeItem(item, { t: 'empty', at: center })
}

/** set by the canvas: the world point at the middle of the visible canvas */
export const canvasApi = {
  center: (): XY => ({ x: 400, y: 200 }),
  toWorld: (cx: number, cy: number): XY => ({ x: cx, y: cy }),
}
const canvasCenter = () => canvasApi.center()

// ---------------------------------------------------------------- filtered add menu (cable dropped on empty canvas)

export function openAddMenu(anchor: { x: number; y: number }, filter: 'mods' | 'gens' | 'modulators' | 'all', target: DropTarget): void {
  const rect = { left: anchor.x - 1, top: anchor.y - 1, right: anchor.x + 1, bottom: anchor.y + 1, width: 2, height: 2 }
  openPopover(rect, (close) => <AddMenu filter={filter} target={target} close={close} />, { width: 320, label: 'Add a node' })
}

function AddMenu({ filter, target, close }: { filter: 'mods' | 'gens' | 'modulators' | 'all'; target: DropTarget; close: () => void }) {
  const [q, setQ] = useState('')
  const items = allItems().filter((i) => {
    if (filter === 'mods') return i.kind === 'fn' && i.fn!.type !== 'src'
    if (filter === 'gens') return i.kind === 'fn' && i.fn!.type === 'src'
    if (filter === 'modulators') return i.kind === 'mod'
    return i.kind !== 'stmt'
  })
  const ql = q.trim().toLowerCase()
  const shown = ql ? items.filter((i) => i.label.toLowerCase().includes(ql)) : items
  return (
    <div class="addmenu" data-testid="add-menu">
      <input
        class="pal-search"
        type="search"
        placeholder={filter === 'gens' ? 'Generators…' : filter === 'mods' ? 'Modifiers, blends…' : filter === 'modulators' ? 'Modulators…' : 'Search…'}
        aria-label="Search"
        data-testid="add-search"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        value={q}
        onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
      />
      <div class="am-list">
        {shown.map((it) => (
          <button
            type="button"
            key={it.key}
            class={`am-item ${it.fn ? `t-${it.fn.type}` : ''}`}
            data-pick={it.fn?.name ?? it.mod}
            onClick={() => {
              close()
              placeItem(it, target)
            }}
          >
            <span class="ticon">{it.fn ? TYPE_ICON[it.fn.origin.startsWith('plugin:') ? 'plugin' : it.fn.type] : MOD_ICON[it.mod!]}</span>
            <span>{it.label}</span>
            <small>{it.group}</small>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- swap a node's function

export function openFnPicker(anchor: HTMLElement, nodeId: string): void {
  const g = graphOf()
  const n = nodeById(g, nodeId)
  if (!n?.call) return
  const cur = ctx.catalog.get(n.call.fn)
  // same position only: a generator stays a generator, a modifier a modifier
  const same = ctx.catalog.list().filter((f) => (cur ? (f.type === 'src') === (cur.type === 'src') : true))
  openPopover(
    anchor,
    (close) => (
      <div class="addmenu" data-testid="fn-picker">
        <div class="am-list">
          {same.map((f) => (
            <button
              type="button"
              key={f.name}
              class={`am-item t-${f.type} ${f.name === n.call!.fn ? 'on' : ''}`}
              data-pick={f.name}
              onClick={() => {
                close()
                swapFn(nodeId, f.name)
              }}
            >
              <span class="ticon">{TYPE_ICON[f.type]}</span>
              <span>{f.name}</span>
              <small>{TYPE_LABEL[f.type]}</small>
            </button>
          ))}
        </div>
      </div>
    ),
    { width: 300, label: 'Change function' },
  )
}

/** Change a node's function, keeping the values of inputs whose names match; cables into inputs that no longer exist are dropped. */
export function swapFn(nodeId: string, fn: string): void {
  const g = graphOf()
  const n = nodeById(g, nodeId)
  if (!n?.call || n.call.fn === fn) return
  const oldIns = ctx.catalog.inputs(n.call.fn)
  const newIns = ctx.catalog.inputs(fn)
  const args: Value[] = newIns.map((inp) => {
    const j = oldIns.findIndex((o) => o.name === inp.name)
    return j >= 0 && n.call!.args[j] ? n.call!.args[j] : DEFAULT
  })
  while (args.length && args[args.length - 1].k === 'default') args.pop()
  const remap = new Map<number, number>()
  oldIns.forEach((o, j) => {
    const k = newIns.findIndex((x) => x.name === o.name)
    if (k >= 0) remap.set(j, k)
  })
  let g2 = updateNode(g, nodeId, (x) => ({ ...x, call: { ...x.call!, fn, args } }))
  g2 = {
    nodes: g2.nodes,
    edges: g2.edges.flatMap((e) => {
      if (e.to !== nodeId || e.port === 'in') return [e]
      const k = remap.get(e.port as number)
      return k === undefined ? [] : [{ ...e, port: k }]
    }),
  }
  // modulator nodes are keyed by port: their ids follow the remap through the compile
  if (applyGraph(g2)) toast('Could not change the function')
  closePopover()
}

void ({} as typeof isGenerator)
