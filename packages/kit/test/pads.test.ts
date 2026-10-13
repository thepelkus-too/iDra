import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { findMotionPlugin, importText, knobDefs, toCode, walkCalls, withMeta, type Sketch } from '@hydra-ipad/core'
import { addPad, bindToPad, removePad, knobBase, knobNameFor, livePads, motionPlaysPads, padPress, toKnobPad, padRelease, padsOf, setKnobBase, unbindKnob, updatePad, withKitMeta } from '../src/pads'
import { loopValue } from '../src/NumberEditor'
import { setArg } from '@hydra-ipad/core'

const sk = (code: string) => importText(code).sketch
const callId = (s: Sketch, fn: string) => [...walkCalls(s)].find((x) => x.call.fn === fn)!.call.id

describe('bindToPad', () => {
  const code = '// lead\nspeed = 1\nosc(20, 0.1, 0.8)\n  .rotate(0.3)\n  .out()\n'
  it('writes a knob def before the chain, a reference in the argument, the plugin and a Hold pad', () => {
    const s0 = sk(code)
    const r = bindToPad(s0, callId(s0, 'rotate'), 0, 0.3, { label: 'rotate angle' })!
    expect(r.knob).toBe('rotateAngle')
    const out = toCode(r.sketch)
    expect(out).toMatch(/rotateAngle = knob\(0\.3, \{ pads: \[\{ mode: 'hold', to: 0\.6, release: 0\.15, ease: 'easeOutQuad' \}\] \}\)\nosc\(20, 0\.1, 0\.8\)\n {2}\.rotate\(rotateAngle\)/)
    expect(out.indexOf('speed = 1')).toBeLessThan(out.indexOf('rotateAngle = knob'))
    expect(findMotionPlugin(r.sketch)).toBeTruthy()
    expect(knobDefs(r.sketch).map((k) => k.name)).toEqual(['rotateAngle'])
    expect(padsOf(r.sketch)).toEqual([expect.objectContaining({ id: 'rotateAngle#1', knob: 'rotateAngle', mode: 'hold', label: 'rotateAngle', value: 0.6 })])
    // the pads are in the code, nothing in meta
    expect(r.sketch.meta ?? {}).toEqual({})
  })
  it('binding in the first statement puts the def on its own line (the export runs)', () => {
    const s0 = sk('osc(20, 0, 0.8).rotate(0.8).out()')
    const r = bindToPad(s0, callId(s0, 'osc'), 2, 0.8)!
    expect(toCode(r.sketch).split('\n').filter((l) => !/loadScript|^$/.test(l))).toEqual(["oscOffset = knob(0.8, { pads: [{ mode: 'hold', to: 1.6, release: 0.15, ease: 'easeOutQuad' }] })", 'osc(20, 0, oscOffset).rotate(0.8).out()'])
  })
  it('round-trips through the code (another editor reopening it keeps the binding)', () => {
    const s0 = sk(code)
    const r = bindToPad(s0, callId(s0, 'rotate'), 0, 0.3)!
    const again = importText(toCode(updatePad(r.sketch, r.pad.id, { mode: 'latch', value2: 0.1, attack: 0.2 }))).sketch
    expect(knobDefs(again).map((k) => [k.name, k.initial])).toEqual([['rotateAngle', 0.3]])
    expect(padsOf(again)).toEqual([expect.objectContaining({ mode: 'latch', value: 0.6, value2: 0.1, attack: 0.2, release: 0.15 })])
  })
  it('a nested call binds before the statement that holds it', () => {
    const s0 = sk('noise(3).out(o1)\nosc(10).modulate(noise(3).scale(2), 0.1).out()\n')
    const nested = [...walkCalls(s0)].filter((x) => x.call.fn === 'scale')[0].call.id
    const r = bindToPad(s0, nested, 0, 2)!
    const out = toCode(r.sketch)
    expect(out.indexOf('scaleAmount = knob(2')).toBeGreaterThan(out.indexOf('noise(3).out(o1)'))
    expect(out).toMatch(/scaleAmount = knob\(2, .*\)\nosc\(10\)\.modulate\(noise\(3\)\.scale\(scaleAmount\), 0\.1\)/)
  })
  it('never shadows Hydra globals, functions or existing defs', () => {
    const s0 = sk('const oscFrequency = 2\nosc(oscFrequency).out()\n')
    expect(knobNameFor(s0, 'osc', 'frequency')).toBe('oscFrequency2')
    expect(knobNameFor(s0, '', 'speed')).toBe('Speed')
    expect(knobNameFor(sk('osc().out()'), 'o', 'sc')).toBe('oSc')
  })
})

describe('unbind and base', () => {
  it('unbind restores the plain number (the base) and drops the def and pads', () => {
    const s0 = sk('osc(20, 0.1, 0.8).rotate(0.3).out()\n')
    const r = bindToPad(s0, callId(s0, 'rotate'), 0, 0.3)!
    const moved = setKnobBase(r.sketch, r.knob, 0.5)
    expect(knobBase(moved, r.knob)).toBe(0.5)
    const back = unbindKnob(moved, r.knob)
    expect(toCode(back)).toMatch(/\.rotate\(0\.5\)/)
    expect(knobDefs(back)).toEqual([])
    expect(padsOf(back)).toEqual([])
  })
  it('pads live in the code: undoing a bind takes them with it, and other meta is untouched', () => {
    const s0 = withMeta(sk('osc().rotate(0.3).out()\n'), 'graph', { x: 1 })
    const r = bindToPad(s0, callId(s0, 'rotate'), 0, 0.3)!
    const undone = { ...r.sketch, stmts: s0.stmts }
    expect(padsOf(undone)).toEqual([])
    expect(livePads(r.sketch).length).toBe(1)
    expect((r.sketch.meta as Record<string, unknown>).graph).toEqual({ x: 1 })
  })
  it('reads pads saved in meta.kit before they moved into the code, and writes them as code on the next edit', () => {
    const s0 = sk('k = knob(0.5)\nosc(10, 0, k).out()\n')
    const old = withKitMeta(s0, { pads: [{ id: 'pad-k-1', knob: 'k', label: 'osc offset', mode: 'trigger', value: 2, attack: 0, release: 0.15, ease: 'linear' }] })
    expect(padsOf(old)).toEqual([expect.objectContaining({ id: 'k#1', mode: 'trigger', value: 2 })])
    const next = updatePad(old, 'k#1', { value: 3 })
    expect(toCode(next)).toMatch(/^k = knob\(0\.5, \{ pads: \[\{ mode: 'trigger', to: 3, ease: 'linear' \}\] \}\)$/m)
    expect((next.meta as { kit: { pads?: unknown } }).kit.pads).toBeUndefined()
  })
  it('a knob with other options, or computed pads, stays code', () => {
    expect(knobDefs(sk("k = knob(0.5, { pads: [{ to: time }] })\n"))).toEqual([])
    expect(knobDefs(sk("k = knob(0.5, { pads: [{ to: 1, colour: 'red' }] })\n"))).toEqual([])
    expect(knobDefs(sk("k = knob(0.5, { pads: [{ to: 1 }] })\n"))[0].pads).toEqual([{ to: 1 }])
  })
  it('several pads per knob: add copies the last pad, goes to the base, and has its own id; remove keeps the others', () => {
    const s0 = sk('osc(20, 0.1, 0.8).out()')
    const r = bindToPad(s0, callId(s0, 'osc'), 2, 0.8)!
    const t = updatePad(r.sketch, r.pad.id, { mode: 'trigger', value: 3 })
    const a = addPad(t, r.knob)
    expect(a.pad).toEqual(expect.objectContaining({ knob: r.knob, mode: 'trigger', value: 0.8, label: 'oscOffset 2', id: 'oscOffset#2' }))
    const b = addPad(a.sketch, r.knob, 1.5)
    expect(padsOf(b.sketch).map((p) => [p.label, p.value])).toEqual([['oscOffset', 3], ['oscOffset 2', 0.8], ['oscOffset 3', 1.5]])
    expect(toCode(b.sketch)).toContain("oscOffset = knob(0.8, { pads: [{ mode: 'trigger', to: 3, ease: 'easeOutQuad' }, { mode: 'trigger', to: 0.8, ease: 'easeOutQuad' }, { mode: 'trigger', to: 1.5, ease: 'easeOutQuad' }] })")
    const c = removePad(b.sketch, a.pad!.id)
    expect(padsOf(c).map((p) => [p.id, p.value])).toEqual([['oscOffset#1', 3], ['oscOffset#2', 1.5]])
    expect(knobDefs(c).map((k) => k.name)).toEqual([r.knob])
    // unbinding drops every pad of the knob
    expect(padsOf(unbindKnob(c, r.knob))).toEqual([])
    expect(addPad(c, 'nope').pad).toBeUndefined()
  })
  it('dock positions go to meta.kit.layout (moving a pad leaves the code alone) and the rest of meta.kit is kept', () => {
    const s0 = sk('osc().rotate(0.3).out()\n')
    const r = bindToPad(s0, callId(s0, 'rotate'), 0, 0.3)!
    const s1 = withKitMeta(r.sketch, { dock: true })
    const s2 = updatePad(s1, r.pad.id, { x: 0.5, y: 0.25 })
    expect(s2.stmts).toBe(s1.stmts)
    expect(padsOf(s2)[0]).toMatchObject({ x: 0.5, y: 0.25, id: r.pad.id })
    expect((s2.meta as { kit: { dock: boolean } }).kit.dock).toBe(true)
    const s3 = updatePad(s2, r.pad.id, { mode: 'latch' })
    expect(padsOf(s3)[0]).toMatchObject({ mode: 'latch', x: 0.5 })
  })
})

describe('playing a pad', () => {
  const calls: unknown[][] = []
  const invoke = (...a: unknown[]) => (calls.push(a), true)
  const pad = { id: 'p1', knob: 'k', label: 'k', mode: 'hold' as const, value: 0.9, attack: 0.1, release: 0.5, ease: 'easeOutQuad' }
  it('hold: press holds with its own id, release lets go of it', () => {
    calls.length = 0
    padPress(pad, invoke, 0.2)
    padRelease(pad, invoke)
    expect(calls).toEqual([
      ['k', 'hold', [0.9, 0.1, 'easeOutQuad', 'p1']],
      ['k', 'release', [0.5, 'easeOutQuad', 'p1']],
    ])
  })
  it('latch toggles between the value and the off value (default: the base)', () => {
    calls.length = 0
    const l = { ...pad, mode: 'latch' as const }
    const a = padPress(l, invoke, 0.2, false)
    const b = padPress(l, invoke, 0.2, a.on)
    padRelease(l, invoke)
    expect([a.on, b.on]).toEqual([true, false])
    expect(calls).toEqual([
      ['k', 'to', [0.9, 0.1, 'easeOutQuad']],
      ['k', 'to', [0.2, 0.5, 'easeOutQuad']],
    ])
  })
  it('trigger glides to the value; release does nothing', () => {
    calls.length = 0
    const t = { ...pad, mode: 'trigger' as const }
    padPress(t, invoke, 0)
    padRelease(t, invoke)
    expect(calls).toEqual([['k', 'to', [0.9, 0.1, 'easeOutQuad']]])
  })
})

describe('playing a pad through the knob (hydra-motion 0.2: k.press / k.lift)', () => {
  const calls: unknown[][] = []
  const invoke = (...a: unknown[]) => (calls.push(a), true)
  const pad = { id: 'k#2', knob: 'k', index: 1, label: 'k 2', mode: 'hold' as const, value: 0.9, attack: 0.1, release: 0.5, ease: 'easeOutQuad' }
  it('press and lift name the pad by its place in the code', () => {
    calls.length = 0
    padPress(pad, invoke, 0.2, false, true)
    padRelease(pad, invoke, true)
    padPress({ ...pad, mode: 'trigger' }, invoke, 0.2, false, true)
    padRelease({ ...pad, mode: 'trigger' }, invoke, true)
    expect(calls).toEqual([
      ['k', 'press', [1]],
      ['k', 'lift', [1]],
      ['k', 'press', [1]],
    ])
    const l = { ...pad, mode: 'latch' as const }
    expect(padPress(l, invoke, 0, false, true).on).toBe(true)
    expect(padPress(l, invoke, 0, true, true).on).toBe(false)
  })
  it('a pad read from before pads moved into the code (no index) still plays with hold / release', () => {
    calls.length = 0
    const { index: _i, ...legacy } = pad
    padPress(legacy, invoke, 0.2, false, true)
    padRelease(legacy, invoke, true)
    expect(calls.map((c) => c[1])).toEqual(['hold', 'release'])
  })
  it('only a sketch pinned to hydra-motion 0.2 or later plays through press / lift', () => {
    const s0 = sk('osc().rotate(0.3).out()\n')
    expect(motionPlaysPads(s0)).toBe(false)
    const r = bindToPad(s0, callId(s0, 'rotate'), 0, 0.3)!
    expect(r.pad.index).toBe(0)
    expect(motionPlaysPads(r.sketch)).toBe(true) // the registry's build
    const withVersion = (version: string) => ({ ...r.sketch, plugins: r.sketch.plugins!.map((p) => ({ ...p, version })) })
    expect(motionPlaysPads(withVersion('0.1.0'))).toBe(false)
    expect(motionPlaysPads(withVersion('0.2.0'))).toBe(true)
    expect(motionPlaysPads(withVersion('0.10.1'))).toBe(true)
    expect(motionPlaysPads(withVersion('1.0.0'))).toBe(true)
    expect(motionPlaysPads(withVersion('unknown'))).toBe(false)
    expect(padsOf(addPad(r.sketch, r.knob).sketch).map((p) => p.index)).toEqual([0, 1])
  })

  // the built plugin with a fake Hydra clock: k.press / k.lift must do exactly what the kit used to send for each mode
  const file = createRequire(import.meta.url).resolve('hydra-motion/dist/hydra-motion.js')
  const G: Record<string, any> = { console: { warn() {}, log() {} }, time: 0, bpm: 30 }
  G.window = G
  G.globalThis = G
  runInNewContext(readFileSync(file, 'utf8'), G)
  it.each(['hold', 'latch', 'trigger'] as const)('%s: press / lift on the knob match the hold / to / release calls', (mode) => {
    const p = { ...pad, index: 0, mode, value2: mode === 'latch' ? -1 : undefined }
    G.time = 0
    const viaPads = G.knob(0.2, { pads: [toKnobPad(p)] })
    const viaCalls = G.knob(0.2)
    const send = (k: any) => (name: string, method: string, args: unknown[]) => (k[method](...args), true)
    let onA = false
    let onB = false
    const seen: Array<[number, number]> = []
    const steps: Array<[number, 'down' | 'up']> = [[0, 'down'], [0.05, 'up'], [0.3, 'down'], [0.7, 'up'], [0.75, 'down'], [1.2, 'up']]
    for (let t = 0, i = 0; t <= 2; t = +(t + 0.025).toFixed(3)) {
      G.time = t
      while (i < steps.length && steps[i][0] <= t) {
        if (steps[i][1] === 'down') {
          onA = padPress(p, send(viaPads), 0.2, onA, true).on
          onB = padPress(p, send(viaCalls), 0.2, onB, false).on
        } else {
          padRelease(p, send(viaPads), true)
          padRelease(p, send(viaCalls), false)
        }
        i++
      }
      seen.push([viaPads(), viaCalls()])
    }
    for (const [a, b] of seen) expect(a).toBeCloseTo(b, 12)
    expect(new Set(seen.map(([a]) => a.toFixed(3))).size).toBeGreaterThan(3) // it actually moved
  })
})

describe('Loop between values', () => {
  it('writes plain Hydra: [a, b].smooth(1).ease(name).fast(n)', () => {
    const s0 = sk('osc(20, 0.1, 0.8).out()\n')
    const v = loopValue(20, 60, 2, 'easeInOutCubic', 30)
    const out = toCode(setArg(s0, callId(s0, 'osc'), 0, v))
    expect(out).toBe("osc([20, 60].smooth(1).ease('easeInOutCubic').fast(1), 0.1, 0.8).out()\n")
    expect((loopValue(0, 1, 1, 'linear', 120) as { mods: { fast: number } }).mods.fast).toBe(0.5)
  })
})
