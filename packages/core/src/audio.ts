import Meyda from 'meyda'
import { HydraAudio, type HydraAudioSettings } from './hydra-audio'

export { audioChip, parseAudioChip } from './audio-chip'
export { HydraAudio } from './hydra-audio'
export type { HydraAudioSettings } from './hydra-audio'

// The audio engine lives in the HOST page (trusted). It never runs inside the sketch frame, and no editor creates an
// AudioContext or calls getUserMedia itself: editors use this engine (and mountAudioPanel) only.
// Analysis uses Meyda's `loudness` (Bark bands) exactly like hydra-synth, then the frame-side `a` object (hydra-audio.ts)
// turns that into `bins` / `fft` with Hydra's own formulas.

export type AudioState = 'idle' | 'starting' | 'running' | 'paused' | 'error'

export interface AudioFrame {
  /** Meyda loudness.total */
  vol: number
  /** Meyda loudness.specific (24 Bark bands) */
  specific: number[]
  /** host-side mirror of Hydra's bins/fft with the current settings (for meters; the sketch has its own) */
  bins: number[]
  fft: number[]
}

export interface MediaTransport {
  readonly duration: number
  readonly currentTime: number
  readonly playing: boolean
  loop: boolean
  play(): Promise<void>
  pause(): void
  seek(t: number): void
}

/** A thing that produces audio. `mic` and `file` ship here; `stream` and `device` come in a later change. */
export interface AudioSource {
  readonly kind: 'mic' | 'file' | 'stream' | 'device'
  readonly label: string
  /** connect into the graph; resolve to the node whose output should be analysed */
  start(ctx: AudioContext): Promise<AudioNode>
  stop(): void
  /** files/streams with a timeline */
  transport?: MediaTransport
  /** monitor (speaker) default: mic is muted to avoid feedback */
  monitorDefaultMuted?: boolean
}

export type AudioSourceSpec =
  | { kind: 'mic'; deviceId?: string }
  | { kind: 'file'; file: Blob | File | string; name?: string }

// ------------------------------------------------------------------ iOS helpers

/**
 * iOS mutes Web Audio output when the hardware silent switch is on, but not <audio> playback ("media" channel).
 * The known workaround (see activetheory/ios-silent-bypass, MIT, whose idea this follows; the code is our own):
 *  1. where available set navigator.audioSession.type = 'playback' (Safari 16.4+), and
 *  2. also loop a silent <audio> element started from a user gesture.
 * Both must run from a user gesture. Returns a handle to undo it.
 */
export function installSilentBypass(opts: { audioSessionType?: 'playback' | 'play-and-record' | 'auto' } = {}): { stop(): void; active: boolean } {
  let el: HTMLAudioElement | undefined
  let url: string | undefined
  let active = false
  try {
    const nav = globalThis.navigator as any
    if (nav?.audioSession) {
      nav.audioSession.type = opts.audioSessionType ?? 'playback'
      active = true
    }
  } catch {
    /* unsupported */
  }
  try {
    if (typeof Audio !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
      url = URL.createObjectURL(silentWav())
      el = new Audio()
      el.setAttribute?.('x-webkit-airplay', 'deny')
      el.preload = 'auto'
      el.loop = true
      el.volume = 0.0001
      el.src = url
      const p = el.play?.()
      p?.catch?.(() => {})
      active = true
    }
  } catch {
    /* ignore */
  }
  return {
    get active() {
      return active
    },
    stop() {
      try {
        el?.pause?.()
        if (url) URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
      active = false
    },
  }
}

/** One second of 8-bit, 8 kHz mono silence as a WAV blob (built here; no embedded third-party data). */
export function silentWav(): Blob {
  const rate = 8000
  const n = rate
  const buf = new ArrayBuffer(44 + n)
  const v = new DataView(buf)
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + n, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate, true)
  v.setUint16(32, 1, true)
  v.setUint16(34, 8, true)
  w(36, 'data')
  v.setUint32(40, n, true)
  new Uint8Array(buf, 44).fill(128)
  return new Blob([buf], { type: 'audio/wav' })
}

// ------------------------------------------------------------------ sources

export class MicSource implements AudioSource {
  readonly kind = 'mic' as const
  readonly label: string
  readonly monitorDefaultMuted = true
  private stream?: MediaStream
  constructor(private deviceId?: string, label = 'Microphone') {
    this.label = label
  }
  async start(ctx: AudioContext): Promise<AudioNode> {
    const md = (globalThis.navigator as any)?.mediaDevices
    if (!md?.getUserMedia) throw new Error('getUserMedia is not available (needs HTTPS and a supporting browser)')
    // Echo cancellation / AGC off: they distort what the visuals should react to.
    const audio: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    if (this.deviceId) audio.deviceId = { exact: this.deviceId }
    const stream = (await md.getUserMedia({ audio, video: false })) as MediaStream
    this.stream = stream
    return ctx.createMediaStreamSource(stream)
  }
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = undefined
  }
}

export class FileSource implements AudioSource {
  readonly kind = 'file' as const
  readonly label: string
  private el?: HTMLMediaElement
  private url?: string
  private _loop = true
  transport: MediaTransport
  constructor(private file: Blob | File | string, name?: string) {
    this.label = name ?? (typeof file === 'string' ? file.split('/').pop() || 'audio' : (file as File).name || 'audio file')
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
        if (self.el) self.el.currentTime = t
      },
    }
  }
  async start(ctx: AudioContext): Promise<AudioNode> {
    const el = new Audio()
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
  stop() {
    try {
      this.el?.pause()
      if (this.el) this.el.src = ''
      if (this.url && typeof this.file !== 'string') URL.revokeObjectURL(this.url)
    } catch {
      /* ignore */
    }
    this.el = undefined
    this.url = undefined
  }
}

export function sourceFromSpec(spec: AudioSourceSpec): AudioSource {
  if (spec.kind === 'mic') return new MicSource(spec.deviceId)
  return new FileSource(spec.file, spec.name)
}

// ------------------------------------------------------------------ engine

export interface AudioEngineOptions {
  /** create the AudioContext (tests inject a mock) */
  contextFactory?: () => AudioContext
  /** replace the Meyda loudness analysis (tests, later beat detection) */
  analyze?: (samples: Float32Array, sampleRate: number) => { total: number; specific: number[] }
  /** how samples are pulled each frame (default requestAnimationFrame) */
  scheduler?: (cb: () => void) => () => void
  /** on iOS, install the silent-switch bypass on start (default true) */
  silentBypass?: boolean
  /** hook for installSilentBypass (tests) */
  installBypass?: typeof installSilentBypass
  bufferSize?: number
}

export const DEFAULT_AUDIO_SETTINGS: HydraAudioSettings = { bins: 4, cutoff: 2, scale: 10, smooth: 0.4 }

export function isIOS(): boolean {
  const n = globalThis.navigator as any
  if (!n) return false
  return /iPad|iPhone|iPod/.test(n.userAgent ?? '') || (n.platform === 'MacIntel' && (n.maxTouchPoints ?? 0) > 1)
}

type Listener<T> = (v: T) => void

export class AudioEngine {
  state: AudioState = 'idle'
  error?: string
  source?: AudioSource
  settings: HydraAudioSettings = { ...DEFAULT_AUDIO_SETTINGS }
  private ctx?: AudioContext
  private node?: AudioNode
  private analyser?: AnalyserNode
  private monitor?: GainNode
  private frame: AudioFrame = { vol: 0, specific: new Array(24).fill(0), bins: [], fft: [] }
  private mirror: HydraAudio
  private buf: Float32Array<ArrayBuffer>
  private cancel?: () => void
  private bypass?: { stop(): void }
  private monitorGain = 1
  private monitorMuted = false
  private frameListeners = new Set<Listener<AudioFrame>>()
  private stateListeners = new Set<Listener<AudioEngine>>()
  private settingsListeners = new Set<Listener<HydraAudioSettings>>()
  private gestureCleanup?: () => void
  private wantRunning = false

  constructor(private opts: AudioEngineOptions = {}) {
    this.buf = new Float32Array(new ArrayBuffer((opts.bufferSize ?? 512) * 4))
    this.mirror = new HydraAudio({ target: false, numBins: this.settings.bins })
    Meyda.bufferSize = this.buf.length
    this.frame.bins = this.mirror.bins.slice()
    this.frame.fft = this.mirror.fft.slice()
  }

  // ---- source selection
  setSource(src: AudioSource | AudioSourceSpec | undefined): void {
    const wasRunning = this.state === 'running' || this.state === 'paused'
    if (this.source) this.teardownSource()
    this.source = src ? ('start' in src ? src : sourceFromSpec(src)) : undefined
    if (this.source) {
      this.monitorMuted = !!this.source.monitorDefaultMuted
      if (this.monitor) this.monitor.gain.value = this.monitorMuted ? 0 : this.monitorGain
    }
    if (wasRunning && this.source) void this.start().catch(() => {})
    else this.setState('idle')
  }

  /** MUST be called from a user gesture on iOS (creates/resumes the AudioContext). */
  async start(): Promise<void> {
    if (!this.source) throw new Error('no audio source selected')
    this.wantRunning = true
    this.setState('starting')
    try {
      const ctx = this.ensureContext()
      if (this.opts.silentBypass !== false && isIOS()) {
        this.bypass?.stop()
        this.bypass = (this.opts.installBypass ?? installSilentBypass)({ audioSessionType: this.source.kind === 'mic' ? 'play-and-record' : 'playback' })
      }
      await ctx.resume()
      this.teardownGraph()
      const node = await this.source.start(ctx)
      this.node = node
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = Math.max(32, this.buf.length)
      node.connect(this.analyser)
      this.monitor = ctx.createGain()
      this.monitor.gain.value = this.monitorMuted ? 0 : this.monitorGain
      node.connect(this.monitor)
      this.monitor.connect(ctx.destination)
      this.error = undefined
      this.setState('running')
      this.loop()
      this.watchGestures()
    } catch (err) {
      this.error = (err as Error).message ?? String(err)
      this.wantRunning = false
      this.setState('error')
      throw err
    }
  }

  stop(): void {
    this.wantRunning = false
    this.cancel?.()
    this.cancel = undefined
    this.teardownSource()
    this.bypass?.stop()
    this.bypass = undefined
    this.gestureCleanup?.()
    this.setState('idle')
  }

  /** Pause analysis and playback (files) without releasing the source. */
  pause(): void {
    this.source?.transport?.pause()
    this.cancel?.()
    this.cancel = undefined
    if (this.state === 'running') this.setState('paused')
  }
  async resume(): Promise<void> {
    if (this.state !== 'paused') return
    await this.ctx?.resume()
    await this.source?.transport?.play()
    this.loop()
    this.setState('running')
  }

  private ensureContext(): AudioContext {
    if (this.ctx && this.ctx.state !== 'closed') return this.ctx
    const make = this.opts.contextFactory ?? (() => new ((globalThis as any).AudioContext || (globalThis as any).webkitAudioContext)())
    const ctx = make()
    this.ctx = ctx
    Meyda.sampleRate = ctx.sampleRate
    ctx.addEventListener?.('statechange', () => {
      // iOS reports 'interrupted' (phone call, Siri, another app); resume as soon as we are allowed to.
      const s = (ctx as any).state as string
      if (this.wantRunning && s !== 'running') void this.tryResume()
      this.emitState()
    })
    return ctx
  }
  private async tryResume() {
    try {
      await this.ctx?.resume()
    } catch {
      /* needs a gesture: watchGestures will retry */
    }
  }
  private watchGestures() {
    this.gestureCleanup?.()
    if (typeof document === 'undefined') return
    const handler = () => {
      if (this.wantRunning && this.ctx && (this.ctx.state as string) !== 'running') void this.tryResume()
    }
    const evs: Array<[EventTarget, string]> = [
      [document, 'visibilitychange'],
      [document, 'pointerdown'],
      [document, 'touchend'],
      [globalThis as unknown as EventTarget, 'pageshow'],
    ]
    for (const [t, e] of evs) t.addEventListener(e, handler, { passive: true })
    this.gestureCleanup = () => evs.forEach(([t, e]) => t.removeEventListener(e, handler))
  }
  private teardownGraph() {
    try {
      this.node?.disconnect()
      this.analyser?.disconnect()
      this.monitor?.disconnect()
    } catch {
      /* ignore */
    }
    this.node = this.analyser = this.monitor = undefined
  }
  private teardownSource() {
    this.cancel?.()
    this.cancel = undefined
    this.teardownGraph()
    this.source?.stop()
  }

  // ---- analysis
  private loop() {
    this.cancel?.()
    const sched = this.opts.scheduler ?? ((cb) => {
      let id = 0
      const tick = () => {
        cb()
        id = requestAnimationFrame(tick)
      }
      id = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(id)
    })
    this.cancel = sched(() => this.pump())
  }
  /** Pull one analysis frame now (also what the scheduler calls). */
  pump(): AudioFrame {
    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.buf)
      const r = this.opts.analyze ? this.opts.analyze(this.buf, this.ctx?.sampleRate ?? 44100) : (Meyda.extract('loudness', this.buf) as unknown as { total: number; specific: number[] } | null)
      if (r && r.specific) {
        this.mirror.feed(r.specific, r.total)
        this.frame = { vol: r.total, specific: Array.prototype.slice.call(r.specific), bins: this.mirror.bins.slice(), fft: this.mirror.fft.slice() }
        for (const cb of [...this.frameListeners]) cb(this.frame)
      }
    }
    return this.frame
  }
  getFrame(): AudioFrame {
    return this.frame
  }
  /** Subscribe to per-frame analysis (the runtime forwards these into the sketch frame). */
  onFrame(cb: Listener<AudioFrame>): () => void {
    this.frameListeners.add(cb)
    return () => this.frameListeners.delete(cb)
  }

  // ---- settings (Hydra's setBins / setCutoff / setScale / setSmooth)
  setSettings(partial: Partial<HydraAudioSettings>, opts: { fromFrame?: boolean } = {}): void {
    this.settings = { ...this.settings, ...partial }
    this.mirror.applySettings(this.settings)
    if (partial.bins !== undefined) this.frame = { ...this.frame, bins: this.mirror.bins.slice(), fft: this.mirror.fft.slice() }
    for (const cb of [...this.settingsListeners]) cb(this.settings)
    void opts
  }
  onSettings(cb: Listener<HydraAudioSettings>): () => void {
    this.settingsListeners.add(cb)
    return () => this.settingsListeners.delete(cb)
  }

  // ---- monitor output (speakers)
  setMonitorGain(v: number): void {
    this.monitorGain = Math.max(0, Math.min(1, v))
    if (this.monitor && !this.monitorMuted) this.monitor.gain.value = this.monitorGain
    this.emitState()
  }
  setMonitorMuted(m: boolean): void {
    this.monitorMuted = m
    if (this.monitor) this.monitor.gain.value = m ? 0 : this.monitorGain
    this.emitState()
  }
  get monitorState(): { gain: number; muted: boolean } {
    return { gain: this.monitorGain, muted: this.monitorMuted }
  }
  get contextState(): string {
    return this.ctx ? String(this.ctx.state) : 'none'
  }

  // ---- state
  private setState(s: AudioState) {
    this.state = s
    this.emitState()
  }
  private emitState() {
    for (const cb of [...this.stateListeners]) cb(this)
  }
  subscribe(cb: Listener<AudioEngine>): () => void {
    this.stateListeners.add(cb)
    return () => this.stateListeners.delete(cb)
  }

  dispose(): void {
    this.stop()
    this.stateListeners.clear()
    this.frameListeners.clear()
    this.settingsListeners.clear()
    void this.ctx?.close?.()
    this.ctx = undefined
  }
}

let shared: AudioEngine | undefined
/** The page-wide engine. Editors and the runtime share it so there is exactly one AudioContext. */
export function getAudioEngine(): AudioEngine {
  return (shared ??= new AudioEngine())
}
export function setAudioEngine(e: AudioEngine | undefined) {
  shared = e
}
