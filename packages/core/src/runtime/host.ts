/// <reference path="../types.d.ts" />
import { catalog as defaultCatalog, type Catalog, type CatalogDelta } from '../catalog'
import { toRunnable } from '../codegen'
import { importText } from '../parse'
import { contentHash, type PluginRef, type Sketch, type Stmt } from '../ir'
import type { AudioEngine } from '../audio'
import type { ErrorKind, FrameToHost, HostToFrame, Transport } from './protocol'
import { Bridge } from './bridge'
import { ScriptCache, verifyIntegrity } from './script-cache'

export type Isolation = 'iframe' | 'inline'

export interface RuntimeOptions {
  isolation?: Isolation
  width?: number
  height?: number
  precision?: 'lowp' | 'mediump' | 'highp'
  catalog?: Catalog
  /** page-wide audio engine; its analysis is streamed into the frame every frame */
  audio?: AudioEngine
  /** URL of hydra-frame.js (iframe mode). Default: `./hydra-frame.js` next to the page. */
  frameUrl?: string
  /** or the bundle text itself */
  frameSource?: string | (() => Promise<string>)
  /** inline mode: how to get the Hydra constructor (default: dynamic import('hydra-synth')) */
  hydraLoader?: () => Promise<new (opts: any) => any>
  /** custom transport (tests, other embeddings) */
  transport?: (container: HTMLElement) => Transport | Promise<Transport>
  scriptCache?: ScriptCache
  requestTimeoutMs?: number
  /** allow the frame to use the camera (iframe `allow` attribute). Default true. */
  allowCamera?: boolean
}

export interface RunOptions {
  /** skip raw code and plugins, run only recognised chains/settings/sources */
  safe?: boolean
  /** re-evaluate even if nothing but numbers changed, and re-initialise sources */
  force?: boolean
}

export interface RunResult {
  ok: boolean
  /** false when only live numbers changed and the shader was not rebuilt */
  recompiled: boolean
  error?: string
  skipped: Array<{ id: string; reason: string }>
  ms: number
}

export interface RuntimeError {
  kind: ErrorKind
  message: string
  at: number
}

export interface PluginResult {
  ok: boolean
  error?: string
  delta: CatalogDelta[]
  from?: 'network' | 'cache' | 'inline'
}

export interface Runtime {
  readonly isolation: Isolation
  /** the iframe (iframe mode) or the container (inline mode) */
  readonly element: HTMLElement
  readonly ready: Promise<void>
  readonly stats: { runs: number; recompiles: number; liveMessages: number; lastRunMs: number }
  readonly errors: RuntimeError[]
  run(input: Sketch | string, opts?: RunOptions): Promise<RunResult>
  hush(): Promise<void>
  setResolution(w: number, h: number): Promise<void>
  screenshot(opts?: { type?: string; quality?: number }): Promise<string>
  thumbnail(width?: number): Promise<string>
  onError(cb: (e: RuntimeError) => void): () => void
  time(): Promise<number>
  /** fire-and-forget; coalesced to one message per animation frame */
  setLive(argId: string, value: number): void
  setLiveBatch(table: Record<string, number>): void
  loadPlugin(ref: PluginRef): Promise<PluginResult>
  getCatalogDelta(): Promise<CatalogDelta[]>
  /** drive Hydra's `mouse.x/y` yourself (the hook for touch input) */
  setMouse(x: number, y: number): void
  /** forward pointer positions over the runtime element into the frame's `mouse` */
  forwardPointer(on: boolean): void
  /** throw the frame away and start fresh (clears plugin-registered functions) */
  reset(): Promise<void>
  dispose(): void
}

const raf = (cb: () => void) => {
  let done = false
  const once = () => {
    if (done) return
    done = true
    cb()
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(once)
  // hidden tabs pause rAF; do not let edits hang
  setTimeout(once, 120)
}

export function buildFrameHtml(bundle: string): string {
  const safe = bundle.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block}</style></head><body><script>${safe}</script></body></html>`
}

function iframeTransport(container: HTMLElement, html: string, allowCamera: boolean): { transport: Transport; element: HTMLIFrameElement } {
  const iframe = document.createElement('iframe')
  // allow-scripts WITHOUT allow-same-origin: opaque origin, cannot read the library's IndexedDB/localStorage or the parent DOM
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('allow', `${allowCamera ? 'camera *; ' : ''}autoplay *; fullscreen *`)
  iframe.setAttribute('title', 'Hydra output')
  iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000;touch-action:none'
  let cb: (m: FrameToHost) => void = () => {}
  const onMsg = (ev: MessageEvent) => {
    if (ev.source !== iframe.contentWindow) return
    const d = ev.data
    if (d && typeof d === 'object' && typeof d.t === 'string') cb(d as FrameToHost)
  }
  window.addEventListener('message', onMsg)
  iframe.srcdoc = html
  container.appendChild(iframe)
  return {
    element: iframe,
    transport: {
      send: (m) => iframe.contentWindow?.postMessage(m, '*'),
      onMessage: (f) => (cb = f),
      dispose() {
        window.removeEventListener('message', onMsg)
        iframe.remove()
      },
    },
  }
}

function inlineTransport(container: HTMLElement, loadHydra: () => Promise<new (opts: any) => any>): Transport {
  let cb: (m: FrameToHost) => void = () => {}
  let bridge: Bridge | undefined
  const defer = (f: () => void) => (typeof queueMicrotask === 'function' ? queueMicrotask(f) : void Promise.resolve().then(f))
  // structuredClone both ways: inline mode has exactly the same value semantics as the iframe
  const clone = <T,>(x: T): T => structuredClone(x)
  const start = loadHydra().then((Hydra) => {
    bridge = new Bridge({ win: window, container, post: (m) => defer(() => cb(clone(m))), Hydra })
    defer(() => cb({ t: 'hello' }))
  })
  start.catch((e) => defer(() => cb({ t: 'fatal', message: `could not load hydra-synth: ${e?.message ?? e}` })))
  return {
    send: (m) => void start.then(() => defer(() => bridge?.handle(clone(m)))),
    onMessage: (f) => (cb = f),
    dispose: () => bridge?.dispose(),
  }
}

interface Pending {
  resolve: (v: any) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function createRuntime(container: HTMLElement, opts: RuntimeOptions = {}): Runtime {
  const isolation: Isolation = opts.isolation ?? 'iframe'
  const cat = opts.catalog ?? defaultCatalog
  const width = opts.width ?? 1280
  const height = opts.height ?? 720
  const timeoutMs = opts.requestTimeoutMs ?? 15000
  const scripts = opts.scriptCache ?? new ScriptCache()

  const errorListeners = new Set<(e: RuntimeError) => void>()
  const errors: RuntimeError[] = []
  const stats = { runs: 0, recompiles: 0, liveMessages: 0, lastRunMs: 0 }
  const delta: CatalogDelta[] = []

  let transport: Transport | undefined
  let element: HTMLElement = container
  let nextId = 1
  const pending = new Map<number, Pending>()
  let readyResolve!: () => void
  let readyReject!: (e: Error) => void
  let ready: Promise<void>
  let disposed = false
  let helloSeen = false

  // run state
  let lastKey: string | undefined
  let lastSafe: boolean | undefined
  let lastLive: Record<string, number> = {}
  let applied = new Map<string, string>() // source slot → init key
  const loadedPlugins = new Map<string, string>() // plugin id → content hash
  let queued: { input: Sketch | string; opts: RunOptions; waiters: Array<{ res: (r: RunResult) => void }> } | undefined
  let runScheduled = false
  let runChain: Promise<unknown> = Promise.resolve()

  // live coalescing
  let livePending: Record<string, number> = {}
  let liveScheduled = false

  const unsubs: Array<() => void> = []

  const emitError = (kind: ErrorKind, message: string) => {
    const e: RuntimeError = { kind, message, at: Date.now() }
    errors.push(e)
    if (errors.length > 50) errors.shift()
    for (const cb of [...errorListeners]) {
      try {
        cb(e)
      } catch {
        /* ignore */
      }
    }
  }

  const send = (m: HostToFrame) => transport?.send(m)
  function request<T = unknown>(build: (id: number) => HostToFrame): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('the Hydra frame did not answer in time'))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      send(build(id))
    })
  }

  const onFrameMessage = (m: FrameToHost) => {
    switch (m.t) {
      case 'hello':
        helloSeen = true
        send({ t: 'init', width, height, precision: opts.precision })
        break
      case 'ready':
        if (opts.audio) send({ t: 'audioSettings', settings: opts.audio.settings })
        readyResolve()
        break
      case 'fatal':
        emitError('runtime', m.message)
        readyReject(new Error(m.message))
        break
      case 'result': {
        const p = pending.get(m.id)
        if (!p) break
        pending.delete(m.id)
        clearTimeout(p.timer)
        if (m.ok) p.resolve(m.value)
        else p.reject(new Error(m.error ?? 'failed'))
        break
      }
      case 'error':
        emitError(m.kind, m.message)
        break
      case 'catalog':
        delta.push(...m.delta)
        cat.refresh(m.delta)
        break
      case 'fetch':
        void (async () => {
          try {
            const r = await scripts.get(m.url)
            send({ t: 'fetched', id: m.id, ok: true, text: r.text })
          } catch (e: any) {
            send({ t: 'fetched', id: m.id, ok: false, error: String(e?.message ?? e) })
          }
        })()
        break
      case 'audioSettings':
        opts.audio?.setSettings(m.settings, { fromFrame: true })
        break
    }
  }

  async function start() {
    helloSeen = false
    ready = new Promise<void>((res, rej) => {
      readyResolve = res
      readyReject = rej
    })
    ready.catch(() => {})
    let t: Transport
    if (opts.transport) {
      t = await opts.transport(container)
      element = container
    } else if (isolation === 'iframe') {
      let bundle: string
      if (typeof opts.frameSource === 'string') bundle = opts.frameSource
      else if (typeof opts.frameSource === 'function') bundle = await opts.frameSource()
      else {
        const res = await fetch(opts.frameUrl ?? new URL('./hydra-frame.js', document.baseURI).href)
        if (!res.ok) throw new Error(`could not load the Hydra frame (${res.status})`)
        bundle = await res.text()
      }
      const r = iframeTransport(container, buildFrameHtml(bundle), opts.allowCamera !== false)
      t = r.transport
      element = r.element
    } else {
      t = inlineTransport(container, opts.hydraLoader ?? (() => import('hydra-synth').then((m) => m.default)))
      element = container
    }
    if (disposed) {
      t.dispose()
      return
    }
    transport = t
    t.onMessage(onFrameMessage)
    if (opts.transport) send({ t: 'init', width, height, precision: opts.precision })
  }

  function wireAudio() {
    const a = opts.audio
    if (!a) return
    unsubs.push(a.onFrame((f) => send({ t: 'audio', vol: f.vol, specific: f.specific })))
    unsubs.push(a.onSettings((s) => send({ t: 'audioSettings', settings: s })))
  }

  const startP = start()
  startP.catch((e) => {
    emitError('runtime', e.message)
    readyReject?.(e)
  })
  wireAudio()

  // ---- pointer forwarding
  let pointerOn: ((ev: PointerEvent) => void) | undefined
  const forwardPointer = (on: boolean) => {
    if (pointerOn) container.removeEventListener('pointermove', pointerOn)
    pointerOn = undefined
    if (!on) return
    pointerOn = (ev) => {
      const r = container.getBoundingClientRect()
      send({ t: 'mouse', x: ev.clientX - r.left, y: ev.clientY - r.top })
    }
    container.addEventListener('pointermove', pointerOn, { passive: true })
  }

  // ---- live parameters
  function flushLive() {
    liveScheduled = false
    const table = livePending
    livePending = {}
    if (Object.keys(table).length === 0) return
    stats.liveMessages++
    send({ t: 'live', table })
  }
  const queueLive = (table: Record<string, number>) => {
    let any = false
    for (const k in table) {
      if (lastLive[k] === table[k] && livePending[k] === undefined) continue
      lastLive[k] = table[k]
      livePending[k] = table[k]
      any = true
    }
    if (any && !liveScheduled) {
      liveScheduled = true
      raf(flushLive)
    }
  }

  // ---- run
  const srcKey = (s: Extract<Stmt, { k: 'source' }>) => JSON.stringify([s.init.kind, s.init.arg ?? null, s.init.argsSrc ?? null])

  async function ensurePlugins(sketch: Sketch): Promise<string | undefined> {
    for (const p of sketch.plugins ?? []) {
      const r = await loadPlugin(p)
      if (!r.ok) return `plugin "${p.name || p.id}": ${r.error}`
    }
    return undefined
  }

  async function execute(input: Sketch | string, o: RunOptions): Promise<RunResult> {
    const t0 = performance.now()
    await ready
    stats.runs++
    const safe = !!o.safe
    let sketch: Sketch | undefined
    let rawText: string | undefined
    if (typeof input === 'string') {
      if (!safe) rawText = input
      else sketch = importText(input).sketch
    } else sketch = input

    let code: string
    let live: Record<string, number> = {}
    let skipped: RunResult['skipped'] = []
    let sources = new Map<string, string>()
    let key: string

    if (rawText !== undefined) {
      code = key = rawText
    } else {
      const sk = sketch!
      if (!safe) {
        const err = await ensurePlugins(sk)
        if (err) emitError('runtime', err)
      }
      const full = toRunnable(sk, { safe, live: true, catalog: cat })
      for (const s of sk.stmts) if (s.k === 'source') sources.set(s.slot, srcKey(s))
      key = full.code
      live = full.live
      skipped = full.skipped
      if (!o.force && lastKey === key && lastSafe === safe) {
        queueLive(live)
        return { ok: true, recompiled: false, skipped, ms: performance.now() - t0 }
      }
      const clear: string[] = []
      for (const [slot, k] of applied) if (o.force || sources.get(slot) !== k) clear.push(slot)
      const keep = new Set([...applied].filter(([slot, k]) => !o.force && sources.get(slot) === k).map(([slot]) => slot))
      const reduced = toRunnable(sk, { safe, live: true, catalog: cat, skipSource: (s) => keep.has(s.slot) })
      code = reduced.code
      stats.recompiles++
      try {
        await request<unknown>((id) => ({ t: 'run', id, code, live, reset: { clearSources: clear } }))
        lastKey = key
        lastSafe = safe
        lastLive = { ...live }
        applied = sources
        stats.lastRunMs = performance.now() - t0
        return { ok: true, recompiled: true, skipped, ms: stats.lastRunMs }
      } catch (e: any) {
        lastKey = undefined
        return { ok: false, recompiled: true, error: String(e.message ?? e), skipped, ms: performance.now() - t0 }
      }
    }
    // raw text path
    stats.recompiles++
    const clear = [...applied.keys()]
    try {
      await request<unknown>((id) => ({ t: 'run', id, code, live, reset: { clearSources: clear } }))
      lastKey = undefined
      lastSafe = safe
      applied = new Map()
      stats.lastRunMs = performance.now() - t0
      return { ok: true, recompiled: true, skipped, ms: stats.lastRunMs }
    } catch (e: any) {
      return { ok: false, recompiled: true, error: String(e.message ?? e), skipped, ms: performance.now() - t0 }
    }
  }

  function run(input: Sketch | string, o: RunOptions = {}): Promise<RunResult> {
    return new Promise<RunResult>((res) => {
      // debounce: many run() calls inside one animation frame collapse into one evaluation of the latest input
      queued = { input, opts: { ...(queued?.opts ?? {}), ...o }, waiters: [...(queued?.waiters ?? []), { res }] }
      if (runScheduled) return
      runScheduled = true
      raf(() => {
        runScheduled = false
        const q = queued!
        queued = undefined
        runChain = runChain.then(async () => {
          const r = await execute(q.input, q.opts).catch((e): RunResult => ({ ok: false, recompiled: true, error: String(e?.message ?? e), skipped: [], ms: 0 }))
          for (const w of q.waiters) w.res(r)
        })
      })
    })
  }

  async function loadPlugin(ref: PluginRef): Promise<PluginResult> {
    await ready
    try {
      let src = ref.src
      let from: PluginResult['from'] = 'inline'
      if (src === undefined) {
        if (!ref.url) return { ok: false, error: 'plugin has neither src nor url', delta: [] }
        const r = await scripts.get(ref.url)
        src = r.text
        from = r.from
      }
      if (ref.integrity && !(await verifyIntegrity(src, ref.integrity))) return { ok: false, error: 'integrity check failed', delta: [], from }
      const hash = contentHash(src)
      if (loadedPlugins.get(ref.id) === hash) return { ok: true, delta: [], from }
      const out = await request<{ delta: CatalogDelta[] }>((id) => ({ t: 'plugin', id, pluginId: ref.id, name: ref.name, src: src! }))
      loadedPlugins.set(ref.id, hash)
      lastKey = undefined // functions changed: next run must re-evaluate
      return { ok: true, delta: out?.delta ?? [], from }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e), delta: [] }
    }
  }

  async function reset() {
    transport?.dispose()
    transport = undefined
    pending.forEach((p) => {
      clearTimeout(p.timer)
      p.reject(new Error('runtime reset'))
    })
    pending.clear()
    if (element !== container) element.remove()
    container.querySelectorAll('canvas').forEach((c) => c.remove())
    lastKey = undefined
    applied = new Map()
    loadedPlugins.clear()
    lastLive = {}
    await start()
  }

  const api: Runtime = {
    isolation,
    get element() {
      return element
    },
    get ready() {
      return ready
    },
    stats,
    errors,
    run,
    async hush() {
      await ready
      lastKey = undefined
      applied = new Map()
      await request((id) => ({ t: 'hush', id }))
    },
    async setResolution(w, h) {
      await ready
      await request((id) => ({ t: 'resolution', id, w, h }))
    },
    async screenshot(o = {}) {
      await ready
      return request<string>((id) => ({ t: 'screenshot', id, type: o.type, quality: o.quality }))
    },
    async thumbnail(w = 240) {
      const png = await api.screenshot({ type: 'image/jpeg', quality: 0.6 })
      return new Promise<string>((res) => {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = w
          c.height = Math.max(1, Math.round((w * img.height) / img.width))
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
          res(c.toDataURL('image/jpeg', 0.62))
        }
        img.onerror = () => res(png)
        img.src = png
      })
    },
    onError(cb) {
      errorListeners.add(cb)
      return () => errorListeners.delete(cb)
    },
    async time() {
      await ready
      return request<number>((id) => ({ t: 'time', id }))
    },
    setLive(argId, value) {
      queueLive({ [argId]: value })
    },
    setLiveBatch(table) {
      queueLive(table)
    },
    loadPlugin,
    async getCatalogDelta() {
      return delta.slice()
    },
    setMouse(x, y) {
      send({ t: 'mouse', x, y })
    },
    forwardPointer,
    reset,
    dispose() {
      disposed = true
      unsubs.forEach((u) => u())
      forwardPointer(false)
      transport?.dispose()
      pending.forEach((p) => clearTimeout(p.timer))
      pending.clear()
      errorListeners.clear()
    },
  }
  void helloSeen
  return api
}
