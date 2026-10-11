// Chunk previews: what a generator plus its first N modifiers produce ("everything up to here"), and a before/after pair
// for one modifier. A pool of small hidden runtimes (docs/previews-runtime.md) renders them at a low frame rate and sends
// each frame to the page as ImageBitmaps; the main runtime is never touched, only read.
import { activeSketch } from './disable'
import { toRunnable } from './codegen'
import { createRuntime as defaultCreateRuntime, type Runtime, type RuntimeOptions } from './runtime/host'
import { newId, walkChains, type Call, type Chain, type ChainStmt, type DefStmt, type OutName, type Sketch, type Stmt, type Value } from './ir'

// ---------------------------------------------------------------- specs and plans

export type PreviewSpec =
  /** the chain's generator and its enabled modifiers up to and including `upToCallId` (default: the whole chain) */
  | { kind: 'prefix'; chainId: string; upToCallId?: string }
  /** the chain up to just before `callId` (A) and including it (B) */
  | { kind: 'diff'; callId: string }

export interface PreviewPlan {
  ok: true
  /** what the preview runtime runs: the chunk drawn to o0 (and B to o1), with the sketch's sources, settings and defs */
  sketch: Sketch
  /** outputs to capture: [0], or [0, 1] for a diff */
  outputs: number[]
  /** pictures copied from the main runtime about once a second: preview source `slot` ← main output or source `from` */
  feeds: Array<{ slot: string; from: string }>
  /** true when the chunk reads something the preview can only copy from the main runtime (an output, prev(), a camera) */
  approximate: boolean
  /** why it is approximate, one plain sentence each */
  notes: string[]
  /** changes whenever what the preview shows would change (number values aside: those are live) */
  key: string
}
export interface PreviewRefusal {
  ok: false
  reason: string
}

export interface PlanOptions {
  /** copy outputs and cameras from the main runtime (default true). False: refuse such chunks instead. */
  approximate?: boolean
}

const OUT_RE = /^o([0-3])$/
const CAMERA_KINDS = new Set(['cam', 'screen'])
/** raw statements a preview keeps: plugin loading and setFunction (they define functions the chunk may call) */
const RAW_KEEP = /^\s*(await\s+)?(loadScript\s*\(|setFunction\s*\()/
const RAW_DRAWS = /\.out\s*\(|\brender\s*\(|\bhush\s*\(/

function stripDisabledArgs(c: Call): Call {
  const fix = (v: Value): Value => (v.k === 'tex' ? { ...v, chain: { ...v.chain, gen: stripDisabledArgs(v.chain.gen), mods: v.chain.mods.filter((m) => !m.disabled).map(stripDisabledArgs) } } : v)
  const { disabled: _d, ...rest } = c
  void _d
  return c.args.some((a) => a.k === 'tex') ? { ...rest, args: rest.args.map(fix) } : (rest as Call)
}

/** gen + the enabled modifiers before index `upTo` in `mods`, plus `extra` (switched on even if it is disabled) */
function chunk(chain: Chain, upTo: number, extra?: Call): Chain {
  const mods = chain.mods.slice(0, upTo).filter((m) => !m.disabled)
  if (extra) mods.push(extra)
  return { id: newId('h'), gen: stripDisabledArgs(chain.gen), mods: mods.map(stripDisabledArgs) }
}

interface Found {
  chain: Chain
  stmt?: ChainStmt | DefStmt
}
function findChain(sketch: Sketch, pred: (c: Chain) => boolean): Found | undefined {
  for (const x of walkChains(sketch)) if (pred(x.chain)) return { chain: x.chain, stmt: x.stmt }
  return undefined
}

/**
 * The program a preview runs for `spec`, or why it can't be previewed. Chunks that read `o0`…`o3`, `prev()` or a camera
 * source cannot see the main runtime's textures: with `approximate` (default) those reads are rewritten to spare sources
 * (s4…s7 for o0…o3; the camera's own slot) that the pool fills with copies of the main runtime's pictures.
 */
export function previewPlan(sketch: Sketch, spec: PreviewSpec, opts: PlanOptions = {}): PreviewPlan | PreviewRefusal {
  let A: Chain | undefined
  let B: Chain | undefined
  let found: Found | undefined
  if (spec.kind === 'prefix') {
    found = findChain(sketch, (c) => c.id === spec.chainId)
    if (!found) return { ok: false, reason: 'that chain is not in the sketch' }
    const { chain } = found
    if (spec.upToCallId === undefined) A = chunk(chain, chain.mods.length)
    else if (spec.upToCallId === chain.gen.id) A = chunk(chain, 0)
    else {
      const i = chain.mods.findIndex((m) => m.id === spec.upToCallId)
      if (i < 0) return { ok: false, reason: 'that call is not in this chain' }
      A = chunk(chain, i, chain.mods[i])
    }
  } else {
    found = findChain(sketch, (c) => c.gen.id === spec.callId || c.mods.some((m) => m.id === spec.callId))
    if (!found) return { ok: false, reason: 'that call is not in the sketch' }
    const { chain } = found
    if (chain.gen.id === spec.callId) {
      // before a generator there is nothing: a black picture
      A = { id: newId('h'), gen: { id: newId('c'), fn: 'solid', args: [{ k: 'num', v: 0 }, { k: 'num', v: 0 }, { k: 'num', v: 0 }, { k: 'num', v: 1 }] }, mods: [] }
      B = chunk(chain, 0)
    } else {
      const i = chain.mods.findIndex((m) => m.id === spec.callId)
      A = chunk(chain, i)
      B = chunk(chain, i, chain.mods[i])
    }
  }

  // the output the chain is drawn to in the sketch (what prev() reads there)
  const stmtOut: OutName | undefined = found.stmt?.k === 'chain' ? (found.stmt.chain.out ?? undefined) : undefined

  const active = activeSketch(sketch)
  const cameras = new Set(active.stmts.filter((s) => s.k === 'source' && CAMERA_KINDS.has(s.init.kind)).map((s) => (s as { slot: string }).slot))
  const feeds = new Map<string, string>()
  const notes: string[] = []
  let refusal: string | undefined
  const approx = opts.approximate !== false

  const readOutput = (o: string): string => {
    const k = Number(OUT_RE.exec(o)![1])
    if (!approx) refusal ??= `reads ${o}, which can't be previewed in isolation`
    const slot = `s${4 + k}`
    if (!feeds.has(slot)) {
      feeds.set(slot, o)
      notes.push(`reads ${o}: a copy of the main output, refreshed about once a second`)
    }
    return slot
  }
  const readCamera = (s: string) => {
    if (!approx) refusal ??= `uses ${s}, a camera or screen a preview never opens`
    if (!feeds.has(s)) {
      feeds.set(s, s)
      notes.push(`uses ${s} (a camera or screen): a copy of the main picture, refreshed about once a second`)
    }
  }
  const mapValue = (v: Value, inChunk: boolean): Value => {
    if (v.k === 'ref') {
      if (OUT_RE.test(v.name)) return { k: 'ref', name: readOutput(v.name) as never }
      if (cameras.has(v.name)) readCamera(v.name)
      return v
    }
    if (v.k === 'tex') return { ...v, chain: mapChain(v.chain, inChunk) }
    return v
  }
  const mapCall = (c: Call, inChunk: boolean): Call => {
    if (c.fn === 'prev' && inChunk) {
      if (!stmtOut) {
        refusal ??= 'prev() reads the output it is drawn to, which a chain in a definition does not have'
        return c
      }
      if (!approx) refusal ??= `reads its own output (prev()), which can't be previewed in isolation`
      return { ...c, fn: 'src', args: [{ k: 'ref', name: readOutput(stmtOut) as never }] }
    }
    return { ...c, args: c.args.map((a) => mapValue(a, inChunk)) }
  }
  const mapChain = (c: Chain, inChunk: boolean): Chain => ({ ...c, gen: mapCall(c.gen, inChunk), mods: c.mods.map((m) => mapCall(m, inChunk)) })

  const stmts: Stmt[] = []
  for (const s of active.stmts) {
    if (s.k === 'setting') stmts.push(s)
    else if (s.k === 'source') {
      // never open a second camera; a picture or video loads again in the preview
      if (!CAMERA_KINDS.has(s.init.kind)) stmts.push(s)
    } else if (s.k === 'def') stmts.push({ ...s, value: mapValue(s.value, false) })
    else if (s.k === 'raw' && RAW_KEEP.test(s.code) && !RAW_DRAWS.test(s.code)) stmts.push(s)
  }
  const outStmt = (c: Chain, out: OutName): ChainStmt => ({ id: newId('s'), k: 'chain', chain: { ...mapChain(c, true), out } })
  stmts.push(outStmt(A, 'o0'))
  if (B) stmts.push(outStmt(B, 'o1'))
  if (refusal) return { ok: false, reason: refusal }

  const plan: Sketch = { version: 1, id: `preview:${sketch.id}`, name: 'preview', createdAt: 0, modifiedAt: 0, stmts, plugins: sketch.plugins }
  const feedList = [...feeds].map(([slot, from]) => ({ slot, from }))
  const outputs = B ? [0, 1] : [0]
  const code = toRunnable(plan, { live: true }).code
  return { ok: true, sketch: plan, outputs, feeds: feedList, approximate: feedList.length > 0, notes, key: JSON.stringify([code, feedList, outputs]) }
}

// ---------------------------------------------------------------- the global preference

export type PreviewMode = 'off' | 'demand' | 'live'
const PREF_KEY = 'idra.previews'
const modeListeners = new Set<(m: PreviewMode) => void>()
let memoryMode: PreviewMode | undefined

/** Previews off / on demand (default: a still picture, animated while opened) / live (thumbnails animate while visible). */
export function previewMode(): PreviewMode {
  if (memoryMode) return memoryMode
  try {
    const v = globalThis.localStorage?.getItem(PREF_KEY)
    if (v === 'off' || v === 'demand' || v === 'live') return v
  } catch {
    /* storage unavailable */
  }
  return 'demand'
}
export function setPreviewMode(m: PreviewMode): void {
  memoryMode = m
  try {
    globalThis.localStorage?.setItem(PREF_KEY, m)
  } catch {
    /* kept in memory for this page */
  }
  for (const cb of [...modeListeners]) cb(m)
}
export function onPreviewMode(cb: (m: PreviewMode) => void): () => void {
  modeListeners.add(cb)
  return () => modeListeners.delete(cb)
}

// ---------------------------------------------------------------- the pool

export type PreviewState =
  /** previews are switched off (preference) */
  | 'off'
  /** the sketch has not been trusted yet: previews run only after the main runtime's trust gate */
  | 'untrusted'
  /** this chunk can't be previewed (`reason`) */
  | 'refused'
  /** wants a runtime; all of the pool's are busy */
  | 'waiting'
  /** not shown, page hidden, or (on demand) its still picture is up to date */
  | 'paused'
  | 'starting'
  | 'running'
  | 'error'

export interface PreviewFrame {
  /** the picture (A for a diff); valid only during the callback: draw it, don't keep it */
  a: ImageBitmap
  /** B for a diff */
  b?: ImageBitmap
  /** Hydra time of the frame */
  time: number
}

export interface PreviewHandle {
  readonly spec: PreviewSpec
  readonly state: PreviewState
  /** approximate: reads an output, prev() or a camera through a copy of the main picture */
  readonly approximate: boolean
  readonly notes: string[]
  /** why it is refused, or the preview's own error */
  readonly reason?: string
  /** change the sketch (after an edit), the spec, or whether the sketch is trusted */
  update(next: { sketch?: Sketch; spec?: PreviewSpec; trusted?: boolean }): void
  /** on screen or not (an IntersectionObserver's answer); invisible previews pause */
  setVisible(visible: boolean): void
  /** opened/expanded: animates even in on-demand mode, and wins over other previews for a runtime */
  setActive(active: boolean): void
  /** lower (or raise, up to the pool's) frame rate for this preview */
  setFps(fps: number): void
  onFrame(cb: (f: PreviewFrame) => void): () => void
  onState(cb: (h: PreviewHandle) => void): () => void
  close(): void
}

export interface PreviewPoolOptions {
  /** most runtimes alive at once (default 2) */
  size?: number
  /** picture size, at most 256×144 (default 256×144) */
  width?: number
  height?: number
  /** frames per second while running (default 15) */
  fps?: number
  /** dispose the runtimes after this long without a running preview (default 20 s) */
  idleMs?: number
  /** how often approximated outputs and cameras are copied from the main runtime (default 1000 ms) */
  feedMs?: number
  /** the main runtime: previews follow its time and live numbers and copy its outputs. Without it, chunks that read outputs are refused. */
  main?: () => Runtime | undefined
  /** options for each preview runtime (frameUrl / frameSource, audio, catalog…) */
  runtime?: RuntimeOptions
  /** overrides the global preference */
  mode?: PreviewMode
  /** tests: build runtimes another way */
  createRuntime?: (container: HTMLElement, opts: RuntimeOptions) => Runtime
  /** where the hidden runtimes live (default: a fixed element behind the page) */
  container?: HTMLElement
}

export interface PreviewPoolStats {
  /** runtimes alive now / most ever alive at once */
  runtimes: number
  maxRuntimes: number
  frames: number
  runs: number
  /** approximated pictures copied from the main runtime, and the average time one copy took (ms) */
  feeds: number
  feedMs: number
  feedFailures: number
}

interface Slot {
  rt: Runtime
  host: HTMLElement
  handle?: H
  key?: string
  feedTimer?: ReturnType<typeof setInterval>
  unsubs: Array<() => void>
}

interface H {
  spec: PreviewSpec
  sketch: Sketch
  trusted: boolean
  visible: boolean
  active: boolean
  fps: number
  plan?: PreviewPlan
  reason?: string
  state: PreviewState
  stillKey?: string
  requestedAt: number
  slot?: Slot
  frameCbs: Set<(f: PreviewFrame) => void>
  stateCbs: Set<(h: PreviewHandle) => void>
  api: PreviewHandle
  closed: boolean
}

export interface PreviewPool {
  open(spec: PreviewSpec, ctx: { sketch: Sketch; trusted: boolean }): PreviewHandle
  readonly stats: PreviewPoolStats
  readonly mode: PreviewMode
  setMode(mode: PreviewMode): void
  dispose(): void
}

export function createPreviewPool(options: PreviewPoolOptions = {}): PreviewPool {
  const size = Math.max(1, options.size ?? 2)
  const W = Math.min(256, options.width ?? 256)
  const HT = Math.min(144, options.height ?? 144)
  const fpsMax = Math.min(30, options.fps ?? 15)
  const idleMs = options.idleMs ?? 20000
  const feedMs = options.feedMs ?? 1000
  const make = options.createRuntime ?? defaultCreateRuntime
  const stats: PreviewPoolStats = { runtimes: 0, maxRuntimes: 0, frames: 0, runs: 0, feeds: 0, feedMs: 0, feedFailures: 0 }
  let mode: PreviewMode = options.mode ?? previewMode()
  const followPref = options.mode === undefined
  const handles = new Set<H>()
  const slots: Slot[] = []
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let syncTimer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  let root: HTMLElement | undefined
  let liveUnsub: (() => void) | undefined
  let liveMain: Runtime | undefined

  const doc: Document | undefined = typeof document !== 'undefined' ? document : undefined
  const pageHidden = () => !!doc && doc.visibilityState === 'hidden'
  const onVis = () => schedule()
  doc?.addEventListener('visibilitychange', onVis)
  const unsubMode = followPref ? onPreviewMode((m) => setMode(m)) : () => {}

  const main = () => options.main?.()

  function emit(h: H) {
    for (const cb of [...h.stateCbs]) {
      try {
        cb(h.api)
      } catch {
        /* ignore */
      }
    }
  }
  function setState(h: H, s: PreviewState, reason?: string) {
    if (h.state === s && h.reason === reason) return
    h.state = s
    h.reason = reason
    emit(h)
  }

  function replan(h: H) {
    const p = previewPlan(h.sketch, h.spec, { approximate: !!main() })
    if (p.ok) {
      h.plan = p
      h.reason = undefined
    } else {
      h.plan = undefined
      h.reason = p.reason
    }
  }

  function wants(h: H): boolean {
    if (h.closed || mode === 'off' || !h.trusted || !h.plan || !h.visible || pageHidden()) return false
    if (h.state === 'error' && h.slot === undefined) return false
    return mode === 'live' || h.active || h.stillKey !== h.plan.key
  }

  function idleState(h: H): PreviewState {
    if (mode === 'off') return 'off'
    if (!h.trusted) return 'untrusted'
    if (!h.plan) return 'refused'
    if (h.state === 'error') return 'error'
    return wants(h) ? 'waiting' : 'paused'
  }

  function schedule() {
    if (disposed) return
    const wanting = [...handles].filter(wants)
    wanting.sort((a, b) => Number(b.active) - Number(a.active) || b.requestedAt - a.requestedAt)
    const chosen = new Set(wanting.slice(0, size))
    // release first, so their runtimes can be reused
    for (const s of slots) if (s.handle && !chosen.has(s.handle)) release(s)
    for (const h of chosen) {
      if (h.slot) continue
      let s = slots.find((x) => !x.handle)
      if (!s && slots.length < size) s = newSlot()
      if (!s) continue
      void assign(s, h)
    }
    for (const h of handles) if (!h.slot) setState(h, idleState(h), h.state === 'error' ? h.reason : h.plan ? undefined : h.reason)
    const busy = slots.some((s) => s.handle)
    clearTimeout(idleTimer)
    if (!busy && slots.length) idleTimer = setTimeout(disposeRuntimes, idleMs)
    if (busy && !syncTimer && main()) syncTimer = setInterval(syncTime, 1000)
    if (!busy && syncTimer) {
      clearInterval(syncTimer)
      syncTimer = undefined
    }
    wireLive()
  }

  function wireLive() {
    const m = main()
    if (m === liveMain) return
    liveUnsub?.()
    liveMain = m
    liveUnsub = m?.onLive((table) => {
      for (const s of slots) if (s.handle) s.rt.setLiveBatch(table)
      // on demand: a still picture follows number changes (one refresh per change burst)
      let again = false
      for (const h of handles) if (!h.slot && h.plan && h.stillKey === h.plan.key && mode === 'demand') {
        h.stillKey = undefined
        again = true
      }
      if (again) queueSchedule()
    })
  }

  let scheduled = false
  function queueSchedule() {
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      schedule()
    }, 250)
  }

  function rootEl(): HTMLElement {
    if (options.container) return options.container
    if (root) return root
    root = document.createElement('div')
    root.setAttribute('aria-hidden', 'true')
    root.dataset.previewPool = ''
    // behind the page but inside the viewport: browsers throttle frames that are scrolled or moved out of view
    root.style.cssText = 'position:fixed;left:0;bottom:0;z-index:-1;pointer-events:none;overflow:hidden;display:flex;gap:0'
    document.body.appendChild(root)
    return root
  }

  function newSlot(): Slot {
    const host = document.createElement('div')
    host.style.cssText = `width:${W}px;height:${HT}px;overflow:hidden;flex:none`
    rootEl().appendChild(host)
    const rt = make(host, { isolation: 'iframe', ...options.runtime, width: W, height: HT, preview: { numSources: 8 }, midi: options.runtime?.midi })
    const slot: Slot = { rt, host, unsubs: [] }
    slot.unsubs.push(
      rt.onFrame((f) => {
        const h = slot.handle
        if (!h || slot.key !== h.plan?.key) return
        stats.frames++
        if (h.state !== 'running') setState(h, 'running')
        const frame: PreviewFrame = { a: f.bitmaps[0], b: f.bitmaps[1], time: f.time }
        for (const cb of [...h.frameCbs]) {
          try {
            cb(frame)
          } catch {
            /* a consumer's error stays there */
          }
        }
        if (mode !== 'live' && !h.active) {
          // on demand: one still picture, then the runtime goes back to the pool
          h.stillKey = h.plan?.key
          queueSchedule()
        }
      }),
      rt.onError((e) => {
        const h = slot.handle
        if (!h || e.kind === 'warning') return
        setState(h, 'error', e.message)
      }),
    )
    slots.push(slot)
    stats.runtimes = slots.length
    stats.maxRuntimes = Math.max(stats.maxRuntimes, slots.length)
    return slot
  }

  async function assign(s: Slot, h: H) {
    s.handle = h
    h.slot = s
    setState(h, 'starting')
    await start(s, h)
  }

  async function start(s: Slot, h: H) {
    const plan = h.plan
    if (!plan) return
    s.rt.loop({ running: false, fps: 1, outputs: plan.outputs })
    stopFeeds(s)
    try {
      await s.rt.ready
    } catch (e) {
      if (s.handle === h) setState(h, 'error', String((e as Error)?.message ?? e))
      return
    }
    if (s.handle !== h || h.plan !== plan) return
    stats.runs++
    const m = main()
    if (m) s.rt.setLiveBatch(m.liveTable())
    const r = await s.rt.run(plan.sketch)
    if (s.handle !== h || h.plan !== plan) return
    if (!r.ok) {
      setState(h, 'error', r.error ?? 'the preview could not run')
      release(s)
      return
    }
    s.key = plan.key
    if (m) {
      try {
        s.rt.setTime(await m.time())
      } catch {
        /* keeps its own clock */
      }
      await pumpFeeds(s, plan)
      if (plan.feeds.length) s.feedTimer = setInterval(() => void pumpFeeds(s, plan), feedMs)
    }
    if (s.handle !== h || h.plan !== plan) return
    const still = mode !== 'live' && !h.active
    s.rt.loop({ running: true, fps: Math.min(fpsMax, h.fps), outputs: plan.outputs, frames: still ? 2 : undefined })
  }

  async function pumpFeeds(s: Slot, plan: PreviewPlan) {
    const m = main()
    if (!m) return
    for (const f of plan.feeds) {
      const t0 = performance.now()
      try {
        const bmp = await m.snapshot(f.from, W, HT)
        if (s.key !== plan.key && s.handle?.plan !== plan) {
          bmp.close?.()
          return
        }
        s.rt.setImage(f.slot, bmp)
        stats.feedMs = (stats.feedMs * stats.feeds + (performance.now() - t0)) / (stats.feeds + 1)
        stats.feeds++
      } catch {
        stats.feedFailures++
      }
    }
  }

  function stopFeeds(s: Slot) {
    if (s.feedTimer) clearInterval(s.feedTimer)
    s.feedTimer = undefined
  }

  function release(s: Slot) {
    const h = s.handle
    s.rt.loop({ running: false, fps: 1, outputs: [0] })
    stopFeeds(s)
    s.handle = undefined
    if (h) {
      h.slot = undefined
      setState(h, h.state === 'error' ? 'error' : idleState(h), h.state === 'error' ? h.reason : undefined)
    }
  }

  async function syncTime() {
    const m = main()
    if (!m) return
    try {
      const t = await m.time()
      for (const s of slots) if (s.handle) s.rt.setTime(t)
    } catch {
      /* ignore */
    }
  }

  function disposeRuntimes() {
    for (const s of slots.splice(0)) {
      if (s.handle) s.handle.slot = undefined
      stopFeeds(s)
      s.unsubs.forEach((u) => u())
      s.rt.dispose()
      s.host.remove()
    }
    stats.runtimes = 0
    root?.remove()
    root = undefined
  }

  function setMode(m: PreviewMode) {
    mode = m
    for (const h of handles) if (mode === 'demand') h.stillKey = undefined
    // a running preview's loop length depends on the mode: start them again
    for (const s of slots) if (s.handle) release(s)
    schedule()
  }

  function open(spec: PreviewSpec, ctx: { sketch: Sketch; trusted: boolean }): PreviewHandle {
    const h: H = {
      spec,
      sketch: ctx.sketch,
      trusted: ctx.trusted,
      visible: true,
      active: false,
      fps: fpsMax,
      state: 'paused',
      requestedAt: performance.now(),
      frameCbs: new Set(),
      stateCbs: new Set(),
      api: undefined as unknown as PreviewHandle,
      closed: false,
    }
    replan(h)
    h.api = {
      get spec() {
        return h.spec
      },
      get state() {
        return h.state
      },
      get approximate() {
        return !!h.plan?.approximate
      },
      get notes() {
        return h.plan?.notes ?? []
      },
      get reason() {
        return h.reason
      },
      update(next) {
        if (h.closed) return
        if (next.sketch) h.sketch = next.sketch
        if (next.spec) h.spec = next.spec
        if (next.trusted !== undefined) h.trusted = next.trusted
        const before = h.plan?.key
        replan(h)
        if (h.state === 'error' && h.plan?.key !== before) h.state = 'paused'
        if (h.slot && h.plan && h.plan.key !== before) void start(h.slot, h)
        else if (h.slot && !h.plan) release(h.slot)
        schedule()
      },
      setVisible(v) {
        if (h.visible === v) return
        h.visible = v
        schedule()
      },
      setActive(a) {
        if (h.active === a) return
        h.active = a
        h.requestedAt = performance.now()
        // the loop length depends on it: start again
        if (h.slot) release(h.slot)
        if (!a) h.stillKey = h.plan?.key
        schedule()
      },
      setFps(f) {
        h.fps = Math.max(0.5, Math.min(fpsMax, f))
        if (h.slot && h.plan && (mode === 'live' || h.active)) h.slot.rt.loop({ running: true, fps: h.fps, outputs: h.plan.outputs })
      },
      onFrame(cb) {
        h.frameCbs.add(cb)
        return () => h.frameCbs.delete(cb)
      },
      onState(cb) {
        h.stateCbs.add(cb)
        return () => h.stateCbs.delete(cb)
      },
      close() {
        if (h.closed) return
        h.closed = true
        if (h.slot) release(h.slot)
        handles.delete(h)
        h.frameCbs.clear()
        h.stateCbs.clear()
        schedule()
      },
    }
    handles.add(h)
    schedule()
    return h.api
  }

  return {
    open,
    stats,
    get mode() {
      return mode
    },
    setMode,
    dispose() {
      disposed = true
      clearTimeout(idleTimer)
      if (syncTimer) clearInterval(syncTimer)
      liveUnsub?.()
      unsubMode()
      doc?.removeEventListener('visibilitychange', onVis)
      for (const h of handles) h.closed = true
      handles.clear()
      disposeRuntimes()
    },
  }
}
