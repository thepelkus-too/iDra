import Meyda from 'meyda'
import { HydraAudio, type HydraAudioSettings } from './hydra-audio'
import { AudioStartError, isIOS, sourceFromSpec, type AudioSource, type AudioSourceSpec } from './audio-sources'

export * from './audio-sources'

export { audioChip, parseAudioChip, audioChipSmooth, audioChipThreshold, audioSignalChip, parseAudioBinding, isAudioChipSource } from './audio-chip'
export type { AudioChipOptions, AudioSignal, ParsedAudioBinding } from './audio-chip'
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
  /** true on the frame where Hydra's beat detector (`detectBeat` on `vol`) fired */
  beat?: boolean
}

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

// ------------------------------------------------------------------ engine

export interface AudioEngineOptions {
  /** create the AudioContext (tests inject a mock) */
  contextFactory?: () => AudioContext
  /** replace the Meyda loudness analysis (tests) */
  analyze?: (samples: Float32Array, sampleRate: number) => { total: number; specific: number[] }
  /** how samples are pulled each frame (default requestAnimationFrame) */
  scheduler?: (cb: () => void) => () => void
  /** on iOS, install the silent-switch bypass on start (default true) */
  silentBypass?: boolean
  /** hook for installSilentBypass (tests) */
  installBypass?: typeof installSilentBypass
  bufferSize?: number
  /** frames of flat-zero input from a playing stream before analysis is reported as blocked (default 90 ≈ 1.5 s) */
  silentFramesLimit?: number
}

export const DEFAULT_AUDIO_SETTINGS: HydraAudioSettings = { bins: 4, cutoff: 2, scale: 10, smooth: 0.4 }

/**
 * Whether the analyser gets usable data: `ok`; `waiting` (started, nothing measured yet); `blocked` (a playing stream
 * delivers only zeros: it plays but does not allow analysis); `off` (play-only source, or nothing running).
 */
export type AnalysisState = 'ok' | 'waiting' | 'blocked' | 'off'

type Listener<T> = (v: T) => void

export class AudioEngine {
  state: AudioState = 'idle'
  error?: string
  /** the last start failure with its code (`canPlayOnly` → offer "Play without analysis") */
  lastError?: AudioStartError
  source?: AudioSource
  settings: HydraAudioSettings = { ...DEFAULT_AUDIO_SETTINGS }
  analysis: AnalysisState = 'off'
  private ctx?: AudioContext
  private node?: AudioNode
  private analyser?: AnalyserNode
  private monitor?: GainNode
  private frame: AudioFrame = { vol: 0, specific: new Array(24).fill(0), bins: [], fft: [], beat: false }
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
  private silentFrames = 0
  private beatNow = false

  constructor(private opts: AudioEngineOptions = {}) {
    this.buf = new Float32Array(new ArrayBuffer((opts.bufferSize ?? 512) * 4))
    this.mirror = new HydraAudio({ target: false, numBins: this.settings.bins })
    this.mirror.onBeat = () => (this.beatNow = true)
    Meyda.bufferSize = this.buf.length
    this.frame.bins = this.mirror.bins.slice()
    this.frame.fft = this.mirror.fft.slice()
  }

  // ---- source selection
  setSource(src: AudioSource | AudioSourceSpec | undefined): void {
    const wasRunning = this.state === 'running' || this.state === 'paused'
    if (this.source) this.teardownSource()
    this.source = src ? ('start' in src ? src : sourceFromSpec(src)) : undefined
    this.lastError = undefined
    this.analysis = 'off'
    if (this.source) {
      this.monitorMuted = !!this.source.monitorDefaultMuted
      if (this.monitor) this.monitor.gain.value = this.monitorMuted ? 0 : this.monitorGain
    }
    if (wasRunning && this.source) void this.start().catch(() => {})
    else this.setState('idle')
  }

  /**
   * Create and resume the AudioContext. Call it from a user gesture (iOS only lets a tap start audio): the panel does
   * this on the first touch inside it, and `start()` does it too.
   */
  async unlock(): Promise<void> {
    const ctx = this.ensureContext()
    if ((ctx.state as string) !== 'running') await ctx.resume().catch(() => {})
    this.emitState()
  }

  /** MUST be called from a user gesture on iOS (creates/resumes the AudioContext). */
  async start(): Promise<void> {
    if (!this.source) throw new Error('no audio source selected')
    this.wantRunning = true
    this.lastError = undefined
    this.setState('starting')
    try {
      const ctx = this.ensureContext()
      if (this.opts.silentBypass !== false && isIOS()) {
        this.bypass?.stop()
        this.bypass = (this.opts.installBypass ?? installSilentBypass)({ audioSessionType: this.source.kind === 'mic' || this.source.kind === 'device' ? 'play-and-record' : 'playback' })
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
      this.silentFrames = 0
      this.analysis = this.source.playOnly ? 'off' : 'waiting'
      this.setState('running')
      this.loop()
      this.watchGestures()
    } catch (err) {
      this.error = (err as Error).message ?? String(err)
      this.lastError = err instanceof AudioStartError ? err : undefined
      this.wantRunning = false
      this.analysis = 'off'
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
    this.analysis = 'off'
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

  /**
   * True when audio should be running but the context is `suspended` or `interrupted` (phone call, Siri, another app,
   * backgrounding) and automatic resumption has not worked: show a "Tap to resume" control that calls `resumeFromGesture()`.
   */
  get needsResume(): boolean {
    return this.wantRunning && !!this.ctx && (this.ctx.state as string) !== 'running' && (this.ctx.state as string) !== 'closed'
  }
  /** Call from a tap: resumes the context and the file/stream playback. */
  async resumeFromGesture(): Promise<void> {
    await this.ctx?.resume().catch(() => {})
    if (this.state === 'running') await this.source?.transport?.play().catch(() => {})
    this.emitState()
  }

  /**
   * One-line advice for the panel, or undefined: the microphone together with an unmuted monitor can feed back, and iOS
   * may route the output to the earpiece or lower it while an input is open.
   */
  get hint(): string | undefined {
    const k = this.source?.kind
    const live = k === 'mic' || k === 'device' || k === 'display'
    if (live && (this.state === 'running' || this.state === 'paused') && !this.monitorMuted && this.monitorGain > 0)
      return 'Mic and speakers are both on: this can feed back. Use headphones, or mute the speakers.'
    return undefined
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
      this.checkSilence()
      const r = this.opts.analyze ? this.opts.analyze(this.buf, this.ctx?.sampleRate ?? 44100) : (Meyda.extract('loudness', this.buf) as unknown as { total: number; specific: number[] } | null)
      if (r && r.specific) {
        this.beatNow = false
        this.mirror.feed(r.specific, r.total)
        this.frame = { vol: r.total, specific: Array.prototype.slice.call(r.specific), bins: this.mirror.bins.slice(), fft: this.mirror.fft.slice(), beat: this.beatNow }
        for (const cb of [...this.frameListeners]) cb(this.frame)
      }
    }
    return this.frame
  }
  /** A playing stream that only ever delivers exact zeros is not analysable (cross-origin without CORS, or an HLS quirk). */
  private checkSilence() {
    const src = this.source
    if (!src || src.playOnly || this.analysis === 'off') return
    let peak = 0
    const b = this.buf
    for (let i = 0; i < b.length; i++) {
      const v = b[i] < 0 ? -b[i] : b[i]
      if (v > peak) peak = v
    }
    if (peak > 0) {
      this.silentFrames = 0
      if (this.analysis !== 'ok') {
        this.analysis = 'ok'
        this.emitState()
      }
      return
    }
    if (src.kind !== 'stream' || !src.transport?.playing) return
    if (++this.silentFrames === (this.opts.silentFramesLimit ?? 90) && this.analysis !== 'ok') {
      this.analysis = 'blocked'
      this.emitState()
    }
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
  /** Output latency facts for Diagnostics (seconds; undefined where the browser does not report them). */
  get latency(): { base?: number; output?: number; sampleRate?: number } {
    const c = this.ctx as any
    return c ? { base: c.baseLatency, output: c.outputLatency, sampleRate: c.sampleRate } : {}
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
