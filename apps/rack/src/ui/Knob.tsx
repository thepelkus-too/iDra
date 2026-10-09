// The rotary knob (and its vertical-fader twin for colour blocks): one number input of one module, or one variable.
//
// Drag up or right to turn it up (Apple Pencil is finer; a second finger on the same knob while dragging is ×0.1 fine
// mode). Tap: keypad (or the modulator's editor). Double-tap: default. Long-press: name, exact value and a menu (pin,
// modulate, remove the modulation, reset). A modulated knob grows a ring showing the swing around its centre; drag on the
// outer ring to change the depth, inside it to move the centre. Each knob captures its own pointer, so two knobs turn at
// once, and all knobs moving together are one undo step.
import { num, type Value } from '@hydra-ipad/core'
import { useRef } from 'preact/hooks'
import { metaNow, setValue, setView, ui } from '../doc'
import { clamp, fmt, roundTo, wrapInto } from '../kit/conv'
import { ctx } from '../kit/ctx'
import { LONG_MS } from '../kit/gestures'
import { Keypad } from '../kit/Keypad'
import { openMenu, type MenuItem } from '../kit/Menu'
import { getArg } from '../kit/model'
import { MOD_ICON, modToValue, valueToMod, type ModKind, type ModSpec } from '../kit/mods'
import { closePopover, hud, openPopover, toast } from '../kit/overlay'
import { assignMod, unassignMod } from '../ops'
import { refInfo, refKey, type ArgRef, type RefInfo } from '../refs'
import { openModEditor } from './ModEditor'

// ---------------------------------------------------------------- what a knob shows

export type Face =
  | { k: 'num'; v: number; dim: boolean }
  | { k: 'mod'; spec: ModSpec }
  | { k: 'var'; name: string }
  | { k: 'expr'; src: string }
  | { k: 'other'; text: string }

export function faceOf(v: Value | undefined, info: RefInfo): Face {
  if (!v || v.k === 'default') return { k: 'num', v: info.def ?? 0, dim: true }
  if (v.k === 'num') return { k: 'num', v: v.v, dim: false }
  if (v.k === 'var') return { k: 'var', name: v.name }
  const m = valueToMod(v)
  if (m && m.kind !== 'expr') return { k: 'mod', spec: m }
  if (m) return { k: 'expr', src: m.src ?? '' }
  return { k: 'other', text: v.k === 'ref' ? v.name : v.k }
}

/** The centre value a knob points at. */
export function baseOfFace(f: Face): number {
  if (f.k === 'num') return f.v
  if (f.k === 'mod') return f.spec.kind === 'steps' ? (f.spec.steps?.[0] ?? 0) : f.spec.off
  return 0
}

/** [low, high] the modulator swings through (the ring). */
export function swingOf(s: ModSpec): [number, number] {
  if (s.kind === 'steps') {
    const st = s.steps ?? [0]
    return [Math.min(...st), Math.max(...st)]
  }
  if (s.kind === 'sine') return [s.off - Math.abs(s.amp), s.off + Math.abs(s.amp)]
  return [Math.min(s.off, s.off + s.amp), Math.max(s.off, s.off + s.amp)]
}

const SWEEP = 270
const angleOf = (frac: number) => -135 + clamp(frac, 0, 1) * SWEEP

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)]
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

// ---------------------------------------------------------------- gesture grouping

let active = 0
let gesture = 0
/** Every knob held at the same time shares one undo step. */
function beginGesture(): string {
  if (active === 0) gesture++
  active++
  return `knobs:${gesture}`
}
function endGesture(): void {
  active = Math.max(0, active - 1)
  if (active === 0) ctx.store.endGroup()
}

// ---------------------------------------------------------------- actions

export function togglePin(key: string): void {
  const pins = metaNow().pins ?? []
  if (pins.includes(key)) return setView({ pins: pins.filter((p) => p !== key) })
  if (pins.length >= 8) return toast('Eight controls are pinned already: unpin one first')
  setView({ pins: [...pins, key] })
  toast('Pinned to performance mode', undefined, 1500)
}

export function assignTo(r: ArgRef, kind: ModKind, bin?: number): void {
  const sk = ctx.store.sketch
  ctx.store.commit(assignMod(sk, r, kind, ctx.catalog, bin !== undefined ? { bin } : {}))
}

function openKeypad(el: Element, r: ArgRef, info: RefInfo, v: number): void {
  const key = `kp:${refKey(r)}`
  openPopover(
    el,
    () => (
      <Keypad
        title={info.label}
        value={v}
        def={info.def}
        hint={info.hint}
        onChange={(x) => setValue(r, num(info.hint.integer ? Math.round(x) : x), key)}
        onClose={() => {
          ctx.store.endGroup()
          closePopover()
        }}
      />
    ),
    { width: 268, label: `${info.label} keypad`, onClose: () => ctx.store.endGroup() },
  )
}

function focusVar(name: string): void {
  const d = ctx.store.sketch.stmts.find((s) => s.k === 'def' && s.name === name)
  if (!d) return toast(`${name} is not defined in this sketch`)
  ui.select(d.id)
  document.querySelector(`[data-stmt="${d.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

export function openKnobMenu(el: Element, r: ArgRef): void {
  const sk = ctx.store.sketch
  const info = refInfo(sk, r, ctx.catalog)
  const f = faceOf(getArg(sk, r), info)
  const key = refKey(r)
  const pinned = (metaNow().pins ?? []).includes(key)
  const shown = f.k === 'num' ? fmt(f.v) + (f.dim ? ' (default)' : '') : f.k === 'mod' ? `${MOD_ICON[f.spec.kind]} around ${fmt(baseOfFace(f))}` : f.k === 'var' ? f.name : f.k === 'expr' ? f.src : f.text
  const items: MenuItem[] = []
  if (f.k === 'num') items.push({ label: 'Type a value…', run: () => openKeypad(el, r, info, f.v), testid: 'menu-type' })
  if (f.k === 'mod' || f.k === 'expr') items.push({ label: 'Edit the modulation…', run: () => openModEditor(el, r), testid: 'menu-edit-mod' })
  if (f.k === 'var') items.push({ label: `Open ${f.name}`, run: () => focusVar(f.name) })
  items.push({ label: pinned ? 'Unpin from performance' : 'Pin to performance', run: () => togglePin(key), testid: 'menu-pin' })
  if (f.k === 'num') {
    items.push({ label: 'Modulate: sine LFO', sep: true, run: () => assignTo(r, 'sine'), testid: 'menu-mod-sine' })
    items.push({ label: 'Modulate: step pattern', run: () => assignTo(r, 'steps') })
    items.push({ label: 'Modulate: audio bin 0', run: () => assignTo(r, 'audio', 0) })
  } else if (f.k === 'mod' || f.k === 'expr' || f.k === 'var') {
    items.push({ label: 'Remove the modulation', sep: true, danger: true, run: () => ctx.store.commit(unassignMod(ctx.store.sketch, r, ctx.catalog)), testid: 'menu-unmod' })
  }
  if (info.def !== undefined) items.push({ label: `Reset to ${fmt(info.def)}`, run: () => setValue(r, num(info.def!)), testid: 'menu-reset' })
  openMenu(el, items, `${info.fn ? `${info.fn} · ` : ''}${info.label} = ${shown}`, 280)
}

// ---------------------------------------------------------------- the control

export interface KnobProps {
  r: ArgRef
  size?: 'big' | 'mini'
  variant?: 'knob' | 'fader'
  /** shown instead of the input name */
  label?: string
}

interface Drag {
  id: number
  x0: number
  y0: number
  lx: number
  ly: number
  v0: number
  amp0: number
  mode: 'base' | 'depth'
  moved: boolean
  fired: boolean
  pen: boolean
  extra: Set<number>
  key: string
  spec?: ModSpec
  timer?: ReturnType<typeof setTimeout>
  pending?: Value
  lastAt: number
}

export function Knob({ r, size = 'big', variant = 'knob', label }: KnobProps) {
  const sk = ctx.store.sketch
  const info = refInfo(sk, r, ctx.catalog)
  const v = getArg(sk, r)
  const f = faceOf(v, info)
  const h = info.hint
  const range = h.max - h.min || 1
  const base = baseOfFace(f)
  const frac = (base - h.min) / range
  const key = refKey(r)
  const st = useRef<Drag | null>(null)
  const lastTap = useRef(0)
  const step = h.integer ? 1 : (h.step ?? 0.01)
  const pinned = (metaNow().pins ?? []).includes(key)

  const apply = (d: Drag, val: Value, now: boolean) => {
    d.pending = val
    // numbers ride the live path every frame; a moving modulator rewrites a function (a recompile), so it is throttled
    const t = performance.now()
    if (val.k === 'num' || now || t - d.lastAt > 120) {
      d.lastAt = t
      d.pending = undefined
      setValue(r, val, d.key)
    }
  }

  const valueFor = (d: Drag, delta: number, fine: number): number => {
    let x = d.v0 + (delta / 200) * range * fine
    x = h.wrap ? wrapInto(x, h.min, h.max) : clamp(x, Math.min(h.min, d.v0), Math.max(h.max, d.v0))
    return h.integer ? Math.round(x) : roundTo(x, step * (fine < 1 ? fine : 1))
  }

  const onDown = (e: PointerEvent) => {
    e.stopPropagation()
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture?.(e.pointerId)
    const cur = st.current
    if (cur) {
      // a second finger on a knob that is already turning: fine mode, re-anchored so the value does not jump
      cur.extra.add(e.pointerId)
      cur.x0 = cur.lx
      cur.y0 = cur.ly
      const now = getArg(ctx.store.sketch, r)
      const nf = faceOf(now, info)
      cur.v0 = baseOfFace(nf)
      cur.amp0 = nf.k === 'mod' ? nf.spec.amp : 0
      return
    }
    const box = el.getBoundingClientRect()
    const dist = Math.hypot(e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2))
    const spec = f.k === 'mod' ? f.spec : undefined
    const d: Drag = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      lx: e.clientX,
      ly: e.clientY,
      v0: base,
      amp0: spec?.amp ?? 0,
      mode: spec && spec.kind !== 'steps' && variant === 'knob' && dist > box.width * 0.36 ? 'depth' : 'base',
      moved: false,
      fired: false,
      pen: e.pointerType === 'pen',
      extra: new Set(),
      key: beginGesture(),
      spec,
      lastAt: 0,
    }
    st.current = d
    d.timer = setTimeout(() => {
      if (st.current !== d || d.moved) return
      d.fired = true
      openKnobMenu(el, r)
    }, LONG_MS)
  }

  const onMove = (e: PointerEvent) => {
    const d = st.current
    if (!d) return
    if (d.extra.has(e.pointerId)) return
    if (d.id !== e.pointerId) return
    d.lx = e.clientX
    d.ly = e.clientY
    const delta = d.y0 - e.clientY + (variant === 'knob' ? (e.clientX - d.x0) * 0.6 : 0)
    // any real movement means "turning", not "holding for the menu", even before the turn threshold
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 3) clearTimeout(d.timer)
    if (!d.moved && Math.abs(delta) < 6 && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 8) return
    if (d.fired) return
    d.moved = true
    clearTimeout(d.timer)
    const fine = (d.pen ? 0.25 : 1) * (d.extra.size ? 0.1 : 1)
    const tag = fine < 1 ? `fine ×${+fine.toFixed(3)}` : info.label
    if (!d.spec) {
      if (f.k !== 'num') return
      const x = valueFor(d, delta, fine)
      apply(d, num(x), false)
      hud.show(e.clientX, Math.max(8, e.clientY - 96), fmt(x), tag)
      return
    }
    if (d.mode === 'depth') {
      const amp = Math.max(0, roundTo(d.amp0 + (delta / 200) * range * fine, step))
      apply(d, modToValue({ ...d.spec, amp }), false)
      hud.show(e.clientX, Math.max(8, e.clientY - 96), `± ${fmt(amp)}`, 'depth')
      return
    }
    const x = valueFor(d, delta, fine)
    const spec: ModSpec = d.spec.kind === 'steps' ? { ...d.spec, steps: (d.spec.steps ?? []).map((s) => +(s + x - d.v0).toFixed(4)) } : { ...d.spec, off: x }
    apply(d, modToValue(spec), false)
    hud.show(e.clientX, Math.max(8, e.clientY - 96), fmt(x), 'centre')
  }

  const onUp = (e: PointerEvent) => {
    const d = st.current
    if (!d) return
    if (d.extra.has(e.pointerId)) {
      d.extra.delete(e.pointerId)
      d.x0 = d.lx
      d.y0 = d.ly
      d.v0 = baseOfFace(faceOf(getArg(ctx.store.sketch, r), info))
      return
    }
    if (d.id !== e.pointerId) return
    clearTimeout(d.timer)
    st.current = null
    hud.hide()
    if (d.pending) setValue(r, d.pending, d.key)
    endGesture()
    if (d.fired || e.type === 'pointercancel') return
    if (d.moved) return
    const el = e.currentTarget as HTMLElement
    // tap
    const armed = ui.state.armed
    if (armed) {
      const [kind, bin] = armed.split(':')
      assignTo(r, kind as ModKind, bin === undefined ? undefined : Number(bin))
      ui.set({ armed: undefined })
      return
    }
    const now = Date.now()
    if (now - lastTap.current < 320 && info.def !== undefined) {
      lastTap.current = 0
      closePopover()
      setValue(r, num(info.def))
      return
    }
    lastTap.current = now
    if (f.k === 'num') openKeypad(el, r, info, f.v)
    else if (f.k === 'mod' || f.k === 'expr') openModEditor(el, r)
    else if (f.k === 'var') focusVar(f.name)
    else openKnobMenu(el, r)
  }

  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    if (!dir || f.k !== 'num') return
    e.preventDefault()
    setValue(r, num(h.integer ? f.v + dir : roundTo(f.v + dir * (e.shiftKey ? step : step * 10), step)))
  }

  const ring = f.k === 'mod' ? swingOf(f.spec) : undefined
  const S = size === 'big' ? 64 : 46
  const c = S / 2
  const rTrack = c - 7
  const shown = f.k === 'num' ? fmt(f.v) : f.k === 'mod' ? MOD_ICON[f.spec.kind] : f.k === 'var' ? f.name : f.k === 'expr' ? 'ƒ' : f.text
  const common = {
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': `${info.fn ? `${info.fn} ` : ''}${info.label}`,
    'aria-valuemin': h.min,
    'aria-valuemax': h.max,
    'aria-valuenow': base,
    'data-testid': `knob-${key}`,
    'data-ref': key,
    'data-drop': 'knob',
    'data-face': f.k,
    'data-no-undo-tap': '',
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: onUp,
    onKeyDown: onKey,
    onContextMenu: (e: Event) => e.preventDefault(),
  }
  const cls = `${f.k === 'num' && f.dim ? 'dim' : ''} ${pinned ? 'pinned' : ''} f-${f.k}`
  if (variant === 'fader') {
    return (
      <div class={`fader ${cls}`} {...common}>
        <div class="ftrack">
          {ring && <i class="fring" style={{ bottom: `${clamp((ring[0] - h.min) / range, 0, 1) * 100}%`, top: `${(1 - clamp((ring[1] - h.min) / range, 0, 1)) * 100}%` }} />}
          <i class="ffill" style={{ height: `${clamp(frac, 0, 1) * 100}%` }} />
        </div>
        <b class="kv">{shown}</b>
        <span class="kl">{label ?? info.label}</span>
      </div>
    )
  }
  return (
    <div class={`knob ${size} ${cls}`} {...common}>
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} aria-hidden="true">
        <path class="ktrack" d={arc(c, c, rTrack, -135, 135)} />
        {f.k === 'num' && <path class="kfill" d={arc(c, c, rTrack, -135, Math.max(-134.9, angleOf(frac)))} />}
        {ring && f.k === 'mod' && (
          <path
            class={`kring ${f.spec.kind === 'time' ? 'grow' : ''}`}
            d={arc(c, c, c - 2.5, angleOf((ring[0] - h.min) / range), Math.max(angleOf((ring[0] - h.min) / range) + 4, angleOf((ring[1] - h.min) / range)))}
          />
        )}
        {f.k === 'var' && <circle class="klink" cx={c} cy={c} r={c - 2.5} />}
        <line
          class="kptr"
          x1={c + (rTrack - 11) * Math.sin((angleOf(frac) * Math.PI) / 180)}
          y1={c - (rTrack - 11) * Math.cos((angleOf(frac) * Math.PI) / 180)}
          x2={c + (rTrack + 1) * Math.sin((angleOf(frac) * Math.PI) / 180)}
          y2={c - (rTrack + 1) * Math.cos((angleOf(frac) * Math.PI) / 180)}
        />
      </svg>
      <b class="kv">{shown}</b>
      <span class="kl">{label ?? info.label}</span>
    </div>
  )
}
