/// <reference path="../types.d.ts" />
import { catalog as defaultCatalog, type Catalog, type CatalogDelta } from '../catalog'
import { liveId, toRunnable } from '../codegen'
import { importText } from '../parse'
import { contentHash, type Chain, type OutName, type PluginRef, type Sketch, type Stmt, type Value } from '../ir'
import { activeOnly, outputGroups, partialRunSet, type PlayingMap } from '../evaluation'
import type { AudioEngine } from '../audio'
import type { ErrorKind, FrameMsg, FrameToHost, HostToFrame, Transport } from './protocol'
import { Bridge } from './bridge'
import { getScriptCache, ScriptCache, verifyIntegrity } from './script-cache'
import { emitPluginLoaded } from '../plugins'
import { getMidiHub, usesMidi, webMidiAvailable, type MidiHub } from '../midi'
import { MOTION_METHODS, type MotionMethod } from '../motion-core'
import { isInvokeName, validInvokeArgs } from './bridge'

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
  /**
   * Inline mode only: let plugins and `loadScript` run in this (host) page. Default false: plugin code runs only in the
   * sandboxed frame, so inline runs report a warning and continue without them. Tests set it.
   */
  pluginsInHostPage?: boolean
  /**
   * MIDI hub whose inputs and messages are forwarded into the frame's Web MIDI shim. Default: the page-wide
   * `getMidiHub()`, so the on-screen controller and forwarded devices reach every preview. `null` turns forwarding off.
   */
  midi?: MidiHub | null
  /**
   * A preview runtime (see `PreviewPool`, docs/previews-runtime.md): Hydra does not animate by itself; `loop()` ticks it at
   * a low frame rate and frames come back through `onFrame`. `numSources` (default 8) adds s4… for approximated outputs.
   */
  preview?: { numSources?: number }
}

export interface PreviewLoop {
  running: boolean
  /** frames per second (0.5–30) */
  fps: number
  /** output indices captured after each tick: [0] for one picture, [0, 1] for a before/after pair */
  outputs: number[]
  /** stop after this many frames (1 = one still picture) */
  frames?: number
}

export interface RunOptions {
  /** skip raw code and plugins, run only recognised chains/settings/sources */
  safe?: boolean
  /** re-evaluate even if nothing but numbers changed, and re-initialise sources */
  force?: boolean
  /**
   * `clean` (default): today's clean slate before evaluating: all four outputs black, `render` back to o0, `speed` 1, `bpm`
   * 30, `update`/`afterUpdate` cleared, changed sources (all of them with `force`) cleared, so the screen matches the code.
   * `none`: vanilla Hydra's eval: only the code runs and anything it doesn't mention carries on (a deleted chain keeps
   * playing). The clock is never reset either way. Opening a different sketch should always use `clean`.
   */
  reset?: 'clean' | 'none'
}

export interface PartRunOptions {
  safe?: boolean
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
  /** JavaScript globals the plugin added (JS-only plugins such as hydra-midi: `midi`, `note`, `cc`) */
  globals?: string[]
  /** existing functions (built-ins or another plugin's) that this plugin replaced */
  shadows?: string[]
  /** hex SHA-256 of the evaluated code, when known */
  hash?: string
  /** e.g. "@latest: may change" */
  warning?: string
}

export interface Runtime {
  readonly isolation: Isolation
  /** the iframe (iframe mode) or the container (inline mode) */
  readonly element: HTMLElement
  readonly ready: Promise<void>
  readonly stats: { runs: number; recompiles: number; liveMessages: number; lastRunMs: number }
  readonly errors: RuntimeError[]
  run(input: Sketch | string, opts?: RunOptions): Promise<RunResult>
  /**
   * A partial run: evaluate statements `ids` of `sketch` against the current runtime state, resetting nothing else: other
   * outputs keep playing, sources and globals stay. The `def`s and sources those statements read run with them; settings
   * and raw code only when listed (`partialRunSet`). Runs after any run already asked for. This is how a held chain's Run,
   * a draft's Run and a code view's "run this line" reach the screen (docs/evaluation.md).
   */
  runPart(sketch: Sketch, ids: string[], opts?: PartRunOptions): Promise<RunResult>
  /** what each output is drawing, as of the last run (with live numbers applied): compare with `outOfSync(sketch, …)` */
  playing(): PlayingMap
  /** called after every run, partial run or hush that changed what plays */
  onPlaying(cb: () => void): () => void
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
  /**
   * Call a hydra-motion knob's method in the running sketch (a pad press: `invoke('k', 'hold', [0.9])`). `name` must be a
   * `def` of the sketch last run, `method` one of set | to | hold | release | press | lift, args numbers or short strings. Fire-and-forget,
   * delivered in order and never coalesced (unlike setLive); queued until the frame is ready. Returns false (and reports a
   * warning) when the call is refused.
   */
  invoke(name: string, method: MotionMethod, args?: Array<number | string>): boolean
  /** drive Hydra's `mouse.x/y` yourself (the hook for touch input) */
  setMouse(x: number, y: number): void
  /** forward pointer positions over the runtime element into the frame's `mouse` */
  forwardPointer(on: boolean): void
  /** throw the frame away and start fresh (clears plugin-registered functions) */
  reset(): Promise<void>
  dispose(): void
  /** current values of the live-parameter table (what `setLive` last sent, merged over the last run's) */
  liveTable(): Record<string, number>
  /** called with each batch of live values as it is sent to the frame (previews mirror the main runtime's numbers) */
  onLive(cb: (table: Record<string, number>) => void): () => void
  /**
   * A small picture of output `of` (`o0`…`o3`) or of a source's current picture (`s0`…), as an ImageBitmap the caller
   * owns (close it). Reads pixels back from the GPU: call it rarely (previews: about once a second).
   */
  snapshot(of: string, width: number, height: number): Promise<ImageBitmap>
  /** preview runtimes: start, change or stop the frame loop */
  loop(opts: PreviewLoop): void
  /** set Hydra's `time` */
  setTime(time: number): void
  /** preview runtimes: show this picture in source `slot` (the bitmap is transferred); null clears it */
  setImage(slot: string, bitmap: ImageBitmap | null): void
  /** preview runtimes: each frame the loop captured (bitmaps in `outputs` order; listeners must not keep them after closing) */
  onFrame(cb: (frame: FrameMsg) => void): () => void
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
      send: (m, transfer) => iframe.contentWindow?.postMessage(m, '*', transfer ?? []),
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
  const clone = <T,>(x: T, transfer?: Transferable[]): T => (transfer?.length ? structuredClone(x, { transfer }) : structuredClone(x))
  const start = loadHydra().then((Hydra) => {
    bridge = new Bridge({ win: window, container, post: (m, transfer) => {
      const c = clone(m, transfer)
      defer(() => cb(c))
    }, Hydra })
    defer(() => cb({ t: 'hello' }))
  })
  start.catch((e) => defer(() => cb({ t: 'fatal', message: `could not load hydra-synth: ${e?.message ?? e}` })))
  return {
    send: (m, transfer) => {
      const c = clone(m, transfer)
      void start.then(() => defer(() => bridge?.handle(c)))
    },
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
  const scripts = opts.scriptCache ?? getScriptCache()
  const midiHub = opts.midi === null ? undefined : (opts.midi ?? getMidiHub())
  const hostPagePlugins = isolation === 'inline' && !opts.transport && !opts.pluginsInHostPage
  const warnedLatest = new Set<string>()
  const shadowLog: string[] = []
  const midiWarned = new Set<string>()

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

  // what each output draws (statement id + the chain as it ran), for out-of-sync checks
  let playingMap = new Map<OutName, { stmt: string; chain: Chain }>()
  const playingListeners = new Set<() => void>()

  // defs of the sketch last run: the only names invoke() forwards
  let knownDefs = new Set<string>()
  let frameReady = false
  let invokeQueue: HostToFrame[] = []

  // live coalescing
  let livePending: Record<string, number> = {}
  let liveScheduled = false

  const unsubs: Array<() => void> = []
  const liveListeners = new Set<(t: Record<string, number>) => void>()
  const frameListeners = new Set<(f: FrameMsg) => void>()

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

  const send = (m: HostToFrame, transfer?: Transferable[]) => transport?.send(m, transfer)
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
        send(initMsg())
        break
      case 'frame':
        for (const cb of [...frameListeners]) {
          try {
            cb(m)
          } catch {
            /* a listener's error never stops the loop */
          }
        }
        for (const b of m.bitmaps) b.close?.()
        send({ t: 'ack', seq: m.seq })
        break
      case 'ready':
        if (opts.audio) send({ t: 'audioSettings', settings: opts.audio.settings })
        if (midiHub) send({ t: 'midiInputs', inputs: midiHub.inputs() })
        frameReady = true
        for (const q of invokeQueue.splice(0)) send(q)
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
        for (const d of m.delta) {
          // a plugin defining a name that exists already (a built-in, or another plugin's) replaces it: say so
          const prev = cat.get(d.name)
          if (prev && prev.origin !== d.origin) {
            shadowLog.push(d.name)
            emitError('warning', `${d.origin.replace(/^plugin:/, 'plugin ')} replaces ${prev.origin === 'builtin' ? 'the built-in' : `${prev.origin.replace(/^plugin:/, '')}’s`} function "${d.name}"`)
          }
        }
        cat.refresh(m.delta)
        break
      case 'fetch':
        void (async () => {
          try {
            if (hostPagePlugins) throw new Error('loadScript is disabled in inline mode (no isolation); switch the preview back to the sandboxed frame')
            const r = await scripts.get(m.url)
            if (r.warning && !warnedLatest.has(m.url)) {
              warnedLatest.add(m.url)
              emitError('warning', r.warning)
            }
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
    frameReady = false
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
    if (opts.transport) send(initMsg())
  }
  function initMsg(): HostToFrame {
    return { t: 'init', width, height, precision: opts.precision, ...(opts.preview ? { preview: { numSources: opts.preview.numSources ?? 8 } } : {}) }
  }

  function wireAudio() {
    const a = opts.audio
    if (!a) return
    // one small message per analysis frame: 24 Bark bands + total (the frame applies Hydra's bins/cutoff/scale/smooth)
    unsubs.push(a.onFrame((f) => send({ t: 'audio', vol: f.vol, specific: f.specific })))
    unsubs.push(a.onSettings((s) => send({ t: 'audioSettings', settings: s })))
  }
  function wireMidi() {
    const hub = midiHub
    if (!hub) return
    unsubs.push(hub.onInputs((inputs) => send({ t: 'midiInputs', inputs })))
    unsubs.push(hub.onMessage((input, data) => send({ t: 'midi', input, data })))
  }

  const startP = start()
  startP.catch((e) => {
    emitError('runtime', e.message)
    readyReject?.(e)
  })
  wireAudio()
  wireMidi()

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
    for (const cb of [...liveListeners]) {
      try {
        cb(table)
      } catch {
        /* ignore */
      }
    }
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

  /** Load the sketch's plugins in order. A failure is reported (with the URL) and the sketch runs without that plugin. */
  async function ensurePlugins(sketch: Sketch): Promise<void> {
    for (const p of sketch.plugins ?? []) {
      const r = await loadPlugin(p)
      if (!r.ok) emitError('runtime', `plugin "${p.name || p.id}"${p.url ? ` (${p.url})` : ''} did not load: ${r.error}. The sketch runs without it; its functions show as unknown calls.`)
    }
  }

  /** Record the chains `sk` draws as playing: replacing everything (clean slate) or only the outputs it mentions. */
  function notePlaying(sk: Sketch, replace: boolean) {
    const next = replace ? new Map<OutName, { stmt: string; chain: Chain }>() : new Map(playingMap)
    for (const g of outputGroups(sk)) {
      if (!g.playing) continue
      const st = sk.stmts.find((x) => x.id === g.playing)
      if (st?.k === 'chain') next.set(g.out, { stmt: st.id, chain: activeOnly(st.chain) })
    }
    playingMap = next
    emitPlaying()
  }
  function emitPlaying() {
    for (const cb of [...playingListeners]) {
      try {
        cb()
      } catch {
        /* ignore */
      }
    }
  }
  /** The chain with the live table's current numbers in place of the ones it ran with. */
  function withLive(c: Chain): Chain {
    const call = (x: Chain['gen']): Chain['gen'] => {
      let changed = false
      const args = x.args.map((a, i): Value => {
        if (a.k === 'tex') {
          const ch = withLive(a.chain)
          if (ch !== a.chain) changed = true
          return ch === a.chain ? a : { ...a, chain: ch }
        }
        const v = lastLive[liveId(x.id, i)]
        if (a.k === 'num' && v !== undefined && v !== a.v) {
          changed = true
          return { k: 'num', v }
        }
        return a
      })
      return changed ? { ...x, args } : x
    }
    const gen = call(c.gen)
    const mods = c.mods.map(call)
    return gen === c.gen && mods.every((m, i) => m === c.mods[i]) ? c : { ...c, gen, mods }
  }

  async function execute(input: Sketch | string, o: RunOptions): Promise<RunResult> {
    const t0 = performance.now()
    await ready
    stats.runs++
    const safe = !!o.safe
    const clean = o.reset !== 'none'
    let sketch: Sketch | undefined
    let rawText: string | undefined
    if (typeof input === 'string') {
      if (!safe) rawText = input
      else sketch = importText(input).sketch
    } else sketch = input
    knownDefs = new Set((sketch ?? importText(rawText!).sketch).stmts.flatMap((s) => (s.k === 'def' && !s.disabled ? [s.name] : [])))

    let code: string
    let live: Record<string, number> = {}
    let skipped: RunResult['skipped'] = []
    let sources = new Map<string, string>()
    let key: string

    if (rawText !== undefined) {
      code = key = rawText
    } else {
      const sk = sketch!
      if (!safe) await ensurePlugins(sk)
      if (!safe && !midiWarned.has(sk.id) && !webMidiAvailable() && usesMidi(sk)) {
        // never fail silently: the sketch's MIDI inputs would just sit at 0
        midiWarned.add(sk.id)
        emitError('warning', `Web MIDI isn't available in this browser, so MIDI inputs won't respond${midiHub ? '; the on-screen controller (⇄ menu › MIDI controller) still sends MIDI' : ''}. Diagnostics shows what this browser supports.`)
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
      // vanilla: a changed source re-initialises from its own statement; a deleted one keeps showing, as in Hydra
      if (clean) for (const [slot, k] of applied) if (o.force || sources.get(slot) !== k) clear.push(slot)
      const keep = new Set([...applied].filter(([slot, k]) => !o.force && sources.get(slot) === k).map(([slot]) => slot))
      const reduced = toRunnable(sk, { safe, live: true, catalog: cat, skipSource: (s) => keep.has(s.slot) })
      code = reduced.code
      stats.recompiles++
      try {
        await request<unknown>((id) => ({ t: 'run', id, code, live, reset: clean ? { clearSources: clear } : null }))
        lastKey = key
        lastSafe = safe
        lastLive = clean ? { ...live } : { ...lastLive, ...live }
        applied = clean ? sources : new Map([...applied, ...sources])
        notePlaying(sk, clean)
        stats.lastRunMs = performance.now() - t0
        return { ok: true, recompiled: true, skipped, ms: stats.lastRunMs }
      } catch (e: any) {
        lastKey = undefined
        return { ok: false, recompiled: true, error: String(e.message ?? e), skipped, ms: performance.now() - t0 }
      }
    }
    // raw text path
    stats.recompiles++
    const clear = clean ? [...applied.keys()] : []
    try {
      await request<unknown>((id) => ({ t: 'run', id, code, live, reset: clean ? { clearSources: clear } : null }))
      lastKey = undefined
      lastSafe = safe
      if (clean) applied = new Map()
      notePlaying(importText(rawText!).sketch, clean)
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

  async function executePart(sketch: Sketch, ids: string[], o: PartRunOptions): Promise<RunResult> {
    const t0 = performance.now()
    await ready
    stats.runs++
    const safe = !!o.safe
    knownDefs = new Set(sketch.stmts.flatMap((s) => (s.k === 'def' && !s.disabled ? [s.name] : [])))
    const set = new Set(partialRunSet(sketch, ids))
    if (!set.size) return { ok: true, recompiled: false, skipped: [], ms: performance.now() - t0 }
    if (!safe) await ensurePlugins(sketch)
    const part: Sketch = { ...sketch, stmts: sketch.stmts.filter((s) => set.has(s.id)) }
    const sources = new Map<string, string>()
    for (const s of part.stmts) if (s.k === 'source') sources.set(s.slot, srcKey(s))
    const r = toRunnable(part, { safe, live: true, catalog: cat, skipSource: (s) => applied.get(s.slot) === srcKey(s) })
    stats.recompiles++
    try {
      await request<unknown>((id) => ({ t: 'run', id, code: r.code, live: r.live, reset: null }))
      // the frame no longer matches any whole-sketch run: the next run() evaluates even if its code is unchanged
      lastKey = undefined
      lastLive = { ...lastLive, ...r.live }
      applied = new Map([...applied, ...sources])
      notePlaying(part, false)
      stats.lastRunMs = performance.now() - t0
      return { ok: true, recompiled: true, skipped: r.skipped, ms: stats.lastRunMs }
    } catch (e: any) {
      return { ok: false, recompiled: true, error: String(e.message ?? e), skipped: r.skipped, ms: performance.now() - t0 }
    }
  }

  function runPart(sketch: Sketch, ids: string[], o: PartRunOptions = {}): Promise<RunResult> {
    return new Promise<RunResult>((res) => {
      // after the frame's debounced run(), if one is scheduled: requests reach the frame in the order they were made
      raf(() => {
        runChain = runChain.then(async () => {
          res(await executePart(sketch, ids, o).catch((e): RunResult => ({ ok: false, recompiled: true, error: String(e?.message ?? e), skipped: [], ms: 0 })))
        })
      })
    })
  }

  async function loadPlugin(ref: PluginRef): Promise<PluginResult> {
    await ready
    const fail = (error: string, extra: Partial<PluginResult> = {}): PluginResult => {
      emitPluginLoaded({ id: ref.id, url: ref.url, functions: [], globals: [], shadows: [], error })
      return { ok: false, error, delta: [], ...extra }
    }
    // plugin code is third-party: it never runs in the host page
    if (hostPagePlugins) return fail('plugins run only in the sandboxed preview, not in inline mode (no isolation)')
    try {
      let src = ref.src
      let from: PluginResult['from'] = 'inline'
      let warning: string | undefined
      if (src === undefined) {
        if (!ref.url) return fail('plugin has neither src nor url')
        const r = await scripts.get(ref.url)
        src = r.text
        from = r.from
        warning = r.warning
        if (warning && !warnedLatest.has(ref.url)) {
          warnedLatest.add(ref.url)
          emitError('warning', warning)
        }
      }
      if (ref.integrity && !(await verifyIntegrity(src, ref.integrity))) return fail('its content changed since you approved it (integrity check failed)', { from })
      const hash = contentHash(src)
      if (loadedPlugins.get(ref.id) === hash) return { ok: true, delta: [], from, warning }
      const shadowStart = shadowLog.length
      const out = await request<{ delta: CatalogDelta[]; globals?: string[] }>((id) => ({ t: 'plugin', id, pluginId: ref.id, name: ref.name, src: src!, url: ref.url }))
      loadedPlugins.set(ref.id, hash)
      lastKey = undefined // functions changed: next run must re-evaluate
      const d = out?.delta ?? []
      const shadows = shadowLog.slice(shadowStart)
      const globals = out?.globals ?? []
      emitPluginLoaded({ id: ref.id, url: ref.url, functions: d.map((x) => x.name), globals, shadows, from })
      return { ok: true, delta: d, from, globals, shadows, warning }
    } catch (e: any) {
      return fail(String(e?.message ?? e))
    }
  }

  async function reset() {
    invokeQueue = []
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
    playingMap = new Map()
    emitPlaying()
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
    runPart,
    playing() {
      const out: PlayingMap = {}
      for (const [o, p] of playingMap) out[o] = { stmt: p.stmt, chain: withLive(p.chain) }
      return out
    },
    onPlaying(cb) {
      playingListeners.add(cb)
      return () => playingListeners.delete(cb)
    },
    async hush() {
      await ready
      lastKey = undefined
      applied = new Map()
      await request((id) => ({ t: 'hush', id }))
      playingMap = new Map()
      emitPlaying()
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
    invoke(name, method, args = []) {
      const refuse = (why: string) => {
        emitError('warning', `pad call ${String(name)}.${String(method)} ignored: ${why}`)
        return false
      }
      if (!isInvokeName(name)) return refuse('not a variable name')
      if (!knownDefs.has(name)) return refuse(`"${name}" is not defined by the running sketch`)
      if (!(MOTION_METHODS as readonly string[]).includes(method)) return refuse(`only ${MOTION_METHODS.join(', ')} are allowed`)
      if (!validInvokeArgs(args)) return refuse('arguments must be numbers or short strings')
      const m: HostToFrame = { t: 'invoke', name, method, args: args.slice() }
      if (frameReady && transport && invokeQueue.length === 0) send(m)
      else invokeQueue.push(m)
      return true
    },
    setMouse(x, y) {
      send({ t: 'mouse', x, y })
    },
    liveTable() {
      return { ...lastLive }
    },
    onLive(cb) {
      liveListeners.add(cb)
      return () => liveListeners.delete(cb)
    },
    async snapshot(of, w, h) {
      await ready
      return request<ImageBitmap>((id) => ({ t: 'snapshot', id, of, width: w, height: h }))
    },
    loop(o) {
      void ready.then(() => send({ t: 'loop', running: o.running, fps: o.fps, outputs: o.outputs, frames: o.frames }))
    },
    setTime(t) {
      void ready.then(() => send({ t: 'setTime', time: t }))
    },
    setImage(slot, bitmap) {
      void ready.then(
        () => send({ t: 'image', slot, bitmap }, bitmap ? [bitmap] : undefined),
        () => bitmap?.close?.(),
      )
    },
    onFrame(cb) {
      frameListeners.add(cb)
      return () => frameListeners.delete(cb)
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
      liveListeners.clear()
      frameListeners.clear()
      playingListeners.clear()
    },
  }
  void helloSeen
  return api
}
