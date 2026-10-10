// Pads on screen: the number editor's Pad tab (bind, configure, unbind), the floating PadDock every editor opens from its ⇄
// menu, and PadStrip, the same pads inline for a host that wants to place them itself (the rack's performance mode).
// Each pad captures its own pointer, so several fingers play several pads; every press and release is one runtime.invoke.
import { useEffect, useRef, useState } from 'preact/hooks'
import { fmt, wrapInto } from './conv'
import { EASE_PRESETS, easeLabel, easePath } from './easing'
import type { NumberField } from './field'
import { kitHost, useHost, type KitHost } from './host'
import { NumSlider } from './NumSlider'
import { closePopover, openSheet, toast } from './overlay'
import { bindToPad, kitMeta, knobBase, livePads, padPress, padRelease, padsOf, setKnobBase, unbindKnob, updatePad, withKitMeta, type PadConfig, type PadMode } from './pads'

const MODES: Array<{ id: PadMode; label: string; hint: string }> = [
  { id: 'hold', label: 'Hold', hint: 'press goes to the value and stays; release glides back' },
  { id: 'latch', label: 'Latch', hint: 'each press toggles between two values' },
  { id: 'trigger', label: 'Trigger', hint: 'each press glides to the value' },
]
const TIME_HINT = { min: 0, max: 4, step: 0.01 }

const latched = new Map<string, boolean>()
let warnedInert = 0

function edit(h: KitHost, f: (s: ReturnType<KitHost['sketch']>) => ReturnType<KitHost['sketch']>, view = false): void {
  const s = h.sketch()
  const n = f(s)
  if (n !== s) h.commit(n, view ? { view: true } : undefined)
}

// ---------------------------------------------------------------- the Pad tab

export function PadTab({ field }: { field: NumberField }) {
  const h = useHost()
  const [knob, setKnob] = useState<string | undefined>(undefined)
  if (!h) return <p class="empty">Pads are not available here.</p>
  if (knob && knobBase(h.sketch(), knob) !== undefined) return <PadEditor knob={knob} />
  if (!field.arg) {
    return (
      <div class="padtab" data-testid="pad-tab">
        <p class="pad-note">Only a function's argument can be bound to a pad (this number is a {field.label.includes('[') ? 'step of an array' : 'setting or a value inside something else'}).</p>
      </div>
    )
  }
  const arg = field.arg
  return (
    <div class="padtab" data-testid="pad-tab">
      <p class="pad-note">
        A pad plays <b>{field.label}</b> from a button: hold it to push the value somewhere else, let go and it glides back. It writes{' '}
        <code>{'<name> = knob(' + fmt(field.get()) + ')'}</code> into the sketch, which runs in plain Hydra with the hydra-motion plugin.
      </p>
      <button
        type="button"
        class="btn primary wide"
        data-testid="pad-bind"
        onClick={() => {
          const wasTrusted = h.trusted()
          const r = bindToPad(h.sketch(), arg.callId, arg.index, field.get(), { label: field.label, inputName: arg.input, padValue: suggestTarget(field) })
          if (!r) return toast('This number is no longer in the sketch')
          h.commit(r.sketch)
          // the owner wrote this code just now on a sketch that already ran its code: no need to ask again
          if (wasTrusted) h.approveOnce?.()
          setKnob(r.knob)
          showPadDock(true)
        }}
      >
        Bind to a pad
      </button>
    </div>
  )
}

function suggestTarget(f: NumberField): number {
  const v = f.get()
  const { min, max } = f.hint
  // an angle's far end is where it started: go half a turn instead
  if (f.hint.wrap) return +wrapInto(v + (max - min) / 2, min, max).toPrecision(6)
  const far = Math.abs(max - v) >= Math.abs(v - min) ? max : min
  return f.hint.integer ? Math.round(far) : +far.toPrecision(6)
}

/** A knob's pads: mode, values, times, curve; base value; unbind. */
export function PadEditor({ knob }: { knob: string }) {
  const h = useHost()
  if (!h) return null
  const sk = h.sketch()
  const base = knobBase(sk, knob)
  const pads = padsOf(sk).filter((p) => p.knob === knob)
  if (base === undefined) return <p class="empty">{knob} is no longer in the sketch.</p>
  const set = (id: string, patch: Partial<PadConfig>) => edit(h, (s) => updatePad(s, id, patch), true)
  const range = Math.max(1, Math.abs(base) * 2, ...pads.map((p) => Math.abs(p.value)))
  const hint = { min: Math.min(0, -range * (base < 0 ? 1 : 0)), max: range, step: 0.01 }
  return (
    <div class="padeditor" data-testid="pad-editor" data-knob={knob}>
      <div class="pe-head">
        <code>
          {knob} = knob({fmt(base)})
        </code>
        {!h.trusted() && <small class="pad-inert">pads start working once the sketch runs its code</small>}
      </div>
      <NumSlider label="base" value={base} hint={hint} testid="pad-base" stack onChange={(v, ph) => (ph === 'end' ? h.endGroup?.() : edit(h, (s) => setKnobBase(s, knob, v)))} />
      {pads.map((p) => (
        <div class="pe-pad" key={p.id} data-pad={p.id}>
          <div class="seg pe-modes" role="radiogroup" aria-label="Pad mode">
            {MODES.map((m) => (
              <button type="button" role="radio" aria-checked={p.mode === m.id} key={m.id} class={p.mode === m.id ? 'on' : ''} data-testid={`pad-mode-${m.id}`} title={m.hint} onClick={() => set(p.id, { mode: m.id })}>
                {m.label}
              </button>
            ))}
          </div>
          <small class="pe-hint">{MODES.find((m) => m.id === p.mode)?.hint}</small>
          <NumSlider label={p.mode === 'latch' ? 'on' : 'to'} value={p.value} hint={hint} testid="pad-value" stack onChange={(v, ph) => ph !== 'end' && set(p.id, { value: v })} />
          {p.mode === 'latch' && <NumSlider label="off" value={p.value2 ?? base} hint={hint} testid="pad-value2" stack onChange={(v, ph) => ph !== 'end' && set(p.id, { value2: v })} />}
          <NumSlider label="attack s" value={p.attack} hint={TIME_HINT} testid="pad-attack" stack onChange={(v, ph) => ph !== 'end' && set(p.id, { attack: v })} />
          {p.mode !== 'trigger' && <NumSlider label={p.mode === 'hold' ? 'release s' : 'off s'} value={p.release} hint={TIME_HINT} testid="pad-release" stack onChange={(v, ph) => ph !== 'end' && set(p.id, { release: v })} />}
          <div class="curves" role="radiogroup" aria-label="Pad curve">
            {EASE_PRESETS.map((name) => (
              <button type="button" role="radio" aria-checked={p.ease === name} key={name} class={`curve ${p.ease === name ? 'on' : ''}`} data-ease={name} title={easeLabel(name)} aria-label={easeLabel(name)} onClick={() => set(p.id, { ease: name })}>
                <svg width="28" height="20" viewBox="-1 -1 30 22" aria-hidden="true">
                  <path d={easePath(name)} />
                </svg>
              </button>
            ))}
          </div>
          <div class="pe-try">
            <Pad pad={p} host={h} base={base} />
          </div>
        </div>
      ))}
      <div class="actions">
        <button type="button" class="btn" data-testid="pad-show" onClick={() => showPadDock(true)}>
          Show pads
        </button>
        <button
          type="button"
          class="btn danger"
          data-testid="pad-unbind"
          onClick={() => {
            edit(h, (s) => unbindKnob(s, knob))
            closePopover()
            toast(`${knob} is a plain number again (${fmt(base)})`)
          }}
        >
          Unbind
        </button>
      </div>
    </div>
  )
}

export function openPadEditor(knob: string): void {
  openSheet(`Pad · ${knob}`, () => <PadEditor knob={knob} />)
}

// ---------------------------------------------------------------- one pad

function Pad({ pad, host, base, compact }: { pad: PadConfig; host: KitHost; base: number; compact?: boolean }) {
  const [down, setDown] = useState(false)
  const [, bump] = useState(0)
  const ptr = useRef<number | null>(null)
  const inert = !host.trusted()
  // trust changes without a store change (the owner taps Run it, a re-run settles): look again while inert
  useEffect(() => {
    if (!inert) return
    const t = setInterval(() => bump((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [inert])
  const on = latched.get(pad.id) ?? false
  const press = (e: PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (ptr.current !== null) return
    if (!host.trusted()) {
      if (Date.now() - warnedInert > 4000) toast('Pads are off until the sketch runs its code: tap Run it in the banner')
      warnedInert = Date.now()
      return
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    ptr.current = e.pointerId
    setDown(true)
    const r = padPress(pad, host.invoke, base, on)
    if (!r.ok) toast(`${pad.knob} is not running yet: wait for the preview to restart`, undefined, 2500)
    if (pad.mode === 'latch') {
      latched.set(pad.id, r.on)
      bump((n) => n + 1)
    }
  }
  const release = (e: PointerEvent) => {
    if (ptr.current !== e.pointerId) return
    ptr.current = null
    setDown(false)
    padRelease(pad, host.invoke)
  }
  return (
    <button
      type="button"
      class={`pad ${pad.mode} ${down ? 'down' : ''} ${on ? 'latched' : ''} ${inert ? 'inert' : ''} ${compact ? 'compact' : ''}`}
      data-testid={`pad-${pad.knob}`}
      data-pad={pad.id}
      data-no-undo-tap
      aria-pressed={pad.mode === 'latch' ? on : down}
      aria-label={`${pad.label} pad (${pad.mode}${inert ? ', off until the sketch runs its code' : ''})`}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <b>{pad.label}</b>
      <small>
        {pad.mode} → {fmt(pad.value)}
      </small>
    </button>
  )
}

// ---------------------------------------------------------------- the dock

let dockOpen = false
const dockListeners = new Set<() => void>()

/** Open or close the floating pads (the ⇄ menu's "Pads"). The choice is saved with the sketch (meta.kit.dock). */
export function showPadDock(open = !dockOpen): void {
  dockOpen = open
  const h = kitHost()
  if (h && (kitMeta(h.sketch()).dock ?? false) !== open) h.commit(withKitMeta(h.sketch(), { dock: open }), { view: true })
  dockListeners.forEach((l) => l())
}
export function padDockOpen(): boolean {
  return dockOpen
}

/** The pads in a row, for a host that places them itself (the rack's performance mode). */
export function PadStrip() {
  const h = useHost()
  if (!h) return null
  const sk = h.sketch()
  const pads = livePads(sk)
  if (!pads.length) return null
  return (
    <div class="padstrip" data-testid="pad-strip">
      {pads.map((p) => (
        <Pad key={p.id} pad={p} host={h} base={knobBase(sk, p.knob) ?? 0} compact />
      ))}
    </div>
  )
}

/** The floating dock, drawn by OverlayHost: pads you can drag by their grip, each with an edit button. */
export function PadDock() {
  const h = useHost()
  const [, set] = useState(0)
  useEffect(() => {
    const l = () => set((n) => n + 1)
    dockListeners.add(l)
    return () => void dockListeners.delete(l)
  }, [])
  // each sketch opens with its dock as it was saved (another sketch's open dock does not follow it)
  const sid = h?.sketch().id
  const want = h ? (kitMeta(h.sketch()).dock ?? false) : false
  useEffect(() => {
    if (dockOpen !== want) {
      dockOpen = want
      set((n) => n + 1)
    }
  }, [sid])
  if (!h || !dockOpen) return null
  const sk = h.sketch()
  const pads = livePads(sk)
  return (
    <div class="paddock" data-testid="pad-dock">
      {pads.length === 0 && (
        <div class="pad-empty dockcard" style={{ right: '16px', bottom: '96px' }}>
          <span>No pads yet: tap a number, then Pad → Bind to a pad.</span>
          <button type="button" class="icon" aria-label="Close pads" onClick={() => showPadDock(false)}>
            ✕
          </button>
        </div>
      )}
      {pads.map((p, i) => (
        <DockPad key={p.id} pad={p} i={i} host={h} base={knobBase(sk, p.knob) ?? 0} />
      ))}
    </div>
  )
}

function DockPad({ pad, i, host, base }: { pad: PadConfig; i: number; host: KitHost; base: number }) {
  const [drag, setDrag] = useState<{ id: number; dx: number; dy: number; x: number; y: number } | null>(null)
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768
  const W = 120
  const H = 96
  const x = drag ? drag.x : pad.x !== undefined ? pad.x * vw : vw - 16 - W - (i % 4) * (W + 10)
  const y = drag ? drag.y : pad.y !== undefined ? pad.y * vh : vh - 120 - H - Math.floor(i / 4) * (H + 10)
  const left = Math.max(4, Math.min(vw - W - 4, x))
  const top = Math.max(4, Math.min(vh - H - 4, y))
  return (
    <div class="dockpad" style={{ left: `${left}px`, top: `${top}px`, width: `${W}px` }}>
      <Pad pad={pad} host={host} base={base} />
      <div class="dockpad-bar">
        <span
          class="grip"
          role="button"
          aria-label={`Move the ${pad.label} pad`}
          data-testid={`pad-grip-${pad.knob}`}
          onPointerDown={(e) => {
            e.stopPropagation()
            ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
            setDrag({ id: e.pointerId, dx: e.clientX - left, dy: e.clientY - top, x: left, y: top })
          }}
          onPointerMove={(e) => {
            if (!drag || drag.id !== e.pointerId) return
            setDrag({ ...drag, x: e.clientX - drag.dx, y: e.clientY - drag.dy })
          }}
          onPointerUp={(e) => {
            if (!drag || drag.id !== e.pointerId) return
            setDrag(null)
            edit(host, (s) => updatePad(s, pad.id, { x: +(drag.x / vw).toFixed(4), y: +(drag.y / vh).toFixed(4) }), true)
          }}
          onPointerCancel={() => setDrag(null)}
        >
          ⠿
        </span>
        <button type="button" class="icon sm" aria-label={`Edit the ${pad.label} pad`} data-testid={`pad-edit-${pad.knob}`} onClick={() => openPadEditor(pad.knob)}>
          ✎
        </button>
      </div>
    </div>
  )
}

/** The ⇄ menu entry every editor passes to mountSwitcher's `extraTools`. */
export function padsTool(): { label: string; small: string; key: string; run: () => void } {
  return { label: 'Pads', small: 'play knobs from pads', key: 'pads', run: () => showPadDock() }
}
