import { describe, expect, test } from 'vitest'
import { catalog, canonicalSketch, enableAll, importText, liveId, num, setDisabled, toCode, validate, withMeta, type Sketch } from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import { APP, autoView, bpmOf, layoutOf, metaOf, readsOf, type RackMeta } from '../src/view'
import { isInteger, panelOf } from '../src/panel'
import {
  activeChain,
  addGenerator,
  addModule,
  assignMod,
  baseOf,
  auditionSketch,
  migrateBypass,
  mutateChain,
  mutateLanes,
  randomizeCall,
  randomLane,
  routeLane,
  swapFn,
  unassignMod,
  unrouteLane,
} from '../src/ops'
import { beatsToMs, ease, Fader, lerpTable, liveTableOf, sameShape, shapeOf } from '../src/fade'
import { parseKey, refInfo, refKey } from '../src/refs'
import { beatsOfRate, rateForBeats } from '../src/ui/ModEditor'
import { findCallDeep, getArg, setArg } from '../src/kit/model'
import { valueToMod } from '../src/kit/mods'
import { Store } from '../src/kit/store'

const imp = (code: string) => importText(code).sketch
const code = (sk: Sketch) => toCode(sk)
const errors = (sk: Sketch) => validate(sk, catalog).filter((p) => p.severity === 'error')
/** a seeded random source, so the dice tests are reproducible */
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

describe('view', () => {
  test('autoView is pure and deterministic, and leaves other apps alone', () => {
    const sk = withMeta(imp('osc().out()\n'), 'graph', { v: 1, pos: {} })
    const before = JSON.stringify(sk)
    expect(autoView(sk)).toEqual(autoView(sk))
    expect(autoView(sk)).toEqual({ v: 1, fade: 4 })
    expect(JSON.stringify(sk)).toBe(before)
    expect(metaOf(withMeta(sk, APP, autoView(sk) as unknown as Record<string, unknown>))).toEqual({ v: 1, fade: 4 })
    expect(metaOf(withMeta(sk, APP, { v: 2 }))).toBeUndefined()
  })

  test('lanes: chains sit in the lane of their output, later writers shadow earlier ones, no .out is unplugged', () => {
    const L = layoutOf(imp('osc().out()\nnoise().out(o1)\nshape().out(o0)\nvoronoi()\n// note\nconst k = 2\nwindow.x = 1\nspeed = 2\nrender(o1)\n'))
    expect(L.lanes.o0.map((r) => [r.stmt.chain.gen.fn, r.shadowed])).toEqual([
      ['osc', true],
      ['shape', false],
    ])
    expect(L.lanes.o1.map((r) => r.stmt.chain.gen.fn)).toEqual(['noise'])
    expect(L.unplugged.map((s) => s.chain.gen.fn)).toEqual(['voronoi'])
    expect(L.vars.map((d) => d.name)).toEqual(['k'])
    expect(L.notes).toHaveLength(1)
    expect(L.raw).toHaveLength(1)
    expect(L.setup.map((s) => s.k)).toEqual(['setting', 'render'])
  })

  test('nothing is dropped: every statement of every corpus sketch has exactly one place on the rack', () => {
    for (const e of corpus) {
      const sk = imp(e.code)
      const L = layoutOf(sk)
      const placed = [...Object.values(L.lanes).flat().map((r) => r.stmt), ...L.unplugged, ...L.vars, ...L.notes, ...L.raw, ...L.setup].map((s) => s.id)
      expect(placed.sort(), e.name).toEqual(sk.stmts.map((s) => s.id).sort())
    }
  })

  test('routing matrix and bpm', () => {
    const sk = imp('osc().out()\nsrc(o0).modulate(o1).out(o2)\nnoise().blend(src(o3)).out(o1)\nbpm = 120\n')
    const r = readsOf(sk)
    expect(r.o2).toEqual(['o0', 'o1'])
    expect(r.o1).toEqual(['o3'])
    expect(r.o0).toEqual([])
    expect(bpmOf(sk)).toBe(120)
    expect(bpmOf(imp('osc().out()\n'))).toBe(30)
  })
})

describe('the corpus through the rack', () => {
  for (const e of corpus) {
    test(`${e.name}: opens with a view, exports untouched text, and one knob is one line`, () => {
      const sk = withMeta(imp(e.code), APP, autoView(imp(e.code)) as unknown as Record<string, unknown>)
      expect(code(sk)).toBe(e.code)
      // the first plain number on a float input of a chain call: turn that knob
      for (const s of sk.stmts) {
        if (s.k !== 'chain') continue
        for (const c of [s.chain.gen, ...s.chain.mods]) {
          // a call written over several lines is written again on one when it changes (core's codegen): skip those
          if (c.src?.text.includes('\n')) continue
          const i = c.args.findIndex((a, j) => a.k === 'num' && catalog.has(c.fn) && catalog.inputs(c.fn)[j]?.type === 'float')
          if (i < 0) continue
          const a = c.args[i] as { v: number }
          const next = code(setArg(sk, { call: c.id, i }, num(a.v + 1)))
          const A = e.code.split('\n')
          const B = next.split('\n')
          expect(B.length, e.name).toBe(A.length)
          expect(A.filter((l, k) => l !== B[k]).length, e.name).toBe(1)
          return
        }
      }
    })
  }
})

describe('panels', () => {
  test('controls come from the catalog: knobs, XY pairs, colour blocks, jacks', () => {
    expect(panelOf('osc', 3, catalog).map((c) => c.t)).toEqual(['knob', 'knob', 'knob'])
    const rep = panelOf('repeat', 0, catalog)
    expect(rep.map((c) => c.t)).toEqual(['xy', 'xy'])
    expect(rep[0]).toMatchObject({ t: 'xy', ix: { name: 'repeatX' }, iy: { name: 'repeatY' } })
    expect(panelOf('color', 0, catalog).map((c) => c.t)).toEqual(['rgba'])
    expect(panelOf('solid', 0, catalog)).toMatchObject([{ t: 'rgba', is: [0, 1, 2, 3] }])
    expect(panelOf('blend', 0, catalog).map((c) => c.t)).toEqual(['jack', 'knob'])
    expect(panelOf('modulate', 0, catalog).map((c) => c.t)).toEqual(['jack', 'knob'])
    expect(panelOf('pixelate', 0, catalog).map((c) => c.t)).toEqual(['xy'])
    // a call the catalog does not know: one knob per argument
    expect(panelOf('myPluginFx', 2, catalog).map((c) => c.t)).toEqual(['knob', 'knob'])
  })
  test('integer inputs get detents', () => {
    expect(isInteger('shape', 'sides', catalog)).toBe(true)
    expect(isInteger('kaleid', 'nSides', catalog)).toBe(true)
    expect(isInteger('osc', 'frequency', catalog)).toBe(false)
    expect(isInteger('repeat', 'repeatX', catalog)).toBe(false)
  })
  test('refs: keys round trip, info has the hint range and default', () => {
    const sk = imp('osc(20).out()\nconst k = 3\n')
    const c = (sk.stmts[0] as { chain: { gen: { id: string } } }).chain.gen.id
    expect(parseKey(refKey({ call: c, i: 1 }))).toEqual({ call: c, i: 1 })
    expect(parseKey(refKey({ def: sk.stmts[1].id }))).toEqual({ def: sk.stmts[1].id })
    const info = refInfo(sk, { call: c, i: 0 }, catalog)
    expect(info).toMatchObject({ label: 'frequency', fn: 'osc', def: 60, exists: true })
    expect(info.hint.max).toBeGreaterThan(info.hint.min)
    expect(refInfo(sk, { def: sk.stmts[1].id }, catalog)).toMatchObject({ label: 'k', exists: true })
  })
})

describe('rack edits', () => {
  test('acceptance 1 as pure edits: generator, knobs, modules, a mini-module', () => {
    let sk = imp('')
    const g = addGenerator(sk, 'o0', 'osc', catalog)
    sk = g.sketch
    const chain = (g.stmt as { chain: { id: string; gen: { id: string } } }).chain
    sk = setArg(setArg(setArg(sk, { call: chain.gen.id, i: 0 }, num(20)), { call: chain.gen.id, i: 1 }, num(0.1)), { call: chain.gen.id, i: 2 }, num(0.8))
    const r = addModule(sk, chain.id, -1, 'rotate', catalog)
    sk = setArg(r.sketch, { call: r.call.id, i: 0 }, num(0.8))
    const m = addModule(sk, chain.id, 0, 'modulate', catalog)
    sk = setArg(m.sketch, { call: m.call.id, i: 1 }, num(0.1))
    const noise = (findCallDeep(sk, m.call.id)!.call.args[0] as { chain: { gen: { id: string } } }).chain.gen
    sk = setArg(sk, { call: noise.id, i: 0 }, num(3))
    expect(canonicalSketch(sk)).toEqual(canonicalSketch(imp('osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out()')))
    expect(errors(sk)).toEqual([])
  })

  test('swap keeps the inputs whose names match', () => {
    const sk = imp('osc().modulateScale(o0, 3, 0.5).out()\n')
    const id = (sk.stmts[0] as { chain: { mods: Array<{ id: string }> } }).chain.mods[0].id
    expect(code(swapFn(sk, id, 'modulateRotate', catalog))).toBe('osc().modulateRotate(o0, 3, 0.5).out()\n')
    expect(code(swapFn(sk, id, 'modulate', catalog))).toBe('osc().modulate(o0).out()\n')
  })

  test('old sketches: a bypassed module goes back into its chain switched off, and meta.rack.bypass is removed', () => {
    // what the old ⏻ left behind for osc(10).rotate(0.5).kaleid(4).scale(2): kaleid bypassed, then rotate (kaleid's
    // entry re-anchored to the start of the chain)
    const sk0 = imp('osc(10).scale(2).out()\nnoise(3).out(o1)\n')
    const ch = (sk0.stmts[0] as { chain: { id: string; gen: { id: string } } }).chain
    const rot = { id: 'c-rot', fn: 'rotate', args: [num(0.5)] }
    const kal = { id: 'c-kal', fn: 'kaleid', args: [num(5)] }
    const old = withMeta(sk0, APP, {
      v: 1,
      fade: 2,
      scenes: {},
      bypass: [
        { chain: ch.id, after: null, call: kal },
        { chain: ch.id, after: null, call: rot },
        { chain: 'gone', after: null, call: { id: 'c-x', fn: 'invert', args: [] } },
      ],
    })
    const sk = migrateBypass(old)
    expect(code(sk)).toBe('osc(10)\n  // .rotate(0.5)\n  // .kaleid(5)\n  .scale(2).out()\nnoise(3).out(o1)\n')
    expect(metaOf(sk)).toEqual({ v: 1, fade: 2, scenes: {} })
    expect('bypass' in (sk.meta!.rack as object)).toBe(false)
    expect(code(enableAll(sk))).toBe('osc(10).rotate(0.5).kaleid(5).scale(2).out()\nnoise(3).out(o1)\n')
    // the export runs in vanilla Hydra (the importer reads the // lines back as the same switched-off modules)
    expect(canonicalSketch(imp(code(sk)))).toEqual(canonicalSketch({ ...sk, meta: undefined }))
    // idempotent; a sketch without the old key is returned as it is
    expect(migrateBypass(sk)).toBe(sk)
    const plain = imp('osc().out()\n')
    expect(migrateBypass(plain)).toBe(plain)
    // an anchor that is no longer in the chain: the module goes to the end of the row
    const lost = migrateBypass(withMeta(sk0, APP, { v: 1, bypass: [{ chain: ch.id, after: 'c-gone', call: rot }] }))
    expect(code(lost)).toBe('osc(10).scale(2)\n  // .rotate(0.5)\n  .out()\nnoise(3).out(o1)\n')
  })

  test('switched off: a disabled row hides nothing, routes and reads skip it, scenes see it as structure', () => {
    let sk = imp('osc().out()\nnoise().blend(src(o1)).out()\n')
    const [a, b] = sk.stmts as Array<{ id: string; chain: { id: string; mods: Array<{ id: string }> } }>
    expect(layoutOf(sk).lanes.o0.map((r) => r.shadowed)).toEqual([true, false])
    expect(readsOf(sk).o0).toEqual(['o1'])
    sk = setDisabled(sk, b.id, true)
    expect(layoutOf(sk).lanes.o0.map((r) => r.shadowed)).toEqual([false, false])
    expect(activeChain(sk, 'o0')!.id).toBe(a.id)
    expect(readsOf(sk).o0).toEqual([])
    // routing blends into the chain you see, not the switched-off one
    expect(code(routeLane(sk, 'o0', 'o2').sketch).split('\n')[0]).toBe('osc().blend(src(o2)).out()')
    // a switched-off modifier no longer reads
    const bl = imp('osc().blend(src(o1)).out()\n')
    expect(readsOf(setDisabled(bl, (bl.stmts[0] as typeof a).chain.mods[0].id, true)).o0).toEqual([])
    // switching changes the shape (a scene recall that differs only in on/off swaps at the end of the fade)
    const base = imp('osc(10).rotate(0.5).out()\n')
    const rid = (base.stmts[0] as typeof a).chain.mods[0].id
    expect(sameShape(base.stmts, setDisabled(base, rid, true).stmts, catalog)).toBe(false)
    expect(sameShape(base.stmts, setDisabled(base, (base.stmts[0] as typeof a).id, true).stmts, catalog)).toBe(false)
  })

  test('audition adds a render() for the lane without touching the sketch', () => {
    const sk = imp('osc().out()\nnoise().out(o2)\n')
    const before = JSON.stringify(sk)
    const a = auditionSketch(sk, 'o2')
    expect(code(a)).toBe('osc().out()\nnoise().out(o2)\n\nrender(o2)\n')
    expect(JSON.stringify(sk)).toBe(before)
  })

  test('routing: an empty lane starts src(oN); a busy one blends it in; unroute takes it out again', () => {
    let sk = imp('osc().out()\n')
    const a = routeLane(sk, 'o1', 'o0')
    expect(code(a.sketch)).toBe('osc().out()\n\nsrc(o0).out(o1)\n')
    sk = routeLane(sk, 'o0', 'o0').sketch // feedback
    expect(code(sk)).toBe('osc().blend(src(o0)).out()\n') // 0.5 is blend's default, which codegen leaves out
    expect(readsOf(sk).o0).toEqual(['o0'])
    expect(code(unrouteLane(sk, 'o0', 'o0'))).toBe('osc().out()\n')
    expect(code(unrouteLane(imp('osc().modulate(o1).out()\n'), 'o0', 'o1'))).toBe('osc().out()\n')
    expect(activeChain(imp('osc().out()\nnoise().out()\n'), 'o0')!.chain.gen.fn).toBe('noise')
  })

  test('modulation: assigning centres on the current value; removing goes back to it', () => {
    const sk = imp('osc().rotate(0.8).out()\n')
    const id = (sk.stmts[0] as { chain: { mods: Array<{ id: string }> } }).chain.mods[0].id
    const ref = { call: id, i: 0 }
    const sine = assignMod(sk, ref, 'sine', catalog)
    const v = getArg(sine, ref)!
    expect(v.k).toBe('fn')
    expect(valueToMod(v)).toMatchObject({ kind: 'sine', off: 0.8 })
    expect(code(sine)).toMatch(/^osc\(\)\.rotate\(\(\) => Math\.sin\(time \* 1\) \* [\d.]+ \+ 0\.8\)\.out\(\)\n$/)
    expect(code(unassignMod(sine, ref, catalog))).toBe('osc().rotate(0.8).out()\n')
    const steps = assignMod(sk, ref, 'steps', catalog)
    expect(getArg(steps, ref)!.k).toBe('arr')
    const audio = assignMod(sk, ref, 'audio', catalog, { bin: 2 })
    expect(code(audio)).toMatch(/a\.fft\[2\]/)
    expect(baseOf(audio, ref, catalog).base).toBe(0.8)
  })

  test('dice and mutate stay in range and keep the sketch valid; locked lanes are left alone', () => {
    const sk = imp('osc(20, 0.1, 0.8).rotate(0.8).out()\nnoise(3).out(o1)\n')
    const osc = (sk.stmts[0] as { chain: { id: string; gen: { id: string } } }).chain
    const r = randomizeCall(sk, osc.gen.id, catalog, seeded(3))
    const args = findCallDeep(r, osc.gen.id)!.call.args
    catalog.inputs('osc').forEach((inp, i) => {
      const h = catalog.hint('osc', inp.name)
      const a = args[i] as { v: number }
      expect(a.v).toBeGreaterThanOrEqual(h.min)
      expect(a.v).toBeLessThanOrEqual(h.max)
    })
    const m = mutateChain(sk, osc.id, catalog, seeded(5))
    expect(sameShape(sk.stmts, m.stmts, catalog)).toBe(true)
    expect(code(m)).not.toBe(code(sk))
    for (let seed = 1; seed < 30; seed++) expect(errors(randomLane(sk, 'o2', catalog, seed)), String(seed)).toEqual([])
    const frozen = mutateLanes(sk, catalog, seeded(7), ['o1'])
    expect(frozen.stmts[1]).toBe(sk.stmts[1])
    expect(frozen.stmts[0]).not.toBe(sk.stmts[0])
  })
})

describe('scenes and crossfades', () => {
  test('numeric-only differences have the same shape; the live table holds every float input', () => {
    const a = imp('osc(20, 0.1).rotate(0.8).modulate(noise(3)).out()\nconst k = 2\n')
    const b = setArg(a, { call: (a.stmts[0] as { chain: { gen: { id: string } } }).chain.gen.id, i: 0 }, num(40))
    expect(sameShape(a.stmts, b.stmts, catalog)).toBe(true)
    const t = liveTableOf(a.stmts, catalog)
    const gen = (a.stmts[0] as { chain: { gen: { id: string } } }).chain.gen.id
    expect(t[liveId(gen, 0)]).toBe(20)
    expect(Object.keys(t)).toHaveLength(4) // osc ×2, rotate, noise
    // a def's number is in the code (not live): changing it is structural
    const c = { ...a, stmts: a.stmts.map((s) => (s.k === 'def' ? { ...s, value: num(5) } : s)) }
    expect(sameShape(a.stmts, c.stmts, catalog)).toBe(false)
    expect(shapeOf(a.stmts, catalog)).not.toBe(shapeOf(imp('osc(20, 0.1).out()\n').stmts, catalog))
  })

  test('lerp, easing and beats', () => {
    expect(lerpTable({ a: 0, b: 1 }, { a: 10, c: 3 }, 0.5)).toEqual({ a: 5 })
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(0.5)).toBe(0.5)
    expect(beatsToMs(4, 120)).toBe(2000)
    expect(beatsToMs(4, 30)).toBe(8000)
    expect(rateForBeats('saw', 1, 60)).toBe(1)
    expect(rateForBeats('sine', 1, 60)).toBeCloseTo(2 * Math.PI, 3)
    expect(beatsOfRate('sine', rateForBeats('sine', 0.5, 120), 120)).toBe(0.5)
    expect(beatsOfRate('saw', 0.37, 120)).toBeUndefined()
  })

  test('the fader sends interpolated tables every frame, lands on the target, and stops when cancelled', () => {
    let now = 0
    const frames: Array<() => void> = []
    const sent: Array<Record<string, number>> = []
    const f = new Fader({ setLiveBatch: (t) => sent.push(t), now: () => now, frame: (cb) => frames.push(cb) })
    let done = 0
    f.run({ x: 0 }, { x: 10 }, 100, () => done++)
    expect(sent[0]).toEqual({ x: 0 })
    now = 50
    frames.shift()!()
    expect(sent[1].x).toBeCloseTo(5)
    now = 120
    frames.shift()!()
    expect(sent[2]).toEqual({ x: 10 })
    expect(done).toBe(1)
    expect(f.active).toBe(false)
    f.run({ x: 0 }, { x: 10 }, 100, () => done++)
    f.cancel()
    now = 500
    frames.shift()?.()
    expect(done).toBe(1)
  })

  test('undo leaves stored scenes and pins alone', () => {
    const sk = withMeta(imp('osc(10).out()\n'), APP, { v: 1 })
    const st = new Store(sk)
    st.keepOnUndo = ['scenes', 'pins']
    const gen = (sk.stmts[0] as { chain: { gen: { id: string } } }).chain.gen.id
    st.commit(setArg(st.sketch, { call: gen, i: 0 }, num(20)))
    st.setView({ v: 1, scenes: { 1: { stmts: st.sketch.stmts, at: 1 } }, pins: [`${gen}:0`] })
    st.undo()
    expect(code(st.sketch)).toBe('osc(10).out()\n')
    expect(metaOf(st.sketch)?.scenes?.['1']).toBeTruthy()
    expect(metaOf(st.sketch)?.pins).toEqual([`${gen}:0`])
  })
})
