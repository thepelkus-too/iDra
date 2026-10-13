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
import {
  audioProxyUrl,
  downloadEpisode,
  getPodcastLibrary,
  isDirectAudioUrl,
  requestPersistentStorage,
  resolveAudioUrl,
  resumePoint,
  storageEstimate,
  FEED_BLOCKED_TEXT,
  PodcastError,
  type PodcastEpisode,
  type PodcastFeed,
  type PodcastLibrary,
} from './podcast'
import type { AudioAsset } from './audio-assets'
import { appStorage } from './storage'
import { h, injectStyles, TOKENS_CSS } from './ui'

const CSS = `
${TOKENS_CSS}
.hi-audio{font:13px/1.35 system-ui,-apple-system,sans-serif;color:var(--hi-text);background:var(--hi-panel);border:1px solid var(--hi-line);border-radius:var(--hi-r);padding:10px;display:grid;gap:8px;min-width:220px;max-width:340px;touch-action:manipulation;-webkit-user-select:none;user-select:none}
.hi-audio .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
/* the editors turn the long-press menu off page-wide; links here need it (Download Linked File, Copy) */
.hi-audio a{-webkit-touch-callout:default}
.hi-audio .note .links{margin-top:6px}.hi-audio .note .links a{color:inherit;font-weight:600;min-height:40px;display:inline-flex;align-items:center;padding:0 6px}
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
.hi-audio .eps{display:grid;gap:4px;max-height:260px;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.hi-audio .ep{display:grid;grid-template-columns:1fr auto;gap:4px}
.hi-audio .ep .dl{min-width:56px;padding:0 8px;font-variant-numeric:tabular-nums}
.hi-audio .ep .dl.saved{color:var(--hi-accent)}
.hi-audio .dls{display:grid;gap:4px;border-top:1px solid var(--hi-line);padding-top:6px}
.hi-audio .dls[hidden]{display:none}
.hi-audio .eps button.play{display:grid;gap:2px;text-align:left;padding:8px 10px;min-height:48px;height:auto}
.hi-audio .eps button.play[aria-current=true]{border-color:var(--hi-accent)}
.hi-audio .eps b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hi-audio .eps small{color:var(--hi-dim);font-size:12px}
.hi-audio .feed-title{font-weight:600}
.hi-audio .state{font-size:12px;padding:4px 8px;border-radius:6px;background:var(--hi-bg);justify-self:start}
.hi-audio .state.ok{color:var(--hi-accent)}
.hi-audio .state.warn{color:var(--hi-warn)}
.hi-audio .state.bad{color:var(--hi-bad)}
`

export interface AudioPanelOptions {
  engine?: AudioEngine
  /** show the long-form iOS notes */
  notes?: boolean
  /** opt-in file store (default: the shared one) */
  assets?: AudioAssets
  /** recent podcast feeds and episode positions (default: the shared one) */
  podcasts?: PodcastLibrary
  /** CORS proxy for feeds/audio (default: the AUDIO_PROXY_URL build setting, unset unless someone configured one) */
  proxy?: string | null
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
  const hr = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  return hr ? `${hr}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
const fmtDate = (t?: number) => {
  if (t === undefined) return ''
  try {
    return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2]
const FILE_HELP = 'Accepts audio saved from Patreon, Telegram or any download: save it to the Files app first (Share › Save to Files), then choose it here.'
const fmtMB = (n?: number) => (n === undefined ? '' : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`)

/** Audio control panel: source (mic, input device, file, stream URL, other apps), transport, meters, Hydra's settings, monitor. */
export const AUDIO_FILE_ACCEPT = [
  'audio/*', 'video/*',
  '.mp3', '.m4a', '.m4b', '.aac', '.wav', '.aif', '.aiff', '.caf', '.flac', '.ogg', '.oga', '.opus', '.webm', '.mp4', '.mov',
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/ogg',
].join(',')

export function mountAudioPanel(el: HTMLElement, opts: AudioPanelOptions = {}): AudioPanelHandle {
  injectStyles('audio-panel', CSS)
  const engine = opts.engine ?? getAudioEngine()
  const assets = opts.assets ?? getAudioAssets()
  const podcasts = opts.podcasts ?? getPodcastLibrary()
  const proxy = audioProxyUrl(opts.proxy)
  const prefs = appStorage('core')

  // ---- source picker
  const choices: Array<[Choice, string]> = [
    ['mic', 'Microphone'],
    ['device', 'Input device…'],
    ['file', 'Audio file…'],
    ['stream', 'Podcast / URL…'],
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
  // iOS greys out files it can't map to "audio/*" (an MP3 saved from Telegram or Safari often isn't), and Android may label
  // them application/octet-stream: list the extensions and exact types too
  const fileInput = h('input', { type: 'file', accept: AUDIO_FILE_ACCEPT, style: 'display:none', 'data-role': 'file-input' }) as HTMLInputElement
  const chooseBtn = h('button', { 'data-role': 'choose-file' }, 'Choose file…')
  const fileName = h('div', { class: 'note fname', 'data-role': 'file-name' }, 'No file chosen')
  const fileHelp = h('div', { class: 'note', 'data-role': 'file-help' }, FILE_HELP)
  const seek = h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: 0, 'aria-label': 'Seek', 'data-role': 'seek', disabled: true }) as HTMLInputElement
  const loop = h('input', { type: 'checkbox', checked: true, 'data-role': 'loop' }) as HTMLInputElement
  const keep = h('input', { type: 'checkbox', 'data-role': 'keep' }) as HTMLInputElement
  const savedSel = h('select', { 'aria-label': 'Kept files', 'data-role': 'saved' }) as HTMLSelectElement
  const forgetBtn = h('button', { 'data-role': 'forget' }, 'Remove')
  const savedRow = h('div', { class: 'row', hidden: true }, savedSel, forgetBtn)
  const fileBox = h('div', { class: 'src', hidden: true },
    h('div', { class: 'row' }, chooseBtn, fileInput),
    fileName,
    fileHelp,
    h('div', { class: 'row' }, h('label', { class: 'check' }, loop, 'loop'), h('label', { class: 'check', title: 'Stored on this device only, never in the sketch' }, keep, 'keep on this device')),
    savedRow,
  )

  // podcast / URL (podcast RSS or Atom feed, direct audio file, internet radio, HLS)
  const urlInput = h('input', { type: 'url', placeholder: 'Podcast feed or https://…/episode.mp3', 'aria-label': 'Podcast feed or audio URL', 'data-role': 'stream-url', autocapitalize: 'off', autocomplete: 'off', spellcheck: false, value: prefs.get<string>('streamUrl') ?? '' }) as HTMLInputElement
  const openBtn = h('button', { 'data-role': 'url-open' }, 'Open')
  const urlNote = h('div', { class: 'note', hidden: true, 'data-role': 'url-note' })
  const recentSel = h('select', { 'aria-label': 'Recent podcasts', 'data-role': 'recent-feeds' }) as HTMLSelectElement
  const forgetFeedBtn = h('button', { 'data-role': 'forget-feed', title: 'Forget this podcast and its saved positions' }, 'Forget')
  const forgetAllBtn = h('button', { 'data-role': 'forget-all-feeds', title: 'Forget every podcast and position kept on this device' }, 'Forget all')
  const recentRow = h('div', { class: 'row', hidden: true }, recentSel, forgetFeedBtn, forgetAllBtn)
  const feedTitle = h('div', { class: 'feed-title', hidden: true, 'data-role': 'feed-title' })
  const episodeList = h('div', { class: 'eps', hidden: true, role: 'list', 'data-role': 'episodes' })
  const back15 = h('button', { 'data-role': 'back15', 'aria-label': 'Back 15 seconds', disabled: true }, '−15 s')
  const fwd15 = h('button', { 'data-role': 'fwd15', 'aria-label': 'Forward 15 seconds', disabled: true }, '+15 s')
  const savedRate = Number(prefs.get<number>('podcastRate')) || 1
  const speedSel = h('select', { 'aria-label': 'Speed', 'data-role': 'speed' }, ...SPEEDS.map((v) => h('option', { value: String(v), selected: v === savedRate }, `${v}×`))) as HTMLSelectElement
  speedSel.value = String(SPEEDS.includes(savedRate) ? savedRate : 1)
  const podState = h('div', { class: 'state', hidden: true, 'data-role': 'pod-state', 'aria-live': 'polite' })
  const dlNote = h('div', { class: 'note', hidden: true, 'data-role': 'download-note', 'aria-live': 'polite' })
  const dlHead = h('div', { class: 'feed-title', 'data-role': 'downloads-head' })
  const dlList = h('div', { class: 'eps', role: 'list', 'data-role': 'downloads' })
  const dlBox = h('div', { class: 'dls', hidden: true }, dlHead, h('div', { class: 'note' }, 'Saved on this device: they play offline and always drive visuals.'), dlList)
  const streamBox = h('div', { class: 'src', hidden: true },
    h('div', { class: 'row' }, urlInput, openBtn),
    h('div', { class: 'note' }, 'A podcast RSS feed, a direct MP3/AAC/Ogg link, or internet radio. Analysis needs the host to allow it (CORS); otherwise it can still play.'),
    dlBox, urlNote, recentRow, feedTitle, episodeList, dlNote,
    h('div', { class: 'row' }, back15, fwd15, speedSel),
    podState,
  )
  const seekRow = h('label', { class: 'seek', hidden: true }, seek)

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
    deviceBox, fileBox, streamBox, otherBox, seekRow,
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
    seekRow.hidden = choice !== 'file' && choice !== 'stream'
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
        return pendingFile ? new FileSource(pendingFile.blob, pendingFile.name, { loop: loop.checked, ref: pendingFile.assetId ? { assetId: pendingFile.assetId } : undefined }) : undefined
      case 'stream':
        return pick ? streamFor(pick) : undefined
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
    if (choice === 'stream') {
      void refreshRecent()
      void loadPositions().then(loadDownloads)
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
      // kept: the next page can continue it (audio-continue.ts)
      if (engine.source instanceof FileSource && !engine.source.resumeRef) engine.source.resumeRef = { assetId: a.id }
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

  // ---- podcast / URL
  /** what "Start" plays for the Podcast / URL source */
  let pick: { url: string; name?: string; feedUrl?: string; duration?: number; src?: string } | undefined
  /** downloaded episodes by episode URL, with their Blob (a reference: the bytes stay in IndexedDB until read) */
  let downloads = new Map<string, { asset: AudioAsset; blob: Blob }>()
  /** downloads in progress by episode URL */
  const active = new Map<string, { ctl: AbortController; pct: string }>()
  let objectUrl: string | undefined
  let feed: PodcastFeed | undefined
  let positions = new Map<string, number>()
  let loading = false
  let blockedUnknown = false
  const say = (msg: string, cls = 'note') => {
    urlNote.textContent = msg
    urlNote.className = cls
    urlNote.hidden = !msg
  }
  const streamFor = (p: NonNullable<typeof pick>) =>
    new StreamSource(p.src ?? p.url, { name: p.name, ref: { url: p.url, assetId: downloads.get(p.url)?.asset.id }, startAt: resumePoint(positions.has(p.url) ? { url: p.url, position: positions.get(p.url)!, updatedAt: 0 } : undefined, p.duration), rate: Number(speedSel.value) || 1, proxy })
  const refreshRecent = async () => {
    try {
      const list = await podcasts.recentFeeds()
      recentSel.textContent = ''
      recentSel.append(h('option', { value: '' }, `Recent podcasts (${list.length})`))
      for (const f of list) recentSel.append(h('option', { value: f.url, selected: f.url === feed?.url }, `${f.title} · ${f.episodes} ep.`))
      recentRow.hidden = list.length === 0
    } catch {
      recentRow.hidden = true
    }
  }
  const loadPositions = async () => {
    try {
      positions = new Map((await podcasts.positions()).map((p) => [p.url, p.position]))
    } catch {
      positions = new Map()
    }
  }
  const savePosition = () => {
    const src = engine.source
    const tr = src?.transport
    if (!pick || !(src instanceof StreamSource) || src.url !== (pick.src ?? pick.url) || !tr || !tr.duration) return
    const at = tr.currentTime
    if (!(at > 0)) return
    positions.set(pick.url, at)
    void podcasts.savePosition(pick.url, at, { duration: tr.duration, feedUrl: pick.feedUrl }).catch(() => {})
  }
  const renderEpisodes = () => {
    episodeList.textContent = ''
    feedTitle.hidden = episodeList.hidden = !feed
    if (!feed) return
    feedTitle.textContent = `${feed.title} · ${feed.episodes.length} episode${feed.episodes.length === 1 ? '' : 's'}`
    if (!feed.episodes.length) episodeList.append(h('div', { class: 'note' }, 'This feed lists no audio episodes.'))
    for (const ep of feed.episodes.slice(0, 300)) {
      const at = positions.get(ep.url)
      const saved = downloads.has(ep.url)
      const meta = [fmtDate(ep.date), ep.duration ? fmtTime(ep.duration) : '', fmtMB(ep.size), saved ? 'on this device' : '', at && at >= 5 ? `resume at ${fmtTime(at)}` : ''].filter(Boolean).join(' · ')
      const b = h('button', { type: 'button', class: 'play', 'data-role': 'episode', 'data-url': ep.url, 'aria-current': pick?.url === ep.url ? 'true' : 'false' }, h('b', {}, ep.title), h('small', {}, meta))
      b.addEventListener('click', () => playEpisode(ep))
      const job = active.get(ep.url)
      const dl = h('button', { type: 'button', class: saved ? 'dl saved' : 'dl', 'data-role': 'download', 'data-url': ep.url, 'aria-label': saved ? `${ep.title} is saved on this device` : job ? `Cancel downloading ${ep.title}` : `Download ${ep.title} for offline`, disabled: saved }, saved ? '✓' : job ? job.pct : '↓')
      dl.addEventListener('click', () => (job ? job.ctl.abort() : void startDownload(ep)))
      episodeList.append(h('div', { class: 'ep', role: 'listitem' }, b, dl))
    }
  }
  const sayDl = (msg: string, cls = 'note') => {
    dlNote.textContent = msg
    dlNote.className = cls
    dlNote.hidden = !msg
  }
  // a host without CORS: the file itself still opens in a tab, where the browser can save it
  const fileLinks = (ep: PodcastEpisode) => {
    const copy = h('button', { type: 'button', 'data-role': 'copy-link' }, 'Copy link')
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ep.url)
        copy.textContent = 'Copied'
      } catch {
        window.prompt('Copy this link:', ep.url)
      }
    })
    const page = ep.page ? h('a', { href: ep.page, target: '_blank', rel: 'noopener noreferrer', 'data-role': 'episode-page' }, 'Episode page') : null
    return h('div', { class: 'row links' }, h('a', { href: ep.url, target: '_blank', rel: 'noopener noreferrer', 'data-role': 'open-file' }, 'Open file'), copy, ...(page ? [page] : []))
  }
  const renderDownloads = async () => {
    const list = [...downloads.values()]
    dlList.textContent = ''
    dlBox.hidden = list.length === 0
    if (!list.length) return
    const total = list.reduce((n, d) => n + d.asset.size, 0)
    const est = await storageEstimate()
    const room = est.quota !== undefined && est.usage !== undefined ? ` · about ${fmtMB(Math.max(0, est.quota - est.usage))} free for this site` : ''
    dlHead.textContent = `Downloads (${list.length}) · ${fmtMB(total)} of ${fmtMB(assets.limits.maxTotal)}${room}`
    for (const { asset } of list) {
      const o = asset.origin!
      const at = positions.get(o.url)
      const meta = [o.feedTitle, o.duration ? fmtTime(o.duration) : '', fmtMB(asset.size), at && at >= 5 ? `resume at ${fmtTime(at)}` : ''].filter(Boolean).join(' · ')
      const play = h('button', { type: 'button', class: 'play', 'data-role': 'downloaded', 'data-url': o.url, 'aria-current': pick?.url === o.url ? 'true' : 'false' }, h('b', {}, o.title), h('small', {}, meta))
      play.addEventListener('click', () => playEpisode({ id: o.url, url: o.url, title: o.title, duration: o.duration }, o.feedUrl))
      const del = h('button', { type: 'button', class: 'dl', 'data-role': 'delete-download', 'data-url': o.url, 'aria-label': `Delete ${o.title} from this device` }, 'Delete')
      del.addEventListener('click', () => void deleteDownload(asset))
      dlList.append(h('div', { class: 'ep', role: 'listitem' }, play, del))
    }
  }
  const loadDownloads = async () => {
    try {
      const list = await assets.downloads()
      const next = new Map<string, { asset: AudioAsset; blob: Blob }>()
      for (const a of list) {
        const got = await assets.get(a.id)
        if (got && a.origin) next.set(a.origin.url, { asset: a, blob: got.blob })
      }
      downloads = next
    } catch {
      downloads = new Map()
    }
    await renderDownloads()
    renderEpisodes()
  }
  const startDownload = async (ep: PodcastEpisode) => {
    const ctl = new AbortController()
    const job = { ctl, pct: '0%' }
    active.set(ep.url, job)
    sayDl(`Downloading “${ep.title}”… tap the percentage to cancel.`)
    renderEpisodes()
    void requestPersistentStorage()
    let last = 0
    try {
      await downloadEpisode(ep, {
        assets,
        feed,
        proxy: proxy ?? null,
        signal: ctl.signal,
        onProgress: ({ received, total }) => {
          job.pct = total ? `${Math.min(99, Math.floor((received / total) * 100))}%` : fmtMB(received)
          const now = Date.now()
          if (now - last > 250) {
            last = now
            renderEpisodes()
          }
        },
      })
      // the list shows ✓ before the note says so
      active.delete(ep.url)
      await loadDownloads()
      sayDl(`“${ep.title}” is saved on this device.`)
    } catch (e) {
      sayDl(ctl.signal.aborted ? 'Download cancelled.' : (e as Error).message, ctl.signal.aborted ? 'note' : 'note err')
      if (e instanceof PodcastError && e.code === 'no-cors') dlNote.append(fileLinks(ep))
    } finally {
      active.delete(ep.url)
      await refreshSaved()
      await loadDownloads()
    }
  }
  const deleteDownload = async (asset: AudioAsset) => {
    const url = asset.origin?.url
    if (url && pick?.url === url && pick.src && engine.source instanceof StreamSource && engine.source.url === pick.src) {
      savePosition()
      engine.stop()
      engine.setSource(undefined)
    }
    await assets.remove(asset.id).catch(() => {})
    sayDl(`Deleted “${asset.origin?.title ?? asset.name}” from this device.`)
    await refreshSaved()
    await loadDownloads()
  }
  const playPick = (p: NonNullable<typeof pick>) => {
    savePosition()
    const saved = downloads.get(p.url)
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = saved ? URL.createObjectURL(saved.blob) : undefined
    p = { ...p, src: objectUrl, name: p.name ?? saved?.asset.origin?.title }
    pick = p
    const wasRunning = engine.state === 'running' || engine.state === 'paused'
    engine.setSource(streamFor(p))
    // choosing an episode is a tap: start right away (setSource restarts a running engine by itself)
    if (!wasRunning) void engine.start().catch(() => {})
    renderEpisodes()
    void renderDownloads()
    refresh()
  }
  const playEpisode = (ep: PodcastEpisode, feedUrl = feed?.url) => playPick({ url: ep.url, name: ep.title, feedUrl, duration: ep.duration })
  const openUrl = async (raw: string) => {
    const u = raw.trim()
    prefs.set('streamUrl', u)
    blockedUnknown = false
    if (!u) {
      say('')
      return
    }
    if (isDirectAudioUrl(u)) {
      // a direct audio link: no request needed to know what it is; Start (or the next tap) plays it
      say('')
      feed = undefined
      renderEpisodes()
      savePosition()
      pick = { url: u }
      applyChoice()
      return
    }
    loading = true
    say('Checking the link…')
    refresh()
    // feeds use the feed proxy (FEED_PROXY_URL, else AUDIO_PROXY_URL); only an explicit panel option overrides it
    const r = await resolveAudioUrl(u, opts.proxy !== undefined ? { proxy: opts.proxy } : {})
    loading = false
    if (urlInput.value.trim() !== u) return refresh() // the owner pasted something else meanwhile
    if (r.kind !== 'feed' && feed) {
      // the list on screen no longer matches the link (playback, if any, carries on)
      feed = undefined
      renderEpisodes()
    }
    switch (r.kind) {
      case 'unsupported':
        say(r.message, 'hint')
        break
      case 'error':
        say(r.message, 'note err')
        break
      case 'audio':
        say('')
        savePosition()
        pick = { url: r.url }
        applyChoice()
        break
      case 'blocked':
        say(r.message, 'hint')
        if (!r.looksLikeFeed) {
          // maybe radio or an audio file on a host without CORS: try it; the stream source says whether it plays
          blockedUnknown = true
          savePosition()
          pick = { url: r.url }
          applyChoice()
        }
        break
      case 'feed':
        feed = r.feed
        say(r.viaProxy ? 'This host blocks web pages, so the feed was read through the feed proxy.' : '')
        await podcasts.rememberFeed(r.feed).catch(() => {})
        await loadPositions()
        renderEpisodes()
        await refreshRecent()
        break
    }
    refresh()
  }
  urlInput.addEventListener('change', () => void openUrl(urlInput.value))
  openBtn.addEventListener('click', () => void openUrl(urlInput.value))
  urlInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      e.preventDefault()
      urlInput.blur()
    }
  })
  recentSel.addEventListener('change', () => {
    if (!recentSel.value) return
    urlInput.value = recentSel.value
    void openUrl(recentSel.value)
  })
  forgetFeedBtn.addEventListener('click', async () => {
    const u = recentSel.value || feed?.url
    if (!u) return
    await podcasts.forgetFeed(u).catch(() => {})
    if (feed?.url === u) {
      feed = undefined
      renderEpisodes()
    }
    await loadPositions()
    await refreshRecent()
    say('Forgotten on this device.')
  })
  forgetAllBtn.addEventListener('click', async () => {
    await podcasts.forgetAll().catch(() => {})
    positions = new Map()
    renderEpisodes()
    await refreshRecent()
    say('Every podcast and saved position was forgotten on this device.')
  })
  const nudge = (d: number) => {
    const tr = engine.source?.transport
    if (!tr) return
    const to = tr.currentTime + d
    tr.seek(tr.duration ? Math.min(tr.duration - 0.5, to) : to)
  }
  back15.addEventListener('click', () => nudge(-15))
  fwd15.addEventListener('click', () => nudge(15))
  speedSel.addEventListener('change', () => {
    const v = Number(speedSel.value) || 1
    prefs.set('podcastRate', v)
    const tr = engine.source?.transport
    if (tr && engine.source instanceof StreamSource) tr.rate = v
  })
  // keep the place in an episode: every few seconds while playing, and when the page is hidden
  const posTimer = setInterval(() => {
    if (engine.state === 'running' && engine.source?.transport?.playing) savePosition()
  }, 5000)
  const onHide = () => {
    if (document.visibilityState === 'hidden') savePosition()
  }
  document.addEventListener('visibilitychange', onHide)

  startBtn.addEventListener('click', async () => {
    try {
      if (engine.state === 'running' || engine.state === 'paused' || engine.state === 'starting') {
        savePosition()
        engine.stop()
      }
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
    if (engine.state === 'running') {
      savePosition()
      engine.pause()
    } else await engine.resume()
  })
  resumeBtn.addEventListener('click', () => void engine.resumeFromGesture())
  playOnlyBtn.addEventListener('click', async () => {
    const src = engine.source instanceof StreamSource ? engine.source.asPlayOnly() : pick ? new StreamSource(pick.url, { name: pick.name, playOnly: true }) : undefined
    if (!src) return
    engine.setSource(src)
    try {
      await engine.start()
    } catch {
      /* shown */
    }
  })

  // ---- state → UI
  const refreshPodState = () => {
    const src = engine.source
    let text = ''
    let cls = ''
    if (choice !== 'stream') text = ''
    else if (loading || engine.state === 'starting') text = 'Loading…'
    else if (engine.state === 'error') {
      cls = 'bad'
      text = engine.lastError?.canPlayOnly ? 'Plays, but the host doesn’t allow analysis: tap “Play without analysis”.' : `Error: ${engine.error}`
      if (blockedUnknown && engine.lastError?.code === 'unreachable') text += ` ${FEED_BLOCKED_TEXT}`
    } else if ((engine.state === 'running' || engine.state === 'paused') && src instanceof StreamSource) {
      if (src.playOnly) {
        cls = 'warn'
        text = 'Play only: plays but can’t drive visuals.'
      } else if (engine.analysis === 'ok') {
        cls = 'ok'
        text = src.viaProxy ? 'Analysis allowed (through your proxy): drives visuals.' : 'Analysis allowed: drives visuals.'
      } else if (engine.analysis === 'blocked') {
        cls = 'warn'
        text = 'Plays but can’t drive visuals (the analyser gets silence).'
      } else text = engine.state === 'paused' ? 'Paused.' : 'Playing · checking analysis…'
    }
    podState.textContent = text
    podState.className = `state ${cls}`
    podState.hidden = !text
  }
  const refresh = () => {
    const running = engine.state === 'running' || engine.state === 'paused'
    startBtn.textContent = running ? 'Stop' : engine.state === 'starting' ? 'Starting…' : 'Start'
    playBtn.disabled = !(running && engine.source?.transport)
    playBtn.textContent = engine.state === 'paused' ? 'Play' : 'Pause'
    seek.disabled = !(running && engine.source?.transport)
    back15.disabled = fwd15.disabled = !(running && !!engine.source?.transport?.duration)
    refreshPodState()
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
  if (choice === 'stream') {
    const u = urlInput.value.trim()
    if (u && isDirectAudioUrl(u)) pick = { url: u }
    void loadPositions().then(loadDownloads)
    void refreshRecent()
  }
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
      savePosition()
      clearInterval(posTimer)
      active.forEach((j) => j.ctl.abort())
      if (objectUrl && !(engine.source instanceof StreamSource && engine.source.url === objectUrl)) URL.revokeObjectURL(objectUrl)
      document.removeEventListener('visibilitychange', onHide)
      cancelAnimationFrame(raf)
      root.remove()
    },
  }
}

