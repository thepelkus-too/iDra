import { AudioEngine, getAudioEngine } from './audio'
import {
  DeviceSource,
  DisplaySource,
  FileSource,
  MicSource,
  StreamSource,
  displayAudioSupported,
  listAudioInputs,
  saveAudioInput,
  savedAudioInput,
  unlockInputLabels,
  type AudioInputInfo,
} from './audio-sources'
import { AudioAssetError, getAudioAssets, type AudioAssets } from './audio-assets'
import { appStorage } from './storage'
import { h, injectStyles, TOKENS_CSS } from './ui'

const CSS = `
${TOKENS_CSS}
.hi-audio{font:13px/1.35 system-ui,-apple-system,sans-serif;color:var(--hi-text);background:var(--hi-panel);border:1px solid var(--hi-line);border-radius:var(--hi-r);padding:10px;display:grid;gap:8px;min-width:220px;max-width:340px;touch-action:manipulation;-webkit-user-select:none;user-select:none}
.hi-audio .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.hi-audio button,.hi-audio select,.hi-audio input[type=url],.hi-audio input[type=text]{min-height:40px;padding:0 12px;border-radius:8px;border:1px solid var(--hi-line);background:var(--hi-bg);color:var(--hi-text);font:inherit;min-width:0}
.hi-audio input[type=url]{flex:1;-webkit-user-select:text;user-select:text}
.hi-audio button.primary{background:var(--hi-accent);color:#042;border-color:transparent;font-weight:600}
.hi-audio button.resume{background:var(--hi-warn);color:#210;border-color:transparent;font-weight:700;width:100%;min-height:48px}
.hi-audio button[disabled]{opacity:.45}
.hi-audio .meter{display:flex;gap:3px;height:44px;align-items:flex-end;background:var(--hi-bg);border-radius:6px;padding:4px}
.hi-audio .meter i{flex:1;background:var(--hi-accent);min-height:2px;border-radius:2px;transition:height 60ms linear}
.hi-audio .meter i.vol{background:var(--hi-warn);flex:.6}
.hi-audio .meter i.beat{flex:.35;background:var(--hi-line);transition:background 80ms}
.hi-audio .meter i.beat.on{background:#fff}
.hi-audio label{display:grid;grid-template-columns:70px 1fr 40px;gap:6px;align-items:center;color:var(--hi-dim)}
.hi-audio label.check{display:flex;gap:8px;min-height:36px}
.hi-audio input[type=range]{width:100%;min-height:32px}
.hi-audio output{text-align:right;font-variant-numeric:tabular-nums;color:var(--hi-text)}
.hi-audio .note{color:var(--hi-dim);font-size:12px}
.hi-audio .hint{color:var(--hi-warn);font-size:12px}
.hi-audio .err{color:var(--hi-bad)}
.hi-audio .time{margin-left:auto;color:var(--hi-dim);font-variant-numeric:tabular-nums}
.hi-audio .src{display:grid;gap:6px}
.hi-audio .src[hidden],.hi-audio [hidden]{display:none!important}
.hi-audio .fname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.hi-audio .seek{grid-template-columns:1fr}
`

export interface AudioPanelOptions {
  engine?: AudioEngine
  /** show the long-form iOS notes */
  notes?: boolean
  /** opt-in file store (default: the shared one) */
  assets?: AudioAssets
}

export interface AudioPanelHandle {
  element: HTMLElement
  destroy(): void
}

type Choice = 'mic' | 'device' | 'file' | 'stream' | 'display' | 'other'

const OTHER_APPS_TEXT =
  'A web page cannot record what other apps play on an iPad. Two ways around it: hold the iPad near the speaker and use the Microphone, or connect a USB-C audio interface (line-in, or a loopback cable from the other device’s output) and pick it under “Input device”.'

const fmtTime = (t: number) => {
  if (!isFinite(t)) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
const fmtMB = (n?: number) => (n === undefined ? '' : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`)

/** Audio control panel: source (mic, input device, file, stream URL, other apps), transport, meters, Hydra's settings, monitor. */
export function mountAudioPanel(el: HTMLElement, opts: AudioPanelOptions = {}): AudioPanelHandle {
  injectStyles('audio-panel', CSS)
  const engine = opts.engine ?? getAudioEngine()
  const assets = opts.assets ?? getAudioAssets()
  const prefs = appStorage('core')

  // ---- source picker
  const choices: Array<[Choice, string]> = [
    ['mic', 'Microphone'],
    ['device', 'Input device…'],
    ['file', 'Audio file…'],
    ['stream', 'Stream URL…'],
  ]
  if (displayAudioSupported()) choices.push(['display', 'Tab / screen audio'])
  choices.push(['other', 'Other apps…'])
  const sourceSel = h('select', { 'aria-label': 'Audio source', 'data-role': 'source' }, ...choices.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement
  const startBtn = h('button', { class: 'primary', 'data-role': 'start' }, 'Start')
  const playBtn = h('button', { disabled: true, 'data-role': 'play' }, 'Pause')
  const time = h('span', { class: 'time' }, '')

  // device
  const deviceSel = h('select', { 'aria-label': 'Input device', 'data-role': 'device' }) as HTMLSelectElement
  const findBtn = h('button', { 'data-role': 'find-inputs' }, 'Find inputs')
  const deviceNote = h('div', { class: 'note' })
  const deviceBox = h('div', { class: 'src', hidden: true }, h('div', { class: 'row' }, deviceSel, findBtn), deviceNote)

  // file
  const fileInput = h('input', { type: 'file', accept: 'audio/*,video/*', style: 'display:none', 'data-role': 'file-input' }) as HTMLInputElement
  const chooseBtn = h('button', { 'data-role': 'choose-file' }, 'Choose file…')
  const fileName = h('div', { class: 'note fname', 'data-role': 'file-name' }, 'No file chosen')
  const seek = h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: 0, 'aria-label': 'Seek', 'data-role': 'seek', disabled: true }) as HTMLInputElement
  const loop = h('input', { type: 'checkbox', checked: true, 'data-role': 'loop' }) as HTMLInputElement
  const keep = h('input', { type: 'checkbox', 'data-role': 'keep' }) as HTMLInputElement
  const savedSel = h('select', { 'aria-label': 'Kept files', 'data-role': 'saved' }) as HTMLSelectElement
  const forgetBtn = h('button', { 'data-role': 'forget' }, 'Remove')
  const savedRow = h('div', { class: 'row', hidden: true }, savedSel, forgetBtn)
  const fileBox = h('div', { class: 'src', hidden: true },
    h('div', { class: 'row' }, chooseBtn, fileInput),
    fileName,
    h('label', { class: 'seek' }, seek),
    h('div', { class: 'row' }, h('label', { class: 'check' }, loop, 'loop'), h('label', { class: 'check', title: 'Stored on this device only, never in the sketch' }, keep, 'keep on this device')),
    savedRow,
  )

  // stream
  const urlInput = h('input', { type: 'url', placeholder: 'https://…/stream.mp3', 'aria-label': 'Stream URL', 'data-role': 'stream-url', autocapitalize: 'off', autocomplete: 'off', spellcheck: false, value: prefs.get<string>('streamUrl') ?? '' }) as HTMLInputElement
  const streamBox = h('div', { class: 'src', hidden: true }, h('div', { class: 'row' }, urlInput), h('div', { class: 'note' }, 'Internet radio or a direct MP3/AAC/Ogg link. Analysis needs the server to allow it (CORS); otherwise it can still play.'))

  const otherBox = h('div', { class: 'src note', hidden: true, 'data-role': 'other-apps' }, OTHER_APPS_TEXT)

  // status and actions
  const resumeBtn = h('button', { class: 'resume', hidden: true, 'data-role': 'resume' }, 'Audio paused by the system · tap to resume')
  const playOnlyBtn = h('button', { hidden: true, 'data-role': 'play-only' }, 'Play without analysis')
  const analysisNote = h('div', { class: 'note err', hidden: true, 'data-role': 'analysis' })
  const hint = h('div', { class: 'hint', hidden: true, 'data-role': 'hint' })
  const meter = h('div', { class: 'meter', 'aria-hidden': 'true' })
  const status = h('div', { class: 'note', 'data-role': 'status' })

  const sliders: Record<string, { input: HTMLInputElement; out: HTMLOutputElement }> = {}
  const mk = (key: string, label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void) => {
    const input = h('input', { type: 'range', min, max, step, value, 'data-role': key }) as HTMLInputElement
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
  const monGain = mk('monitor', 'speakers', 0, 1, 0.01, engine.monitorState.gain, (v) => engine.setMonitorGain(v))
  const mute = h('input', { type: 'checkbox', checked: engine.monitorState.muted, 'data-role': 'mute' }) as HTMLInputElement
  mute.addEventListener('change', () => engine.setMonitorMuted(mute.checked))
  const muteRow = h('label', { class: 'check' }, mute, 'mute speakers')
  const notes = h('div', { class: 'note' }, opts.notes === false ? '' : 'iOS: with the mic on, the system may play audio quietly or through the earpiece; headphones avoid that and feedback. Devices with a silent switch would mute web audio; the app works around that.')

  const root = h('div', { class: 'hi-audio', role: 'group', 'aria-label': 'Audio' },
    h('div', { class: 'row' }, sourceSel, startBtn, playBtn, time),
    deviceBox, fileBox, streamBox, otherBox,
    resumeBtn, analysisNote, playOnlyBtn, hint,
    meter, status, ...controls, monGain, muteRow, notes,
  )
  el.appendChild(root)

  // iOS only lets a tap start audio: create/resume the context on the first tap inside the panel (not page-wide, so
  // opening an editor never interrupts music another app is playing).
  const unlock = () => void engine.unlock().catch(() => {})
  root.addEventListener('click', unlock, { once: true })
  root.addEventListener('touchend', unlock, { once: true, passive: true })

  // ---- meter
  let bars: HTMLElement[] = []
  let beatBar: HTMLElement | undefined
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
    beatBar = h('i', { class: 'beat', title: 'beat' })
    beatBar.style.height = '100%'
    meter.appendChild(beatBar)
  }
  rebuildMeter(engine.settings.bins)

  // ---- choosing sources
  let choice: Choice = (prefs.get<Choice>('audioSourceKind') as Choice) ?? 'mic'
  if (!choices.some(([v]) => v === choice)) choice = 'mic'
  let pendingFile: { blob: Blob; name: string; assetId?: string } | undefined
  let inputs: AudioInputInfo[] = []

  const showBoxes = () => {
    deviceBox.hidden = choice !== 'device'
    fileBox.hidden = choice !== 'file'
    streamBox.hidden = choice !== 'stream'
    otherBox.hidden = choice !== 'other'
    startBtn.hidden = choice === 'other'
  }
  const fillDevices = (labelled: boolean) => {
    deviceSel.textContent = ''
    const saved = savedAudioInput()
    if (!inputs.length) deviceSel.append(h('option', { value: '' }, 'No inputs found'))
    inputs.forEach((d, i) => deviceSel.append(h('option', { value: d.deviceId }, d.label || `Input ${i + 1}`)))
    if (saved && inputs.some((d) => d.deviceId === saved.deviceId)) deviceSel.value = saved.deviceId
    else if (saved) {
      const same = inputs.find((d) => d.label && d.label === saved.label)
      if (same) deviceSel.value = same.deviceId
    }
    deviceNote.textContent = labelled ? 'A USB-C audio interface shows up here when it is connected. The choice is remembered.' : 'Names appear after you allow the microphone once: tap “Find inputs”.'
  }
  const refreshDevices = async () => {
    try {
      const r = await listAudioInputs()
      inputs = r.inputs
      fillDevices(r.labelled)
    } catch {
      fillDevices(false)
    }
  }
  const refreshSaved = async () => {
    try {
      const list = await assets.list()
      savedSel.textContent = ''
      savedSel.append(h('option', { value: '' }, `Kept files (${list.length})`))
      for (const a of list) savedSel.append(h('option', { value: a.id }, `${a.name} · ${fmtMB(a.size)}`))
      savedRow.hidden = list.length === 0
    } catch {
      savedRow.hidden = true
    }
  }

  const sourceForChoice = () => {
    switch (choice) {
      case 'mic':
        return new MicSource()
      case 'device': {
        const d = inputs.find((x) => x.deviceId === deviceSel.value) ?? savedAudioInput()
        return d ? new DeviceSource(d.deviceId, d.label) : new MicSource()
      }
      case 'file':
        return pendingFile ? new FileSource(pendingFile.blob, pendingFile.name, { loop: loop.checked }) : undefined
      case 'stream': {
        const u = urlInput.value.trim()
        return u ? new StreamSource(u) : undefined
      }
      case 'display':
        return new DisplaySource()
      default:
        return undefined
    }
  }
  const applyChoice = () => {
    const src = sourceForChoice()
    if (src) engine.setSource(src)
    else if (engine.source) engine.setSource(undefined)
    refresh()
  }

  sourceSel.value = choice
  showBoxes()
  sourceSel.addEventListener('change', () => {
    choice = sourceSel.value as Choice
    prefs.set('audioSourceKind', choice)
    showBoxes()
    if (choice === 'device') void refreshDevices()
    if (choice === 'file') {
      void refreshSaved()
      if (!pendingFile) fileInput.click()
    }
    if (choice !== 'other') applyChoice()
  })
  findBtn.addEventListener('click', async () => {
    try {
      const r = await unlockInputLabels()
      inputs = r.inputs
      fillDevices(r.labelled)
      applyChoice()
    } catch (e) {
      deviceNote.textContent = (e as Error).message
    }
  })
  deviceSel.addEventListener('change', () => {
    const d = inputs.find((x) => x.deviceId === deviceSel.value)
    if (d) saveAudioInput(d)
    applyChoice()
  })
  chooseBtn.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0]
    if (!f) return
    pendingFile = { blob: f, name: f.name }
    fileName.textContent = `${f.name} · ${fmtMB(f.size)}`
    fileName.className = 'note fname'
    if (keep.checked) await keepFile()
    applyChoice()
  })
  const keepFile = async () => {
    if (!pendingFile || pendingFile.assetId) return
    try {
      const a = await assets.add(pendingFile.blob, pendingFile.name)
      pendingFile.assetId = a.id
      await refreshSaved()
    } catch (e) {
      keep.checked = false
      fileName.textContent = e instanceof AudioAssetError ? e.message : `Could not keep the file: ${(e as Error).message}`
      fileName.className = 'note fname err'
    }
  }
  keep.addEventListener('change', () => {
    if (keep.checked) void keepFile()
  })
  savedSel.addEventListener('change', async () => {
    if (!savedSel.value) return
    const got = await assets.get(savedSel.value)
    if (!got) return
    pendingFile = { blob: got.blob, name: got.meta.name, assetId: got.meta.id }
    fileName.textContent = `${got.meta.name} · ${fmtMB(got.meta.size)} · kept on this device`
    applyChoice()
  })
  forgetBtn.addEventListener('click', async () => {
    if (!savedSel.value) return
    await assets.remove(savedSel.value)
    await refreshSaved()
  })
  loop.addEventListener('change', () => {
    const tr = engine.source?.transport
    if (tr) tr.loop = loop.checked
  })
  seek.addEventListener('input', () => engine.source?.transport?.seek(Number(seek.value)))
  urlInput.addEventListener('change', () => {
    prefs.set('streamUrl', urlInput.value.trim())
    applyChoice()
  })

  startBtn.addEventListener('click', async () => {
    try {
      if (engine.state === 'running' || engine.state === 'paused' || engine.state === 'starting') engine.stop()
      else {
        if (!engine.source || engine.state === 'error') {
          const src = sourceForChoice()
          if (!src) {
            if (choice === 'file') fileInput.click()
            else if (choice === 'stream') urlInput.focus()
            return
          }
          engine.setSource(src)
        }
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
  resumeBtn.addEventListener('click', () => void engine.resumeFromGesture())
  playOnlyBtn.addEventListener('click', async () => {
    const u = engine.source instanceof StreamSource ? engine.source.url : urlInput.value.trim()
    if (!u) return
    engine.setSource(new StreamSource(u, { playOnly: true }))
    try {
      await engine.start()
    } catch {
      /* shown */
    }
  })

  // ---- state → UI
  const refresh = () => {
    const running = engine.state === 'running' || engine.state === 'paused'
    startBtn.textContent = running ? 'Stop' : engine.state === 'starting' ? 'Starting…' : 'Start'
    playBtn.disabled = !(running && engine.source?.transport)
    playBtn.textContent = engine.state === 'paused' ? 'Play' : 'Pause'
    seek.disabled = !(running && engine.source?.transport)
    mute.checked = engine.monitorState.muted
    status.className = engine.state === 'error' ? 'note err' : 'note'
    const label = engine.source ? engine.source.label + (engine.source.playOnly ? ' (play only)' : '') : 'no source'
    status.textContent = engine.state === 'error' ? `Audio error: ${engine.error}` : `${label} · ${engine.state} · context ${engine.contextState}`
    resumeBtn.hidden = !engine.needsResume
    const blocked = engine.analysis === 'blocked'
    const noCors = engine.state === 'error' && !!engine.lastError?.canPlayOnly
    analysisNote.hidden = !blocked
    analysisNote.textContent = blocked ? 'The analyser only receives silence. If you can hear the stream, it plays but doesn’t allow analysis.' : ''
    playOnlyBtn.hidden = !(blocked || noCors)
    const ht = engine.hint
    hint.hidden = !ht
    hint.textContent = ht ?? ''
    const st = engine.settings
    for (const k of ['cutoff', 'scale', 'smooth', 'bins'] as const) {
      sliders[k].input.value = String(st[k])
      sliders[k].out.textContent = String(st[k])
    }
    const g = engine.monitorState.gain
    sliders.monitor.input.value = String(g)
    sliders.monitor.out.textContent = String(g)
    if (bars.length - 1 !== st.bins) rebuildMeter(st.bins)
  }
  const unState = engine.subscribe(refresh)
  const unSettings = engine.onSettings(refresh)
  let raf = 0
  let lastDraw = 0
  let beatUntil = 0
  const unFrame = engine.onFrame((f) => {
    const now = performance.now()
    if (f.beat) beatUntil = now + 120
    if (now - lastDraw < 33) return
    lastDraw = now
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      if (bars.length - 1 !== f.fft.length) rebuildMeter(f.fft.length)
      bars[0].style.height = `${Math.min(100, (f.vol / 30) * 100)}%`
      f.fft.forEach((v, i) => (bars[i + 1].style.height = `${Math.min(100, v * 100)}%`))
      beatBar?.classList.toggle('on', performance.now() < beatUntil)
      const tr = engine.source?.transport
      if (tr && tr.duration) {
        time.textContent = `${fmtTime(tr.currentTime)} / ${fmtTime(tr.duration)}`
        seek.max = String(tr.duration)
        if (document.activeElement !== seek) seek.value = String(tr.currentTime)
      } else time.textContent = tr && tr.currentTime ? fmtTime(tr.currentTime) : ''
    })
  })
  if (choice === 'device') void refreshDevices()
  if (choice === 'file') void refreshSaved()
  // pick up an engine that already has a source (another panel set it up)
  if (!engine.source && choice !== 'file' && choice !== 'other' && choice !== 'display') {
    const src = sourceForChoice()
    if (src) engine.setSource(src)
  }
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

