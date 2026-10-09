// The top bar, the selection bar, the picture-in-picture output and performance mode.
import { newId } from '@hydra-ipad/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import { appPrefs } from '../prefs'
import { applyGraph, arrange, compileOf, graphOf, metaNow, posOf, tryApply, ui, useUi } from '../doc'
import { Switcher, SketchName, UndoRedo, openMoreMenu } from '../kit/Chrome'
import { codeBridge } from '../kit/CodeDrawer'
import { ctx, useRunner, useStore } from '../kit/ctx'
import { NumSlider } from '../kit/NumSlider'
import { toast } from '../kit/overlay'
import { nodeById } from '../model'
import { bake, deleteNodes, disconnect, duplicateNodes, freeOutputs, toggleBypass } from '../ops'
import type { XY } from '../view'
import { setCallNum } from './Nodes'
import { togglePreview } from './Preview'

export function TopBar() {
  const st = useUi()
  const runner = useRunner()
  return (
    <header class="topbar" data-testid="topbar">
      <Switcher />
      <SketchName />
      <span class="grow" />
      <UndoRedo />
      <button type="button" class={`icon ${st.mode === 'lasso' ? 'on' : ''}`} data-testid="mode-lasso" aria-pressed={st.mode === 'lasso'} aria-label="Select with a rectangle" title="One finger on the canvas: pan, or draw a selection rectangle" onClick={() => ui.set({ mode: st.mode === 'lasso' ? 'pan' : 'lasso' })}>
        ⬚
      </button>
      <button type="button" class={`btn ${st.palette ? 'on' : ''}`} data-testid="add" aria-pressed={st.palette} onClick={() => ui.set({ palette: !st.palette })}>
        ＋ Node
      </button>
      <button type="button" class={`btn ${st.code ? 'on' : ''}`} data-testid="code-toggle" aria-pressed={st.code} onClick={() => ui.set({ code: !st.code })}>
        Code
      </button>
      <button type="button" class="icon" data-testid="run" aria-label="Run again" title="Run again (⌘Enter)" onClick={() => (codeBridge.flush(), runner.run(true))}>
        ▶
      </button>
      <button type="button" class="icon" data-testid="perform" aria-label="Performance mode" title="Performance mode" onClick={() => ui.set({ perform: true })}>
        ⛶
      </button>
      <button
        type="button"
        class="icon"
        data-testid="more"
        aria-label="More"
        onClick={(e) =>
          openMoreMenu(e.currentTarget as HTMLElement, [
            { label: 'Arrange (re-run the layout)', run: arrange, testid: 'menu-arrange' },
            { label: 'Fit to screen', run: () => ui.set({ fit: ui.state.fit + 1 }), testid: 'menu-fit' },
          ])
        }
      >
        ⋯
      </button>
    </header>
  )
}

// ---------------------------------------------------------------- selection

export function duplicateSelection(): void {
  const ids = ui.state.sel
  if (!ids.length) return void toast('Select nodes first')
  const g = graphOf()
  const { graph, map } = duplicateNodes(g, ids)
  const placed: Record<string, XY> = {}
  for (const [from, to] of Object.entries(map)) if (to) placed[to] = { x: posOf(from).x + 40, y: posOf(from).y + 70 }
  if (!Object.keys(placed).length) return void toast('Only chain nodes and modulators can be duplicated')
  if (tryApply(graph, { placed })) ui.select(Object.values(map).filter((x) => x && nodeById(graph, x)?.kind === 'call'))
}

export function deleteSelection(): void {
  const st = ui.state
  if (st.cable) {
    applyGraph(disconnect(graphOf(), st.cable))
    ui.select([])
    return
  }
  const groups = metaNow().groups ?? []
  const ids = st.sel.flatMap((id) => groups.find((x) => x.id === id)?.ids ?? [id]).filter((id) => !id.startsWith('out:') && !id.startsWith('src:'))
  if (!ids.length) return void toast(st.sel.length ? 'Outputs and sources stay: they are part of every sketch' : 'Select nodes first')
  const g = deleteNodes(graphOf(), ids)
  const left = groups.map((gr) => ({ ...gr, ids: gr.ids.filter((x) => !ids.includes(x)) })).filter((gr) => gr.ids.length > 1)
  if (tryApply(g, { meta: { groups: left.length ? left : undefined } })) {
    ui.select([])
    toast(`Deleted ${ids.length}`, { label: 'Undo', run: () => ctx.store.undo() })
  }
}

function groupSelection(): void {
  const g = graphOf()
  const ids = ui.state.sel.filter((id) => nodeById(g, id)?.kind === 'call')
  if (ids.length < 2) return void toast('Select two or more chain nodes to group')
  const groups = (metaNow().groups ?? []).map((gr) => ({ ...gr, ids: gr.ids.filter((x) => !ids.includes(x)) })).filter((gr) => gr.ids.length > 1)
  // in chain order (top-left first) so the macro sits where the run starts
  ids.sort((a, b) => posOf(a).x - posOf(b).x || posOf(a).y - posOf(b).y)
  const id = newId('g')
  const name = window.prompt('Group name', 'macro') ?? 'macro'
  ctx.store.setView({ groups: [...groups, { id, ids, name: name.trim() || 'macro' }] })
  ui.select([id])
}

function togglePins(nodeId: string): void {
  const n = nodeById(graphOf(), nodeId)
  if (!n || n.kind !== 'call') return void toast('Pin the numbers of a chain node')
  const ins = ctx.catalog.inputs(n.call!.fn)
  const ports = ins.map((x, i) => (x.type === 'float' && (n.call!.args[i]?.k ?? 'default') !== 'fn' && (n.call!.args[i]?.k ?? 'default') !== 'arr' ? i : -1)).filter((i) => i >= 0)
  const pins = metaNow().pins ?? []
  const has = pins.some((p) => p.node === nodeId)
  ctx.store.setView({ pins: has ? pins.filter((p) => p.node !== nodeId) : [...pins, ...ports.map((port) => ({ node: nodeId, port }))] })
  toast(has ? 'Unpinned from performance mode' : `Pinned ${ports.length} control${ports.length === 1 ? '' : 's'} to performance mode`)
}

export function SelectionBar() {
  const st = useUi()
  useStore()
  if (!st.sel.length && !st.cable) return null
  const g = graphOf()
  const meta = metaNow()
  const groups = meta.groups ?? []
  const one = st.sel.length === 1 ? st.sel[0] : undefined
  const n = one ? nodeById(g, one) : undefined
  const gr = one ? groups.find((x) => x.id === one) : undefined
  const openGr = one ? groups.find((x) => x.open && x.ids.includes(one)) : undefined
  const dup = n ? (compileOf().dup[n.id] ?? 1) : 1
  const calls = st.sel.filter((id) => nodeById(g, id)?.kind === 'call')
  return (
    <div class="selbar" role="toolbar" aria-label="Selection" data-testid="selbar">
      {st.cable ? (
        <button type="button" class="btn danger" data-testid="sel-cable-delete" onClick={deleteSelection}>
          Remove cable
        </button>
      ) : (
        <>
          <span class="count">{gr ? `group: ${gr.name}` : n ? (n.call?.fn ?? n.name ?? n.kind) : `${st.sel.length} selected`}</span>
          <button type="button" class="btn" data-testid="sel-dup" onClick={duplicateSelection}>
            Duplicate
          </button>
          <button type="button" class="btn danger" data-testid="sel-delete" onClick={deleteSelection}>
            Delete
          </button>
          {n?.kind === 'call' && (
            <button type="button" class={`btn ${n.bypassed ? 'on' : ''}`} data-testid="sel-bypass" aria-pressed={!!n.bypassed} onClick={() => tryApply(toggleBypass(g, n.id, ctx.catalog))}>
              Bypass
            </button>
          )}
          {calls.length > 1 && (
            <button type="button" class="btn" data-testid="sel-group" onClick={groupSelection}>
              Group
            </button>
          )}
          {gr && (
            <button type="button" class="btn" data-testid="sel-ungroup" onClick={() => (ctx.store.setView({ groups: groups.filter((x) => x.id !== gr.id) }), ui.select(gr.ids))}>
              Ungroup
            </button>
          )}
          {openGr && (
            <button type="button" class="btn" data-testid="sel-collapse" onClick={() => (ctx.store.setView({ groups: groups.map((x) => (x.id === openGr.id ? { ...x, open: false } : x)) }), ui.select([openGr.id]))}>
              Collapse group
            </button>
          )}
          {n && (n.kind === 'call' || n.kind === 'out') && (
            <button type="button" class={`btn ${(meta.previews ?? []).includes(n.id) ? 'on' : ''}`} data-testid="sel-preview" onClick={() => togglePreview(n.id)}>
              👁 Preview
            </button>
          )}
          {n?.kind === 'call' && (
            <button type="button" class={`btn ${(meta.pins ?? []).some((p) => p.node === n.id) ? 'on' : ''}`} data-testid="sel-pin" onClick={() => togglePins(n.id)}>
              Pin
            </button>
          )}
          {n?.kind === 'call' && dup > 1 && (
            <button type="button" class="btn" data-testid="sel-bake" title="Write it once to a free output and read that output everywhere" onClick={() => {
              const r = bake(g, n.id, freeOutputs(g))
              if (tryApply(r)) toast(`Baked into ${freeOutputs(g)[0]}`)
            }}>
              Bake ×{dup} → {freeOutputs(g)[0] ?? '—'}
            </button>
          )}
        </>
      )}
      <button type="button" class="icon" aria-label="Clear selection" data-testid="sel-clear" onClick={() => ui.select([])}>
        ✕
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- PiP output + performance mode

interface PipBox {
  x: number
  y: number
  w: number
}

export function Pip({ stage }: { stage: HTMLElement }) {
  const st = useUi()
  const runner = useRunner()
  const slot = useRef<HTMLDivElement>(null)
  const [b, setB] = useState<PipBox>(() => appPrefs.get<PipBox>('pip') ?? { x: -16, y: 16, w: Math.min(320, Math.round(window.innerWidth * 0.3)) })
  useEffect(() => {
    if (slot.current && stage.parentElement !== slot.current) slot.current.appendChild(stage)
  }, [stage])
  const drag = useRef<{ id: number; x0: number; y0: number; b0: PipBox; resize: boolean } | null>(null)
  const save = (nb: PipBox) => appPrefs.set('pip', nb)
  // negative x = from the right edge
  const style = st.perform ? {} : { width: `${b.w}px`, height: `${(b.w * 9) / 16}px`, top: `${b.y}px`, ...(b.x < 0 ? { right: `${-b.x}px` } : { left: `${b.x}px` }) }
  return (
    <div class={`pip ${st.perform ? 'perform' : ''}`} style={style} data-testid="pip">
      <div class="stage-slot" ref={slot} data-testid="stage-slot" />
      {!st.perform && (
        <>
          <div
            class="pip-grip"
            aria-label="Move the output"
            data-no-undo-tap
            onPointerDown={(e) => {
              ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
              drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, b0: b, resize: false }
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (!d || d.id !== e.pointerId) return
              const W = window.innerWidth
              const left = (d.b0.x < 0 ? W + d.b0.x - d.b0.w : d.b0.x) + (e.clientX - d.x0)
              const right = W - left - d.b0.w
              setB({ ...d.b0, x: right < left ? -Math.max(0, right) : Math.max(0, left), y: Math.max(0, d.b0.y + e.clientY - d.y0) })
            }}
            onPointerUp={() => {
              drag.current = null
              save(b)
            }}
          >
            {runner.trust.pending && <span class="pill warn">safe mode</span>}
            {runner.status.fellBack && <span class="pill err">last good frame</span>}
          </div>
          <div
            class="pip-resize"
            aria-label="Resize the output"
            data-no-undo-tap
            onPointerDown={(e) => {
              ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
              drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, b0: b, resize: true }
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (!d || d.id !== e.pointerId) return
              const dx = e.clientX - d.x0
              setB({ ...d.b0, w: Math.max(160, Math.min(window.innerWidth - 32, d.b0.w + (d.b0.x < 0 ? -dx : dx))) })
            }}
            onPointerUp={() => {
              drag.current = null
              save(b)
            }}
          />
        </>
      )}
      {st.perform && <PerformControls />}
    </div>
  )
}

function PerformControls() {
  useStore()
  const meta = metaNow()
  const g = graphOf()
  const pins = (meta.pins ?? []).filter((p) => nodeById(g, p.node)?.kind === 'call')
  return (
    <div class="perform-ui">
      <button type="button" class="btn exit" data-testid="perform-exit" onClick={() => ui.set({ perform: false })}>
        Exit
      </button>
      <div class="pins" data-testid="pins">
        {pins.length === 0 && <span class="hint">Select a node and tap Pin to bring its controls here.</span>}
        {pins.map((p) => {
          const n = nodeById(g, p.node)!
          const inp = ctx.catalog.inputs(n.call!.fn)[p.port]
          if (!inp) return null
          const a = n.call!.args[p.port]
          const d = typeof inp.default === 'number' ? inp.default : 0
          const v = a?.k === 'num' ? a.v : d
          return <NumSlider key={`${p.node}:${p.port}`} label={`${n.call!.fn} ${inp.name}`} value={v} def={d} hint={ctx.catalog.hint(n.call!.fn, inp.name)} testid={`pin-${n.call!.fn}-${p.port}`} onChange={(x, ph) => setCallNum(p.node, p.port, x, ph)} />
        })}
      </div>
    </div>
  )
}
