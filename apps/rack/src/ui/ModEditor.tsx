// The editor a modulated knob opens: the modulator's kind, rate (in Hz, or synced to the beat: 1/4 … 4 beats), depth and
// centre; the bin of an audio tile; the steps of a step sequencer with fast / smooth / ease / offset; the text of an
// expression. Every change is written at once (the preview follows) and the whole session is one undo step.
import type { Hint, Value } from '@hydra-ipad/core'
import { useState } from 'preact/hooks'
import { setValue } from '../doc'
import { closePopover, fmt, NumSlider, openPopover } from '@hydra-ipad/kit'
import { ctx } from '../kit/ctx'
import { getArg } from '../kit/model'
import { LFO_KINDS, MOD_ICON, MOD_LABEL, modToValue, valueToMod, type ModSpec } from '../kit/mods'
import { Meter } from '../kit/Chrome'
import { unassignMod } from '../ops'
import { refInfo, refKey, type ArgRef } from '../refs'
import { bpmOf } from '../view'

export const BEATS = [0.25, 0.5, 1, 2, 4]
const BEAT_LABEL: Record<number, string> = { 0.25: '1/4', 0.5: '1/2', 1: '1', 2: '2', 4: '4' }

/** The rate that makes one cycle last `beats` at `bpm` (sine rates are radians per second, the others cycles per second). */
export function rateForBeats(kind: ModSpec['kind'], beats: number, bpm: number): number {
  const secs = (beats * 60) / (bpm > 0 ? bpm : 30)
  const r = kind === 'sine' ? (2 * Math.PI) / secs : 1 / secs
  return +r.toFixed(4)
}

/** Which beat length a rate matches (for highlighting), if any. */
export function beatsOfRate(kind: ModSpec['kind'], rate: number, bpm: number): number | undefined {
  return BEATS.find((b) => Math.abs(rateForBeats(kind, b, bpm) - rate) < 1e-3)
}

export function openModEditor(anchor: Element, r: ArgRef): void {
  openPopover(anchor, () => <ModEditor r={r} />, { width: 320, label: 'Modulation', onClose: () => ctx.store.endGroup() })
}

function ModEditor({ r }: { r: ArgRef }) {
  const [, force] = useState(0)
  const sk = ctx.store.sketch
  const v = getArg(sk, r)
  const spec = v ? valueToMod(v) : undefined
  const info = refInfo(sk, r, ctx.catalog)
  const key = `mod:${refKey(r)}`
  if (!spec) return <div class="modedit">Not modulated.</div>
  const put = (s: ModSpec | Value) => {
    setValue(r, 'k' in s ? s : modToValue(s), key)
    force((x) => x + 1)
  }
  const span = info.hint.max - info.hint.min || 1
  const around: Hint = { min: Math.min(info.hint.min, spec.off), max: Math.max(info.hint.max, spec.off) }
  const bpm = bpmOf(sk)
  const sliders = (
    <>
      <NumSlider label="depth" value={spec.amp} hint={{ min: 0, max: Math.max(span, Math.abs(spec.amp)) }} testid="mod-depth" onChange={(x, ph) => ph !== 'end' && put({ ...spec, amp: +x.toFixed(4) })} />
      <NumSlider label="centre" value={spec.off} hint={around} testid="mod-centre" onChange={(x, ph) => ph !== 'end' && put({ ...spec, off: +x.toFixed(4) })} />
    </>
  )
  let body
  if (LFO_KINDS.includes(spec.kind)) {
    const beat = beatsOfRate(spec.kind, spec.rate, bpm)
    body = (
      <>
        <div class="seg" role="group" aria-label="Shape">
          {LFO_KINDS.map((k) => (
            <button type="button" key={k} class={k === spec.kind ? 'on' : ''} title={MOD_LABEL[k]} onClick={() => put({ ...spec, kind: k, rate: beat ? rateForBeats(k, beat, bpm) : spec.rate })}>
              {MOD_ICON[k]}
            </button>
          ))}
        </div>
        <NumSlider label={spec.kind === 'sine' ? 'rate (rad/s)' : 'rate (Hz)'} value={spec.rate} hint={{ min: 0, max: spec.kind === 'sine' ? 12 : 4, log: true }} testid="mod-rate" onChange={(x, ph) => ph !== 'end' && put({ ...spec, rate: +x.toFixed(4) })} />
        <div class="seg beats" role="group" aria-label="Rate in beats">
          <small>beats</small>
          {BEATS.map((b) => (
            <button type="button" key={b} class={beat === b ? 'on' : ''} data-testid={`beat-${BEAT_LABEL[b]}`} onClick={() => put({ ...spec, rate: rateForBeats(spec.kind, b, bpm) })}>
              {BEAT_LABEL[b]}
            </button>
          ))}
        </div>
        {sliders}
      </>
    )
  } else if (spec.kind === 'audio' || spec.kind === 'vol') {
    body = (
      <>
        {spec.kind === 'audio' && (
          <div class="seg" role="group" aria-label="Bin">
            <small>bin</small>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((b) => (
              <button type="button" key={b} class={b === spec.bin ? 'on' : ''} onClick={() => put({ ...spec, bin: b })}>
                {b}
              </button>
            ))}
          </div>
        )}
        <Meter bin={spec.kind === 'vol' ? -1 : (spec.bin ?? 0)} />
        {sliders}
        <p class="note">Smoothing and the number of bins are set for the whole sketch in Audio (⋯ menu).</p>
      </>
    )
  } else if (spec.kind === 'steps') {
    const steps = spec.steps ?? [0]
    const m = spec.mods ?? {}
    const hint: Hint = { min: Math.min(info.hint.min, ...steps), max: Math.max(info.hint.max, ...steps) }
    body = (
      <>
        <div class="steps">
          {steps.map((s, i) => (
            <NumSlider key={i} compact label={`${i + 1}`} value={s} hint={hint} testid={`mod-step-${i}`} onChange={(x, ph) => ph !== 'end' && put({ ...spec, steps: steps.map((y, j) => (j === i ? +x.toFixed(4) : y)) })} />
          ))}
        </div>
        <div class="row">
          <button type="button" class="btn sm" data-testid="mod-step-add" onClick={() => put({ ...spec, steps: [...steps, steps[steps.length - 1] ?? 0] })}>
            ＋ step
          </button>
          <button type="button" class="btn sm" disabled={steps.length < 2} onClick={() => put({ ...spec, steps: steps.slice(0, -1) })}>
            − step
          </button>
        </div>
        <NumSlider label="fast" value={m.fast ?? 1} dim={m.fast === undefined} hint={{ min: 0, max: 8 }} testid="mod-fast" onChange={(x, ph) => ph !== 'end' && put({ ...spec, mods: { ...m, fast: +x.toFixed(3) } })} />
        <NumSlider label="smooth" value={m.smooth ?? 0} dim={m.smooth === undefined} hint={{ min: 0, max: 1 }} testid="mod-smooth" onChange={(x, ph) => ph !== 'end' && put({ ...spec, mods: { ...m, smooth: +x.toFixed(3) } })} />
        <NumSlider label="offset" value={m.offset ?? 0} dim={m.offset === undefined} hint={{ min: 0, max: 1 }} testid="mod-offset" onChange={(x, ph) => ph !== 'end' && put({ ...spec, mods: { ...m, offset: +x.toFixed(3) } })} />
        <div class="seg" role="group" aria-label="Ease">
          <small>ease</small>
          {['linear', 'easeInOutCubic', 'sin'].map((e) => (
            <button type="button" key={e} class={m.ease === e ? 'on' : ''} onClick={() => put({ ...spec, mods: { ...m, ease: m.ease === e ? undefined : e } })}>
              {e === 'easeInOutCubic' ? 'cubic' : e}
            </button>
          ))}
        </div>
      </>
    )
  } else if (spec.kind === 'expr') {
    body = <ExprEdit src={spec.src ?? ''} onSave={(src) => put({ ...spec, src })} />
  } else {
    body = sliders
  }
  return (
    <div class="modedit" data-testid="mod-editor">
      <div class="modhead">
        <b>
          {MOD_ICON[spec.kind]} {MOD_LABEL[spec.kind]}
        </b>
        <span>
          on {info.fn ? `${info.fn}.` : ''}
          {info.label}
        </span>
      </div>
      {body}
      <button
        type="button"
        class="btn danger wide"
        data-testid="mod-remove"
        onClick={() => {
          closePopover()
          ctx.store.commit(unassignMod(ctx.store.sketch, r, ctx.catalog))
        }}
      >
        Remove (back to {fmt(spec.kind === 'steps' ? (spec.steps?.[0] ?? 0) : spec.off)})
      </button>
    </div>
  )
}

function ExprEdit({ src, onSave }: { src: string; onSave: (s: string) => void }) {
  const [t, setT] = useState(src)
  return (
    <div class="expr">
      <textarea rows={3} value={t} spellcheck={false} autocapitalize="off" data-testid="mod-expr" onInput={(e) => setT((e.currentTarget as HTMLTextAreaElement).value)} />
      <button type="button" class="btn sm" disabled={t === src || !/=>/.test(t)} onClick={() => onSave(t.trim())}>
        Apply
      </button>
    </div>
  )
}
