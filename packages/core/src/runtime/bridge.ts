import { HydraAudio } from '../hydra-audio'
import type { CatalogDelta } from '../catalog'
import type { ErrorKind, FrameToHost, HostToFrame } from './protocol'

// Frame-side half of the runtime. It owns the canvas, hydra-synth, the live-parameter table and the `a` object.
// It is used unchanged in the sandboxed iframe (frame-entry.ts) and in inline mode (host.ts).
// It is driven ONLY through handle(msg) / post(msg): there is no other API surface.

export interface BridgeEnv {
  win: any
  container: HTMLElement
  post: (msg: FrameToHost) => void
  /** hydra-synth's default export (or a mock in tests) */
  Hydra: new (opts: any) => any
}

const LIVE_NAME = '__hl'

export class Bridge {
  private hydra: any
  private canvas?: HTMLCanvasElement
  private audio?: HydraAudio
  private delta: CatalogDelta[] = []
  private origin = 'plugin:inline'
  private pendingFetch = new Map<number, (r: { ok: boolean; text?: string; error?: string }) => void>()
  private fetchId = 1
  private errorCounts = new Map<string, { n: number; t: number }>()
  private restoreConsole?: () => void
  private disposed = false

  constructor(private env: BridgeEnv) {}

  post(msg: FrameToHost) {
    if (!this.disposed) this.env.post(msg)
  }

  // ---------------------------------------------------------------- dispatch
  handle(msg: HostToFrame): void {
    if (this.disposed) return
    try {
      switch (msg.t) {
        case 'init':
          return this.init(msg.width, msg.height, msg.precision)
        case 'run':
          return void this.run(msg)
        case 'live':
          return this.mergeLive(msg.table)
        case 'hush':
          return this.reply(msg.id, () => this.hush())
        case 'resolution':
          return this.reply(msg.id, () => this.hydra?.setResolution(msg.w, msg.h))
        case 'screenshot':
          return void this.screenshot(msg.id, msg.type, msg.quality)
        case 'time':
          return this.reply(msg.id, () => this.hydra?.synth?.time ?? 0)
        case 'plugin':
          return this.reply(msg.id, () => this.plugin(msg.pluginId, msg.name, msg.src))
        case 'catalog':
          return this.reply(msg.id, () => this.flushDelta(true))
        case 'fetched': {
          const cb = this.pendingFetch.get(msg.id)
          this.pendingFetch.delete(msg.id)
          cb?.({ ok: msg.ok, text: msg.text, error: msg.error })
          return
        }
        case 'audio':
          this.audio?.feed(msg.specific, msg.vol)
          return
        case 'audioSettings':
          this.audio?.applySettings(msg.settings)
          return
        case 'mouse':
          return this.setMouse(msg.x, msg.y, msg.buttons)
        case 'dispose':
          return this.dispose()
      }
    } catch (err) {
      this.error('runtime', (err as Error)?.message ?? String(err))
    }
  }

  /**
   * hydra-synth's `mouse` has getter-only x/y/buttons fed by its own window listeners. The first time the host drives the
   * mouse we swap in a plain object (same shape) and switch the native listeners off, so the two sources never fight.
   */
  private hostMouse?: { x: number; y: number; buttons: number; mods: unknown; enabled: boolean }
  private setMouse(x: number, y: number, buttons?: number) {
    const h = this.hydra
    if (!h?.synth) return
    if (!this.hostMouse) {
      const old = h.synth.mouse
      try {
        if (old) old.enabled = false
      } catch {
        /* ignore */
      }
      this.hostMouse = { x: 0, y: 0, buttons: 0, mods: old?.mods ?? { shift: false, alt: false, control: false, meta: false }, enabled: false }
      h.synth.mouse = this.hostMouse
      this.env.win.mouse = this.hostMouse
    }
    this.hostMouse.x = x
    this.hostMouse.y = y
    if (buttons !== undefined) this.hostMouse.buttons = buttons
  }

  private reply(id: number, f: () => unknown) {
    try {
      const value = f()
      Promise.resolve(value).then(
        (v) => this.post({ t: 'result', id, ok: true, value: v ?? null }),
        (e) => this.post({ t: 'result', id, ok: false, error: String(e?.message ?? e) }),
      )
    } catch (e: any) {
      this.post({ t: 'result', id, ok: false, error: String(e?.message ?? e) })
    }
  }

  // ---------------------------------------------------------------- setup
  private init(width: number, height: number, precision?: string) {
    const { win, container } = this.env
    this.hookConsole()
    win.addEventListener?.('error', (ev: ErrorEvent) => this.error('runtime', ev.message || 'script error'))
    win.addEventListener?.('unhandledrejection', (ev: PromiseRejectionEvent) => this.error('runtime', String((ev.reason && ev.reason.message) || ev.reason)))
    const doc: Document = win.document
    const canvas = doc.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;image-rendering:auto'
    container.appendChild(canvas)
    this.canvas = canvas
    win[LIVE_NAME] = win[LIVE_NAME] ?? {}
    let webgl = true
    try {
      this.hydra = new this.env.Hydra({
        canvas,
        width,
        height,
        makeGlobal: true,
        autoLoop: true,
        detectAudio: false,
        enableStreamCapture: false,
        ...(precision ? { precision } : {}),
      })
    } catch (e: any) {
      webgl = false
      this.post({ t: 'fatal', message: `Could not start Hydra: ${e?.message ?? e}` })
      return
    }
    const synth = this.hydra.synth
    // audio: replace Hydra's microphone-bound object with one that is fed from the host
    this.audio = new HydraAudio({
      target: win,
      parentEl: container,
      onSettings: (s) => this.post({ t: 'audioSettings', settings: s }),
    })
    synth.a = this.audio
    win.a = this.audio
    // catalog tracking: wrap setFunction so plugin-defined functions are reported to the host
    const orig = synth.setFunction
    const wrapped = (obj: any) => {
      try {
        this.delta.push({
          name: obj.name,
          type: obj.type,
          inputs: JSON.parse(JSON.stringify(obj.inputs ?? [])),
          origin: this.origin,
          glsl: typeof obj.glsl === 'string' ? obj.glsl : undefined,
        })
      } catch {
        /* ignore malformed definitions; Hydra will warn */
      }
      return orig(obj)
    }
    synth.setFunction = wrapped
    win.setFunction = wrapped
    // loadScript goes through the host so it can be cached and served offline
    win.loadScript = (url = '') =>
      new Promise<void>((resolve) => {
        const id = this.fetchId++
        this.pendingFetch.set(id, (r) => {
          if (r.ok && r.text !== undefined) {
            try {
              ;(0, win.eval)(r.text)
            } catch (e: any) {
              this.error('runtime', `loadScript ${url}: ${e?.message ?? e}`)
            }
          } else this.error('warning', `could not load script ${url}${r.error ? ': ' + r.error : ''}`)
          resolve()
        })
        this.post({ t: 'fetch', id, url })
      })
    this.post({ t: 'ready', info: { webgl, precision: this.hydra.precision ?? 'unknown' } })
  }

  private hookConsole() {
    const { win } = this.env
    const c = win.console
    if (!c || this.restoreConsole) return
    const origWarn = c.warn
    const origErr = c.error
    const classify = (args: unknown[]): ErrorKind | undefined => {
      const first = String(args[0] ?? '')
      if (/shader could not compile|error compiling|\(regl\)|Error during tick|framebuffer|WebGL/i.test(first + String(args[1] ?? ''))) return 'shader'
      if (/could not get camera|could not get screen/i.test(first)) return 'camera'
      if (/^ERROR|function does not return a number|Arguments must be/i.test(first)) return 'runtime'
      return undefined
    }
    const wrap = (orig: (...a: unknown[]) => void) =>
      (...args: unknown[]) => {
        const kind = classify(args)
        if (kind) {
          const msg = args
            .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a)?.slice(0, 300) } catch { return String(a) } })()))
            .join(' ')
          this.error(kind, msg)
        }
        try {
          orig.apply(c, args)
        } catch {
          /* ignore */
        }
      }
    c.warn = wrap(origWarn)
    c.error = wrap(origErr)
    this.restoreConsole = () => {
      c.warn = origWarn
      c.error = origErr
    }
  }

  /** Report an error to the host, de-duplicating the 60-per-second repeats of a per-frame failure. */
  private error(kind: ErrorKind, message: string) {
    const key = kind + message
    const now = Date.now()
    const prev = this.errorCounts.get(key)
    if (prev && now - prev.t < 1500) {
      prev.n++
      return
    }
    this.errorCounts.set(key, { n: 1, t: now })
    if (this.errorCounts.size > 200) this.errorCounts.clear()
    this.post({ t: 'error', kind, message: message.slice(0, 2000), count: 1 })
  }

  // ---------------------------------------------------------------- actions
  private mergeLive(table: Record<string, number>) {
    const live = (this.env.win[LIVE_NAME] ??= {})
    for (const k in table) live[k] = table[k]
  }

  private hush() {
    const h = this.hydra
    if (!h) return
    h.hush()
  }

  private resetForRun(clearSources: string[]) {
    const h = this.hydra
    const win = this.env.win
    if (!h) return
    const synth = h.synth
    for (const slot of clearSources) {
      try {
        synth[slot]?.clear()
      } catch {
        /* ignore */
      }
    }
    for (const o of h.o ?? []) {
      try {
        synth.solid(0, 0, 0, 0).out(o)
      } catch {
        /* ignore */
      }
    }
    synth.render?.(h.o?.[0])
    h.sandbox?.set?.('update', () => {})
    h.sandbox?.set?.('afterUpdate', () => {})
    // user-settable globals go back to Hydra's defaults, so a sketch without `speed = …` is not affected by the previous one
    h.sandbox?.set?.('speed', 1)
    h.sandbox?.set?.('bpm', 30)
    win[LIVE_NAME] = win[LIVE_NAME] ?? {}
  }

  private async run(msg: Extract<HostToFrame, { t: 'run' }>) {
    const { win } = this.env
    if (!this.hydra) {
      this.post({ t: 'result', id: msg.id, ok: false, error: 'runtime not initialised' })
      return
    }
    this.origin = 'plugin:inline'
    try {
      this.resetForRun(msg.reset.clearSources)
      this.mergeLive(msg.live)
      const needsAsync = /\bawait\b/.test(msg.code)
      if (needsAsync) {
        // HydraRenderer.eval() discards the value of the evaluation, so call the (indirect) eval ourselves to await it
        await (0, win.eval)(`(async () => {\n${msg.code}\n})()`)
      } else {
        this.hydra.eval(msg.code)
      }
      this.flushDelta()
      this.post({ t: 'result', id: msg.id, ok: true })
    } catch (e: any) {
      const message = String(e?.message ?? e)
      this.error('eval', message)
      this.post({ t: 'result', id: msg.id, ok: false, error: message })
    }
    void win
  }

  private plugin(pluginId: string, name: string, src: string) {
    this.origin = `plugin:${pluginId}`
    try {
      ;(0, this.env.win.eval)(src)
    } finally {
      this.origin = 'plugin:inline'
    }
    return { delta: this.flushDelta(true), name }
  }

  /** Send newly registered functions to the host. With `all` also returns them to the caller. */
  private flushDelta(all = false): CatalogDelta[] {
    const d = this.delta
    this.delta = []
    if (d.length) this.post({ t: 'catalog', delta: d })
    return all ? d : []
  }

  private screenshot(id: number, type = 'image/png', quality = 0.9) {
    const h = this.hydra
    if (!h || !this.canvas) return this.post({ t: 'result', id, ok: false, error: 'not ready' })
    let done = false
    const finish = (v: { ok: boolean; value?: unknown; error?: string }) => {
      if (done) return
      done = true
      this.post({ t: 'result', id, ...v })
    }
    const timer = setTimeout(() => finish({ ok: false, error: 'screenshot timed out' }), 3000)
    // Hydra captures right after drawing a frame; a plain toDataURL() would read a cleared WebGL buffer.
    h.getScreenImage((blob: Blob) => {
      clearTimeout(timer)
      const reader = new FileReader()
      reader.onload = () => {
        if (type === 'image/png') return finish({ ok: true, value: reader.result })
        const img = new Image()
        img.onload = () => {
          const c = this.env.win.document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          c.getContext('2d')!.drawImage(img, 0, 0)
          finish({ ok: true, value: c.toDataURL(type, quality) })
        }
        img.onerror = () => finish({ ok: false, error: 'decode failed' })
        img.src = String(reader.result)
      }
      reader.onerror = () => finish({ ok: false, error: 'read failed' })
      reader.readAsDataURL(blob)
    })
  }

  dispose() {
    this.disposed = true
    this.restoreConsole?.()
    try {
      this.hydra?.synth?.hush?.()
    } catch {
      /* ignore */
    }
    this.canvas?.remove()
  }
}
