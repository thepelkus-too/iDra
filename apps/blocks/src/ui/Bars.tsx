// The top bar, the selection bar (duplicate, delete, mutate, fold, the ↶ history scrubber), the floating output
// (picture-in-picture, resizable, with a full-screen mode) and the starters sheet.
import type { Stmt } from '@hydra-ipad/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import { historyOf, scrubTo, tidy, ui, useUi } from '../doc'
import { BackdropButtons, Switcher, SketchName, UndoRedo, openMoreMenu } from '../kit/Chrome'
import { codeBridge } from '../kit/CodeDrawer'
import { newBlankSketch } from '../kit/actions'
import { ctx, useRunner, useStore } from '../kit/ctx'
import { closeSheet, openSheet } from '../kit/overlay'
import { deleteSel, dice, duplicateSel, foldSel, mutateSel, selectedStmtId } from '../ops'
import { appPrefs } from '../prefs'
import { STARTERS } from '../starters'
import { metaNow } from '../doc'
import { wsApi } from './Workspace'

export function TopBar() {
  const st = useUi()
  const runner = useRunner()
  return (
    <header class="topbar" data-testid="topbar">
      <Switcher />
      <SketchName />
      <span class="grow" />
      <BackdropButtons />
      <UndoRedo />
      <button type="button" class={`btn ${st.palette ? 'on' : ''}`} data-testid="palette-toggle" aria-pressed={st.palette} onClick={() => ui.set({ palette: !st.palette })}>
        Blocks
      </button>
      <button type="button" class="icon dice" data-testid="dice" aria-label="Surprise me" title="Surprise me: a random script" onClick={() => dice(wsApi.center())}>
        🎲
      </button>
      <button type="button" class={`btn ${st.code ? 'on' : ''}`} data-testid="code-toggle" aria-pressed={st.code} onClick={() => ui.set({ code: !st.code })}>
        Code
      </button>
      <button type="button" class="icon" data-testid="run" aria-label="Run again" title="Run again (⌘Enter)" onClick={() => (codeBridge.flush(), runner.run(true))}>
        ▶
      </button>
      <button type="button" class="icon" data-testid="hush" aria-label="Hush" title="Hush: a black picture until the next edit or ▶" onClick={hush}>
        ■
      </button>
      <button
        type="button"
        class="icon"
        data-testid="more"
        aria-label="More"
        onClick={(e) =>
          openMoreMenu(e.currentTarget as HTMLElement, [
            { label: 'New from a starter…', run: openStarters, testid: 'menu-starters' },
            { label: 'Tidy up (lay out again)', run: tidy, testid: 'menu-tidy' },
            { label: 'Fit to screen', run: () => ui.set({ fit: ui.state.fit + 1 }), testid: 'menu-fit' },
            { label: 'Full-screen output', run: () => ui.set({ perform: true }), testid: 'menu-full' },
          ])
        }
      >
        ⋯
      </button>
    </header>
  )
}

/** Hush: a black picture; the next edit or ▶ brings the sketch back. */
function hush(): void {
  void ctx.runner.rt?.hush()
}

// ---------------------------------------------------------------- selection

export function SelectionBar() {
  const st = useUi()
  useStore()
  if (!st.sel) return null
  const stmtId = selectedStmtId()
  const stmt = ctx.store.sketch.stmts.find((s) => s.id === stmtId)
  const folded = !!stmtId && (metaNow().collapsed ?? []).includes(stmtId)
  return (
    <div class="selbar" role="toolbar" aria-label="Selection" data-testid="selbar">
      <button type="button" class="btn" data-testid="sel-dup" onClick={duplicateSel}>
        Duplicate
      </button>
      <button type="button" class="btn danger" data-testid="sel-delete" onClick={deleteSel}>
        Delete
      </button>
      <button type="button" class="btn" data-testid="sel-mutate" title="Nudge every number of the script a little" onClick={() => mutateSel()}>
        ✨ Mutate
      </button>
      {stmt?.k === 'chain' && (
        <button type="button" class={`btn ${folded ? 'on' : ''}`} data-testid="sel-fold" onClick={foldSel}>
          {folded ? 'Unfold' : 'Fold'}
        </button>
      )}
      {stmtId && <Scrubber stmtId={stmtId} />}
      <button type="button" class="icon" aria-label="Clear selection" data-testid="sel-clear" onClick={() => ui.select(undefined)}>
        ✕
      </button>
    </div>
  )
}

/** ↶ slide back through the last 20 states of the selected script (each slide position is the script as it was). */
function Scrubber({ stmtId }: { stmtId: string }) {
  const h = historyOf(stmtId)
  const now = useRef<Stmt | undefined>()
  const [k, setK] = useState(h.length)
  useEffect(() => {
    now.current = undefined
    setK(historyOf(stmtId).length)
  }, [stmtId])
  if (!h.length) return null
  return (
    <label class="scrub" title="Slide back through this script's last changes">
      <span aria-hidden="true">↶</span>
      <input
        type="range"
        min={0}
        max={h.length}
        step={1}
        value={k}
        data-testid="sel-history"
        aria-label="Script history"
        onInput={(e) => {
          const v = Number((e.currentTarget as HTMLInputElement).value)
          const cur = ctx.store.sketch.stmts.find((s) => s.id === stmtId)
          if (!now.current && cur) now.current = cur
          setK(v)
          const target = v >= h.length ? now.current : h[v]
          if (target) scrubTo(stmtId, target)
        }}
        onChange={() => ctx.store.endGroup()}
      />
      <small>
        {k}/{h.length}
      </small>
    </label>
  )
}

// ---------------------------------------------------------------- starters

export function openStarters(): void {
  openSheet(
    'New from a starter',
    () => (
      <div class="starters" data-testid="starters">
        {STARTERS.map((s) => (
          <button
            type="button"
            key={s.name}
            class="card starter"
            data-starter={s.name}
            onClick={() => {
              closeSheet()
              void newBlankSketch(s.code, s.name)
            }}
          >
            <b>{s.name}</b>
            <small>{s.about}</small>
            <code>{s.code}</code>
          </button>
        ))}
      </div>
    ),
    { wide: true },
  )
}

// ---------------------------------------------------------------- PiP output + full screen

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
    <div class={`pip ${st.perform ? 'perform' : ''}`} style={style} data-testid="pip" data-hi-backdrop={st.perform ? undefined : 'stage'}>
      <div class="stage-slot" ref={slot} data-testid="stage-slot" />
      {st.perform ? (
        <button type="button" class="btn exit" data-testid="perform-exit" onClick={() => ui.set({ perform: false })}>
          Exit full screen
        </button>
      ) : (
        <>
          <div
            class="pip-grip" data-hi-backdrop="hide"
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
          <button
            type="button"
            class="icon pip-full" data-hi-backdrop="hide"
            aria-label="Full screen"
            data-testid="pip-full"
            data-no-undo-tap
            // on release, not click: the button sits over the output frame, where a click after a multi-finger gesture can go missing
            onPointerUp={() => ui.set({ perform: true })}
            onClick={(e) => e.detail === 0 && ui.set({ perform: true })}
          >
            ⛶
          </button>
          <div
            class="pip-resize" data-hi-backdrop="hide"
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
    </div>
  )
}
