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
import { addPad, bindToPad, kitMeta, knobBase, livePads, padPress, padRelease, padsOf, removePad, setKnobBase, unbindKnob, updatePad, withKitMeta, withPads, type PadConfig, type PadMode } from './pads'

const MODES: Array<{ id: PadMode; label: string; hint: string }> = [
  { id: 'hold', label: 'Hold', hint: 'press goes to the value and stays; release glides back' },
  { id: 'latch', label: 'Latch', hint: 'each press toggles between two values' },
  { id: 'trigger', label: 'Trigger', hint: 'each press glides to the value and it stays there: add more pads for a row of presets' },
]
const TIME_HINT = { min: 0, max: 4, step: 0.01 }

const latched = new Map<string, boolean>()
let warnedInert = 0

/** One edit through the host. Pad settings are code (undoable); `view` is for dock positions; `coalesce` for a drag. */
function edit(h: KitHost, f: (s: ReturnType<KitHost['sketch']>) => ReturnType<KitHost['sketch']>, view = false, coalesce?: string): void {
  const s = h.sketch()
  const n = f(s)
  if (n !== s) h.commit(n, view ? { view: true } : coalesce ? { coalesce } : undefined)
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
        <code>{'<name> = knob(' + fmt(field.get()) + ', { pads: [ … ] })'}</code> into the sketch: plain Hydra with the hydra-motion plugin, with the pads' settings in the code.
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

/**
 * A knob's pads: a row of them to try, each with a handle that switches the settings below to it and an × that removes it;
 * then the chosen pad's mode, values, times and curve; the knob's base value; unbind.
 */
export function PadEditor({ knob, pad: first }: { knob: string; pad?: string }) {
  const h = useHost()
  // which of the knob's pads the settings show, by place (pad ids are places too: `<knob>#<n>`)
  const [picked, pick] = useState<number>(() => {
    const s = h?.sketch()
    return s ? Math.max(0, padsOf(s).filter((p) => p.knob === knob).findIndex((p) => p.id === first)) : 0
  })
  if (!h) return null
  const sk = h.sketch()
  const base = knobBase(sk, knob)
  const pads = padsOf(sk).filter((p) => p.knob === knob)
  if (base === undefined) return <p class="empty">{knob} is no longer in the sketch.</p>
  const p = pads[Math.min(picked, pads.length - 1)]
  const set = (id: string, patch: Partial<PadConfig>) => edit(h, (s) => updatePad(s, id, patch))
  const slide = (id: string, key: keyof PadConfig) => (v: number, ph?: string) => (ph === 'end' ? h.endGroup?.() : edit(h, (s) => updatePad(s, id, { [key]: v }), false, `pad-${id}-${key}`))
  const range = Math.max(1, Math.abs(base) * 2, ...pads.map((p) => Math.abs(p.value)))
  const hint = { min: Math.min(0, -range * (base < 0 ? 1 : 0)), max: range, step: 0.01 }
  const remove = (gone: PadConfig) => {
    const at = padsOf(h.sketch()).findIndex((x) => x.id === gone.id)
    const mine = pads.indexOf(gone)
    edit(h, (s) => removePad(s, gone.id))
    if (mine < picked || picked >= pads.length - 1) pick(Math.max(0, picked - 1))
    toast(`Removed ${gone.label}`, {
      label: 'Undo',
      run: () => {
        const now = padsOf(h.sketch())
        edit(h, (s) => withPads(s, [...now.slice(0, at), gone, ...now.slice(at)]))
        pick(mine)
      },
    })
  }
  return (
    <div class="padeditor" data-testid="pad-editor" data-knob={knob}>
      <div class="pe-head">
        <code>
          {knob} = knob({fmt(base)})
        </code>
        {!h.trusted() && <small class="pad-inert">pads start working once the sketch runs its code</small>}
      </div>
      <NumSlider label="base" value={base} hint={hint} testid="pad-base" stack onChange={(v, ph) => (ph === 'end' ? h.endGroup?.() : edit(h, (s) => setKnobBase(s, knob, v), false, `knob-${knob}`))} />
      <div class="pe-pads" role="group" aria-label={`Pads for ${knob}`}>
        {pads.map((x, i) => (
          <div class={`pe-slot ${x.id === p?.id ? 'on' : ''}`} key={x.id} data-pad={x.id}>
            <Pad pad={x} host={h} base={base} />
            {x.id !== p?.id && (
              <button type="button" class="pe-handle pe-pick" data-testid="pad-pick" aria-label={`Edit the ${x.label} pad`} onClick={() => pick(i)}>
                ✎
              </button>
            )}
            {pads.length > 1 && (
              <button type="button" class="pe-handle pe-x" data-testid="pad-remove" aria-label={`Remove the ${x.label} pad`} onClick={() => remove(x)}>
                ✕
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          class="pe-add"
          data-testid="pad-add"
          aria-label={`Add a pad for ${knob}`}
          onClick={() => {
            const r = addPad(h.sketch(), knob)
            edit(h, () => r.sketch)
            if (r.pad) pick(pads.length)
          }}
        >
          ＋
        </button>
      </div>
      {p && (
        <div class="pe-pad" key={p.id} data-pad={p.id}>
          <div class="pe-name">{p.label}</div>
          <div class="seg pe-modes" role="radiogroup" aria-label="Pad mode">
            {MODES.map((m) => (
              <button type="button" role="radio" aria-checked={p.mode === m.id} key={m.id} class={p.mode === m.id ? 'on' : ''} data-testid={`pad-mode-${m.id}`} title={m.hint} onClick={() => set(p.id, { mode: m.id })}>
                {m.label}
              </button>
            ))}
          </div>
          <small class="pe-hint">{MODES.find((m) => m.id === p.mode)?.hint}</small>
          <NumSlider label={p.mode === 'latch' ? 'on' : 'to'} value={p.value} hint={hint} testid="pad-value" stack onChange={slide(p.id, 'value')} />
          {p.mode === 'latch' && <NumSlider label="off" value={p.value2 ?? base} hint={hint} testid="pad-value2" stack onChange={slide(p.id, 'value2')} />}
          <NumSlider label="attack s" value={p.attack} hint={TIME_HINT} testid="pad-attack" stack onChange={slide(p.id, 'attack')} />
          {p.mode !== 'trigger' && <NumSlider label={p.mode === 'hold' ? 'release s' : 'off s'} value={p.release} hint={TIME_HINT} testid="pad-release" stack onChange={slide(p.id, 'release')} />}
          <div class="curves" role="radiogroup" aria-label="Pad curve">
            {EASE_PRESETS.map((name) => (
              <button type="button" role="radio" aria-checked={p.ease === name} key={name} class={`curve ${p.ease === name ? 'on' : ''}`} data-ease={name} title={easeLabel(name)} aria-label={easeLabel(name)} onClick={() => set(p.id, { ease: name })}>
                <svg width="28" height="20" viewBox="-1 -1 30 22" aria-hidden="true">
                  <path d={easePath(name)} />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}
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

export function openPadEditor(knob: string, pad?: string): void {
  openSheet(`Pad · ${knob}`, () => <PadEditor knob={knob} pad={pad} />)
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
        <button type="button" class="icon sm" aria-label={`Edit the ${pad.label} pad`} data-testid={`pad-edit-${pad.knob}`} onClick={() => openPadEditor(pad.knob, pad.id)}>
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
