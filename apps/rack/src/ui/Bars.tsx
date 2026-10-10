// The chrome around the rack: the top bar (tempo with tap, speed, freeze, hush, code, perform), the mixer (what is on
// screen, the routing matrix, lane chips to drag onto jacks), the mod bay, the scene column, the floating output and the
// performance overlay with pinned controls.
import { OUT_NAMES, type OutName } from '@hydra-ipad/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import { fadeTo, metaNow, recallScene, setView, storeScene, ui, useUi } from '../doc'
import { pressToDrag } from '../drag'
import { BackdropButtons, Meter, Switcher, SketchName, UndoRedo, openMoreMenu } from '../kit/Chrome'
import { codeBridge } from '../kit/CodeDrawer'
import { ctx, useRunner, useStore } from '../kit/ctx'
import { LONG_MS, NumSlider, toast } from '@hydra-ipad/kit'
import { LFO_KINDS, MOD_ICON, MOD_LABEL, type ModKind } from '../kit/mods'
import { commit } from '../doc'
import { mutateLanes, routeLane, unrouteLane } from '../ops'
import { appPrefs } from '../prefs'
import { parseKey, refInfo } from '../refs'
import { readsOf } from '../view'
import { MousePad } from './Controls'
import { Knob } from './Knob'
import { renderTarget, setRender } from './Lanes'
import { SETTING_DEFAULT, SETTING_HINT, openSources, setSetting, settingOf } from './Setup'

// ---------------------------------------------------------------- top bar

let frozenFrom: number | undefined

export function freeze(): void {
  const sp = settingOf('speed')?.v ?? SETTING_DEFAULT.speed
  if (sp > 0) {
    frozenFrom = sp
    setSetting('speed', 0)
  } else {
    setSetting('speed', frozenFrom ?? 1)
    frozenFrom = undefined
  }
}

export function TopBar() {
  const st = useUi()
  useStore()
  const runner = useRunner()
  const taps = useRef<number[]>([])
  const bpm = settingOf('bpm')?.v ?? SETTING_DEFAULT.bpm
  const speed = settingOf('speed')?.v ?? SETTING_DEFAULT.speed
  const tap = () => {
    const now = performance.now()
    const t = taps.current.filter((x) => now - x < 2500)
    t.push(now)
    taps.current = t.slice(-6)
    if (t.length < 2) return toast('Tap again to the beat')
    const gaps = t.slice(1).map((x, i) => x - t[i])
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
    setSetting('bpm', Math.max(20, Math.min(300, Math.round(60000 / avg))), 'tap-tempo')
  }
  return (
    <header class="topbar" data-testid="topbar">
      <Switcher />
      <SketchName />
      <span class="grow" />
      <div class="tempo" role="group" aria-label="Tempo">
        <NumSlider compact label="bpm" value={bpm} dim={!settingOf('bpm')} hint={SETTING_HINT.bpm} testid="bpm" onChange={(v, ph) => (ph === 'end' ? ctx.store.endGroup() : setSetting('bpm', v, 'bpm'))} />
        <button type="button" class="btn sm" data-testid="tap-tempo" data-no-undo-tap onClick={tap}>
          tap
        </button>
        <NumSlider compact label="speed" value={speed} dim={!settingOf('speed')} hint={SETTING_HINT.speed} testid="speed" onChange={(v, ph) => (ph === 'end' ? ctx.store.endGroup() : setSetting('speed', v, 'speed'))} />
        <button type="button" class={`icon ${speed === 0 ? 'on' : ''}`} data-testid="freeze" aria-pressed={speed === 0} aria-label="Freeze" title="Freeze: speed 0 (tap again to thaw)" onClick={freeze}>
          ▮▮
        </button>
      </div>
      <BackdropButtons />
      <UndoRedo />
      <button type="button" class="btn" data-testid="sources" onClick={openSources}>
        S0–S3
      </button>
      <button type="button" class={`btn ${st.code ? 'on' : ''}`} data-testid="code-toggle" aria-pressed={st.code} onClick={() => ui.set({ code: !st.code })}>
        Code
      </button>
      <button type="button" class="icon" data-testid="run" aria-label="Run again" title="Run again (⌘Enter)" onClick={() => (codeBridge.flush(), runner.run(true))}>
        ▶
      </button>
      <button type="button" class="icon" data-testid="hush" aria-label="Hush" title="Hush: a black picture until the next edit or ▶" onClick={() => void ctx.runner.rt?.hush()}>
        ■
      </button>
      <button type="button" class="btn perform-btn" data-testid="perform" title="Performance mode: the picture full screen with your pinned controls" onClick={() => ui.set({ perform: true })}>
        Perform
      </button>
      <button
        type="button"
        class="icon"
        data-testid="more"
        aria-label="More"
        onClick={(e) =>
          openMoreMenu(e.currentTarget as HTMLElement, [
            { label: 'Morph every unlocked lane to random (8 beats)', run: morphAll, testid: 'menu-morph' },
            { label: st.bay ? 'Hide the mod bay' : 'Show the mod bay', run: () => ui.set({ bay: !st.bay }) },
          ])
        }
      >
        ⋯
      </button>
    </header>
  )
}

export function morphAll(): void {
  const next = mutateLanes(ctx.store.sketch, ctx.catalog, Math.random, metaNow().frozen ?? [])
  fadeTo(next.stmts, 8)
}

// ---------------------------------------------------------------- mixer

export function Mixer() {
  useStore()
  const sk = ctx.store.sketch
  const shown = renderTarget(sk.stmts)
  const reads = readsOf(sk)
  const toggle = (to: OutName, from: OutName) => {
    if (reads[to].includes(from)) commit(unrouteLane(ctx.store.sketch, to, from))
    else commit(routeLane(ctx.store.sketch, to, from).sketch)
  }
  return (
    <aside class="mixer" data-testid="mixer" aria-label="Mixer">
      <div class="mixgroup">
        <small>on screen</small>
        <div class="seg render" role="group" aria-label="On screen">
          {OUT_NAMES.map((o) => (
            <button type="button" key={o} class={shown === o ? 'on' : ''} data-testid={`render-${o}`} aria-pressed={shown === o} onClick={() => setRender(o)}>
              {o.toUpperCase()}
            </button>
          ))}
          <button type="button" class={shown === 'all' ? 'on' : ''} data-testid="render-all" aria-pressed={shown === 'all'} onClick={() => setRender('all')}>
            all
          </button>
        </div>
      </div>
      <div class="mixgroup">
        <small>routing: row reads column</small>
        <table class="matrix" data-testid="matrix">
          <thead>
            <tr>
              <th />
              {OUT_NAMES.map((o) => (
                <th key={o}>{o.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {OUT_NAMES.map((to) => (
              <tr key={to}>
                <th>{to.toUpperCase()}</th>
                {OUT_NAMES.map((from) => (
                  <td key={from}>
                    <button
                      type="button"
                      class={`cell ${reads[to].includes(from) ? 'on' : ''} ${to === from ? 'fb' : ''}`}
                      data-testid={`route-${to}-${from}`}
                      aria-pressed={reads[to].includes(from)}
                      aria-label={`${to} reads ${from}${to === from ? ' (feedback)' : ''}`}
                      onClick={() => toggle(to, from)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="mixgroup">
        <small>drag onto a jack</small>
        <div class="chips">
          {[...OUT_NAMES, 's0', 's1', 's2', 's3'].map((o) => (
            <span key={o} class={`chip lanechip ${o.startsWith('s') ? 'srcchip' : ''}`} data-testid={`chip-${o}`} onPointerDown={(e) => pressToDrag(e, { t: 'lane', name: o }, o.toUpperCase(), () => toast('Drag it onto a texture jack'))}>
              {o.toUpperCase()}
            </span>
          ))}
        </div>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------- mod bay

interface Tile {
  kind: ModKind
  bin?: number
  label: string
  icon: string
}

const TILES: Tile[] = [
  ...LFO_KINDS.map((k) => ({ kind: k, label: MOD_LABEL[k].replace(' LFO', ''), icon: MOD_ICON[k] })),
  { kind: 'steps', label: 'Steps', icon: MOD_ICON.steps },
  { kind: 'time', label: 'Time', icon: MOD_ICON.time },
  { kind: 'mouseX', label: 'Mouse X', icon: MOD_ICON.mouseX },
  { kind: 'mouseY', label: 'Mouse Y', icon: MOD_ICON.mouseY },
  ...[0, 1, 2, 3].map((b) => ({ kind: 'audio' as ModKind, bin: b, label: `Bin ${b}`, icon: MOD_ICON.audio })),
  { kind: 'vol', label: 'Volume', icon: MOD_ICON.vol },
  { kind: 'expr', label: 'Expression', icon: MOD_ICON.expr },
]

const tileKey = (t: Tile) => (t.bin === undefined ? t.kind : `${t.kind}:${t.bin}`)

export function ModBay() {
  const st = useUi()
  if (!st.bay) return null
  return (
    <section class="bay" data-testid="modbay" aria-label="Modulation sources">
      <div class="tiles">
        {TILES.map((t) => {
          const k = tileKey(t)
          return (
            <div
              key={k}
              class={`tile m-${t.kind} ${st.armed === k ? 'armed' : ''}`}
              role="button"
              tabIndex={0}
              data-testid={`tile-${k}`}
              data-no-undo-tap
              title="Drag onto a knob (or tap, then tap a knob)"
              onPointerDown={(e) =>
                pressToDrag(e, { t: 'mod', kind: t.kind, bin: t.bin }, `${t.icon} ${t.label}`, () => {
                  const armed = ui.state.armed === k ? undefined : k
                  ui.set({ armed })
                  if (armed) toast(`${t.label}: now tap a knob`, undefined, 2500)
                })
              }
            >
              <b aria-hidden="true">{t.icon}</b>
              <span>{t.label}</span>
              {t.kind === 'audio' && <Meter bin={t.bin ?? 0} />}
              {t.kind === 'vol' && <Meter bin={-1} />}
            </div>
          )
        })}
      </div>
      <MousePad />
    </section>
  )
}

// ---------------------------------------------------------------- scenes

export const SLOTS = ['1', '2', '3', '4', '5', '6', '7', '8']
const FADES = [0, 1, 2, 4, 8]

export function Scenes() {
  const st = useUi()
  useStore()
  const m = metaNow()
  const press = useRef<{ id: number; timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null)
  return (
    <aside class="scenes" data-testid="scenes" aria-label="Scenes">
      <small>scenes</small>
      {SLOTS.map((s) => {
        const has = !!m.scenes?.[s]
        return (
          <button
            type="button"
            key={s}
            class={`scene ${has ? 'full' : ''} ${st.fading === s ? 'fading' : ''}`}
            data-testid={`scene-${s}`}
            data-no-undo-tap
            aria-label={has ? `Scene ${s}: tap to recall, hold to store again` : `Scene ${s}: hold to store`}
            onPointerDown={(e) => {
              const id = e.pointerId
              const p = { id, fired: false, timer: setTimeout(() => {
                p.fired = true
                storeScene(s)
              }, LONG_MS + 140) }
              press.current = p
            }}
            onPointerUp={(e) => {
              const p = press.current
              if (!p || p.id !== e.pointerId) return
              clearTimeout(p.timer)
              press.current = null
              if (p.fired) return
              if (!has) return toast('Hold a scene button to store the rack in it')
              recallScene(s)
            }}
            onPointerCancel={() => {
              if (press.current) clearTimeout(press.current.timer)
              press.current = null
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {s}
          </button>
        )
      })}
      <small>fade</small>
      <button
        type="button"
        class="btn sm fade"
        data-testid="scene-fade"
        title="Crossfade length in beats"
        onClick={() => {
          const cur = m.fade ?? 4
          setView({ fade: FADES[(FADES.indexOf(cur) + 1) % FADES.length] })
        }}
      >
        {m.fade ?? 4}♩
      </button>
    </aside>
  )
}

// ---------------------------------------------------------------- output (PiP) and performance mode

interface PipBox {
  x: number
  y: number
  w: number
}

/** Bottom right, clear of the scene column and the mod bay. */
function defaultPip(): PipBox {
  const w = Math.min(300, Math.round(window.innerWidth * 0.28))
  return { x: -76, y: Math.max(60, window.innerHeight - (w * 9) / 16 - 150), w }
}

export function Pip({ stage }: { stage: HTMLElement }) {
  const st = useUi()
  const runner = useRunner()
  const slot = useRef<HTMLDivElement>(null)
  const [b, setB] = useState<PipBox>(() => appPrefs.get<PipBox>('pip') ?? defaultPip())
  useEffect(() => {
    if (slot.current && stage.parentElement !== slot.current) slot.current.appendChild(stage)
  }, [stage])
  const drag = useRef<{ id: number; x0: number; y0: number; b0: PipBox; resize: boolean } | null>(null)
  const save = (nb: PipBox) => appPrefs.set('pip', nb)
  const style = st.perform ? {} : { width: `${b.w}px`, height: `${(b.w * 9) / 16}px`, top: `${b.y}px`, ...(b.x < 0 ? { right: `${-b.x}px` } : { left: `${b.x}px` }) }
  return (
    <div class={`pip ${st.perform ? 'perform' : ''}`} style={style} data-testid="pip" data-hi-backdrop={st.perform ? undefined : 'stage'}>
      <div class="stage-slot" ref={slot} data-testid="stage-slot" />
      {st.perform ? (
        <PinBar />
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
          <button type="button" class="icon pip-full" data-hi-backdrop="hide" aria-label="Performance mode" data-testid="pip-full" data-no-undo-tap onPointerUp={() => ui.set({ perform: true })} onClick={(e) => e.detail === 0 && ui.set({ perform: true })}>
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

/** Performance mode: up to eight pinned controls float translucent along the bottom edge; scenes stay on the right. */
function PinBar() {
  useStore()
  const st = useUi()
  const pins = (metaNow().pins ?? []).filter((k) => refInfo(ctx.store.sketch, parseKey(k), ctx.catalog).exists)
  return (
    <div class="perform-ui">
      <button type="button" class="btn exit" data-testid="perform-exit" onClick={() => ui.set({ perform: false })}>
        Exit
      </button>
      <div class="pins" data-testid="pins">
        {pins.length ? pins.map((k) => <Knob key={k} r={parseKey(k)} />) : <small class="nopins">Long-press any knob and choose “Pin to performance” to bring it here.</small>}
      </div>
      <div class="pscenes">
        {SLOTS.filter((s) => metaNow().scenes?.[s]).map((s) => (
          <button type="button" key={s} class={`scene full ${st.fading === s ? 'fading' : ''}`} data-testid={`pscene-${s}`} onClick={() => recallScene(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
