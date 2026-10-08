import { describe, expect, test } from 'vitest'
import { fromCode, importText } from '../src/parse'
import { toCode, toCodeWithMap, toRunnable } from '../src/codegen'
import { catalog, Catalog } from '../src/catalog'
import { validate } from '../src/validate'
import { corpus } from '../src/corpus'
import { withMeta, setMeta, mapCalls, setArg, walkCalls, num, newSketch, chainStmt, makeChain, makeCall, contentHash, stripVolatile, reId, cloneSketch } from '../src/ir'
import { describe as describeSketch } from '../src/analyze'
import { autoLayout, buildGraph } from '../src/autoLayout'
import { needsTrustPrompt, riskyParts, trustFingerprint } from '../src/trust'
import { isSafeExpression } from '../src/safe-expr'

describe('catalog matches hydra-synth source', () => {
  test('every function in glsl-functions.js is present with its types, defaults and positions', async () => {
    const mod = await import('hydra-synth/src/glsl/glsl-functions.js')
    const raw = mod.default()
    expect(catalog.names()).toHaveLength(raw.length)
    for (const f of raw) {
      const d = catalog.get(f.name)!
      expect(d, f.name).toBeDefined()
      expect(d.type).toBe(f.type)
      const implicit = f.type === 'combine' || f.type === 'combineCoord' ? 1 : 0
      expect(d.inputs.length).toBe(f.inputs.length + implicit)
      f.inputs.forEach((inp, i) => {
        expect(d.inputs[i + implicit].name).toBe(inp.name)
        expect(d.inputs[i + implicit].type).toBe(inp.type)
      })
      expect(catalog.position(f.name)).toBe(f.type === 'src' ? 'gen' : 'mod')
    }
    expect(catalog.get('modulate')!.inputs[0]).toMatchObject({ type: 'sampler2D', implicit: true })
    expect(catalog.get('sum')!.inputs[0].default).toEqual([1, 1, 1, 1])
  })

  test('hints add ranges but defaults come from the catalog; unhinted inputs get the heuristic', () => {
    expect(catalog.hint('osc', 'frequency')).toMatchObject({ min: 0, max: 200, log: true })
    expect(catalog.hint('rotate', 'angle')).toMatchObject({ wrap: true })
    expect(catalog.hint('kaleid', 'nSides')).toMatchObject({ min: 1, max: 24, integer: true })
    const c = Catalog.fromHydra()
    c.refresh([{ name: 'wob', type: 'coord', inputs: [{ name: 'k', type: 'float', default: 5 }, { name: 'z', type: 'float', default: 0 }, { name: 'n', type: 'float', default: -4 }], origin: 'plugin:x' }])
    expect(c.hint('wob', 'k')).toMatchObject({ min: 0.5, max: 50 })
    expect(c.hint('wob', 'z')).toMatchObject({ min: -1, max: 1 })
    expect(c.hint('wob', 'n')).toMatchObject({ min: -40, max: -0.4 })
  })

  test('refresh adds plugin functions (incl. vec2/vec3 inputs), notifies subscribers and groups by origin', () => {
    const c = Catalog.fromHydra()
    const seen: string[][] = []
    const un = c.subscribe((ch) => seen.push(ch.added))
    c.refresh([
      { name: 'swirl', type: 'combineCoord', inputs: [{ name: 'amt', type: 'float', default: 1 }, { name: 'center', type: 'vec2', default: 0.5 }, { name: 'tint', type: 'vec3', default: [1, 0, 0] }], origin: 'plugin:p1' },
      { name: 'bogus', type: 'nonsense', inputs: [], origin: 'plugin:p1' },
    ])
    expect(seen).toEqual([['swirl']])
    const f = c.get('swirl')!
    expect(f.inputs.map((i) => i.type)).toEqual(['sampler2D', 'float', 'vec2', 'vec3'])
    expect(f.inputs[2].default).toEqual([0.5, 0.5])
    expect(c.has('bogus')).toBe(false)
    const groups = c.groups().map((g) => g.origin)
    expect(groups[0]).toBe('builtin')
    expect(groups).toContain('plugin:p1')
    un()
    c.refresh([{ name: 'again', type: 'src', inputs: [], origin: 'plugin:p2' }])
    expect(seen).toHaveLength(1)
    c.removeOrigin('plugin:p1')
    expect(c.has('swirl')).toBe(false)
  })
})

describe('meta and foreign data survive', () => {
  const base = () => {
    let s = fromCode('osc(10, 0.1).rotate(1).out()')
    s = withMeta(s, 'graph', { zoom: 2, nodes: { a: { x: 1 } } })
    s = setMeta(s, 'rack', { modules: [1, 2, 3] })
    ;(s as any).futureField = { keep: true }
    ;(s.stmts[0] as any).weird = 'x'
    ;(s.stmts[0] as any).meta = { stack: { open: true } }
    return s
  }

  test('withMeta only touches its own app key', () => {
    const s = withMeta(base(), 'stack', { tab: 'edit' })
    expect(s.meta).toEqual({ graph: { zoom: 2, nodes: { a: { x: 1 } } }, rack: { modules: [1, 2, 3] }, stack: { tab: 'edit' } })
    expect(withMeta(s, 'stack', { more: 1 }).meta!.stack).toEqual({ tab: 'edit', more: 1 })
  })

  test('editing arguments keeps sketch meta, node meta, unknown fields and src records', () => {
    const s0 = base()
    const call = [...walkCalls(s0)].find((x) => x.call.fn === 'rotate')!.call
    const s1 = setArg(mapCalls(s0, (c) => c), call.id, 0, num(2))
    expect(s1.meta).toEqual(s0.meta)
    expect((s1 as any).futureField).toEqual({ keep: true })
    expect((s1.stmts[0] as any).weird).toBe('x')
    expect((s1.stmts[0] as any).meta).toEqual({ stack: { open: true } })
    expect(s1.stmts[0].src).toEqual(s0.stmts[0].src)
    expect(toCode(s1)).toBe('osc(10, 0.1)\n  .rotate(2)\n  .out()'.replace(/\n {2}/g, '') .replace(/^osc\(10, 0\.1\)\.rotate\(2\)\.out\(\)$/, 'osc(10, 0.1).rotate(2).out()'))
  })

  test('a JSON round trip (what the library does) keeps everything', () => {
    const s = base()
    const back = JSON.parse(JSON.stringify(s))
    expect(back.meta).toEqual(s.meta)
    expect(toCode(back)).toBe(toCode(s))
  })

  test('another editor can add its meta without disturbing the first', () => {
    let s = base()
    s = withMeta(s, 'blocks', { collapsed: ['x'] })
    expect(Object.keys(s.meta!).sort()).toEqual(['blocks', 'graph', 'rack'])
    expect((s.meta as any).graph.zoom).toBe(2)
  })

  test('reId and cloneSketch preserve meta and src', () => {
    const s = base()
    const r = reId(s)
    expect(r.meta).toEqual(s.meta)
    expect(r.stmts[0].src).toEqual(s.stmts[0].src)
    expect(r.stmts[0].id).not.toBe(s.stmts[0].id)
    expect(cloneSketch(s).meta).toEqual(s.meta)
  })
})

describe('format-preserving export', () => {
  test('changing one number rewrites only that line', () => {
    const code = '// keep me\nspeed = 0.5\nosc(20, 0.1, 0.8) // base\n  .rotate(0.8)\n  .kaleid(4)\n  .out(o1);\n\nnoise(3).out()\n'
    const s = fromCode(code)
    const call = [...walkCalls(s)].find((x) => x.call.fn === 'rotate')!.call
    const out = toCode(setArg(s, call.id, 0, num(1.5)))
    const diff = code.split('\n').map((l, i) => [l, out.split('\n')[i]]).filter(([a, b]) => a !== b)
    expect(diff).toEqual([['  .rotate(0.8)', '  .rotate(1.5)']])
  })

  test('adding a modifier keeps the other lines and the semicolon style', () => {
    const code = 'osc(20)\n  .rotate(1)\n  .out();\n'
    const s = fromCode(code)
    const stmt: any = s.stmts[0]
    const s2 = { ...s, stmts: [{ ...stmt, chain: { ...stmt.chain, mods: [...stmt.chain.mods, makeCall('kaleid', [num(5)])] } }] }
    expect(toCode(s2 as any)).toBe('osc(20)\n  .rotate(1)\n  .kaleid(5)\n  .out();\n')
  })

  test('toCodeWithMap ranges point at the node text', () => {
    const s = fromCode('osc(10)\n  .rotate(1)\n  .out()\n')
    const { code, map } = toCodeWithMap(s)
    const rot = [...walkCalls(s)].find((x) => x.call.fn === 'rotate')!.call
    expect(code.slice(map[rot.id].from, map[rot.id].to)).toBe('.rotate(1)')
    const fresh = toCodeWithMap(s, { fresh: true })
    expect(fresh.code.slice(fresh.map[rot.id].from, fresh.map[rot.id].to)).toBe('.rotate(1)')
    expect(fresh.code.slice(fresh.map[s.stmts[0].id].from, fresh.map[s.stmts[0].id].to)).toContain('osc(10)')
  })
})

describe('codegen golden output', () => {
  const gen = (...c: Array<[string, any[]]>) => c
  void gen
  test('omits trailing defaults, keeps placeholders, one modifier per line', () => {
    const sk = newSketch('t', [chainStmt(makeChain(makeCall('osc', [num(60), num(0.1), num(0.8)]), [makeCall('rotate', [{ k: 'default' }, num(0.2)]), makeCall('kaleid', [num(4)]), makeCall('pixelate', [num(20), num(20)])], 'o1'))])
    expect(toCode(sk)).toBe('osc(60, 0.1, 0.8)\n  .rotate(10, 0.2)\n  .kaleid()\n  .pixelate()\n  .out(o1)\n')
  })
  test('nested chains, refs, arrays with modifiers, functions and vars', () => {
    const { sketch } = importText('const k = noise(2)\nosc([1, 2, 3].fast(2).smooth(), () => time)\n  .modulate(k.constructor && noise(3).thresh(), 0.2)\n  .blend(o0, 0.3)\n  .out()')
    expect(toCode(sketch, { fresh: true })).toContain('osc([1, 2, 3].fast(2).smooth(1), () => time)')
    expect(toCode(sketch, { fresh: true })).toContain('.blend(o0, 0.3)')
  })
  test('live mode turns numeric chain args into closures and keeps the values out of the code', () => {
    const a = toRunnable(fromCode('osc(20, 0.1).rotate(1).out()'), { live: true })
    const b = toRunnable(fromCode('osc(25, 0.1).rotate(1).out()'), { live: true })
    // different call ids, so compare the structure with ids masked
    const mask = (c: string) => c.replace(/"[a-z0-9]+:(\d+)"/g, '"ID:$1"')
    expect(mask(a.code)).toBe(mask(b.code))
    expect(Object.values(a.live)).toEqual([20, 0.1, 1])
    expect(a.code).toMatch(/osc\(\(\) => __hl\["[^"]+:0"\], \(\) => __hl\["[^"]+:1"\]\)/)
  })
})

describe('validate', () => {
  const v = (code: string) => validate(fromCode(code))
  const codes = (code: string) => v(code).map((p) => p.code)
  test('clean sketches have no errors', () => {
    for (const e of corpus) if (!e.broken) expect(validate(importText(e.code).sketch).filter((p) => p.severity === 'error'), e.name).toEqual([])
  })
  test('wrong position, missing texture, too many args, unknown function', () => {
    expect(codes('rotate(1).out()')).toContain('wrong-position')
    expect(codes('osc().osc().out()')).toContain('wrong-position')
    expect(codes('osc().modulate().out()')).toContain('texture-missing')
    expect(codes('src().out()')).toContain('texture-missing')
    expect(codes('osc(1,2,3,4).out()')).toContain('too-many-args')
    expect(codes('foo(1).out()')).toContain('unknown-function')
    expect(codes('osc(noise).out()')).toContain('function-not-called')
    expect(v('osc(1).modulate(0.5).out()').some((p) => p.code === 'bad-arg')).toBe(true)
    expect(codes('osc(10)')).toContain('not-rendered')
  })
  test('var before def and unknown var', () => {
    const early = fromCode('const b = osc(1)\nosc().modulate(b).out()')
    expect(validate(early).filter((p) => p.severity === 'error')).toEqual([])
    const s = fromCode('const b = osc(1)\nosc().modulate(b).out()')
    const reordered = { ...s, stmts: [s.stmts[1], s.stmts[0]] }
    expect(validate(reordered).map((p) => p.code)).toContain('var-before-def')
    const unknown = { ...s, stmts: [s.stmts[1]] }
    expect(validate(unknown).map((p) => p.code)).toContain('unknown-var')
  })
})

describe('analyze + layout', () => {
  const d = (name: string) => describeSketch(importText(corpus.find((c) => c.name === name)!.code).sketch)
  test('feedback, shadowing, not rendered, sources, defs', () => {
    expect(d('04-feedback').feedbackEdges).toHaveLength(1)
    expect(d('11-prev').feedbackEdges).toHaveLength(1)
    expect(d('11-prev').usesPrev).toBe(true)
    expect(d('13-same-output-twice').shadowed).toHaveLength(1)
    expect(d('13-same-output-twice').outputs.o0.writers).toHaveLength(2)
    expect(d('12-no-out').notRendered).toHaveLength(1)
    expect(d('08-sources').usedSources).toEqual(['s0', 's1', 's2', 's3'])
    expect(d('08-sources').activeRender).toBe('o0')
    expect(d('14-render').activeRender).toBe('o0')
    const v = d('09-variables')
    expect(v.defs.map((x) => x.name)).toEqual(['mult', 'sides', 'pat', 'base', 'wobble'])
    expect(v.defs.find((x) => x.name === 'base')!.uses.length).toBe(2)
    expect(d('26-nested').maxDepth).toBeGreaterThanOrEqual(2)
    expect(d('07-audio').usesAudio).toBe(true)
    expect(d('25-comments').comments).toBeGreaterThan(3)
    expect(d('16-update').raws).toBe(2)
  })
  test('autoLayout positions every call and every note, with boxes per chain', () => {
    for (const e of corpus) {
      const s = importText(e.code).sketch
      const lay = autoLayout(s)
      for (const x of walkCalls(s)) expect(lay.positions[x.call.id], `${e.name} ${x.call.fn}`).toBeDefined()
      for (const st of s.stmts) if (st.k === 'raw' || st.k === 'comment') expect(lay.positions[`${st.k}:${st.id}`], e.name).toBeDefined()
      for (const p of Object.values(lay.positions)) expect(Number.isFinite(p.x + p.y)).toBe(true)
      expect(lay.size.w).toBeGreaterThan(0)
    }
    const s = importText('osc(1).rotate(2).out()').sketch
    const lay = autoLayout(s)
    const ids = [...walkCalls(s)].map((x) => x.call.id)
    expect(lay.positions[ids[0]].x).toBeLessThan(lay.positions[ids[1]].x) // left to right
    const g = buildGraph(s)
    expect(g.edges.length).toBeGreaterThanOrEqual(2)
  })
})

describe('trust', () => {
  test('needs a prompt only for raw code, JS defs, unsafe expressions, plugins', () => {
    const need = (code: string) => needsTrustPrompt(fromCode(code))
    expect(need('osc(10).rotate(() => Math.sin(time)).out()')).toBe(false)
    expect(need('osc(() => a.fft[0] * 4).out()')).toBe(false)
    expect(need('speed = 2\nosc().out()')).toBe(false)
    expect(need('update = () => {}\nosc().out()')).toBe(true)
    expect(need('osc(() => fetch("//x")).out()')).toBe(true)
    expect(need('const x = foo()\nosc().out()')).toBe(true)
    const s = fromCode('osc().out()')
    expect(needsTrustPrompt({ ...s, plugins: [{ id: 'p', name: 'P', url: 'https://x/p.js' }] })).toBe(true)
  })
  test('approval is per exact content', () => {
    const s = fromCode('update = () => {}\nosc().out()')
    const fp = trustFingerprint(s)
    expect(needsTrustPrompt(s, fp)).toBe(false)
    expect(needsTrustPrompt(fromCode('update = () => { evil() }\nosc().out()'), fp)).toBe(true)
    expect(needsTrustPrompt({ ...s, plugins: [{ id: 'p', name: 'P', src: '1' }] }, fp)).toBe(true)
    expect(riskyParts(s)[0].kind).toBe('raw')
  })
  test('the safe-expression allowlist', () => {
    const ok = ['() => Math.sin(time * 0.5) * 2', '() => a.fft[0] * 3 + 1', '() => mouse.x / width', 'a0(2, 1)', '(x) => x * 2', '() => [1,2][0]']
    const bad = ['() => fetch("x")', '() => window.location', 'eval("1")', '() => (0, eval)("1")', '() => document.cookie', '() => import("x")', 'async () => 1', '() => { while(1){} }', '() => this', '() => constructor.constructor("1")()']
    for (const s of ok) expect(isSafeExpression(s), s).toBe(true)
    for (const s of bad) expect(isSafeExpression(s), s).toBe(false)
  })
})

describe('hash helper', () => {
  test('ignores ids/meta/src, order-independent', () => {
    expect(contentHash({ a: 1, b: { id: 'x', c: 2 } })).toBe(contentHash({ b: { c: 2, id: 'y', meta: { z: 1 } }, a: 1 }))
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }))
    expect(stripVolatile({ id: 1, k: 'num', src: { text: 'x' } })).toEqual({ k: 'num' })
    expect(stripVolatile({ k: 'fn', src: '() => 1' })).toEqual({ k: 'fn', src: '() => 1' })
  })
})
