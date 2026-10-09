import { AudioEngine, FileSource, MicSource, getAudioEngine } from './audio'
import { h, injectStyles, TOKENS_CSS } from './ui'

const CSS = `
${TOKENS_CSS}
.hi-audio{font:13px/1.35 system-ui,-apple-system,sans-serif;color:var(--hi-text);background:var(--hi-panel);border:1px solid var(--hi-line);border-radius:var(--hi-r);padding:10px;display:grid;gap:8px;min-width:220px;max-width:340px;touch-action:manipulation;-webkit-user-select:none;user-select:none}
.hi-audio .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.hi-audio button,.hi-audio select{min-height:40px;padding:0 12px;border-radius:8px;border:1px solid var(--hi-line);background:var(--hi-bg);color:var(--hi-text);font:inherit}
.hi-audio button.primary{background:var(--hi-accent);color:#042;border-color:transparent;font-weight:600}
.hi-audio button[disabled]{opacity:.45}
.hi-audio .meter{display:flex;gap:3px;height:44px;align-items:flex-end;background:var(--hi-bg);border-radius:6px;padding:4px}
.hi-audio .meter i{flex:1;background:var(--hi-accent);min-height:2px;border-radius:2px;transition:height 60ms linear}
.hi-audio .meter i.vol{background:var(--hi-warn);flex:.6}
.hi-audio label{display:grid;grid-template-columns:70px 1fr 40px;gap:6px;align-items:center;color:var(--hi-dim)}
.hi-audio input[type=range]{width:100%;min-height:32px}
.hi-audio output{text-align:right;font-variant-numeric:tabular-nums;color:var(--hi-text)}
.hi-audio .note{color:var(--hi-dim);font-size:12px}
.hi-audio .err{color:var(--hi-bad)}
.hi-audio .time{margin-left:auto;color:var(--hi-dim);font-variant-numeric:tabular-nums}
`

export interface AudioPanelOptions {
  engine?: AudioEngine
  /** show the long-form iOS notes */
  notes?: boolean
}

export interface AudioPanelHandle {
  element: HTMLElement
  destroy(): void
}

/** Compact audio control panel: source, transport, level + bins meter, cutoff/scale/smooth/bins, monitor volume. */
export function mountAudioPanel(el: HTMLElement, opts: AudioPanelOptions = {}): AudioPanelHandle {
  injectStyles('audio-panel', CSS)
  const engine = opts.engine ?? getAudioEngine()
  const file = h('input', { type: 'file', accept: 'audio/*,video/*', style: 'display:none' })
  const sourceSel = h('select', { 'aria-label': 'Audio source' }, h('option', { value: 'mic' }, 'Microphone'), h('option', { value: 'file' }, 'Audio file…'))
  const startBtn = h('button', { class: 'primary' }, 'Start')
  const playBtn = h('button', { disabled: true }, 'Pause')
  const time = h('span', { class: 'time' }, '')
  const meter = h('div', { class: 'meter', 'aria-hidden': 'true' })
  const status = h('div', { class: 'note' })
  const sliders: Record<string, { input: HTMLInputElement; out: HTMLOutputElement }> = {}
  const mk = (key: string, label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void) => {
    const input = h('input', { type: 'range', min, max, step, value }) as HTMLInputElement
    const out = h('output', {}, String(value)) as HTMLOutputElement
    input.addEventListener('input', () => {
      out.textContent = input.value
      onInput(Number(input.value))
    })
    sliders[key] = { input, out }
    return h('label', {}, label, input, out)
  }
  const s = engine.settings
  const controls = [
    mk('cutoff', 'cutoff', 0, 10, 0.1, s.cutoff, (v) => engine.setSettings({ cutoff: v })),
    mk('scale', 'scale', 1, 30, 0.5, s.scale, (v) => engine.setSettings({ scale: v })),
    mk('smooth', 'smooth', 0, 0.99, 0.01, s.smooth, (v) => engine.setSettings({ smooth: v })),
    mk('bins', 'bins', 1, 16, 1, s.bins, (v) => engine.setSettings({ bins: v })),
  ]
  const monGain = mk('monitor', 'monitor', 0, 1, 0.01, engine.monitorState.gain, (v) => engine.setMonitorGain(v))
  const mute = h('input', { type: 'checkbox', checked: engine.monitorState.muted }) as HTMLInputElement
  mute.addEventListener('change', () => engine.setMonitorMuted(mute.checked))
  const muteRow = h('label', { style: 'grid-template-columns:auto 1fr' }, mute, 'mute speakers')
  const notes = h('div', { class: 'note' }, opts.notes === false ? '' : 'iOS: with the mic on, the system may play audio quietly through the earpiece. iPhones and some older iPads also mute web audio with the hardware silent switch; the app works around that. Sound from other apps cannot be captured.')

  const root = h('div', { class: 'hi-audio', role: 'group', 'aria-label': 'Audio' }, h('div', { class: 'row' }, sourceSel, startBtn, playBtn, time), file, meter, status, ...controls, monGain, muteRow, notes)
  el.appendChild(root)

  let bars: HTMLElement[] = []
  const rebuildMeter = (n: number) => {
    meter.textContent = ''
    bars = []
    const vol = h('i', { class: 'vol' })
    meter.appendChild(vol)
    bars.push(vol)
    for (let i = 0; i < n; i++) {
      const b = h('i')
      meter.appendChild(b)
      bars.push(b)
    }
  }
  rebuildMeter(engine.settings.bins)

  let pending: File | undefined
  const chooseSource = async () => {
    if (sourceSel.value === 'mic') engine.setSource(new MicSource())
    else if (pending) engine.setSource(new FileSource(pending))
  }
  sourceSel.addEventListener('change', () => {
    if (sourceSel.value === 'file') file.click()
    else void chooseSource()
  })
  file.addEventListener('change', () => {
    pending = file.files?.[0]
    if (pending) void chooseSource()
  })
  startBtn.addEventListener('click', async () => {
    try {
      if (engine.state === 'running' || engine.state === 'paused') engine.stop()
      else {
        if (!engine.source) await chooseSource()
        await engine.start()
      }
    } catch {
      /* shown via status */
    }
  })
  playBtn.addEventListener('click', async () => {
    if (engine.state === 'running') engine.pause()
    else await engine.resume()
  })

  const refresh = () => {
    const running = engine.state === 'running' || engine.state === 'paused'
    startBtn.textContent = running ? 'Stop' : engine.state === 'starting' ? 'Starting…' : 'Start'
    playBtn.disabled = !(running && engine.source?.transport)
    playBtn.textContent = engine.state === 'paused' ? 'Play' : 'Pause'
    mute.checked = engine.monitorState.muted
    status.className = engine.state === 'error' ? 'note err' : 'note'
    status.textContent = engine.state === 'error' ? `Audio error: ${engine.error}` : `${engine.source ? engine.source.label : 'no source'} · ${engine.state} · context ${engine.contextState}`
    const st = engine.settings
    for (const k of ['cutoff', 'scale', 'smooth', 'bins'] as const) {
      sliders[k].input.value = String(st[k])
      sliders[k].out.textContent = String(st[k])
    }
    if (bars.length - 1 !== st.bins) rebuildMeter(st.bins)
  }
  const unState = engine.subscribe(refresh)
  const unSettings = engine.onSettings(refresh)
  let raf = 0
  let lastDraw = 0
  const unFrame = engine.onFrame((f) => {
    const now = performance.now()
    if (now - lastDraw < 33) return
    lastDraw = now
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      if (bars.length - 1 !== f.fft.length) rebuildMeter(f.fft.length)
      bars[0].style.height = `${Math.min(100, (f.vol / 30) * 100)}%`
      f.fft.forEach((v, i) => (bars[i + 1].style.height = `${Math.min(100, v * 100)}%`))
      const tr = engine.source?.transport
      time.textContent = tr && tr.duration ? `${tr.currentTime.toFixed(0)}/${tr.duration.toFixed(0)}s` : ''
    })
  })
  refresh()
  return {
    element: root,
    destroy() {
      unState()
      unSettings()
      unFrame()
      cancelAnimationFrame(raf)
      root.remove()
    },
  }
}
