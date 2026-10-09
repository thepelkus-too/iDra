// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createRuntime, Bridge, ScriptCache, type Runtime, type RuntimeTransport, type FrameToHost, type HostToFrame } from '../src/runtime'
import { importText, fromCode } from '../src/parse'
import { toCode } from '../src/codegen'
import { Catalog } from '../src/catalog'
import { validate } from '../src/validate'
import { corpus } from '../src/corpus'
import { setArg, walkCalls, num, type Sketch } from '../src/ir'
import { MockHydra, resetMock } from './helpers/mock-hydra'

/**
 * A custom transport that stands in for the iframe: the Bridge sits behind two structured-clone hops and is reachable ONLY through
 * messages, exactly like the real frame. Each message is also asserted to be plain cloneable data. (Real-iframe behaviour is covered by
 * scripts/e2e.mjs in Chromium.)
 */
function loopbackTransport(log: Array<{ dir: 'h2f' | 'f2h'; msg: any }>) {
  return (container: HTMLElement): RuntimeTransport => {
    let cb: (m: FrameToHost) => void = () => {}
    let bridge: Bridge | undefined
    const later = (f: () => void) => setTimeout(f, 0)
    bridge = new Bridge({
      win: window,
      container,
      post: (m) => later(() => { log.push({ dir: 'f2h', msg: m }); cb(structuredClone(m)) }),
      Hydra: MockHydra as any,
    })
    return {
      send: (m: HostToFrame) => later(() => { log.push({ dir: 'h2f', msg: m }); bridge!.handle(structuredClone(m)) }),
      onMessage: (f) => (cb = f),
      dispose: () => bridge?.dispose(),
    }
  }
}

let MODE: 'inline' | 'loopback' = 'inline'
let MSG_LOG: Array<{ dir: 'h2f' | 'f2h'; msg: any }> = []
const mk = (extra: Record<string, unknown> = {}) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const catalog = Catalog.fromHydra()
  MSG_LOG = []
  // inline mode refuses plugins by default (they never run in the host page); these tests opt in to exercise the bridge
  const opts: any = MODE === 'inline' ? { isolation: 'inline', hydraLoader: async () => MockHydra, pluginsInHostPage: true } : { transport: loopbackTransport(MSG_LOG) }
  const rt = createRuntime(container, { catalog, ...opts, ...extra } as any)
  return { rt, catalog, container }
}
const hydra = () => MockHydra.instances[MockHydra.instances.length - 1]
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

let rt: Runtime
let catalog: Catalog
beforeEach(() => {
  resetMock()
  ;(window as any).__hl = {}
})
afterEach(() => rt?.dispose())

describe.each(['inline', 'loopback'] as const)('runtime (%s transport, real generator + sandbox, no GL)', (mode) => {
  beforeEach(() => {
    MODE = mode
    for (const k of ['__ran', '__loaded']) delete (window as any)[k]
  })
  test('runs a sketch and compiles a shader', async () => {
    ;({ rt, catalog } = mk())
    await rt.ready
    const r = await rt.run(fromCode('osc(20, 0.1, 0.8).rotate(0.5).out()'))
    expect(r.ok).toBe(true)
    expect(r.recompiled).toBe(true)
    expect(hydra().o[0].passes?.[0].frag).toContain('osc')
  })

  test('changing only numbers does not recompile; the live table carries the value', async () => {
    ;({ rt } = mk())
    let sk = fromCode('osc(20, 0.1, 0.8).rotate(0.5).out()')
    await rt.run(sk)
    const before = hydra().o[0].renders
    const rotate = [...walkCalls(sk)].find((x) => x.call.fn === 'rotate')!.call
    sk = setArg(sk, rotate.id, 0, num(1.25))
    const r = await rt.run(sk)
    expect(r.recompiled).toBe(false)
    await tick(160)
    expect(hydra().o[0].renders).toBe(before) // shader untouched
    expect(Object.values(hydra().frame(0)!.values)).toContain(1.25) // …but the closure now returns the new number
    expect(rt.stats.recompiles).toBe(1)
  })

  test('a structural edit recompiles', async () => {
    ;({ rt } = mk())
    const sk = fromCode('osc(20).rotate(0.5).out()')
    await rt.run(sk)
    const r = await rt.run(fromCode('osc(20).rotate(0.5).kaleid(4).out()'))
    expect(r.recompiled).toBe(true)
    expect(rt.stats.recompiles).toBe(2)
  })

  test('run() calls in one frame are debounced into a single evaluation', async () => {
    ;({ rt } = mk())
    await rt.ready
    const ps = [1, 2, 3, 4, 5].map((n) => rt.run(fromCode(`osc(${n * 10}).out()`)))
    const results = await Promise.all(ps)
    expect(rt.stats.runs).toBe(1)
    expect(results.every((r) => r.ok)).toBe(true)
    expect(hydra().o[0].passes?.[0].frag).toBeDefined()
  })

  test('setLive is fire-and-forget and coalesced to one message per frame', async () => {
    ;({ rt } = mk())
    await rt.run(fromCode('osc(20).rotate(0.5).out()'))
    const id = Object.keys((window as any).__hl).find((k) => k.endsWith(':0') && (window as any).__hl[k] === 0.5)!
    expect(id).toBeDefined()
    const sent = rt.stats.liveMessages
    for (let i = 0; i < 200; i++) rt.setLive(id, i / 100)
    await tick(200)
    expect(rt.stats.liveMessages - sent).toBe(1)
    expect((window as any).__hl[id]).toBeCloseTo(1.99)
  })

  test('errors are surfaced through onError, never thrown', async () => {
    ;({ rt } = mk())
    const seen: string[] = []
    rt.onError((e) => seen.push(e.kind + ':' + e.message))
    const r = await rt.run(fromCode('osc(10).out()\nthrow new Error("boom")'))
    expect(r.ok).toBe(false)
    await tick(10)
    expect(seen.some((s) => s.startsWith('eval:') && s.includes('boom'))).toBe(true)
  })

  test('shader compile warnings reach onError', async () => {
    ;({ rt } = mk())
    const seen: string[] = []
    rt.onError((e) => seen.push(e.kind))
    await rt.run(fromCode('osc(10).sum([1,1,1,1]).out()'))
    await tick(20)
    expect(seen).toContain('shader')
  })

  test('safe mode skips raw code and unsafe expressions', async () => {
    ;({ rt } = mk())
    const sk = fromCode('window.__ran = 1\nosc(() => fetch("/x") && 1).out()\nosc(() => Math.sin(time)).out(o1)')
    const r = await rt.run(sk, { safe: true })
    expect(r.ok).toBe(true)
    expect((window as any).__ran).toBeUndefined()
    expect(r.skipped.length).toBeGreaterThan(0)
    const full = await rt.run(sk, { safe: false })
    expect(full.ok).toBe(true)
    expect((window as any).__ran).toBe(1)
  })

  test('unchanged sources are not re-initialised on the next run', async () => {
    ;({ rt } = mk())
    await rt.run(fromCode('s0.initCam(0)\nsrc(s0).out()'))
    await rt.run(fromCode('s0.initCam(0)\nsrc(s0).kaleid(3).out()'))
    const cams = hydra().s[0].log.filter((l: any[]) => l[0] === 'cam')
    expect(cams).toHaveLength(1)
    await rt.run(fromCode('s0.initCam(1)\nsrc(s0).out()'))
    expect(hydra().s[0].log.filter((l: any[]) => l[0] === 'cam')).toHaveLength(2)
  })

  test('time(), screenshot() and setResolution() round-trip through messages', async () => {
    ;({ rt } = mk())
    await rt.ready
    expect(typeof (await rt.time())).toBe('number')
    expect(await rt.screenshot()).toMatch(/^data:/)
    await rt.setResolution(640, 360)
    expect(hydra().width).toBe(640)
  })

  test('plugins register functions: catalog gains them under plugin:<id>, and unknown calls upgrade', async () => {
    ;({ rt, catalog } = mk())
    const text = 'foo(3).bar(2).out()\n'
    const { sketch } = importText(text)
    // unknown today
    let problems = validate(sketch, catalog)
    expect(problems.filter((p) => p.code === 'unknown-function').length).toBe(2)
    // byte-identical round trip while unknown
    expect(toCode(sketch)).toBe(text)
    const changes: string[][] = []
    catalog.subscribe((c) => changes.push(c.added))
    const res = await rt.loadPlugin({
      id: 'demo',
      name: 'Demo',
      src: `setFunction({name:'foo',type:'src',inputs:[{type:'float',name:'n',default:1}],glsl:'return vec4(n);'});
            setFunction({name:'bar',type:'coord',inputs:[{type:'float',name:'k',default:2}],glsl:'return _st*k;'})`,
    })
    expect(res.ok).toBe(true)
    expect(res.delta.map((d) => d.name)).toEqual(['foo', 'bar'])
    expect(catalog.get('foo')?.origin).toBe('plugin:demo')
    expect(catalog.get('bar')?.type).toBe('coord')
    expect(changes.flat()).toEqual(expect.arrayContaining(['foo', 'bar']))
    problems = validate(sketch, catalog)
    expect(problems.filter((p) => p.code === 'unknown-function')).toEqual([])
    expect(toCode(sketch)).toBe(text)
    const r = await rt.run(sketch)
    expect(r.ok).toBe(true)
    expect(hydra().o[0].passes?.[0].frag).toContain('foo')
    expect((await rt.getCatalogDelta()).length).toBe(2)
  })

  test('loadScript is served through the host script cache (and from cache when offline)', async () => {
    let online = true
    const fetchStub = (async (url: string) => {
      if (!online) throw new Error('offline')
      return new Response(`window.__loaded = (window.__loaded || 0) + 1; setFunction({name:'zap',type:'color',inputs:[],glsl:'return _c0;'})`)
    }) as unknown as typeof fetch
    ;({ rt, catalog } = mk({ scriptCache: new ScriptCache({ fetch: fetchStub, cacheStorage: undefined }) }))
    const sk = fromCode("await loadScript('https://example.com/p.js')\nosc(10).zap().out()")
    expect((await rt.run(sk)).ok).toBe(true)
    expect((window as any).__loaded).toBe(1)
    expect(catalog.get('zap')).toBeDefined()
    online = false
    await rt.run(sk, { force: true })
    expect((window as any).__loaded).toBe(2) // served from the cache
  })

  test('audio frames fed by the host drive the sketch-side `a` object with Hydra semantics', async () => {
    const listeners: Array<(f: any) => void> = []
    const engine: any = {
      settings: { bins: 4, cutoff: 2, scale: 10, smooth: 0 },
      onFrame: (cb: any) => (listeners.push(cb), () => {}),
      onSettings: () => () => {},
      setSettings: () => {},
    }
    ;({ rt } = mk({ audio: engine }))
    await rt.run(fromCode('osc(() => a.fft[0] * 10, 0.1).out()'))
    const specific = Array.from({ length: 24 }, (_, i) => (i < 6 ? 8 : 0))
    listeners.forEach((l) => l({ vol: 5, specific }))
    await tick(10)
    const a = (window as any).a
    // bin 0 = sum of first 6 Bark bands = 48; smooth 0 → (48 - cutoff 2) / scale 10 = 4.6
    expect(a.fft[0]).toBeCloseTo(4.6)
    expect(typeof (window as any).a0).toBe('function')
    expect((window as any).a0(2, 1)()).toBeCloseTo(4.6 * 2 + 1)
  })

  test('the whole corpus runs through the runtime without a rejected promise or an uncaught error', async () => {
    ;({ rt } = mk())
    const uncaught: unknown[] = []
    const onErr = (e: ErrorEvent) => uncaught.push(e.error)
    window.addEventListener('error', onErr)
    for (const entry of corpus) {
      const sketch: Sketch = importText(entry.code).sketch
      const r = await rt.run(sketch, { safe: true })
      expect(r, entry.name).toHaveProperty('ok')
    }
    window.removeEventListener('error', onErr)
    expect(uncaught).toEqual([])
  })

  test('hush clears outputs and forgets the compiled state', async () => {
    ;({ rt } = mk())
    await rt.run(fromCode('osc(10).out()'))
    await rt.hush()
    const r = await rt.run(fromCode('osc(10).out()'))
    expect(r.recompiled).toBe(true)
  })

  test('setMouse drives Hydra\'s getter-only mouse without throwing', async () => {
    ;({ rt } = mk())
    const seen: string[] = []
    rt.onError((e) => seen.push(e.message))
    await rt.run(fromCode('osc(() => mouse.x / 100).out()'))
    rt.setMouse(42, 7)
    rt.setMouse(50, 9)
    await tick(50)
    expect((window as any).mouse.x).toBe(50)
    expect(hydra().synth.mouse.y).toBe(9)
    expect(seen).toEqual([])
  })

  test('boundary: every message is plain data, the frame is only reachable through messages', async () => {
    if (mode === 'inline') return // the log is recorded by the loopback transport
    ;({ rt } = mk())
    await rt.run(fromCode('osc(10).rotate(1).out()'))
    rt.setLive('x', 1)
    await tick(200)
    const kinds = new Set(MSG_LOG.map((m) => `${m.dir}:${m.msg.t}`))
    for (const k of ['h2f:init', 'h2f:run', 'f2h:ready', 'f2h:result']) expect(kinds.has(k), k).toBe(true)
    for (const { msg } of MSG_LOG) expect(() => structuredClone(msg)).not.toThrow()
    // a function can never cross: the host cannot smuggle behaviour into the frame
    expect(() => structuredClone({ t: 'live', table: { a: () => 1 } })).toThrow()
  })
})
