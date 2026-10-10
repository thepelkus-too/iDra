// SPDX-License-Identifier: MIT
// Unit tests with a fake clock: Hydra's `time` and `bpm` live on a plain object passed as the global.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMotion } from '../src/motion.js'
import { hydraEasingNames } from '../scripts/hydra-paths.mjs'

const names = await hydraEasingNames()
const setup = () => {
  const G = { time: 0, bpm: 30, warnings: [] }
  const m = createMotion({ easings: names, global: G, warn: (msg) => G.warnings.push(msg) })
  return { G, m }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} expected ${b}, got ${a}`)

test('knob() returns its number; set jumps', () => {
  const { G, m } = setup()
  const k = m.knob(0.5)
  assert.equal(typeof k, 'function')
  near(k(), 0.5)
  k.set(0.2)
  near(k(), 0.2)
  near(k.value, 0.2)
  near(k.base, 0.2)
  G.time = 10
  near(k(), 0.2)
  assert.equal(+k, 0.2)
})

test('to glides over seconds with an easing, and onDone fires once it settles', () => {
  const { G, m } = setup()
  const k = m.knob(0)
  const done = []
  k.onDone((v) => done.push(v))
  k.to(1, 2) // linear
  assert.equal(k.busy, true)
  G.time = 1
  near(k(), 0.5)
  G.time = 1.5
  near(k(), 0.75)
  G.time = 2
  near(k(), 1)
  assert.equal(k.busy, false)
  assert.deepEqual(done, [1])
  k.to(0, 1, 'easeInQuad')
  G.time = 2.5
  near(k(), 1 - 0.25)
})

test('to retargets mid-flight starting from the current value', () => {
  const { G, m } = setup()
  const k = m.knob(0)
  k.to(1, 2)
  G.time = 1
  near(k(), 0.5)
  k.to(0, 1)
  near(k(), 0.5, 'no jump at retarget')
  G.time = 1.5
  near(k(), 0.25)
  G.time = 2
  near(k(), 0)
})

test('hold and release: momentary value, then back to the base', () => {
  const { G, m } = setup()
  const k = m.knob(0.3)
  k.hold(0.9)
  near(k(), 0.9)
  near(k.base, 0.3)
  assert.equal(k.held, 1)
  k.release(1)
  near(k(), 0.9)
  G.time = 0.5
  near(k(), 0.6)
  G.time = 1
  near(k(), 0.3)
  assert.equal(k.held, 0)
  // attack time
  k.hold(1, 2)
  near(k(), 0.3)
  G.time = 2
  near(k(), 0.65)
  k.release() // immediate
  near(k(), 0.3)
  // options-object form
  k.hold(0.8, { attack: 0, id: 'pad' })
  near(k(), 0.8)
  k.release({ time: 0, id: 'pad' })
  near(k(), 0.3)
})

test('stacked holds: most recent wins; releasing it returns to the still-held one, else the base', () => {
  const { G, m } = setup()
  const k = m.knob(0)
  k.hold(0.9, 0, 'linear', 'A')
  k.hold(0.1, 0, 'linear', 'B')
  near(k(), 0.1)
  k.release(0, 'linear', 'B')
  near(k(), 0.9, 'back to A')
  k.release(0, 'linear', 'A')
  near(k(), 0, 'back to base')
  // release the older one first: the newer stays visible
  k.hold(0.9, 0, 'linear', 'A')
  k.hold(0.1, 0, 'linear', 'B')
  k.release(0, 'linear', 'A')
  near(k(), 0.1)
  k.release(0, 'linear', 'B')
  near(k(), 0)
  // release with no id releases the most recent
  k.hold(0.5)
  k.hold(0.7)
  k.release()
  near(k(), 0.5)
  k.releaseAll(1)
  G.time = 0.5
  near(k(), 0.25)
  // releasing an unknown id does nothing
  k.release(0, 'linear', 'nope')
  assert.equal(k.held, 0)
})

test('to and set while held change the base, not the held value', () => {
  const { G, m } = setup()
  const k = m.knob(0)
  k.hold(1)
  k.set(0.4)
  near(k(), 1)
  near(k.base, 0.4)
  k.to(0.8, 2)
  G.time = 1
  near(k(), 1, 'still held')
  near(k.base, 0.6)
  k.release(1)
  G.time = 1.5
  // release glides from 1 towards the moving base (0.7 at t=1.5) halfway
  near(k(), 1 + (0.7 - 1) * 0.5)
  G.time = 3
  near(k(), 0.8)
})

test('beat durations follow Hydra bpm at the time of the call', () => {
  for (const bpm of [30, 60, 120]) {
    const { G, m } = setup()
    G.bpm = bpm
    const k = m.knob(0)
    k.to(1, '2b')
    const total = (2 * 60) / bpm
    G.time = total / 2
    near(k(), 0.5, `bpm ${bpm}`)
    G.time = total
    near(k(), 1)
  }
  const { m } = setup()
  near(m.seconds('500ms'), 0.5)
  near(m.seconds('1.5s'), 1.5)
  near(m.seconds(2), 2)
  assert.equal(m.seconds(-1), 0)
  assert.equal(m.seconds('soon'), 0)
})

test('easing parity: knob.to traces the same curve as Hydra\'s array .ease(name)', async () => {
  const { arrayUtilsFile } = await import('../scripts/hydra-paths.mjs')
  const ArrayUtils = (await import(arrayUtilsFile)).default
  ArrayUtils.init()
  const fractions = [0, 0.05, 0.1, 0.25, 0.333, 0.5, 0.6, 0.75, 0.9, 0.99]
  assert.ok(names.length >= 14, 'Hydra has its easing set')
  for (const name of names) {
    // [0, 1].smooth(1).ease(name): with bpm 60 the value at time f + 0.5 is ease(f) between 0 and 1
    const arr = [0, 1].smooth(1).ease(name)
    const hydraAt = ArrayUtils.getValue(arr)
    const { G, m } = setup()
    const k = m.knob(0)
    k.to(1, 1, name)
    for (const f of fractions) {
      G.time = f
      const ours = k()
      const theirs = hydraAt({ time: f + 0.5, bpm: 60 })
      assert.ok(Math.abs(ours - theirs) < 1e-12, `${name} at ${f}: ${ours} vs Hydra ${theirs}`)
    }
  }
  assert.deepEqual(setup().m.easings, names)
})

test('a function works as an easing; a bad one never throws', () => {
  const { G, m } = setup()
  const k = m.knob(0)
  k.to(1, 1, (t) => t * t * t)
  G.time = 0.5
  near(k(), 0.125)
  k.to(0, 1, () => { throw new Error('boom') })
  G.time = 1
  assert.ok(Number.isFinite(k()))
  k.to(0, 1, 'nonsense')
  assert.ok(G.warnings.some((w) => /unknown easing "nonsense"/.test(w)))
})

test('returns only numbers; destroyed or non-numeric input keeps the last good value', () => {
  const { G, m } = setup()
  const k = m.knob('x')
  near(k(), 0)
  k.set(NaN)
  near(k(), 0)
  k.to(Infinity, 1)
  near(k(), 0)
  k.set(0.7)
  k.destroy()
  k.set(0.1)
  near(k(), 0.7)
  G.time = 'garbage'
  near(k(), 0.7)
  const k2 = m.knob(0.2)
  G.time = undefined // Hydra not started: falls back to wall time, still a number
  assert.equal(typeof k2(), 'number')
})

test('gate: envelope 0..1, retriggering keeps the rate', () => {
  const { G, m } = setup()
  const g = m.gate({ attack: 1, release: 2 })
  near(g(), 0)
  g.down()
  assert.equal(g.open, true)
  G.time = 0.5
  near(g(), 0.5)
  g.up()
  G.time = 1
  near(g(), 0.25) // from 0.5 at 1 per second over 2 s for the full range
  g.down()
  G.time = 1.75
  near(g(), 1)
  g.toggle()
  assert.equal(g.open, false)
  assert.equal(m.isGate(g), true)
  assert.equal(m.isKnob(g), false)
})

test('hydra clock pauses with speed = 0 (time stops); wall clock keeps going', () => {
  let wall = 100
  const G = { time: 5, bpm: 30, performance: { now: () => wall * 1000 } }
  const m = createMotion({ easings: names, global: G })
  const kh = m.knob(0)
  const kw = m.knob(0, { clock: 'wall' })
  kh.to(1, 1)
  kw.to(1, 1)
  wall += 0.5 // time does not move: Hydra is paused
  near(kh(), 0)
  near(kw(), 0.5)
  G.time = 5.5
  near(kh(), 0.5)
  // a hold with no attack shows at once even while paused
  kh.hold(0.9)
  near(kh(), 0.9)
  // a custom clock
  let t = 0
  const kc = m.knob(0, { now: () => t })
  kc.to(1, 4)
  t = 1
  near(kc(), 0.25)
})

test('Hydra resetting its time restarts a glide instead of stalling', () => {
  const { G, m } = setup()
  G.time = 100
  const k = m.knob(0)
  k.to(1, 2)
  G.time = 0
  near(k(), 0)
  G.time = 1
  near(k(), 0.5)
})
