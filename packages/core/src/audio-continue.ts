// Audio across page switches. Each editor and the Library is its own page, so switching ends playback. When a file,
// stream or podcast episode was playing as the page went away, its place is kept in sessionStorage (this tab only), and
// the next page that installs this shows "▶ Continue …". iOS starts sound only from a tap, so continuing takes one.
import type { AudioEngine } from './audio'
import { getAudioAssets, type AudioAssets } from './audio-assets'
import { audioProxyUrl } from './podcast'
import { FileSource, StreamSource, type AudioResumeRef, type AudioSource } from './audio-sources'
import { h, injectStyles, TOKENS_CSS } from './ui'

export interface AudioContinueRecord {
  kind: 'file' | 'stream'
  ref: AudioResumeRef
  name: string
  /** seconds */
  position: number
  rate: number
  loop: boolean
  playOnly: boolean
  /** ms since epoch */
  savedAt: number
}

export const AUDIO_CONTINUE_KEY = 'hydra-ipad:audio-continue'
/** older than this, the offer is dropped */
export const AUDIO_CONTINUE_MAX_AGE_MS = 30 * 60 * 1000

/** The record for what the engine is playing now, or undefined when nothing that can be found again is playing. */
export function audioContinueRecord(engine: AudioEngine, now = Date.now()): AudioContinueRecord | undefined {
  const src = engine.source
  if (!src || engine.state !== 'running' || (src.kind !== 'file' && src.kind !== 'stream')) return undefined
  const ref = src.resumeRef
  if (!ref || (!ref.url && !ref.assetId)) return undefined
  const tr = src.transport
  return {
    kind: src.kind,
    ref: { ...ref },
    name: src.label,
    position: tr?.currentTime ?? 0,
    rate: tr?.rate ?? 1,
    loop: tr?.loop ?? false,
    playOnly: !!src.playOnly,
    savedAt: now,
  }
}

export function readAudioContinue(storage: Storage | undefined = safeSession(), now = Date.now()): AudioContinueRecord | undefined {
  try {
    const raw = storage?.getItem(AUDIO_CONTINUE_KEY)
    if (!raw) return undefined
    const r = JSON.parse(raw) as AudioContinueRecord
    if (!r || (r.kind !== 'file' && r.kind !== 'stream') || !r.ref || now - r.savedAt > AUDIO_CONTINUE_MAX_AGE_MS) return undefined
    return r
  } catch {
    return undefined
  }
}

/** Build the source a record describes: a kept file from the device, else the URL. */
export async function sourceFromContinue(r: AudioContinueRecord, opts: { assets?: AudioAssets; proxy?: string | null } = {}): Promise<AudioSource | undefined> {
  if (r.ref.assetId) {
    const got = await (opts.assets ?? getAudioAssets()).get(r.ref.assetId).catch(() => undefined)
    if (got) {
      if (r.kind === 'file') {
        return new FileSource(got.blob, r.name, { loop: r.loop, ref: { ...r.ref } })
      }
      return new StreamSource(URL.createObjectURL(got.blob), { name: r.name, startAt: r.position, rate: r.rate, ref: { ...r.ref } })
    }
  }
  if (r.ref.url) return new StreamSource(r.ref.url, { name: r.name, startAt: r.position, rate: r.rate, playOnly: r.playOnly, proxy: audioProxyUrl(opts.proxy), ref: { ...r.ref } })
  return undefined
}

export interface AudioContinueOptions {
  storage?: Storage
  assets?: AudioAssets
  proxy?: string | null
  /** where the offer goes (default document.body) */
  parent?: HTMLElement
}

const CSS = `
${TOKENS_CSS}
.hi-continue{position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:60;display:flex;gap:4px;align-items:center;max-width:min(420px,calc(100vw - 24px));padding:4px;border-radius:12px;background:var(--hi-panel);border:1px solid var(--hi-line);box-shadow:0 6px 24px rgba(0,0,0,.35);font:13px/1.3 system-ui,-apple-system,sans-serif;color:var(--hi-text)}
.hi-continue button{min-height:44px;border:0;border-radius:9px;background:transparent;color:inherit;font:inherit;padding:0 12px;cursor:pointer}
.hi-continue .go{background:var(--hi-accent);color:var(--hi-bg);font-weight:600;text-align:left;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hi-continue .x{min-width:44px;opacity:.8}
`

const installed = new WeakSet<AudioEngine>()

/**
 * Keep the playing file/stream when this page goes away, and offer to continue one kept by the previous page.
 * Call once per page with the page's engine; returns a cleanup.
 */
export function installAudioContinue(engine: AudioEngine, opts: AudioContinueOptions = {}): () => void {
  if (installed.has(engine) || typeof window === 'undefined') return () => {}
  installed.add(engine)
  const storage = opts.storage ?? safeSession()
  const save = () => {
    const r = audioContinueRecord(engine)
    try {
      if (r) storage?.setItem(AUDIO_CONTINUE_KEY, JSON.stringify(r))
      else storage?.removeItem(AUDIO_CONTINUE_KEY)
    } catch {
      /* private mode, full storage: nothing to continue */
    }
  }
  window.addEventListener('pagehide', save)

  let chip: HTMLElement | undefined
  const drop = () => {
    chip?.remove()
    chip = undefined
    try {
      storage?.removeItem(AUDIO_CONTINUE_KEY)
    } catch {
      /* ignore */
    }
  }
  const rec = readAudioContinue(storage)
  if (rec && !engine.source) {
    injectStyles('audio-continue', CSS)
    const at = rec.position >= 1 ? ` · ${fmt(rec.position)}` : ''
    const go = h('button', { type: 'button', class: 'go', 'data-role': 'continue-audio', title: 'Continue the audio from the last page' }, `▶ Continue “${rec.name}”${at}`)
    const x = h('button', { type: 'button', class: 'x', 'data-role': 'dismiss-continue', 'aria-label': 'Don’t continue the audio' }, '✕')
    chip = h('div', { class: 'hi-continue', role: 'region', 'aria-label': 'Continue audio' }, go, x)
    ;(opts.parent ?? document.body).append(chip)
    x.addEventListener('click', drop)
    go.addEventListener('click', async () => {
      go.disabled = true
      // iOS: the AudioContext must be resumed inside the tap, before anything is awaited
      const unlocking = engine.unlock()
      const src = await sourceFromContinue(rec, opts)
      await unlocking
      if (!src) {
        go.textContent = `“${rec.name}” is no longer available`
        setTimeout(drop, 2500)
        return
      }
      drop()
      engine.setSource(src)
      await engine.start().catch(() => {})
      const tr = engine.source?.transport
      if (src instanceof FileSource && tr) {
        tr.seek(rec.position)
        if (rec.rate !== 1) tr.rate = rec.rate
      }
    })
  }
  // something else started (the audio panel): the offer is stale
  const unsub = engine.subscribe(() => {
    if (chip && engine.source && engine.state !== 'idle') drop()
  })
  return () => {
    window.removeEventListener('pagehide', save)
    unsub()
    chip?.remove()
    installed.delete(engine)
  }
}

function fmt(s: number): string {
  const t = Math.floor(s)
  const hh = Math.floor(t / 3600)
  const mm = Math.floor((t % 3600) / 60)
  const ss = String(t % 60).padStart(2, '0')
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

function safeSession(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}
