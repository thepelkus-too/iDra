import { describe, expect, it } from 'vitest'
import { findMotionPlugin, importText, knobDefs, toCode, walkCalls, withMeta, type Sketch } from '@hydra-ipad/core'
import { bindToPad, knobBase, knobNameFor, livePads, padPress, padRelease, padsOf, setKnobBase, unbindKnob, updatePad, withKitMeta } from '../src/pads'
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
    expect(out).toMatch(/rotateAngle = knob\(0\.3\)\nosc\(20, 0\.1, 0\.8\)\n {2}\.rotate\(rotateAngle\)/)
    expect(out.indexOf('speed = 1')).toBeLessThan(out.indexOf('rotateAngle = knob'))
    expect(findMotionPlugin(r.sketch)).toBeTruthy()
    expect(knobDefs(r.sketch).map((k) => k.name)).toEqual(['rotateAngle'])
    expect(padsOf(r.sketch)).toEqual([expect.objectContaining({ knob: 'rotateAngle', mode: 'hold', label: 'rotate angle', value: 0.6 })])
    // other apps' meta untouched; ours only under meta.kit
    expect(Object.keys(r.sketch.meta ?? {})).toEqual(['kit'])
  })
  it('round-trips through the code (another editor reopening it keeps the binding)', () => {
    const s0 = sk(code)
    const r = bindToPad(s0, callId(s0, 'rotate'), 0, 0.3)!
    const again = importText(toCode(r.sketch)).sketch
    expect(knobDefs(again).map((k) => [k.name, k.initial])).toEqual([['rotateAngle', 0.3]])
  })
  it('a nested call binds before the statement that holds it', () => {
    const s0 = sk('noise(3).out(o1)\nosc(10).modulate(noise(3).scale(2), 0.1).out()\n')
    const nested = [...walkCalls(s0)].filter((x) => x.call.fn === 'scale')[0].call.id
    const r = bindToPad(s0, nested, 0, 2)!
    const out = toCode(r.sketch)
    expect(out.indexOf('scaleAmount = knob(2)')).toBeGreaterThan(out.indexOf('noise(3).out(o1)'))
    expect(out).toMatch(/scaleAmount = knob\(2\)\nosc\(10\)\.modulate\(noise\(3\)\.scale\(scaleAmount\)\)/)
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
  it('pads of an undone bind are kept but not live (they come back with redo)', () => {
    const s0 = withMeta(sk('osc().rotate(0.3).out()\n'), 'graph', { x: 1 })
    const r = bindToPad(s0, callId(s0, 'rotate'), 0, 0.3)!
    // undo restores statements but the editor keeps meta as it is now
    const undone = { ...r.sketch, stmts: s0.stmts }
    expect(padsOf(undone).length).toBe(1)
    expect(livePads(undone)).toEqual([])
    expect(livePads(r.sketch).length).toBe(1)
    expect((r.sketch.meta as Record<string, unknown>).graph).toEqual({ x: 1 })
  })
  it('updatePad and withKitMeta keep the rest of meta.kit', () => {
    const s0 = sk('osc().rotate(0.3).out()\n')
    const r = bindToPad(s0, callId(s0, 'rotate'), 0, 0.3)!
    const s1 = withKitMeta(r.sketch, { dock: true })
    const s2 = updatePad(s1, r.pad.id, { mode: 'latch', x: 0.5 })
    expect(padsOf(s2)[0]).toMatchObject({ mode: 'latch', x: 0.5, id: r.pad.id })
    expect((s2.meta as { kit: { dock: boolean } }).kit.dock).toBe(true)
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

describe('Loop between values', () => {
  it('writes plain Hydra: [a, b].smooth(1).ease(name).fast(n)', () => {
    const s0 = sk('osc(20, 0.1, 0.8).out()\n')
    const v = loopValue(20, 60, 2, 'easeInOutCubic', 30)
    const out = toCode(setArg(s0, callId(s0, 'osc'), 0, v))
    expect(out).toBe("osc([20, 60].smooth(1).ease('easeInOutCubic').fast(1), 0.1, 0.8).out()\n")
    expect((loopValue(0, 1, 1, 'linear', 120) as { mods: { fast: number } }).mods.fast).toBe(0.5)
  })
})
