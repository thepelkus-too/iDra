// Owns the Hydra runtime for the preview: trust gate, safe-mode runs, error collection, "keep the last good frame",
// fast numeric edits. Every runtime call is asynchronous (core contract); setLive is fire-and-forget.
import {
  catalog,
  createRuntime,
  describe,
  getAudioEngine,
  getLibrary,
  riskyParts,
  trustFingerprint,
  type Isolation,
  type RiskyPart,
  type Runtime,
  type RuntimeError,
  type Sketch,
} from '@hydra-ipad/core'

export interface RunStatus {
  phase: 'idle' | 'running' | 'ok' | 'error'
  message?: string
  recompiled?: boolean
  ms?: number
  skipped: number
  /** the preview currently shows the last good version because the current one failed */
  fellBack: boolean
}

export interface TrustState {
  /** the sketch has risky parts and the owner has not said yes: the preview runs in safe mode */
  pending: boolean
  parts: RiskyPart[]
}

const SETTLE_MS = 700

export class Runner {
  rt!: Runtime
  isolation: Isolation = 'iframe'
  status: RunStatus = { phase: 'idle', skipped: 0, fellBack: false }
  trust: TrustState = { pending: false, parts: [] }
  /** recent runtime errors, newest last (attribution to rows happens in the UI) */
  errors: RuntimeError[] = []
  /** a camera/screen source in a sandboxed frame cannot be granted: the UI offers inline mode */
  cameraDenied = false

  private lib = getLibrary()
  private audio = getAudioEngine()
  private sketch?: Sketch
  private approved = new Map<string, boolean>() // trust fingerprint → run allowed
  private lastGood?: { sketch: Sketch; safe: boolean }
  private lastAttempt?: { sketch: Sketch; safe: boolean; at: number }
  private startedAt = 0
  private settleTimer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private again = false
  private force = false
  private listeners = new Set<() => void>()
  private unErr?: () => void
  private errorSeq = 0
  private disposed = false
  /** hook for tests/e2e */
  runs = 0

  constructor(private stage: HTMLElement, private size = { width: 960, height: 540 }) {}

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private emit(): void {
    for (const cb of [...this.listeners]) cb()
  }

  async start(isolation: Isolation = this.isolation): Promise<void> {
    this.unErr?.()
    this.rt?.dispose()
    this.stage.textContent = ''
    this.isolation = isolation
    this.errors = []
    this.lastGood = undefined
    this.rt = createRuntime(this.stage, { isolation, audio: this.audio, catalog, width: this.size.width, height: this.size.height })
    this.unErr = this.rt.onError((e) => this.onError(e))
    try {
      await this.rt.ready
    } catch (e) {
      this.onError({ kind: 'runtime', message: String((e as Error)?.message ?? e), at: Date.now() })
    }
    try {
      this.rt.forwardPointer(true)
    } catch {
      /* optional */
    }
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.settleTimer)
    this.unErr?.()
    this.rt?.dispose()
  }

  // ---------------------------------------------------------------- errors

  private onError(e: RuntimeError): void {
    if (this.disposed) return
    this.errors.push(e)
    if (this.errors.length > 30) this.errors.shift()
    this.errorSeq++
    if (e.kind === 'camera') this.cameraDenied = true
    const hard = e.kind === 'shader' || e.kind === 'eval' || e.kind === 'runtime'
    const attempt = this.lastAttempt
    if (hard && attempt && Date.now() - attempt.at < 4000) {
      this.status = { ...this.status, phase: 'error', message: e.message }
      clearTimeout(this.settleTimer)
      this.fallBack(attempt)
    }
    this.emit()
  }

  /** The current version failed: put the last good one back so the preview never freezes or goes black. */
  private fallBack(failed: { sketch: Sketch; safe: boolean }): void {
    const good = this.lastGood
    if (!good || good.sketch === failed.sketch) {
      this.status = { ...this.status, phase: 'error', fellBack: false }
      return
    }
    this.status = { ...this.status, phase: 'error', fellBack: true }
    // run the old one without recording it as a new attempt, so a failing fallback cannot loop
    this.lastAttempt = undefined
    void this.rt.run(good.sketch, { safe: good.safe, force: true }).catch(() => {})
  }

  // ---------------------------------------------------------------- trust

  private async decide(sketch: Sketch): Promise<{ safe: boolean }> {
    const parts = riskyParts(sketch)
    if (parts.length === 0) {
      this.trust = { pending: false, parts: [] }
      return { safe: false }
    }
    const fp = trustFingerprint(sketch)
    let ok = this.approved.get(fp)
    if (ok === undefined) {
      ok = !(await this.lib.needsTrust(sketch))
      this.approved.set(fp, ok)
    }
    this.trust = { pending: !ok, parts }
    return { safe: !ok }
  }

  /** "Run it once" for this exact content. */
  approveOnce(): void {
    if (!this.sketch) return
    this.approved.set(trustFingerprint(this.sketch), true)
    this.run(true)
  }
  /** "Always for this sketch": stored in the library as a hash of exactly the risky parts. */
  async approveAlways(): Promise<void> {
    if (!this.sketch) return
    await this.lib.approve(this.sketch)
    this.approved.set(trustFingerprint(this.sketch), true)
    this.run(true)
  }

  /** Forget trust decisions (a different sketch was opened). */
  resetTrust(): void {
    this.approved.clear()
    this.trust = { pending: false, parts: [] }
  }

  async setIsolation(iso: Isolation): Promise<void> {
    this.cameraDenied = false
    await this.start(iso)
    this.run(true)
  }

  // ---------------------------------------------------------------- running

  /** Remember the latest sketch without running it (a numeric drag already pushed live values). */
  track(sketch: Sketch): void {
    this.sketch = sketch
  }

  /** Ask for a run of the latest sketch. Calls inside one animation frame collapse (core does too, this keeps the trust check off the hot path). */
  run(force = false, sketch?: Sketch): void {
    if (sketch) this.sketch = sketch
    if (!this.sketch) return
    if (force) this.force = true
    if (this.running) {
      this.again = true
      return
    }
    void this.loop()
  }

  private async loop(): Promise<void> {
    this.running = true
    try {
      do {
        this.again = false
        const sketch = this.sketch!
        const force = this.force
        this.force = false
        await this.runOnce(sketch, force)
      } while (this.again && !this.disposed)
    } finally {
      this.running = false
    }
  }

  private async runOnce(sketch: Sketch, force: boolean): Promise<void> {
    // edits that arrive while the runtime is still starting are picked up by the run that follows start()
    if (!this.rt) return
    const { safe } = await this.decide(sketch)
    const d = describe(sketch)
    if (!d.usesCamera) this.cameraDenied = false
    this.status = { ...this.status, phase: 'running', fellBack: false }
    this.lastAttempt = { sketch, safe, at: Date.now() }
    this.startedAt = Date.now()
    this.runs++
    const t0 = performance.now()
    let r
    try {
      r = await this.rt.run(sketch, { safe, force })
    } catch (e) {
      r = { ok: false, recompiled: true, error: String((e as Error)?.message ?? e), skipped: [], ms: performance.now() - t0 }
    }
    if (this.disposed) return
    if (!r.ok) {
      const msg = r.error ?? 'the sketch failed to run'
      this.errors.push({ kind: 'eval', message: msg, at: Date.now() })
      this.status = { phase: 'error', message: msg, recompiled: r.recompiled, ms: r.ms, skipped: r.skipped.length, fellBack: false }
      this.fallBack({ sketch, safe })
    } else {
      this.status = { phase: 'ok', recompiled: r.recompiled, ms: r.ms, skipped: r.skipped.length, fellBack: false }
      const seq = this.errorSeq
      clearTimeout(this.settleTimer)
      // "good" = nothing complained for a moment after it started; only then does it become the version to fall back to
      this.settleTimer = setTimeout(() => {
        if (this.errorSeq === seq && this.lastAttempt?.sketch === sketch) {
          this.lastGood = { sketch, safe }
          this.emit()
        }
      }, SETTLE_MS)
    }
    this.emit()
  }

  /** Fast path for a dragged number: instant, no recompile. */
  setLive(id: string, value: number): void {
    this.rt?.setLive(id, value)
  }

  /** Errors from the most recent run attempt (what the rows and the banner explain). Empty when the sketch runs fine. */
  currentErrors(): RuntimeError[] {
    if (this.status.phase !== 'error') return []
    return this.errors.filter((e) => e.at >= this.startedAt - 50)
  }

  /** Drop everything the user has seen as errors (the banner's dismiss). */
  clearErrors(): void {
    this.errors = []
    if (this.status.phase === 'error') this.status = { ...this.status, phase: 'ok', message: undefined }
    this.emit()
  }

  async thumbnail(width = 160): Promise<string | undefined> {
    try {
      return await this.rt.thumbnail(width)
    } catch {
      return undefined
    }
  }
}
