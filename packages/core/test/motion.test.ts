// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createRuntime, type Runtime } from '../src/runtime'
import { Catalog, catalog as defaultCatalog } from '../src/catalog'
import { importText } from '../src/parse'
import { toCode, toRunnable } from '../src/codegen'
import { describe as describeSketch } from '../src/analyze'
import { chainStmt, makeCall, makeChain, newSketch, num, setArg, type Sketch } from '../src/ir'
import { corpus } from '../src/corpus'
import { pluginRegistry } from '../src/plugins'
import {
  compat, exportWithPrelude, findMotionPlugin, knobArg, knobDef, knobDefs, motionPluginRef, motionPrelude, mountCompatBadge,
  MOTION_PLUGIN_ID, parseKnobDef, splitPrelude, withMotion,
} from '../src/motion'
import { sriSync } from '../src/sha256'
import { MockHydra, resetMock } from './helpers/mock-hydra'
import { loopbackTransport } from './helpers/loopback'

// The plugin exactly as the site serves it: the package's built file (its public surface), found the way any dependency is.
const req = createRequire(import.meta.url)
const motionDir = dirname(req.resolve('hydra-motion/package.json'))
const MOTION_SRC = readFileSync(resolve(motionDir, 'dist/hydra-motion.js'), 'utf8')
const MOTION_VERSION = JSON.parse(readFileSync(resolve(motionDir, 'package.json'), 'utf8')).version
const pastedMotion = () => ({ id: MOTION_PLUGIN_ID, name: 'hydra-motion', src: MOTION_SRC, integrity: sriSync(MOTION_SRC), version: MOTION_VERSION })

const knobSketch = (): Sketch => {
  const s = newSketch('knob test', [knobDef('k', 0.5)])
  const call = makeCall('osc', [num(10), num(0.1), num(0.8)])
  s.stmts.push(chainStmt(makeChain(call, [], 'o0')))
  return setArg(s, call.id, 2, knobArg('k'))
}

describe('the registry entry and the built file', () => {
  test('registry pins the built file by version and SRI, with the MIT licence', () => {
    const e = pluginRegistry().find((x) => x.id === MOTION_PLUGIN_ID)!
    expect(e.license).toBe('MIT')
    expect(e.version).toBe(MOTION_VERSION)
    expect(e.integrity).toBe('sha256-' + createHash('sha256').update(MOTION_SRC).digest('base64'))
    expect(e.url).toMatch(new RegExp(`/plugins/hydra-motion@${MOTION_VERSION.replace(/\./g, '\\.')}/hydra-motion\\.js$`))
    const ref = motionPluginRef()
    expect(ref).toMatchObject({ id: 'hydra-motion', url: e.url, integrity: e.integrity, version: MOTION_VERSION })
  })
  test('sriSync matches WebCrypto/Node for ASCII and UTF-8 text', () => {
    for (const t of ['', 'abc', MOTION_SRC, 'é → ü · 🎛️'.repeat(40)]) expect(sriSync(t)).toBe('sha256-' + createHash('sha256').update(t).digest('base64'))
  })
  test('its global names collide with nothing in Hydra or the curated plugins', () => {
    for (const n of ['knob', 'gate', 'hydraMotion']) {
      expect(defaultCatalog.get(n), n).toBeUndefined()
      for (const e of pluginRegistry().filter((x) => x.id !== MOTION_PLUGIN_ID)) expect(e.description, e.id).not.toMatch(new RegExp(`\\b${n}\\(`))
    }
    // hydra-midi (the only JS-globals plugin we have a copy of) defines none of them
    const midi = readFileSync(resolve(__dirname, '../../../scripts/fixtures/hydra-midi/index.js'), 'utf8')
    expect(midi).not.toMatch(/window\.(knob|gate|hydraMotion)\b|\b(knob|gate|hydraMotion):/)
  })
})

describe('knobs in the IR', () => {
  test('knobDef / parseKnobDef / knobArg, and codegen ↔ import round-trip', () => {
    const d = knobDef('k', 0.5)
    expect(d).toMatchObject({ k: 'def', name: 'k', decl: 'bare', value: { k: 'js', src: 'knob(0.5)' } })
    expect(parseKnobDef(d)).toEqual({ name: 'k', initial: 0.5, decl: 'bare' })
    expect(() => knobDef('not a name', 1)).toThrow()
    const s = knobSketch()
    const code = toCode(s)
    expect(code).toBe('k = knob(0.5)\n\nosc(10, 0.1, k).out()\n')
    const back = importText(code).sketch
    expect(knobDefs(back)).toEqual([{ stmtId: back.stmts[0].id, name: 'k', initial: 0.5, decl: 'bare' }])
    const chain = back.stmts.find((x) => x.k === 'chain')!
    expect(chain.k === 'chain' && chain.chain.gen.args[2]).toEqual({ k: 'var', name: 'k' })
    expect(toCode(back)).toBe(code)
    // other spellings a person might type
    for (const t of ['const k = knob(-2.5e-1)\n', 'var k = knob(.5)\n', 'k = knob( 3 )\n']) {
      const sk = importText(t).sketch
      expect(knobDefs(sk).length, t).toBe(1)
      expect(toCode(sk)).toBe(t)
    }
    expect(knobDefs(importText('k = knob(0.5, { clock: "wall" })\n').sketch)).toEqual([]) // not the plain form: left as code
  })
  test('safe mode skips the plugin and runs knobs as their initial numbers', () => {
    const s = withMotion(knobSketch())
    const r = toRunnable(s, { safe: true })
    expect(r.code).toMatch(/^k = 0\.5$/m)
    expect(r.skipped.map((x) => x.reason).join()).toMatch(/knob/)
    expect(toRunnable(s).code).toMatch(/^k = knob\(0\.5\)$/m)
  })
})

describe('self-contained export (inlined plugin)', () => {
  test('exportWithPrelude inlines the plugin between delimiters with name, version, hash and MIT notice', async () => {
    const s = withMotion(knobSketch())
    expect(toCode(s)).toMatch(/^await loadScript\('.*hydra-motion@.*'\)\n/)
    const text = await exportWithPrelude(s, { source: MOTION_SRC })
    const lines = text.split('\n')
    expect(lines[0]).toBe(`// ---- hydra-motion ${MOTION_VERSION} · ${sriSync(MOTION_SRC)} · MIT · inlined plugin, do not edit ----`)
    expect(text).toContain(MOTION_SRC)
    expect(text).toContain(`// ---- end hydra-motion ${MOTION_VERSION} ----\nk = knob(0.5)`)
    expect(text).toMatch(/Permission is hereby granted/)
    expect(text).not.toMatch(/loadScript/)
    // no licence stamped on the sketch itself
    expect(text.slice(text.indexOf('// ---- end'))).not.toMatch(/licen[cs]e|MIT/i)
  })
  test('the importer recognises the block as the plugin; re-import does not duplicate it; untouched export is byte-identical', async () => {
    const text = await exportWithPrelude(withMotion(knobSketch()), { source: MOTION_SRC })
    const imp = importText(text)
    expect(imp.sketch.stmts.some((x) => x.k === 'raw')).toBe(false)
    expect(imp.sketch.plugins).toEqual([motionPluginRef()]) // the registry's own build
    expect(knobDefs(imp.sketch).length).toBe(1)
    expect(toCode(imp.sketch)).toBe(text)
    expect(await exportWithPrelude(imp.sketch)).toBe(text) // idempotent, needs no network
    const again = importText(toCode(imp.sketch))
    expect(again.sketch.plugins?.length).toBe(1)
    expect(toCode(again.sketch)).toBe(text)
    // runtime code never contains the block (the plugin is loaded as a plugin)
    expect(toRunnable(imp.sketch).code).not.toContain('hydra-motion')
  })
  test('a block from another build imports as that code (pasted plugin); an edited block is just code', () => {
    const other = MOTION_SRC.replace('hydra-motion v', 'hydra-motion  v')
    const text = motionPrelude(other, '9.9.9') + 'k = knob(1)\nosc(k).out()\n'
    const imp = importText(text).sketch
    expect(findMotionPlugin(imp)).toMatchObject({ id: MOTION_PLUGIN_ID, src: other, version: '9.9.9', integrity: sriSync(other) })
    expect(toCode(imp)).toBe(text)
    const edited = text.replace('MIT License', 'MIT Licence')
    expect(splitPrelude(edited)).toBeUndefined()
    const e = importText(edited).sketch
    expect(e.plugins).toBeUndefined()
    expect(toCode(e)).toBe(edited)
  })
  test('removing the plugin drops the block from the export', async () => {
    const text = await exportWithPrelude(withMotion(knobSketch()), { source: MOTION_SRC })
    const imp = importText(text).sketch
    const without = { ...imp, plugins: [] }
    expect(toCode(without).startsWith('k = knob(0.5)')).toBe(true)
  })
  test('untouched imports of the corpus still export byte for byte', () => {
    for (const c of corpus) expect(toCode(importText(c.code).sketch), c.name).toBe(c.code)
  })
})

describe('compat', () => {
  const plain = importText('osc(10).out()\n').sketch
  test('levels and reasons', async () => {
    expect(compat(plain)).toEqual({ vanilla: 'yes', needs: [], reasons: [] })
    const withPlugin = withMotion(knobSketch())
    const c = compat(withPlugin)
    expect(c.vanilla).toBe('with-plugin')
    expect(c.needs).toEqual([motionPluginRef().url])
    const inlined = importText(await exportWithPrelude(withPlugin, { source: MOTION_SRC })).sketch
    expect(compat(inlined).vanilla).toBe('yes')
    expect(compat({ ...plain, plugins: [{ id: 'pasted-x', name: 'x', src: 'window.x = 1' }] }).vanilla).toBe('no')
    expect(compat(knobSketch())).toMatchObject({ vanilla: 'with-plugin', reasons: [expect.stringMatching(/does not load hydra-motion/)] })
    const audio = importText('osc(() => a.fft[0] * 20).out()\n').sketch
    expect(compat(audio, { audioSource: 'mic' }).vanilla).toBe('yes')
    expect(compat(audio, { audioSource: 'file' })).toMatchObject({ vanilla: 'no', reasons: [expect.stringMatching(/audio file/)] })
    const loads = importText("await loadScript('https://cdn.jsdelivr.net/npm/hydra-midi@0.4.6/dist/index.js')\nosc().out()\n").sketch
    expect(compat(loads)).toMatchObject({ vanilla: 'with-plugin', needs: ['https://cdn.jsdelivr.net/npm/hydra-midi@0.4.6/dist/index.js'] })
    expect(describeSketch(withPlugin).compat.vanilla).toBe('with-plugin')
  })
  test('mountCompatBadge shows the level and updates', () => {
    const host = document.createElement('div')
    const b = mountCompatBadge(host, plain)
    expect(host.textContent).toContain('Plain Hydra')
    b.update(withMotion(knobSketch()))
    expect(b.element.dataset.level).toBe('with-plugin')
    expect(host.textContent).toContain('hydra-motion@')
    b.update(importText('osc(() => a.fft[0]).out()\n').sketch)
    const c = mountCompatBadge(host, importText('osc(() => a.fft[0]).out()\n').sketch, { audio: { source: { kind: 'stream' } } })
    expect(c.element.textContent).toContain('Needs iDra')
    b.destroy()
    c.destroy()
    expect(host.children.length).toBe(0)
  })
})

describe.each(['inline', 'loopback'] as const)('runtime.invoke (%s transport, real plugin file, mock Hydra)', (mode) => {
  let rt: Runtime
  let errors: string[]
  beforeEach(() => {
    resetMock()
    for (const k of ['knob', 'gate', 'hydraMotion', 'k', 'p']) delete (window as any)[k]
    ;(window as any).__hl = {}
    const container = document.createElement('div')
    document.body.appendChild(container)
    const opts: any = mode === 'inline' ? { isolation: 'inline', hydraLoader: async () => MockHydra, pluginsInHostPage: true } : { transport: loopbackTransport() }
    rt = createRuntime(container, { catalog: Catalog.fromHydra(), midi: null, ...opts })
    errors = []
    rt.onError((e) => errors.push(`${e.kind}: ${e.message}`))
  })
  afterEach(() => rt.dispose())
  const hydra = () => MockHydra.instances[MockHydra.instances.length - 1]
  const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))
  const sketch = () => ({ ...knobSketch(), plugins: [pastedMotion()] })

  test('hold / release reach the knob the sketch rendered with', async () => {
    const r = await rt.run(sketch())
    expect(r.ok).toBe(true)
    const k = (window as any).k
    expect((window as any).hydraMotion.isKnob(k)).toBe(true)
    const uniformValue = () => { const v = hydra().frame(0)!.values; return v[Object.keys(v).find((n) => /offset/.test(n))!] }
    expect(uniformValue()).toBe(0.5)
    expect(rt.invoke('k', 'hold', [0.9, 0, 'linear', 'A'])).toBe(true)
    await tick()
    expect(k()).toBe(0.9)
    expect(uniformValue()).toBe(0.9)
    rt.invoke('k', 'release', [0, 'linear', 'A'])
    await tick()
    expect(k()).toBe(0.5)
    expect(errors).toEqual([])
  })

  test('calls arrive in order and are never coalesced', async () => {
    await rt.run(sketch())
    const k = (window as any).k
    const seen: number[] = []
    const orig = k.set
    k.set = (v: number) => (seen.push(v), orig(v))
    for (let i = 1; i <= 25; i++) rt.invoke('k', 'set', [i / 100])
    rt.invoke('k', 'hold', [1])
    rt.invoke('k', 'release', [])
    await tick(30)
    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => (i + 1) / 100))
    expect(k()).toBe(0.25)
  })

  test('whitelist: unknown names, other methods and non-plain args are refused, nothing is evaluated', async () => {
    await rt.run(sketch())
    ;(window as any).evil = { set: () => ((window as any).pwned = true) }
    expect(rt.invoke('nope', 'set', [1])).toBe(false)
    expect(rt.invoke('k', 'destroy' as any, [])).toBe(false)
    expect(rt.invoke('k', 'set', [{ valueOf: () => 1 }] as any)).toBe(false)
    expect(rt.invoke('k', 'set', ['x'.repeat(65)])).toBe(false)
    expect(rt.invoke('k', 'set', [NaN])).toBe(false)
    expect(rt.invoke('k = 1; window.pwned = true; k', 'set', [1])).toBe(false)
    expect(rt.invoke('evil', 'set', [1])).toBe(false) // not a def of the sketch
    await tick()
    expect(errors.filter((e) => /pad call/.test(e)).length).toBe(7)
    expect((window as any).pwned).toBeUndefined()
    expect((window as any).k()).toBe(0.5)
  })

  test('a def that is not a knob is refused inside the frame', async () => {
    const s = importText('p = 0.3\nosc(p).out()\n').sketch
    await rt.run({ ...s, plugins: [pastedMotion()] })
    expect(rt.invoke('p', 'set', [1])).toBe(true) // the host only knows it is a def
    await tick()
    expect(errors.join('\n')).toMatch(/"p" is not a hydra-motion knob/)
    expect((window as any).p).toBe(0.3)
  })

  test('invoke before the frame is ready is queued, then delivered', async () => {
    const p = rt.run(sketch())
    await p
    // a fresh runtime: queue before ready
    rt.dispose()
    const container = document.createElement('div')
    rt = createRuntime(container, { catalog: Catalog.fromHydra(), midi: null, ...(mode === 'inline' ? { isolation: 'inline', hydraLoader: async () => MockHydra, pluginsInHostPage: true } : { transport: loopbackTransport() }) } as any)
    await rt.run(sketch())
    rt.invoke('k', 'set', [0.7])
    await tick()
    expect((window as any).k()).toBe(0.7)
  })

  test('safe mode: no plugin, the knob is its initial number, and the sketch runs', async () => {
    const r = await rt.run(sketch(), { safe: true })
    expect(r.ok).toBe(true)
    expect((window as any).k).toBe(0.5)
    expect((window as any).hydraMotion).toBeUndefined()
    // a plain number is baked into the shader
    expect(hydra().frame(0)!.frag).toMatch(/0\.5/)
  })
})
