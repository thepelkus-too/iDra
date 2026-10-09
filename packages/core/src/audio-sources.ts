// Things that produce audio for the engine (audio.ts). All of them run in the HOST page; the sketch frame only ever sees
// analysis numbers. Every source is selectable in mountAudioPanel. See docs/audio.md for what each does on iOS.

import { appStorage } from './storage'

export interface MediaTransport {
  readonly duration: number
  readonly currentTime: number
  readonly playing: boolean
  loop: boolean
  play(): Promise<void>
  pause(): void
  seek(t: number): void
}

export type AudioSourceKind = 'mic' | 'file' | 'stream' | 'device' | 'display'

/** A thing that produces audio. */
export interface AudioSource {
  readonly kind: AudioSourceKind
  readonly label: string
  /** connect into the graph; resolve to the node whose output should be analysed */
  start(ctx: AudioContext): Promise<AudioNode>
  stop(): void
  /** files/streams with a timeline */
  transport?: MediaTransport
  /** monitor (speaker) default: mic is muted to avoid feedback */
  monitorDefaultMuted?: boolean
  /** true when the source plays outside Web Audio (a stream without CORS): audible, but the analyser gets silence */
  readonly playOnly?: boolean
}

export type AudioSourceSpec =
  | { kind: 'mic'; deviceId?: string }
  | { kind: 'file'; file: Blob | File | string; name?: string }
  | { kind: 'stream'; url: string; playOnly?: boolean; name?: string }
  | { kind: 'device'; deviceId: string; label?: string }
  | { kind: 'display' }

export type AudioErrorCode = 'denied' | 'not-found' | 'no-cors' | 'unreachable' | 'unsupported' | 'no-audio-track' | 'insecure' | 'failed'

/** Start failures with a code the panel can act on (`canPlayOnly`: offer "Play without analysis"). */
export class AudioStartError extends Error {
  constructor(message: string, readonly code: AudioErrorCode, readonly canPlayOnly = false) {
    super(message)
    this.name = 'AudioStartError'
  }
}

export function isIOS(): boolean {
  const n = globalThis.navigator as any
  if (!n) return false
  return /iPad|iPhone|iPod/.test(n.userAgent ?? '') || (n.platform === 'MacIntel' && (n.maxTouchPoints ?? 0) > 1)
}

/** Factory for <audio> elements (tests inject fakes). */
export type MediaElementFactory = () => HTMLAudioElement
const defaultElement: MediaElementFactory = () => new Audio()

// ------------------------------------------------------------------ microphone and input devices

/** Constraints for analysis: processing that flattens dynamics is off. iOS may ignore some of these (docs/audio.md). */
export function analysisConstraints(deviceId?: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  if (deviceId) c.deviceId = { exact: deviceId }
  return c
}

function mediaDevices(): MediaDevices | undefined {
  return (globalThis.navigator as any)?.mediaDevices
}

/** Turn getUserMedia's DOMExceptions into something a person can act on. */
export function micError(err: unknown, what = 'microphone'): AudioStartError {
  const name = (err as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    return new AudioStartError(`Permission to use the ${what} was denied. Allow it for this site (iPad: Settings › Apps › Safari › Microphone, or the “aA” menu › Website Settings), then tap Start again.`, 'denied')
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return new AudioStartError(`No ${what} was found.`, 'not-found')
  if (name === 'OverconstrainedError') return new AudioStartError(`The selected input is not available any more. Pick another one.`, 'not-found')
  if (name === 'NotReadableError') return new AudioStartError(`The ${what} is in use by another app or could not be opened.`, 'failed')
  return new AudioStartError(`Could not open the ${what}: ${(err as Error)?.message ?? String(err)}`, 'failed')
}

async function openInput(ctx: AudioContext, deviceId: string | undefined, what: string): Promise<{ node: AudioNode; stream: MediaStream }> {
  const md = mediaDevices()
  if (!md?.getUserMedia) throw new AudioStartError('Audio input needs HTTPS and a browser that supports getUserMedia.', globalThis.isSecureContext === false ? 'insecure' : 'unsupported')
  let stream: MediaStream
  try {
    stream = (await md.getUserMedia({ audio: analysisConstraints(deviceId), video: false })) as MediaStream
  } catch (e) {
    throw micError(e, what)
  }
  return { node: ctx.createMediaStreamSource(stream), stream }
}

export class MicSource implements AudioSource {
  readonly kind = 'mic' as const
  readonly label: string
  readonly monitorDefaultMuted = true
  private stream?: MediaStream
  constructor(private deviceId?: string, label = 'Microphone') {
    this.label = label
  }
  async start(ctx: AudioContext): Promise<AudioNode> {
    const r = await openInput(ctx, this.deviceId, 'microphone')
    this.stream = r.stream
    return r.node
  }
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = undefined
  }
}

export interface AudioInputInfo {
  deviceId: string
  label: string
  groupId?: string
}

/** Audio inputs (mic, USB-C interface, line-in). Labels are empty until the page has had permission once. */
export async function listAudioInputs(): Promise<{ inputs: AudioInputInfo[]; labelled: boolean }> {
  const md = mediaDevices()
  if (!md?.enumerateDevices) return { inputs: [], labelled: false }
  const all = await md.enumerateDevices()
  const inputs = all.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId }))
  return { inputs, labelled: inputs.some((i) => !!i.label) }
}

/** Ask for mic permission once (from a tap) so enumerateDevices returns labels, then release it at once. */
export async function unlockInputLabels(): Promise<{ inputs: AudioInputInfo[]; labelled: boolean }> {
  const md = mediaDevices()
  if (!md?.getUserMedia) return listAudioInputs()
  try {
    const s = await md.getUserMedia({ audio: true, video: false })
    s.getTracks().forEach((t) => t.stop())
  } catch (e) {
    throw micError(e)
  }
  return listAudioInputs()
}

const corePrefs = () => appStorage('core')
/** The persisted input choice (`hydra-core:audioInput`), shared by every editor. */
export function savedAudioInput(): AudioInputInfo | undefined {
  return corePrefs().get<AudioInputInfo>('audioInput') ?? undefined
}
export function saveAudioInput(d: AudioInputInfo | undefined): void {
  if (d) corePrefs().set('audioInput', { deviceId: d.deviceId, label: d.label })
  else corePrefs().remove('audioInput')
}

/** A specific input device. Device ids can change between sessions (iOS), so it falls back to matching the label. */
export class DeviceSource implements AudioSource {
  readonly kind = 'device' as const
  readonly label: string
  readonly monitorDefaultMuted = true
  private stream?: MediaStream
  constructor(readonly deviceId: string, label?: string) {
    this.label = label || 'Input device'
  }
  async start(ctx: AudioContext): Promise<AudioNode> {
    try {
      const r = await openInput(ctx, this.deviceId, this.label)
      this.stream = r.stream
      return r.node
    } catch (e) {
      if (!(e instanceof AudioStartError) || e.code !== 'not-found') throw e
      const { inputs } = await listAudioInputs().catch(() => ({ inputs: [] as AudioInputInfo[] }))
      const same = inputs.find((i) => i.label && i.label === this.label)
      if (!same) throw new AudioStartError(`“${this.label}” is not connected. Plug it in, or pick another input.`, 'not-found')
      const r = await openInput(ctx, same.deviceId, this.label)
      saveAudioInput(same)
      this.stream = r.stream
      return r.node
    }
  }
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = undefined
  }
}

// ------------------------------------------------------------------ files and streams (media elements)

/**
 * Files play through an <audio> element + MediaElementAudioSourceNode instead of decodeAudioData: decoding a 10-minute
 * stereo track at 48 kHz holds ~230 MB of Float32 PCM, which an iPad tab may not survive, while a media element streams
 * from the Blob with a small buffer. Seeking and looping come for free.
 */
abstract class ElementSource implements AudioSource {
  abstract readonly kind: AudioSourceKind
  abstract readonly label: string
  protected el?: HTMLAudioElement
  protected _loop: boolean
  transport: MediaTransport
  constructor(protected makeElement: MediaElementFactory, loop: boolean) {
    this._loop = loop
    const self = this
    this.transport = {
      get duration() {
        return self.el?.duration && isFinite(self.el.duration) ? self.el.duration : 0
      },
      get currentTime() {
        return self.el?.currentTime ?? 0
      },
      get playing() {
        return !!self.el && !self.el.paused && !self.el.ended
      },
      get loop() {
        return self._loop
      },
      set loop(v: boolean) {
        self._loop = v
        if (self.el) self.el.loop = v
      },
      async play() {
        await self.el?.play()
      },
      pause() {
        self.el?.pause()
      },
      seek(t: number) {
        if (self.el && isFinite(t)) self.el.currentTime = Math.max(0, t)
      },
    }
  }
  abstract start(ctx: AudioContext): Promise<AudioNode>
  stop() {
    try {
      this.el?.pause()
      if (this.el) {
        this.el.removeAttribute('src')
        this.el.load?.()
      }
    } catch {
      /* ignore */
    }
    this.el = undefined
  }
}

export class FileSource extends ElementSource {
  readonly kind = 'file' as const
  readonly label: string
  /** byte size when known (Blob/File) */
  readonly size?: number
  private url?: string
  constructor(private file: Blob | File | string, name?: string, opts: { createElement?: MediaElementFactory; loop?: boolean } = {}) {
    super(opts.createElement ?? defaultElement, opts.loop ?? true)
    this.label = name ?? (typeof file === 'string' ? file.split('/').pop() || 'audio' : (file as File).name || 'audio file')
    this.size = typeof file === 'string' ? undefined : file.size
  }
  async start(ctx: AudioContext): Promise<AudioNode> {
    const el = this.makeElement()
    el.crossOrigin = 'anonymous'
    el.loop = this._loop
    el.preload = 'auto'
    this.url = typeof this.file === 'string' ? this.file : URL.createObjectURL(this.file)
    el.src = this.url
    this.el = el
    const node = ctx.createMediaElementSource(el)
    // start playing; the engine has already been resumed from a user gesture
    await el.play().catch(() => {})
    return node
  }
  override stop() {
    super.stop()
    if (this.url && typeof this.file !== 'string') URL.revokeObjectURL(this.url)
    this.url = undefined
  }
}

/** Wait until a media element can play, or fails. */
export function waitPlayable(el: HTMLMediaElement, timeoutMs: number): Promise<'ok' | 'error' | 'timeout'> {
  return new Promise((resolve) => {
    let done = false
    const finish = (r: 'ok' | 'error' | 'timeout') => {
      if (done) return
      done = true
      clearTimeout(t)
      el.removeEventListener('canplay', ok)
      el.removeEventListener('playing', ok)
      el.removeEventListener('error', bad)
      resolve(r)
    }
    const ok = () => finish('ok')
    const bad = () => finish('error')
    const t = setTimeout(() => finish('timeout'), timeoutMs)
    el.addEventListener('canplay', ok)
    el.addEventListener('playing', ok)
    el.addEventListener('error', bad)
    if (el.readyState >= 3) finish('ok')
  })
}

export function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url)
}
export function nativeHls(): boolean {
  try {
    return typeof document !== 'undefined' && !!document.createElement('audio').canPlayType?.('application/vnd.apple.mpegurl')
  } catch {
    return false
  }
}

/**
 * Internet radio / direct MP3, AAC, Ogg URLs. Loaded with `crossOrigin="anonymous"` so Web Audio may read the samples;
 * a server without CORS headers makes that load fail, and then a plain probe tells "no CORS" (plays, can't be analysed)
 * apart from "unreachable". `playOnly` plays the stream outside Web Audio: audible, never analysed.
 */
export class StreamSource extends ElementSource {
  readonly kind = 'stream' as const
  readonly label: string
  readonly playOnly: boolean
  readonly monitorDefaultMuted = false
  private loadTimeoutMs: number
  constructor(readonly url: string, opts: { playOnly?: boolean; name?: string; createElement?: MediaElementFactory; loadTimeoutMs?: number } = {}) {
    super(opts.createElement ?? defaultElement, false)
    this.playOnly = !!opts.playOnly
    this.loadTimeoutMs = opts.loadTimeoutMs ?? 15000
    let host = url
    try {
      host = new URL(url).host + new URL(url).pathname.replace(/\/$/, '')
    } catch {
      /* keep */
    }
    this.label = opts.name ?? host
  }
  async start(ctx: AudioContext): Promise<AudioNode> {
    if (!/^https?:|^blob:|^data:/i.test(this.url)) throw new AudioStartError('Enter an http(s) URL of an audio stream or file.', 'unreachable')
    if (isHlsUrl(this.url) && !nativeHls())
      throw new AudioStartError('This is an HLS (.m3u8) stream. Only browsers with native HLS (Safari) can play it; use the direct MP3/AAC/Ogg URL if the station has one.', 'unsupported')
    const el = this.makeElement()
    el.preload = 'auto'
    el.loop = false
    this.el = el
    if (this.playOnly) {
      el.src = this.url
      await el.play().catch(() => {})
      // nothing to analyse: a source node with no input is silence
      return ctx.createGain()
    }
    el.crossOrigin = 'anonymous'
    el.src = this.url
    const node = ctx.createMediaElementSource(el)
    void el.play().catch(() => {})
    const r = await waitPlayable(el, this.loadTimeoutMs)
    if (r === 'ok') return node
    // CORS refused, unreachable, or a format the browser cannot play: find out which with a plain (no-CORS) probe
    this.stop()
    const probe = this.makeElement()
    probe.muted = true
    probe.preload = 'auto'
    probe.src = this.url
    const p = await waitPlayable(probe, this.loadTimeoutMs)
    try {
      probe.removeAttribute('src')
      probe.load?.()
    } catch {
      /* ignore */
    }
    if (p === 'ok') throw new AudioStartError("This stream plays but doesn't allow analysis (the server sends no CORS headers).", 'no-cors', true)
    throw new AudioStartError(r === 'timeout' && p === 'timeout' ? 'The stream did not start (timed out).' : 'Could not load the stream: the URL is unreachable or not an audio format this browser plays.', 'unreachable')
  }
}

// ------------------------------------------------------------------ other apps (desktop browsers only)

/** True when tab/screen audio capture may work here (feature detection; never offered on iOS, which has no getDisplayMedia). */
export function displayAudioSupported(): boolean {
  const md = mediaDevices() as any
  return typeof md?.getDisplayMedia === 'function' && !isIOS()
}

/** Tab or screen audio via getDisplayMedia (Chromium desktop shares tab audio; most other platforms give no audio track). */
export class DisplaySource implements AudioSource {
  readonly kind = 'display' as const
  readonly label = 'Tab / screen audio'
  readonly monitorDefaultMuted = true
  private stream?: MediaStream
  async start(ctx: AudioContext): Promise<AudioNode> {
    const md = mediaDevices() as any
    if (typeof md?.getDisplayMedia !== 'function') throw new AudioStartError('Screen and tab capture are not available in this browser.', 'unsupported')
    let stream: MediaStream
    try {
      stream = await md.getDisplayMedia({ video: true, audio: true })
    } catch (e) {
      throw micError(e, 'screen capture')
    }
    stream.getVideoTracks().forEach((t) => t.stop())
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop())
      throw new AudioStartError('No audio was shared. In the share dialog pick a tab and switch on “Share tab audio”.', 'no-audio-track')
    }
    this.stream = stream
    return ctx.createMediaStreamSource(stream)
  }
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = undefined
  }
}

export function sourceFromSpec(spec: AudioSourceSpec): AudioSource {
  switch (spec.kind) {
    case 'mic':
      return new MicSource(spec.deviceId)
    case 'file':
      return new FileSource(spec.file, spec.name)
    case 'stream':
      return new StreamSource(spec.url, { playOnly: spec.playOnly, name: spec.name })
    case 'device':
      return new DeviceSource(spec.deviceId, spec.label)
    case 'display':
      return new DisplaySource()
  }
}
