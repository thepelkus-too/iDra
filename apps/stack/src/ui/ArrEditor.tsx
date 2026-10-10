// Step strip for array values: draggable bars, + / − steps, fast / smooth / ease / offset, and a playhead that follows the beat.
import { arr, type ArrMods, type Hint } from '@hydra-ipad/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import { fmt, roundTo } from '../conv'
import { ctx, edit, useStore } from '../ctx'
import { getArg, refKey, setArg, type ArgRef } from '../model'
import { Keypad, openPopover } from '@hydra-ipad/kit'
import { Scrub } from './Scrub'

export const EASES = [
  'linear', 'easeInQuad', 'easeOutQuad', 'easeInOutQuad', 'easeInCubic', 'easeOutCubic', 'easeInOutCubic',
  'easeInQuart', 'easeOutQuart', 'easeInOutQuart', 'easeInQuint', 'easeOutQuint', 'easeInOutQuint', 'sin',
]

export interface ArrEditorProps {
  refd: ArgRef
  title: string
  hint: Hint
  def: number
}

function setMod(mods: ArrMods, key: keyof ArrMods, val: number | string | undefined): ArrMods {
  const next: ArrMods = { ...mods }
  if (val === undefined) delete next[key]
  // key order = application order: an existing key keeps its place, a new one is appended
  else (next as Record<string, unknown>)[key] = val
  return next
}

export function ArrEditor({ refd, title, hint, def }: ArrEditorProps) {
  useStore()
  const v = getArg(ctx.store.sketch, refd)
  const key = `arr:${refKey(refd)}`
  const barsRef = useRef<HTMLDivElement>(null)
  const [head, setHead] = useState(0)
  const arrV = v?.k === 'arr' ? v : undefined

  // playhead: sample the runtime clock now and then, interpolate in between
  useEffect(() => {
    if (!arrV) return
    let stop = false
    let t0 = 0
    let wall0 = performance.now()
    let raf = 0
    const sync = async () => {
      try {
        const t = await ctx.runner.rt.time()
        t0 = t
        wall0 = performance.now()
      } catch {
        /* no clock yet */
      }
    }
    void sync()
    const iv = setInterval(sync, 1500)
    const tick = () => {
      if (stop) return
      const sk = ctx.store.sketch
      const bpm = settingOf(sk, 'bpm', 30)
      const speed = settingOf(sk, 'speed', 1)
      const cur = getArg(sk, refd)
      if (cur?.k === 'arr' && cur.v.length) {
        const time = t0 + ((performance.now() - wall0) / 1000) * speed
        const fast = cur.mods.fast ?? 1
        const idx = Math.floor((time * fast * (bpm / 60) + (cur.mods.offset ?? 0)) % cur.v.length)
        setHead((h) => (h === idx ? h : idx))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      stop = true
      clearInterval(iv)
      cancelAnimationFrame(raf)
    }
  }, [!!arrV])

  if (!arrV) return <div class="empty">This value is no longer an array.</div>
  const values = arrV.v
  const mods = arrV.mods ?? {}
  const lo = Math.min(hint.min, ...values)
  const hi = Math.max(hint.max, ...values)
  const stepH = hint.step ?? 0.01

  const write = (nv: number[], nm: ArrMods = mods) => edit((s) => setArg(s, refd, arr(nv, nm)), { coalesce: key })
  const setBar = (i: number, val: number) => {
    const cur = getArg(ctx.store.sketch, refd)
    if (cur?.k !== 'arr') return
    const nv = cur.v.slice()
    nv[i] = hint.integer ? Math.round(val) : roundTo(val, stepH)
    write(nv, cur.mods)
  }
  const fromY = (clientY: number, col: HTMLElement) => {
    const r = col.getBoundingClientRect()
    const t = 1 - Math.max(0, Math.min(1, (clientY - r.top) / r.height))
    return lo + t * (hi - lo)
  }

  const barDown = (e: PointerEvent, i: number) => {
    const col = e.currentTarget as HTMLElement
    col.setPointerCapture(e.pointerId)
    col.dataset.drag = '1'
    setBar(i, fromY(e.clientY, col))
  }
  const barMove = (e: PointerEvent, i: number) => {
    const col = e.currentTarget as HTMLElement
    if (col.dataset.drag !== '1') return
    setBar(i, fromY(e.clientY, col))
  }
  const barUp = (e: PointerEvent) => {
    const col = e.currentTarget as HTMLElement
    delete col.dataset.drag
    ctx.store.endGroup()
    try {
      col.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const modScrub = (name: 'fast' | 'smooth' | 'offset', h: Hint, dflt: number) => {
    const val = mods[name]
    return (
      <div class="mod">
        <span class="lbl">{name}</span>
        <Scrub
          testid={`arr-${name}`}
          label={name}
          value={val ?? dflt}
          dim={val === undefined}
          hint={h}
          onChange={(n, ph) => {
            if (ph === 'end') return ctx.store.endGroup()
            const cur = getArg(ctx.store.sketch, refd)
            if (cur?.k === 'arr') write(cur.v, setMod(cur.mods, name, n))
          }}
          onTap={(el) =>
            openPopover(
              el,
              (close) => (
                <Keypad
                  title={name}
                  value={val ?? dflt}
                  def={dflt}
                  hint={h}
                  onChange={(n) => {
                    const cur = getArg(ctx.store.sketch, refd)
                    if (cur?.k === 'arr') write(cur.v, setMod(cur.mods, name, n))
                  }}
                  onClose={close}
                />
              ),
              { width: 260, label: name, stack: true, onClose: () => ctx.store.endGroup() },
            )
          }
        />
        {val !== undefined && (
          <button type="button" class="x" aria-label={`remove ${name}`} onClick={() => write(values, setMod(mods, name, undefined))}>
            ×
          </button>
        )}
      </div>
    )
  }

  return (
    <div class="arr-editor" data-testid="arr-editor">
      <div class="ed-head">
        <span>{title}</span>
        <span class="steps">
          <button type="button" class="btn sm" aria-label="remove step" data-testid="arr-minus" disabled={values.length <= 1} onClick={() => write(values.slice(0, -1))}>
            −
          </button>
          <b>{values.length}</b>
          <button type="button" class="btn sm" aria-label="add step" data-testid="arr-plus" onClick={() => write([...values, values.length ? values[values.length - 1] : def])}>
            +
          </button>
        </span>
      </div>
      <div class="bars" ref={barsRef} data-testid="arr-bars">
        {values.map((val, i) => {
          const pct = ((val - lo) / (hi - lo || 1)) * 100
          return (
            <div class={`barcol ${head === i ? 'head' : ''}`} key={i}>
              <div
                class="bartrack"
                data-bar={i}
                onPointerDown={(e) => barDown(e, i)}
                onPointerMove={(e) => barMove(e, i)}
                onPointerUp={barUp}
                onPointerCancel={barUp}
              >
                <div class="barfill" style={{ height: `${Math.max(2, Math.min(100, pct))}%` }} />
              </div>
              <button
                type="button"
                class="barval"
                data-testid={`arr-val-${i}`}
                onClick={(e) =>
                  openPopover(
                    e.currentTarget as HTMLElement,
                    (close) => <Keypad title={`step ${i + 1}`} value={getValueAt(refd, i, val)} def={def} hint={hint} onChange={(n) => setBar(i, n)} onClose={close} />,
                    { width: 260, stack: true, onClose: () => ctx.store.endGroup() },
                  )
                }
              >
                {fmt(val)}
              </button>
            </div>
          )
        })}
      </div>
      <div class="mods">
        {modScrub('fast', { min: 0.1, max: 8, step: 0.1 }, 1)}
        {modScrub('smooth', { min: 0, max: 1, step: 0.01 }, 0)}
        {modScrub('offset', { min: 0, max: 4, step: 0.01 }, 0)}
        <div class="mod">
          <span class="lbl">ease</span>
          <button
            type="button"
            class={`chip ${mods.ease ? 'on' : ''}`}
            data-testid="arr-ease"
            onClick={(e) =>
              openPopover(
                e.currentTarget as HTMLElement,
                (close) => (
                  <div class="menu">
                    <button type="button" class="item" onClick={() => (write(values, setMod(mods, 'ease', undefined)), close())}>
                      none
                    </button>
                    {EASES.map((n) => (
                      <button type="button" class={`item ${mods.ease === n ? 'on' : ''}`} key={n} onClick={() => (write(values, setMod(mods, 'ease', n)), close())}>
                        {n}
                      </button>
                    ))}
                  </div>
                ),
                { width: 220, label: 'ease' },
              )
            }
          >
            {mods.ease ?? 'none'}
          </button>
        </div>
      </div>
      <div class="note">
        Playhead follows <code>time × speed × bpm/60</code>. Bars set the values; the order of fast, smooth, ease is the order they are applied in.
      </div>
    </div>
  )
}

function getValueAt(refd: ArgRef, i: number, fallback: number): number {
  const v = getArg(ctx.store.sketch, refd)
  return v?.k === 'arr' ? (v.v[i] ?? fallback) : fallback
}

export function settingOf(sk: { stmts: Array<{ k: string; name?: string; v?: number }> }, name: 'bpm' | 'speed', dflt: number): number {
  for (let i = sk.stmts.length - 1; i >= 0; i--) {
    const s = sk.stmts[i]
    if (s.k === 'setting' && s.name === name && typeof s.v === 'number') return s.v
  }
  return dflt
}
