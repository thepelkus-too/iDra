// The on-screen MIDI controller ("Hydra Touch": 8 CC faders, a keyboard, 8 pads) and the "no Web MIDI" banner.
// Messages go through the page's MidiHub to every runtime, whose frame shim hands them to hydra-midi.

import { getMidiHub, usesMidi, webMidiAvailable, type MidiHub } from './midi'
import type { Sketch } from './ir'
import { siteRoot } from './switcher'
import { h, injectStyles, TOKENS_CSS } from './ui'

const CSS = `
${TOKENS_CSS}
.hi-midi{font:13px/1.35 system-ui,-apple-system,sans-serif;color:var(--hi-text);background:var(--hi-panel);border:1px solid var(--hi-line);border-radius:var(--hi-r);padding:10px;display:grid;gap:10px;touch-action:none;-webkit-user-select:none;user-select:none;max-width:560px}
.hi-midi .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.hi-midi button,.hi-midi select{min-height:40px;padding:0 12px;border-radius:8px;border:1px solid var(--hi-line);background:var(--hi-bg);color:var(--hi-text);font:inherit}
.hi-midi .note{color:var(--hi-dim);font-size:12px}
.hi-midi .faders{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}
.hi-midi .fader{position:relative;height:150px;border-radius:8px;background:var(--hi-bg);border:1px solid var(--hi-line);overflow:hidden;touch-action:none}
.hi-midi .fader i{position:absolute;left:0;right:0;bottom:0;background:var(--hi-accent);opacity:.85}
.hi-midi .fader span{position:absolute;left:0;right:0;top:4px;text-align:center;font-size:11px;color:var(--hi-text);text-shadow:0 1px 2px #000;pointer-events:none}
.hi-midi .fader b{position:absolute;left:0;right:0;bottom:4px;text-align:center;font-size:11px;font-weight:600;pointer-events:none;font-variant-numeric:tabular-nums}
.hi-midi .keys{display:flex;height:96px;gap:2px}
.hi-midi .key{flex:1;border-radius:0 0 6px 6px;background:#e9edf2;color:#111;display:flex;align-items:flex-end;justify-content:center;font-size:10px;padding-bottom:4px;touch-action:none;border:1px solid #0003}
.hi-midi .key.black{background:#1b1f24;color:#ccd;height:62%;flex:.8}
.hi-midi .key.on,.hi-midi .pad.on{background:var(--hi-accent)!important;color:#042}
.hi-midi .pads{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}
.hi-midi .pad{height:54px;border-radius:8px;background:var(--hi-bg);border:1px solid var(--hi-line);display:flex;align-items:center;justify-content:center;font-size:11px;touch-action:none}
.hi-midi-banner{font:13px/1.4 system-ui,-apple-system,sans-serif;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;border-radius:10px;background:#3a2a05;color:#ffd98a;border:1px solid #7a5a10}
.hi-midi-banner a{color:#ffe7b0}
.hi-midi-banner button{min-height:36px;padding:0 10px;border-radius:8px;border:1px solid #7a5a10;background:#4a360a;color:#ffe7b0;font:inherit}
`

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** hydra-midi's note naming: C4 = 60 (`note('C3')` is 48). */
export const midiNoteName = (n: number) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`

export interface MidiControllerOptions {
  hub?: MidiHub
  /** first CC number of the 8 faders (default 1 → CC 1–8) */
  firstCC?: number
  /** lowest keyboard note (default 48 = C3) and number of keys (default 13) */
  lowNote?: number
  keys?: number
  /** pad notes (default 36–43, the General MIDI drum range) */
  padNotes?: number[]
}

export function mountMidiController(el: HTMLElement, opts: MidiControllerOptions = {}): { element: HTMLElement; destroy(): void } {
  injectStyles('midi-panel', CSS)
  const hub = opts.hub ?? getMidiHub()
  const firstCC = opts.firstCC ?? 1
  const low = opts.lowNote ?? 48
  const nKeys = opts.keys ?? 13
  const pads = opts.padNotes ?? [36, 37, 38, 39, 40, 41, 42, 43]
  let channel = 0

  const chSel = h('select', { 'aria-label': 'MIDI channel', 'data-role': 'midi-channel' }, ...Array.from({ length: 16 }, (_, i) => h('option', { value: i }, `channel ${i + 1}`))) as HTMLSelectElement
  chSel.addEventListener('change', () => (channel = Number(chSel.value)))
  const webBtn = h('button', { 'data-role': 'midi-enable' }, 'Use MIDI devices too')
  const webNote = h('span', { class: 'note', 'data-role': 'midi-web' })
  const renderWeb = () => {
    const ins = hub.inputs().filter((i) => i.id !== 'hydra-touch')
    webBtn.hidden = hub.webMidi !== 'idle'
    webNote.textContent =
      hub.webMidi === 'unavailable' ? 'This browser has no Web MIDI: only this on-screen controller sends MIDI.' :
      hub.webMidi === 'denied' ? `MIDI access was refused (${hub.webMidiError ?? 'denied'}).` :
      hub.webMidi === 'granted' ? (ins.length ? `Also forwarding: ${ins.map((i) => i.name).join(', ')}` : 'MIDI access granted; no devices connected.') :
      'Hardware controllers can be forwarded too.'
  }
  webBtn.addEventListener('click', async () => {
    await hub.enableWebMidi()
    renderWeb()
  })
  const unInputs = hub.onInputs(renderWeb)
  renderWeb()

  // ---- faders
  const faders = h('div', { class: 'faders' })
  for (let i = 0; i < 8; i++) {
    const cc = firstCC + i
    const fill = h('i')
    const val = h('b', {}, '0')
    const f = h('div', { class: 'fader', role: 'slider', 'aria-label': `CC ${cc}`, 'aria-valuemin': 0, 'aria-valuemax': 127, 'aria-valuenow': 0, 'data-cc': cc, tabindex: 0 }, fill, h('span', {}, `CC${cc}`), val)
    let last = -1
    const set = (v01: number) => {
      const v = Math.round(Math.max(0, Math.min(1, v01)) * 127)
      fill.style.height = `${(v / 127) * 100}%`
      val.textContent = String(v)
      f.setAttribute('aria-valuenow', String(v))
      if (v !== last) {
        last = v
        hub.cc(cc, v / 127, channel)
      }
    }
    const fromEvent = (e: PointerEvent) => {
      const r = f.getBoundingClientRect()
      set(1 - (e.clientY - r.top) / Math.max(1, r.height))
    }
    let active: number | null = null
    f.addEventListener('pointerdown', (e) => {
      active = e.pointerId
      f.setPointerCapture?.(e.pointerId)
      fromEvent(e)
    })
    f.addEventListener('pointermove', (e) => {
      if (active === e.pointerId) fromEvent(e)
    })
    const release = (e: PointerEvent) => {
      if (active === e.pointerId) active = null
    }
    f.addEventListener('pointerup', release)
    f.addEventListener('pointercancel', release)
    f.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0
      if (step) set((Math.max(0, last) + step * 8) / 127)
    })
    faders.append(f)
  }

  // ---- keyboard
  const keys = h('div', { class: 'keys' })
  const press = (elx: HTMLElement, note: number) => {
    let down = false
    const on = (e: PointerEvent) => {
      elx.setPointerCapture?.(e.pointerId)
      down = true
      elx.classList.add('on')
      hub.noteOn(note, 0.8, channel)
    }
    const off = () => {
      if (!down) return
      down = false
      elx.classList.remove('on')
      hub.noteOff(note, channel)
    }
    elx.addEventListener('pointerdown', on)
    elx.addEventListener('pointerup', off)
    elx.addEventListener('pointercancel', off)
    elx.addEventListener('lostpointercapture', off)
  }
  for (let n = low; n < low + nKeys; n++) {
    const black = [1, 3, 6, 8, 10].includes(n % 12)
    const k = h('div', { class: 'key' + (black ? ' black' : ''), role: 'button', 'aria-label': `note ${midiNoteName(n)} (${n})`, 'data-note': n }, black ? '' : midiNoteName(n))
    press(k, n)
    keys.append(k)
  }
  // ---- pads
  const padEl = h('div', { class: 'pads' })
  for (const n of pads) {
    const p = h('div', { class: 'pad', role: 'button', 'aria-label': `pad ${n}`, 'data-pad': n }, String(n))
    press(p, n)
    padEl.append(p)
  }

  const root = h('div', { class: 'hi-midi', role: 'group', 'aria-label': 'MIDI controller' },
    h('div', { class: 'row' }, h('strong', {}, 'Hydra Touch'), chSel, webBtn),
    webNote,
    faders, keys, padEl,
    h('div', { class: 'note' }, `In a sketch: await midi.start({ input: '*', channel: '*' }) then cc(${firstCC}) … cc(${firstCC + 7}), note(${low}) or note('${midiNoteName(low)}'). Needs the hydra-midi plugin.`),
  )
  el.appendChild(root)
  return {
    element: root,
    destroy() {
      unInputs()
      root.remove()
    },
  }
}

export interface MidiBannerOptions {
  /** link to the Diagnostics page (default: the harness's Diagnostics tab next to this app) */
  diagnosticsUrl?: string
  /** called when the owner wants the on-screen controller */
  onController?: () => void
}

/** "Web MIDI isn't available…" when the sketch uses hydra-midi and the browser has no Web MIDI. Returns null otherwise. */
export function midiBanner(sketch: Sketch, opts: MidiBannerOptions = {}): HTMLElement | null {
  if (!usesMidi(sketch) || webMidiAvailable()) return null
  injectStyles('midi-panel', CSS)
  const diag = opts.diagnosticsUrl ?? diagnosticsHref()
  return h('div', { class: 'hi-midi-banner', role: 'status', 'data-role': 'midi-banner' },
    h('span', {}, 'Web MIDI isn’t available in this browser, so MIDI inputs won’t respond. '),
    h('a', { href: diag }, 'Diagnostics'),
    opts.onController ? h('button', { type: 'button', onclick: opts.onController }, 'Use the on-screen controller') : null,
  )
}

/** The harness's Diagnostics tab (the live feature report). `current`: this app's name, or 'shell' at the site root. */
export function diagnosticsHref(current = 'app', base?: string): string {
  return new URL('harness/?tab=diag', siteRoot(current, base)).href
}
