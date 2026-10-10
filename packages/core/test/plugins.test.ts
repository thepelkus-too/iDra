// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createRuntime, ScriptCache, MidiShim, installMemoryStorage, isPinnedScriptUrl, type Runtime } from '../src/runtime'
import { Catalog } from '../src/catalog'
import { importText, fromCode } from '../src/parse'
import { toCode } from '../src/codegen'
import { validate } from '../src/validate'
import {
  pluginRegistry, pluginIdFromUrl, versionFromUrl, PluginStore, findLoadScripts, withPlugin, withoutPlugin, pluginRefFromUrl,
  pluginRefFor, onPluginLoaded, siteBaseUrl,
} from '../src/plugins'
import { MidiHub, midiChip, parseMidiChip, usesMidi, webMidiAvailable, TOUCH_INPUT } from '../src/midi'
import { midiBanner, midiNoteName } from '../src/midi-panel'
import { MockHydra, resetMock } from './helpers/mock-hydra'
import { loopbackTransport, memoryCacheStorage } from './helpers/loopback'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const PLUGIN_SRC = `setFunction({name:'swirl',type:'coord',inputs:[{type:'float',name:'k',default:2}],glsl:'return _st*k;'})
setFunction({name:'pattern',type:'src',inputs:[{type:'vec4',name:'tint',default:[1,0,0,1]},{type:'int',name:'n',default:3}],glsl:'return tint;'})
window.myHelper = (x) => x * 2`

let rt: Runtime | undefined
afterEach(() => {
  rt?.dispose()
  rt = undefined
})
beforeEach(() => resetMock())

const mk = (extra: Record<string, unknown> = {}, log: any[] = []) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const catalog = Catalog.fromHydra()
  rt = createRuntime(container, { catalog, transport: loopbackTransport(log), ...extra } as any)
  return { rt, catalog }
}

describe('registry', () => {
  test('every entry is complete, uses https, and says how it was verified', () => {
    const reg = pluginRegistry()
    expect(reg.length).toBeGreaterThan(5)
    const ids = new Set<string>()
    for (const e of reg) {
      expect(e.id, e.id).toMatch(/^[a-z0-9._-]+$/)
      expect(ids.has(e.id)).toBe(false)
      ids.add(e.id)
      // https, or a file this site serves itself (resolved against the site root) pinned by its SRI
      if (e.integrity) expect(e.url.startsWith(siteBaseUrl()) || /^https:\/\//.test(e.url), e.url).toBe(true)
      else expect(e.url).toMatch(/^https:\/\//)
      expect(e.homepage).toMatch(/^https:\/\//)
      expect(['functions', 'js', 'mixed']).toContain(e.kind)
      expect(['verified', 'unverified']).toContain(e.verified.status)
      expect(e.verified.how.length).toBeGreaterThan(10)
      expect(e.license).toBeTruthy()
    }
    const midi = reg.find((e) => e.id === 'hydra-midi')!
    expect(isPinnedScriptUrl(midi.url)).toBe(true)
  })
  test('ids and versions from URLs', () => {
    expect(pluginIdFromUrl('https://cdn.jsdelivr.net/npm/hydra-midi@0.4.6/dist/index.js')).toBe('hydra-midi')
    expect(pluginIdFromUrl('https://cdn.jsdelivr.net/gh/geikha/hyper-hydra@latest/hydra-blend.js')).toBe('hydra-blend')
    expect(pluginIdFromUrl('https://unpkg.com/@scope/thing@1.0.0/index.js')).toBe('scope-thing')
    expect(pluginIdFromUrl('http://127.0.0.1:8080/hydra-midi@0.4.6/dist/index.js')).toBe('hydra-midi')
    expect(pluginIdFromUrl('https://example.com/e2e-plugin@1.0.0/plugin.js')).toBe('e2e-plugin')
    expect(versionFromUrl('https://cdn.jsdelivr.net/npm/hydra-midi@0.4.6/dist/index.js')).toBe('0.4.6')
    expect(versionFromUrl('https://cdn.jsdelivr.net/gh/geikha/hyper-hydra@latest/hydra-blend.js')).toBe('latest')
    expect(isPinnedScriptUrl('https://cdn.jsdelivr.net/gh/geikha/hyper-hydra@latest/hydra-blend.js')).toBe(false)
    expect(isPinnedScriptUrl('https://example.com/p.js?v=3')).toBe(false)
    expect(isPinnedScriptUrl('https://raw.githubusercontent.com/a/b/0123456789abcdef0123456789abcdef01234567/x.js')).toBe(true)
  })
})

describe('ScriptCache', () => {
  test('pinned URLs are served from the cache without the network; floating URLs revalidate and warn', async () => {
    const cs = memoryCacheStorage()
    let hits = 0
    let body = 'v1'
    let online = true
    const fetch = (async () => {
      if (!online) throw new Error('offline')
      hits++
      return new Response(body)
    }) as unknown as typeof globalThis.fetch
    const pinned = 'https://cdn.example/npm/x@1.2.3/index.js'
    const floating = 'https://cdn.example/npm/x@latest/index.js'
    let c = new ScriptCache({ fetch, cacheStorage: cs })
    expect((await c.get(pinned)).from).toBe('network')
    body = 'v2'
    // a fresh page (new memory) still finds the pinned copy in Cache Storage
    c = new ScriptCache({ fetch, cacheStorage: cs })
    const p2 = await c.get(pinned)
    expect(p2).toMatchObject({ from: 'cache', text: 'v1', latest: false })
    expect(p2.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hits).toBe(1)
    const f1 = await c.get(floating)
    expect(f1).toMatchObject({ from: 'network', text: 'v2', latest: true })
    expect(f1.warning).toMatch(/not pinned/)
    online = false
    expect(await c.get(floating)).toMatchObject({ from: 'cache', text: 'v2' })
    expect(await c.info(pinned)).toMatchObject({ size: 2, latest: false })
    await c.remove(pinned)
    await expect(new ScriptCache({ fetch, cacheStorage: cs }).get(pinned)).rejects.toThrow(/no cached copy/)
  })
})

describe('codegen preamble', () => {
  test('manager plugins add a loadScript line, unless the sketch already has it (byte-identical round trip)', () => {
    const url = 'https://cdn.jsdelivr.net/npm/hydra-midi@0.4.6/dist/index.js'
    const text = `await loadScript('${url}')\nosc(10).out()\n`
    const { sketch } = importText(text)
    const withRef = withPlugin(sketch, pluginRefFromUrl(url))
    expect(toCode(withRef)).toBe(text)
    const plain = withPlugin(fromCode('osc(10).out()'), pluginRefFromUrl(url))
    expect(toCode(plain).startsWith(`await loadScript('${url}')\n\nosc(10)`)).toBe(true)
    const pasted = withPlugin(fromCode('osc(10).out()'), { id: 'p', name: 'Mine', src: 'x()' })
    expect(toCode(pasted)).toMatch(/^\/\/ plugin "Mine" is pasted code/)
    expect(toCode(withoutPlugin(plain, 'hydra-midi'))).toBe(toCode(fromCode('osc(10).out()')))
  })
  test('findLoadScripts lists existing loadScript lines for "Add to plugins"', () => {
    const url = 'https://example.com/a@1.0.0/x.js'
    const { sketch } = importText(`await loadScript("${url}")\nosc().out()`)
    expect(findLoadScripts(sketch)).toEqual([expect.objectContaining({ url, inPlugins: false })])
    expect(findLoadScripts(withPlugin(sketch, pluginRefFromUrl(url)))[0].inPlugins).toBe(true)
  })
})

describe('PluginStore', () => {
  test('preview shows URL, size, version, hash and pinning; install and record', async () => {
    const url = 'https://cdn.example/npm/demo@2.0.1/demo.js'
    const cache = new ScriptCache({ fetch: (async () => new Response(PLUGIN_SRC)) as any, cacheStorage: memoryCacheStorage() })
    const store = new PluginStore({ cache, indexedDB: indexedDB })
    const p = await store.preview(url)
    expect(p).toMatchObject({ id: 'demo', url, size: PLUGIN_SRC.length, version: '2.0.1', pinned: true, from: 'network' })
    expect(p.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(p.integrity).toMatch(/^sha256-/)
    await expect(store.preview('javascript:alert(1)')).rejects.toThrow()
    const rec = await store.install(p)
    await store.record(rec.id, { functions: ['swirl'], globals: ['myHelper'] })
    const got = await store.get('demo')
    expect(got).toMatchObject({ functions: ['swirl'], globals: ['myHelper'], pinned: true })
    expect(pluginRefFor(got!)).toMatchObject({ id: 'demo', url, integrity: p.integrity, version: '2.0.1' })
    const pasted = await store.previewSource('setFunction({})', 'My Thing')
    expect(pasted).toMatchObject({ id: 'pasted-my-thing', from: 'pasted' })
    await store.install(pasted)
    expect((await store.list()).map((x) => x.id)).toEqual(['demo', 'pasted-my-thing'])
    await store.remove('demo')
    expect((await store.list()).length).toBe(1)
  })
})

describe('runtime plugins (loopback frame)', () => {
  test('a plugin adds functions (int/vec4 inputs), globals, catalog origin plugin:<id>; unknown calls upgrade', async () => {
    const { rt, catalog } = mk()
    const text = 'pattern([0,1,0,1], 4).swirl(3).out()\n'
    const { sketch } = importText(text)
    expect(validate(sketch, catalog).filter((p) => p.code === 'unknown-function').length).toBe(2)
    const events: any[] = []
    const off = onPluginLoaded((e) => events.push(e))
    const res = await rt.loadPlugin({ id: 'demo', name: 'Demo', src: PLUGIN_SRC })
    off()
    expect(res.ok).toBe(true)
    expect(res.delta.map((d) => d.name).sort()).toEqual(['pattern', 'swirl'])
    expect(res.globals).toContain('myHelper')
    expect(catalog.get('swirl')?.origin).toBe('plugin:demo')
    expect(catalog.get('pattern')?.inputs.map((i) => i.type)).toEqual(['vec4', 'int'])
    expect(events[0]).toMatchObject({ id: 'demo', functions: expect.arrayContaining(['swirl']) })
    expect(validate(sketch, catalog).filter((p) => p.code === 'unknown-function')).toEqual([])
    expect(toCode(sketch)).toBe(text)
    expect((await rt.run(sketch)).ok).toBe(true)
  })

  test('replacing a built-in warns; a failing plugin is reported with its URL and the sketch keeps running', async () => {
    const fetch = (async (u: string) => (String(u).includes('bad') ? new Response('nope', { status: 404 }) : new Response(''))) as any
    const { rt, catalog } = mk({ scriptCache: new ScriptCache({ fetch, cacheStorage: undefined }) })
    const errs: string[] = []
    rt.onError((e) => errs.push(e.message))
    const r = await rt.loadPlugin({ id: 'evil', name: 'Evil', src: `setFunction({name:'osc',type:'src',inputs:[],glsl:'return vec4(1.);'})` })
    expect(r.shadows).toEqual(['osc'])
    expect(errs.join('\n')).toMatch(/plugin evil replaces the built-in function "osc"/)
    expect(catalog.get('osc')?.origin).toBe('plugin:evil')
    const sk = withPlugin(fromCode('noise(3).out()'), { id: 'bad', name: 'Bad', url: 'https://example.com/bad@1.0.0/x.js' })
    const run = await rt.run(sk)
    expect(run.ok).toBe(true)
    expect(errs.join('\n')).toMatch(/plugin "Bad" \(https:\/\/example.com\/bad@1.0.0\/x.js\) did not load: .*404/)
  })

  test('a changed plugin fails its integrity check', async () => {
    const { rt } = mk()
    const r = await rt.loadPlugin({ id: 'x', name: 'X', src: 'window.a1 = 1', integrity: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/integrity/)
  })

  test('sketch.plugins load in order before the code, and the loadScript line for the same URL is not fetched twice', async () => {
    let fetches = 0
    const url = 'https://example.com/demo@1.0.0/demo.js'
    const fetch = (async () => (fetches++, new Response(PLUGIN_SRC))) as any
    const { rt, catalog } = mk({ scriptCache: new ScriptCache({ fetch, cacheStorage: undefined }) })
    const { sketch } = importText(`await loadScript('${url}')\nosc().swirl(2).out()`)
    const sk = withPlugin(sketch, pluginRefFromUrl(url))
    const errs: string[] = []
    rt.onError((e) => errs.push(e.message))
    const r = await rt.run(sk)
    expect(r.ok).toBe(true)
    expect(catalog.get('swirl')?.origin).toBe('plugin:demo')
    expect(fetches).toBe(1)
    expect(errs).toEqual([])
  })

  test('top-level await works in plugin code', async () => {
    const { rt } = mk()
    const r = await rt.loadPlugin({ id: 'a', name: 'A', src: `await new Promise((r) => setTimeout(r, 5)); setFunction({name:'later',type:'color',inputs:[],glsl:'return _c0;'})` })
    expect(r.ok).toBe(true)
    expect(r.delta.map((d) => d.name)).toEqual(['later'])
  })

  test('@latest warns once per URL', async () => {
    const fetch = (async () => new Response('window.x1 = 1')) as any
    const { rt } = mk({ scriptCache: new ScriptCache({ fetch, cacheStorage: undefined }) })
    const errs: string[] = []
    rt.onError((e) => e.kind === 'warning' && errs.push(e.message))
    const ref = { id: 'l', name: 'L', url: 'https://example.com/gh/u/r@latest/l.js' }
    expect((await rt.loadPlugin(ref)).warning).toMatch(/not pinned/)
    await rt.loadPlugin({ ...ref, id: 'l2' })
    expect(errs.filter((e) => /not pinned/.test(e)).length).toBe(1)
  })

  test('inline mode (no isolation) refuses plugins instead of running them in the host page', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    rt = createRuntime(container, { isolation: 'inline', hydraLoader: async () => MockHydra as any, catalog: Catalog.fromHydra() })
    const r = await rt.loadPlugin({ id: 'x', name: 'X', src: 'window.__ranInHost = true' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/sandboxed/)
    expect((window as any).__ranInHost).toBeUndefined()
  })
})

describe('MIDI', () => {
  test('midiChip / parseMidiChip round trip, and the text form parses back to the same value', () => {
    const specs = [
      { kind: 'cc', index: 1 },
      { kind: 'cc', index: 7, channel: 2, min: 0, max: 4 },
      { kind: 'note', index: 'C3', channel: '*' },
    ] as const
    for (const s of specs) {
      const v = midiChip(s as any)
      expect(parseMidiChip(v)).toEqual(s)
      const { sketch } = importText(`osc(${v.k === 'js' ? v.src : ''}).out()`)
      const st = sketch.stmts[0] as any
      expect(st.chain.gen.args[0]).toEqual(v)
    }
    expect(midiChip({ kind: 'cc', index: 1, min: 0, max: 1 })).toEqual({ k: 'js', src: 'cc(1).range(0, 1)' })
    expect(parseMidiChip({ k: 'js', src: 'cc(1) + 1' })).toBeUndefined()
  })

  test('usesMidi and the banner', () => {
    expect(usesMidi(fromCode('osc(cc(1)).out()'))).toBe(true)
    expect(usesMidi(fromCode('await midi.start()\nosc().out()'))).toBe(true)
    expect(usesMidi(fromCode('osc(10).out()'))).toBe(false)
    expect(usesMidi(withPlugin(fromCode('osc().out()'), pluginRefFromUrl('https://cdn.jsdelivr.net/npm/hydra-midi@0.4.6/dist/index.js')))).toBe(true)
    expect(webMidiAvailable({})).toBe(false)
    const b = midiBanner(fromCode('osc(cc(1)).out()'), { diagnosticsUrl: '/harness/?tab=diag' })!
    expect(b.textContent).toMatch(/Web MIDI isn’t available in this browser, so MIDI inputs won’t respond/)
    expect(b.querySelector('a')!.getAttribute('href')).toBe('/harness/?tab=diag')
    expect(midiBanner(fromCode('osc().out()'))).toBeNull()
    expect(midiNoteName(60)).toBe('C4')
    expect(midiNoteName(48)).toBe('C3')
  })

  test('MidiHub bytes', () => {
    const hub = new MidiHub({})
    expect(hub.webMidi).toBe('unavailable')
    const got: Array<[string, number[]]> = []
    hub.onMessage((i, d) => got.push([i, d]))
    hub.cc(1, 1, 2)
    hub.noteOn(60, 0.5)
    hub.noteOff(60)
    expect(got).toEqual([
      ['hydra-touch', [0xb2, 1, 127]],
      ['hydra-touch', [0x90, 60, 64]],
      ['hydra-touch', [0x80, 60, 0]],
    ])
    expect(hub.inputs()).toEqual([TOUCH_INPUT])
  })

  test('the runtime forwards hub inputs and messages to the frame', async () => {
    const hub = new MidiHub({})
    const log: any[] = []
    const { rt } = mk({ midi: hub }, log)
    await rt.ready
    hub.cc(3, 0.5)
    await tick(5)
    expect(log.some((l) => l.dir === 'h2f' && l.msg.t === 'midi' && l.msg.data.join() === [0xb0, 3, 64].join())).toBe(true)
  })

  test('the vendored hydra-midi 0.4.6 reads CCs and notes through the shim', async () => {
    const shim = new MidiShim(window, { install: true })
    expect(webMidiAvailable()).toBe(false) // the shim is never counted as real Web MIDI
    installMemoryStorage(window)
    const src = readFileSync(resolve(__dirname, '../../../scripts/fixtures/hydra-midi/index.js'), 'utf8')
    new Function(src)()
    const w = window as any
    shim.setInputs([TOUCH_INPUT])
    await w.midi.start({ input: '*', channel: '*' })
    await tick(10)
    shim.receive('hydra-touch', [0xb0, 1, 127])
    shim.receive('hydra-touch', [0x90, 60, 100])
    expect(w.cc(1)()).toBeCloseTo(1)
    expect(w.cc(1).range(0, 4)()).toBeCloseTo(4)
    expect(w.note(60)()).toBe(1)
    shim.receive('hydra-touch', [0x80, 60, 0])
    expect(w.note(60)()).toBe(0)
    shim.dispose()
    delete (navigator as any).requestMIDIAccess
  })
})
