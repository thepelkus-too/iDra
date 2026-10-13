// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { fromCode } from '../src/parse'
import { toRunnable } from '../src/codegen'
import { setDisabled } from '../src/disable'
import { createPreviewPool, previewPlan, previewMode, setPreviewMode, type PreviewPlan, type PreviewPool } from '../src/preview'
import type { Runtime, RuntimeOptions, PreviewLoop } from '../src/runtime/host'
import type { FrameMsg } from '../src/runtime/protocol'
import type { Chain, Sketch } from '../src/ir'

const chainAt = (s: Sketch, i: number): Chain => (s.stmts.filter((x) => x.k === 'chain')[i] as { chain: Chain }).chain
const ok = (p: ReturnType<typeof previewPlan>): PreviewPlan => {
  if (!p.ok) throw new Error(p.reason)
  return p
}
const code = (p: PreviewPlan) => toRunnable(p.sketch).code

describe('previewPlan', () => {
  const s = fromCode(`speed = 0.5
s1.initImage('https://example.com/a.png')
k = 0.4
osc(10, 0.2)
  .rotate(k)
  // .kaleid(5)
  .modulate(noise(3).scale(2), 0.3)
  .color(1, 0.5)
  .out(o2)
render(o2)
solid(1).out(o3)
`)
  const ch = chainAt(s, 0)
  const [rotate, kaleid, modulate, color] = ch.mods

  test('prefix: the generator and the enabled modifiers up to the call, drawn to o0, with sources, settings and defs', () => {
    const p = ok(previewPlan(s, { kind: 'prefix', chainId: ch.id, upToCallId: modulate.id }))
    expect(code(p)).toBe(`speed = 0.5
s1.initImage('https://example.com/a.png')
k = 0.4
osc(10, 0.2)
  .rotate(k)
  .modulate(noise(3).scale(2), 0.3)
  .out()`)
    expect(p.outputs).toEqual([0])
    expect(p.approximate).toBe(false)
    // the generator alone, and the whole chain
    expect(code(ok(previewPlan(s, { kind: 'prefix', chainId: ch.id, upToCallId: ch.gen.id }))).endsWith('osc(10, 0.2).out()')).toBe(true)
    expect(code(ok(previewPlan(s, { kind: 'prefix', chainId: ch.id }))).includes('.color(1, 0.5)')).toBe(true)
  })

  test('the call ids are kept, so the main runtime’s live numbers drive the preview', () => {
    const p = ok(previewPlan(s, { kind: 'prefix', chainId: ch.id, upToCallId: color.id }))
    const live = toRunnable(p.sketch, { live: true }).live
    expect(Object.keys(live)).toContain(`${color.id}:0`)
    expect(Object.keys(live)).toContain(`${ch.gen.id}:0`)
  })

  test('diff: before (o0) and after (o1); a disabled call can be previewed switched on', () => {
    const p = ok(previewPlan(s, { kind: 'diff', callId: kaleid.id }))
    expect(p.outputs).toEqual([0, 1])
    const c = code(p)
    expect(c).toContain('osc(10, 0.2)\n  .rotate(k)\n  .out()')
    expect(c).toContain('osc(10, 0.2)\n  .rotate(k)\n  .kaleid(5)\n  .out(o1)')
    expect(code(ok(previewPlan(s, { kind: 'diff', callId: rotate.id })))).toContain('osc(10, 0.2).out()')
    // before a generator: black
    expect(code(ok(previewPlan(s, { kind: 'diff', callId: ch.gen.id })))).toContain('solid().out()')
  })

  test('a nested chain (a texture argument) and a draft (a disabled chain statement) can be previewed', () => {
    const nested = (modulate.args[0] as { chain: Chain }).chain
    expect(code(ok(previewPlan(s, { kind: 'prefix', chainId: nested.id })))).toContain('noise(3)\n  .scale(2)\n  .out()')
    const d = setDisabled(s, s.stmts.find((x) => x.k === 'chain')!.id, true)
    expect(code(ok(previewPlan(d, { kind: 'prefix', chainId: ch.id, upToCallId: rotate.id })))).toContain('.rotate(k)')
  })

  test('render() and other chains are left out; plugin-loading raw lines stay, other raw code does not', () => {
    const t = fromCode(`await loadScript('https://example.com/p.js')
a.show()
osc().out()
noise().out(o1)
render()`)
    const c = code(ok(previewPlan(t, { kind: 'prefix', chainId: chainAt(t, 0).id })))
    expect(c).toBe(`await loadScript('https://example.com/p.js')\nosc().out()`)
  })

  test('reading an output, prev() or a camera: approximated through copied pictures, or refused', () => {
    const t = fromCode(`s0.initCam()
osc().modulate(o1).blend(src(s0)).out(o2)
src(o2).scale(1.01).blend(prev(), 0.7).out(o2)
`)
    const p = ok(previewPlan(t, { kind: 'prefix', chainId: chainAt(t, 0).id }))
    expect(p.approximate).toBe(true)
    expect(p.feeds).toEqual([
      { slot: 's5', from: 'o1' },
      { slot: 's0', from: 's0' },
    ])
    expect(code(p)).not.toContain('initCam')
    expect(code(p)).toContain('.modulate(s5)')
    const q = ok(previewPlan(t, { kind: 'prefix', chainId: chainAt(t, 1).id }))
    expect(q.feeds).toEqual([{ slot: 's6', from: 'o2' }])
    expect(code(q)).toBe('src(s6)\n  .scale(1.01)\n  .blend(src(s6), 0.7)\n  .out()')
    const r = previewPlan(t, { kind: 'prefix', chainId: chainAt(t, 0).id }, { approximate: false })
    expect(r).toEqual({ ok: false, reason: "reads o1, which can't be previewed in isolation" })
  })

  test('unknown ids are refused politely', () => {
    expect(previewPlan(s, { kind: 'prefix', chainId: 'nope' }).ok).toBe(false)
    expect(previewPlan(s, { kind: 'diff', callId: 'nope' }).ok).toBe(false)
    expect(previewPlan(s, { kind: 'prefix', chainId: ch.id, upToCallId: 'nope' }).ok).toBe(false)
  })
})

// ---------------------------------------------------------------- the pool, with stand-in runtimes

class FakeRuntime {
  static all: FakeRuntime[] = []
  static alive = 0
  static maxAlive = 0
  runs: Sketch[] = []
  loops: PreviewLoop[] = []
  live: Array<Record<string, number>> = []
  times: number[] = []
  images: Array<{ slot: string }> = []
  disposed = false
  frameCbs = new Set<(f: FrameMsg) => void>()
  errorCbs = new Set<(e: any) => void>()
  liveCbs = new Set<(t: Record<string, number>) => void>()
  ready = Promise.resolve()
  runResult = { ok: true, recompiled: true, skipped: [], ms: 1 } as any
  constructor(public opts: RuntimeOptions) {
    FakeRuntime.all.push(this)
    FakeRuntime.alive++
    FakeRuntime.maxAlive = Math.max(FakeRuntime.maxAlive, FakeRuntime.alive)
  }
  async run(s: Sketch) {
    this.runs.push(s)
    return this.runResult
  }
  loop(o: PreviewLoop) {
    this.loops.push(o)
  }
  get running() {
    return this.loops[this.loops.length - 1]?.running ?? false
  }
  setLiveBatch(t: Record<string, number>) {
    this.live.push(t)
  }
  setTime(t: number) {
    this.times.push(t)
  }
  setImage(slot: string) {
    this.images.push({ slot })
  }
  async snapshot() {
    return { width: 4, height: 4, close() {} } as unknown as ImageBitmap
  }
  async time() {
    return 12.5
  }
  liveTable() {
    return { x: 1 }
  }
  onLive(cb: (t: Record<string, number>) => void) {
    this.liveCbs.add(cb)
    return () => this.liveCbs.delete(cb)
  }
  onFrame(cb: (f: FrameMsg) => void) {
    this.frameCbs.add(cb)
    return () => this.frameCbs.delete(cb)
  }
  onError(cb: (e: any) => void) {
    this.errorCbs.add(cb)
    return () => this.errorCbs.delete(cb)
  }
  frame(n = 1) {
    const bmp = () => ({ width: 256, height: 144, close() {} }) as unknown as ImageBitmap
    for (const cb of this.frameCbs) cb({ t: 'frame', seq: 1, bitmaps: Array.from({ length: n }, bmp), time: 1 })
  }
  error(message: string) {
    for (const cb of this.errorCbs) cb({ kind: 'eval', message, at: 0 })
  }
  dispose() {
    this.disposed = true
    FakeRuntime.alive--
  }
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('PreviewPool', () => {
  let pool: PreviewPool | undefined
  afterEach(() => {
    pool?.dispose()
    pool = undefined
    FakeRuntime.all = []
    FakeRuntime.alive = 0
    FakeRuntime.maxAlive = 0
    vi.useRealTimers()
  })
  const sketch = fromCode('osc(10).rotate(1).kaleid(3).scale(2).out()\nnoise(3).colorama(0.1).out(o1)\nsrc(o1).modulate(o0).out(o2)\n')
  const specs = () => {
    const a = chainAt(sketch, 0)
    const b = chainAt(sketch, 1)
    return [
      { kind: 'prefix' as const, chainId: a.id, upToCallId: a.mods[0].id },
      { kind: 'prefix' as const, chainId: a.id, upToCallId: a.mods[1].id },
      { kind: 'diff' as const, callId: a.mods[2].id },
      { kind: 'prefix' as const, chainId: b.id },
      { kind: 'diff' as const, callId: b.mods[0].id },
    ]
  }
  const mainRt = new FakeRuntime({})
  FakeRuntime.all = []
  FakeRuntime.alive = 0
  FakeRuntime.maxAlive = 0
  const mk = (extra: Record<string, unknown> = {}) =>
    createPreviewPool({ createRuntime: (_c, o) => new FakeRuntime(o) as unknown as Runtime, mode: 'live', main: () => mainRt as unknown as Runtime, ...extra })

  test('never runs more runtimes than its size; the rest wait and take over as others close', async () => {
    pool = mk({ size: 2 })
    const hs = specs().map((sp) => pool!.open(sp, { sketch, trusted: true }))
    await flush()
    expect(FakeRuntime.alive).toBe(2)
    expect(hs.filter((h) => h.state === 'starting' || h.state === 'running')).toHaveLength(2)
    expect(hs.filter((h) => h.state === 'waiting')).toHaveLength(3)
    hs[4].close()
    hs[3].close()
    await flush()
    expect(FakeRuntime.maxAlive).toBe(2)
    expect(pool.stats.maxRuntimes).toBe(2)
    // the newest wanting previews have the runtimes; closing one hands it on
    const running = hs.filter((h) => h.state === 'starting')
    running[0].close()
    await flush()
    expect(hs.filter((h) => h.state === 'starting')).toHaveLength(2)
    expect(FakeRuntime.maxAlive).toBe(2)
  })

  test('a preview gets the live table, the main time and the plan; a diff captures two outputs', async () => {
    pool = mk({ size: 1 })
    const h = pool.open(specs()[2], { sketch, trusted: true })
    await flush()
    const rt = FakeRuntime.all[0]
    expect(rt.opts.preview).toEqual({ numSources: 8 })
    expect(rt.opts.width).toBe(256)
    expect(rt.opts.height).toBe(144)
    expect(rt.live[0]).toEqual({ x: 1 })
    expect(rt.times).toEqual([12.5])
    expect(rt.runs).toHaveLength(1)
    expect(rt.loops.at(-1)).toMatchObject({ running: true, fps: 15, outputs: [0, 1] })
    const got: number[] = []
    h.onFrame((f) => got.push(f.b ? 2 : 1))
    rt.frame(2)
    expect(got).toEqual([2])
    expect(h.state).toBe('running')
    // live numbers on the main runtime reach the preview
    for (const cb of mainRt.liveCbs) cb({ 'c:0': 3 })
    expect(rt.live.at(-1)).toEqual({ 'c:0': 3 })
  })

  test('chunks reading outputs get copies of the main pictures; without a main runtime they are refused', async () => {
    pool = mk({ size: 1 })
    const c = chainAt(sketch, 2)
    const h = pool.open({ kind: 'prefix', chainId: c.id }, { sketch, trusted: true })
    await flush()
    expect(h.approximate).toBe(true)
    expect(FakeRuntime.all[0].images.map((i) => i.slot).sort()).toEqual(['s4', 's5'])
    pool.dispose()
    pool = createPreviewPool({ createRuntime: (_c, o) => new FakeRuntime(o) as unknown as Runtime, mode: 'live' })
    const r = pool.open({ kind: 'prefix', chainId: c.id }, { sketch, trusted: true })
    expect(r.state).toBe('refused')
    expect(r.reason).toBe("reads o1, which can't be previewed in isolation")
  })

  test('an update with the same sketch right after opening does not leave a cold pool’s preview starting', async () => {
    // PreviewPeek opens a handle and then sends an update in the same tick; every update makes a new plan object
    pool = mk({ size: 1 })
    const h = pool.open(specs()[0], { sketch, trusted: true })
    h.update({ sketch, trusted: true })
    await flush()
    const rt = FakeRuntime.all[0]
    expect(rt.runs).toHaveLength(1)
    expect(rt.loops.at(-1)).toMatchObject({ running: true })
    rt.frame()
    expect(h.state).toBe('running')
  })

  test('nothing runs before the sketch is trusted, while invisible, or with previews off', async () => {
    pool = mk()
    const h = pool.open(specs()[0], { sketch, trusted: false })
    await flush()
    expect(h.state).toBe('untrusted')
    expect(FakeRuntime.alive).toBe(0)
    h.update({ trusted: true })
    await flush()
    expect(h.state).toBe('starting')
    h.setVisible(false)
    expect(h.state).toBe('paused')
    expect(FakeRuntime.all[0].running).toBe(false)
    h.setVisible(true)
    await flush()
    pool.setMode('off')
    expect(h.state).toBe('off')
  })

  test('on demand: one still picture, then the runtime is free; opening it animates; a number change refreshes the still', async () => {
    vi.useFakeTimers()
    pool = mk({ mode: 'demand', size: 1 })
    const [s0, s1] = specs()
    const a = pool.open(s0, { sketch, trusted: true })
    const b = pool.open(s1, { sketch, trusted: true })
    await flush()
    const rt = FakeRuntime.all[0]
    expect(rt.loops.at(-1)).toMatchObject({ running: true, frames: 2 })
    expect([a.state, b.state].sort()).toEqual(['starting', 'waiting'])
    rt.frame()
    vi.advanceTimersByTime(300)
    await flush()
    // the other one gets its still next
    expect([a.state, b.state].filter((x) => x === 'starting')).toHaveLength(1)
    rt.frame()
    vi.advanceTimersByTime(300)
    await flush()
    expect([a.state, b.state]).toEqual(['paused', 'paused'])
    a.setActive(true)
    await flush()
    expect(rt.loops.at(-1)).toMatchObject({ running: true })
    expect(rt.loops.at(-1)!.frames).toBeUndefined()
    a.setActive(false)
    vi.advanceTimersByTime(300)
    await flush()
    for (const cb of mainRt.liveCbs) cb({ 'c:0': 1 })
    vi.advanceTimersByTime(300)
    await flush()
    expect([a.state, b.state].filter((x) => x === 'starting')).toHaveLength(1)
  })

  test('a preview error stays on the preview; the runtimes are disposed after idling', async () => {
    vi.useFakeTimers()
    pool = mk({ size: 1, idleMs: 1000 })
    const h = pool.open(specs()[0], { sketch, trusted: true })
    await flush()
    FakeRuntime.all[0].error('boom')
    expect(h.state).toBe('error')
    expect(h.reason).toBe('boom')
    expect(mainRt.disposed).toBe(false)
    h.close()
    vi.advanceTimersByTime(1500)
    expect(FakeRuntime.all[0].disposed).toBe(true)
    expect(pool.stats.runtimes).toBe(0)
  })

  test('a failed run is reported on the preview', async () => {
    pool = createPreviewPool({
      createRuntime: (_c, o) => {
        const r = new FakeRuntime(o)
        r.runResult = { ok: false, recompiled: true, error: 'nope', skipped: [], ms: 0 }
        return r as unknown as Runtime
      },
      mode: 'live',
    })
    const h = pool.open(specs()[0], { sketch, trusted: true })
    await flush()
    expect(h.state).toBe('error')
    expect(h.reason).toBe('nope')
  })

  test('the preference', () => {
    expect(previewMode()).toBe('demand')
    setPreviewMode('live')
    expect(previewMode()).toBe('live')
    setPreviewMode('demand')
  })
})
