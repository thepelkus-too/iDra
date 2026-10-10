// Mini editor for a function value: chips that insert into a one-line expression, a scale/offset pair that wraps it as
// `() => expr * scale + offset`, free-text editing, and, for `a.fft[n]`, a bin picker with a live meter.
import { audioChip, fnv, mountAudioPanel, parseAudioChip, type Hint, type InputDef } from '@hydra-ipad/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import { composeFn, fmt, parseFnWrap } from '../conv'
import { ctx, edit, useStore } from '../ctx'
import { getArg, refKey, setArg, type ArgRef } from '../model'
import { Keypad, openPopover, openSheet } from '@hydra-ipad/kit'
import { Scrub } from './Scrub'

export const FN_CHIPS: Array<{ label: string; expr: string }> = [
  { label: 'time', expr: 'time' },
  { label: 'mouse.x', expr: 'mouse.x' },
  { label: 'mouse.y', expr: 'mouse.y' },
  { label: 'Math.sin(time)', expr: 'Math.sin(time)' },
  { label: 'a.fft[0]', expr: 'a.fft[0]' },
  { label: 'bpm', expr: 'bpm' },
  { label: 'Math.cos(time)', expr: 'Math.cos(time)' },
  { label: 'time % 4', expr: 'time % 4' },
  { label: 'mouse.x / width', expr: 'mouse.x / width' },
]

const AUDIO_BODY = /^a\.fft\[(\d+)\]$/

/** Syntax check only (compiles, never runs). */
export function syntaxOk(expr: string): boolean {
  if (!expr.trim()) return false
  try {
    // eslint-disable-next-line no-new-func
    new Function(`"use strict"; return (${expr})`)
    return true
  } catch {
    return false
  }
}

/** Short label for a function chip in a row. Audio chips are recognised with core's `parseAudioChip`. */
export function fnLabel(src: string): { text: string; audio?: { bin: number; scale: number; offset: number } } {
  const chip = parseAudioChip({ k: 'fn', src })
  if (chip) {
    const scale = chip.scale !== 1 ? ` ×${fmt(chip.scale)}` : ''
    const offset = chip.offset !== 0 ? ` ${chip.offset < 0 ? '−' : '+'}${fmt(Math.abs(chip.offset))}` : ''
    return { text: `fft[${chip.bin}]${scale}${offset}`, audio: chip }
  }
  const w = parseFnWrap(src)
  if (!w) return { text: src.length > 28 ? src.slice(0, 27) + '…' : src }
  let t = w.body.replace(/Math\./g, '')
  if (w.scale !== 1) t += ` ×${fmt(w.scale)}`
  if (w.offset !== 0) t += ` ${w.offset < 0 ? '−' : '+'}${fmt(Math.abs(w.offset))}`
  return { text: t.length > 34 ? t.slice(0, 33) + '…' : t }
}

/** A tiny live meter for one fft bin. Updates the DOM directly: no re-render per frame. */
export function Meter({ bin, scale = 1, offset = 0, vertical = true }: { bin: number; scale?: number; offset?: number; vertical?: boolean }) {
  const bar = useRef<HTMLElement>(null)
  useEffect(() => {
    const off = ctx.audio.onFrame((f) => {
      const el = bar.current
      if (!el) return
      const v = Math.max(0, Math.min(1, (f.fft[bin] ?? 0) * scale + offset))
      if (vertical) el.style.height = `${(v * 100).toFixed(0)}%`
      else el.style.width = `${(v * 100).toFixed(0)}%`
    })
    return off
  }, [bin, scale, offset, vertical])
  return (
    <span class={`meter ${vertical ? 'v' : 'h'}`} data-testid="fn-meter" aria-hidden="true">
      <i ref={bar} />
    </span>
  )
}

export interface FnEditorProps {
  refd: ArgRef
  title: string
  input?: InputDef
  hint: Hint
}

export function FnEditor({ refd, title, hint }: FnEditorProps) {
  useStore()
  const v = getArg(ctx.store.sketch, refd)
  const src = v?.k === 'fn' ? v.src : ''
  const parsed = parseFnWrap(src)
  const [body, setBody] = useState(parsed?.body ?? src)
  const [scale, setScale] = useState(parsed?.scale ?? 1)
  const [offset, setOffset] = useState(parsed?.offset ?? 0)
  const composed = useRef(src)
  const inputRef = useRef<HTMLInputElement>(null)

  // follow outside changes (undo, the code view) but never rewrite what the user is typing
  useEffect(() => {
    if (src === composed.current) return
    composed.current = src
    const p = parseFnWrap(src)
    setBody(p?.body ?? src)
    setScale(p?.scale ?? 1)
    setOffset(p?.offset ?? 0)
  }, [src])

  if (v?.k !== 'fn') return <div class="empty">This value is no longer a function.</div>
  const canWrap = !!parsed
  const audio = AUDIO_BODY.exec(body.trim())
  const valid = syntaxOk(body)
  const key = `fn:${refKey(refd)}`

  const push = (b: string, s: number, o: number) => {
    if (!syntaxOk(b)) return
    const a = AUDIO_BODY.exec(b.trim())
    const next = a ? (audioChip(Number(a[1]), s, o) as { k: 'fn'; src: string }).src : canWrap ? composeFn(b, s, o) : b.trim().startsWith('()') ? b : `() => ${b}`
    composed.current = next
    edit((sk) => setArg(sk, refd, fnv(next)), { coalesce: key })
  }
  const setB = (b: string) => {
    setBody(b)
    push(b, scale, offset)
  }
  const insert = (expr: string) => {
    const el = inputRef.current
    const isChip = FN_CHIPS.some((c) => c.expr === body.trim())
    // a chip replaces the expression, unless the caret is in the field (then it is inserted there)
    const typing = !!el && document.activeElement === el
    let nb: string
    let caret: number
    if (!body.trim() || isChip || !typing || !el) {
      nb = expr
      caret = expr.length
    } else {
      const a = el.selectionStart ?? body.length
      const z = el.selectionEnd ?? a
      nb = body.slice(0, a) + expr + body.slice(z)
      caret = a + expr.length
    }
    setB(nb)
    requestAnimationFrame(() => {
      el?.setSelectionRange(caret, caret)
    })
  }
  const bins = Math.max(4, ctx.audio.settings.bins)
  const audioOn = ctx.audio.state === 'running'

  return (
    <div class="fn-editor" data-testid="fn-editor">
      <div class="ed-head">
        <span>{title}</span>
        <code class="ed-src">{src}</code>
      </div>
      <div class="chips" role="list">
        {FN_CHIPS.map((c) => (
          <button type="button" role="listitem" class={`chip ${body.trim() === c.expr ? 'on' : ''}`} key={c.label} data-chip={c.label} onClick={() => insert(c.expr)}>
            {c.label}
          </button>
        ))}
      </div>
      <div class="expr-row">
        <span class="p big">() =&gt;</span>
        <input
          ref={inputRef}
          class={`expr ${valid ? '' : 'bad'}`}
          data-testid="fn-expr"
          type="text"
          inputMode="text"
          autocapitalize="off"
          autocorrect="off"
          autocomplete="off"
          spellcheck={false}
          value={body}
          aria-label="Expression"
          aria-invalid={!valid}
          onInput={(e) => setB((e.currentTarget as HTMLInputElement).value)}
        />
        {audio && <Meter bin={Number(audio[1])} scale={scale} offset={offset} />}
      </div>
      {!valid && <div class="note bad">That is not a valid expression yet; the sketch keeps the last good one.</div>}
      {audio && (
        <div class="bins" role="group" aria-label="fft bin">
          <span class="lbl">bin</span>
          {Array.from({ length: bins }, (_, i) => (
            <button type="button" class={`chip bin ${Number(audio[1]) === i ? 'on' : ''}`} key={i} data-bin={i} onClick={() => setB(`a.fft[${i}]`)}>
              {i}
            </button>
          ))}
        </div>
      )}
      {audio && !audioOn && (
        <div class="note">
          Audio is off. Start the microphone or a file in the audio panel.{' '}
          <button type="button" class="linkish" onClick={() => openSheet('Audio', (c) => <AudioMount onDone={c} />)}>
            Open audio panel
          </button>
        </div>
      )}
      {canWrap ? (
        <div class="wrap-row">
          <span class="lbl">scale</span>
          <Scrub
            testid="fn-scale"
            label="scale"
            value={scale}
            hint={{ min: -8, max: 8, step: 0.01 }}
            dim={scale === 1}
            onChange={(n, ph) => {
              if (ph === 'end') return ctx.store.endGroup()
              setScale(n)
              push(body, n, offset)
            }}
            onTap={(el) => openKeypadFor(el, 'scale', scale, 1, { min: -8, max: 8, step: 0.01 }, (n) => (setScale(n), push(body, n, offset)))}
          />
          <span class="lbl">offset</span>
          <Scrub
            testid="fn-offset"
            label="offset"
            value={offset}
            hint={{ min: Math.min(hint.min, -1), max: Math.max(hint.max, 1), step: hint.step ?? 0.01 }}
            dim={offset === 0}
            onChange={(n, ph) => {
              if (ph === 'end') return ctx.store.endGroup()
              setOffset(n)
              push(body, scale, n)
            }}
            onTap={(el) => openKeypadFor(el, 'offset', offset, 0, { min: Math.min(hint.min, -1), max: Math.max(hint.max, 1), step: hint.step ?? 0.01 }, (n) => (setOffset(n), push(body, scale, n)))}
          />
        </div>
      ) : (
        <div class="note">This function is not a plain `() =&gt; …` arrow, so it is shown as text only.</div>
      )}
    </div>
  )
}

function openKeypadFor(el: HTMLElement, title: string, value: number, def: number, hint: Hint, onChange: (n: number) => void) {
  openPopover(el, (close) => <Keypad title={title} value={value} def={def} hint={hint} onChange={onChange} onClose={close} />, { width: 260, label: title, stack: true, onClose: () => ctx.store.endGroup() })
}

/** core's audio panel inside a sheet. */
export function AudioMount({ onDone }: { onDone?: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    host.current.textContent = ''
    const h = mountAudioPanel(host.current, { engine: ctx.audio })
    return () => h.destroy()
  }, [])
  return (
    <div>
      <div ref={host} data-testid="audio-panel" />
      {onDone && (
        <button type="button" class="btn wide" onClick={onDone}>
          Done
        </button>
      )}
    </div>
  )
}
