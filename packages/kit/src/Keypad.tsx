// Compact numeric keypad popover: digits, ., ±, backspace, and the nudges ×2 ÷2 ±1. Every key applies immediately
// (the preview follows), and the whole session is one undo step.
import type { Hint } from '@hydra-ipad/core'
import { useRef, useState } from 'preact/hooks'
import { fmt, roundTo, wrapInto } from './conv'

export interface KeypadProps {
  title: string
  value: number
  def?: number
  hint: Hint
  onChange: (v: number) => void
  onClose: () => void
}

export function Keypad(p: KeypadProps) {
  const [buf, setBuf] = useState<string>('')
  const [fresh, setFresh] = useState(true)
  const [cur, setCur] = useState(p.value)
  const latest = useRef(cur)
  latest.current = cur

  const apply = (v: number) => {
    if (!isFinite(v)) return
    latest.current = v
    setCur(v)
    p.onChange(v)
  }
  const press = (k: string) => {
    let b = fresh ? '' : buf
    if (k === '⌫') b = b.slice(0, -1)
    else if (k === '±') b = b.startsWith('-') ? b.slice(1) : '-' + (b || fmt(latest.current).replace(/^-/, ''))
    else if (k === '.') {
      if (!b.includes('.')) b = (b === '' || b === '-' ? b + '0' : b) + '.'
    } else b += k
    setFresh(false)
    setBuf(b)
    const n = Number(b)
    if (b !== '' && b !== '-' && !b.endsWith('.') && isFinite(n)) apply(n)
    else if (b.endsWith('.') && isFinite(Number(b + '0'))) apply(Number(b + '0'))
  }
  const nudge = (f: (v: number) => number) => {
    const v = f(latest.current)
    const r = Math.abs(v) < 1e-9 ? 0 : +v.toPrecision(10)
    setFresh(true)
    setBuf('')
    apply(p.hint.wrap ? wrapInto(r, p.hint.min, p.hint.max) : r)
  }
  const show = fresh ? fmt(cur) : buf || '0'
  const key = (k: string, label = k, cls = '') => (
    <button type="button" class={`key ${cls}`} data-key={k} onClick={() => press(k)} aria-label={label === '⌫' ? 'backspace' : label}>
      {label}
    </button>
  )
  const nk = (label: string, f: (v: number) => number, testid: string) => (
    <button type="button" class="key nudge" data-testid={testid} onClick={() => nudge(f)}>
      {label}
    </button>
  )
  const step = p.hint.integer ? 1 : roundTo(Math.max(p.hint.step ?? 0.01, 0.01) * 10, p.hint.step ?? 0.01)
  return (
    <div class="keypad" data-testid="keypad">
      <div class="kp-head">
        <span class="kp-title">{p.title}</span>
        {p.def !== undefined && <span class="kp-def">default {fmt(p.def)}</span>}
      </div>
      <div class={`kp-display ${fresh ? 'fresh' : ''}`} data-testid="kp-display">
        {show}
      </div>
      <div class="kp-grid">
        {nk('×2', (v) => v * 2, 'nudge-x2')}
        {nk('÷2', (v) => v / 2, 'nudge-d2')}
        {nk('−1', (v) => v - 1, 'nudge-m1')}
        {nk('+1', (v) => v + 1, 'nudge-p1')}
        {key('7')}
        {key('8')}
        {key('9')}
        {key('⌫', '⌫', 'util')}
        {key('4')}
        {key('5')}
        {key('6')}
        {key('±', '±', 'util')}
        {key('1')}
        {key('2')}
        {key('3')}
        {nk(`+${fmt(step)}`, (v) => v + step, 'nudge-step')}
        {key('0', '0', 'wide')}
        {key('.')}
        <button type="button" class="key ok" data-testid="kp-ok" onClick={p.onClose}>
          OK
        </button>
      </div>
      {p.def !== undefined && (
        <button
          type="button"
          class="kp-reset"
          onClick={() => {
            setFresh(true)
            apply(p.def!)
          }}
        >
          Reset to default ({fmt(p.def)})
        </button>
      )}
    </div>
  )
}
