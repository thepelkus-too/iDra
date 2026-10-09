// The controls that are more than one knob: XY pads for natural pairs, the colour block (faders with a swatch), vector
// inputs, and the Mouse XY performance pad in the mod bay.
import { liveId, num, type Hint, type Value } from '@hydra-ipad/core'
import { useRef } from 'preact/hooks'
import { commit } from '../doc'
import { clamp, fmt, roundTo } from '../kit/conv'
import { ctx } from '../kit/ctx'
import { getArg, setArg } from '../kit/model'
import { hud } from '../kit/overlay'
import type { Control } from '../panel'
import { refInfo } from '../refs'
import { Knob, faceOf } from './Knob'

let padGesture = 0

const numOf = (v: Value | undefined, def: number | undefined): number | undefined => (!v || v.k === 'default' ? (def ?? 0) : v.k === 'num' ? v.v : undefined)

export function XYPad({ call, c }: { call: string; c: Extract<Control, { t: 'xy' }> }) {
  const sk = ctx.store.sketch
  const rx = { call, i: c.x }
  const ry = { call, i: c.y }
  const ix = refInfo(sk, rx, ctx.catalog)
  const iy = refInfo(sk, ry, ctx.catalog)
  const vx = numOf(getArg(sk, rx), ix.def)
  const vy = numOf(getArg(sk, ry), iy.def)
  const st = useRef<{ id: number; key: string } | null>(null)
  const fx = vx === undefined ? 0.5 : clamp((vx - ix.hint.min) / (ix.hint.max - ix.hint.min || 1), 0, 1)
  const fy = vy === undefined ? 0.5 : clamp((vy - iy.hint.min) / (iy.hint.max - iy.hint.min || 1), 0, 1)
  const set = (e: PointerEvent, el: HTMLElement) => {
    const b = el.getBoundingClientRect()
    const px = clamp((e.clientX - b.left) / b.width, 0, 1)
    const py = clamp(1 - (e.clientY - b.top) / b.height, 0, 1)
    const val = (h: Hint, f: number) => (h.integer ? Math.round(h.min + f * (h.max - h.min)) : roundTo(h.min + f * (h.max - h.min), h.step ?? 0.01))
    let next = ctx.store.sketch
    const shown: string[] = []
    if (vx !== undefined) {
      const x = val(ix.hint, px)
      ctx.runner.setLive(liveId(call, c.x), x)
      next = setArg(next, rx, num(x))
      shown.push(fmt(x))
    }
    if (vy !== undefined) {
      const y = val(iy.hint, py)
      ctx.runner.setLive(liveId(call, c.y), y)
      next = setArg(next, ry, num(y))
      shown.push(fmt(y))
    }
    ctx.store.hold(st.current!.key)
    commit(next, {}, { coalesce: st.current!.key })
    hud.show(e.clientX, Math.max(8, e.clientY - 96), shown.join(', '), `${c.ix.name} · ${c.iy.name}`)
  }
  return (
    <div class="xy" data-testid={`xy-${call}:${c.x}`}>
      <div
        class="xypad"
        role="group"
        aria-label={`${c.ix.name} and ${c.iy.name}`}
        data-no-undo-tap
        onPointerDown={(e) => {
          e.stopPropagation()
          const el = e.currentTarget as HTMLElement
          el.setPointerCapture?.(e.pointerId)
          st.current = { id: e.pointerId, key: `xy:${++padGesture}` }
          set(e, el)
        }}
        onPointerMove={(e) => st.current?.id === e.pointerId && set(e, e.currentTarget as HTMLElement)}
        onPointerUp={(e) => {
          if (st.current?.id !== e.pointerId) return
          st.current = null
          hud.hide()
          ctx.store.endGroup()
        }}
        onPointerCancel={() => {
          st.current = null
          hud.hide()
        }}
      >
        <i class="xh" style={{ top: `${(1 - fy) * 100}%` }} />
        <i class="xv" style={{ left: `${fx * 100}%` }} />
        <i class="xdot" style={{ left: `${fx * 100}%`, top: `${(1 - fy) * 100}%` }} />
        {(vx === undefined || vy === undefined) && <small class="xlock">{vx === undefined ? c.ix.name : c.iy.name} is modulated</small>}
      </div>
      <div class="xyknobs">
        <Knob r={rx} size="mini" />
        <Knob r={ry} size="mini" />
      </div>
    </div>
  )
}

export function Rgba({ call, c }: { call: string; c: Extract<Control, { t: 'rgba' }> }) {
  const sk = ctx.store.sketch
  const vals = c.is.map((i) => {
    const r = { call, i }
    const info = refInfo(sk, r, ctx.catalog)
    const f = faceOf(getArg(sk, r), info)
    return f.k === 'num' ? f.v : f.k === 'mod' ? f.spec.off : 0.5
  })
  const ch = (x: number) => Math.round(clamp(x, 0, 1) * 255)
  const a = c.is.length === 4 ? clamp(vals[3], 0, 1) : 1
  const sw = `rgba(${ch(vals[0])}, ${ch(vals[1])}, ${ch(vals[2])}, ${a})`
  return (
    <div class="rgba" data-testid={`rgba-${call}`}>
      <span class="swatch" style={{ background: sw }} title={sw} />
      {c.is.map((i) => (
        <Knob key={i} r={{ call, i }} variant="fader" />
      ))}
    </div>
  )
}

/** vec4 (and other vector) inputs: shown as their numbers, edited in the code drawer. Nothing is hidden. */
export function VecField({ call, c }: { call: string; c: Extract<Control, { t: 'vec' }> }) {
  const v = getArg(ctx.store.sketch, { call, i: c.i })
  return (
    <div class="vec" data-testid={`vec-${call}:${c.i}`}>
      <small>{c.inp.name}</small>
      <code>{!v || v.k === 'default' ? 'default' : v.k === 'vec4' ? `[${v.v.map(fmt).join(', ')}]` : v.k}</code>
    </div>
  )
}

/** The Mouse XY pad: drives Hydra's `mouse` from touch (core's runtime.setMouse), in the output's own pixels. */
export function MousePad() {
  const st = useRef<number | null>(null)
  const dot = useRef<HTMLElement>(null)
  const set = (e: PointerEvent, el: HTMLElement) => {
    const b = el.getBoundingClientRect()
    const fx = clamp((e.clientX - b.left) / b.width, 0, 1)
    const fy = clamp((e.clientY - b.top) / b.height, 0, 1)
    const { width: W, height: H } = ctx.runner.size()
    ctx.runner.rt?.setMouse(fx * W, fy * H)
    if (dot.current) {
      dot.current.style.left = `${fx * 100}%`
      dot.current.style.top = `${fy * 100}%`
    }
  }
  return (
    <div
      class="mousepad"
      data-testid="mouse-pad"
      role="group"
      aria-label="Mouse XY: drives mouse.x and mouse.y"
      data-no-undo-tap
      onPointerDown={(e) => {
        e.stopPropagation()
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
        st.current = e.pointerId
        set(e, e.currentTarget as HTMLElement)
      }}
      onPointerMove={(e) => st.current === e.pointerId && set(e, e.currentTarget as HTMLElement)}
      onPointerUp={() => (st.current = null)}
      onPointerCancel={() => (st.current = null)}
    >
      <i ref={dot} class="xdot" />
      <small>mouse</small>
    </div>
  )
}
