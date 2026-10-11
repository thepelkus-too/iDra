import { describe, expect, it } from 'vitest'
import { ease } from '../src/easing'
import { Session, glideBack, glideField, returnValue, type NumberField } from '../src/field'
import { Glide, glideOf, parseDuration, type Clock } from '../src/glide'

/** A clock you step by hand: frames run only when `advance` is called. */
function fakeClock() {
  let t = 0
  let queue: Array<{ id: number; cb: () => void }> = []
  let seq = 0
  const c: Clock & { advance(ms: number, frame?: number): void; pending(): number } = {
    now: () => t,
    frame: (cb) => {
      const id = ++seq
      queue.push({ id, cb })
      return id
    },
    cancel: (h) => {
      queue = queue.filter((q) => q.id !== h)
    },
    advance(ms, frame = 16) {
      const end = t + ms
      while (t < end) {
        t = Math.min(end, t + frame)
        const q = queue
        queue = []
        q.forEach((x) => x.cb())
      }
    },
    pending: () => queue.length,
  }
  return c
}

/** An editor in miniature: a store with coalescing undo, a live slot, a change subscription. */
function fakeEditor(initial: number, opts: { live?: boolean; hint?: NumberField['hint'] } = {}) {
  const ed = {
    value: initial,
    undo: [] as number[],
    group: false,
    liveValue: initial,
    liveCalls: 0,
    commits: 0,
    subs: new Set<() => void>(),
    set(v: number) {
      if (!ed.group) ed.undo.push(ed.value)
      ed.value = v
      ed.liveValue = v
      ed.commits++
      ed.subs.forEach((s) => s())
    },
  }
  const field: NumberField = {
    id: 'osc.frequency',
    label: 'osc frequency',
    hint: opts.hint ?? { min: 0, max: 100, step: 0.1 },
    get: () => ed.value,
    onChange: (v, ph) => {
      if (ph === 'end') {
        ed.group = false
        return
      }
      ed.set(v)
      ed.group = true
    },
    live: opts.live === false ? undefined : (v) => ((ed.liveValue = v), ed.liveCalls++, true),
  }
  const subscribe = (cb: () => void) => (ed.subs.add(cb), () => void ed.subs.delete(cb))
  return { ed, field, subscribe }
}

describe('parseDuration', () => {
  it('reads seconds, ms and beats', () => {
    expect(parseDuration('2')).toBe(2)
    expect(parseDuration('1.5s')).toBe(1.5)
    expect(parseDuration('250ms')).toBe(0.25)
    expect(parseDuration('2b')).toBe(4) // Hydra's default bpm 30: 2 s per beat
    expect(parseDuration('2b', 120)).toBe(1)
    expect(parseDuration('.5')).toBe(0.5)
    expect(parseDuration('fast')).toBeUndefined()
    expect(parseDuration('-1')).toBeUndefined()
  })
})

describe('Glide (fake clock)', () => {
  it('follows the curve and lands exactly on the target', () => {
    const c = fakeClock()
    const frames: number[] = []
    let done: number | undefined
    const g = new Glide({ from: 0, to: 10, seconds: 1, ease: 'easeInOutCubic', onFrame: (v) => frames.push(v), onDone: (v) => (done = v) }, c).start()
    expect(g.at(500)).toBeCloseTo(10 * ease('easeInOutCubic')(0.5))
    c.advance(250)
    expect(frames[frames.length - 1]).toBeCloseTo(10 * ease('easeInOutCubic')(0.25), 6)
    expect(done).toBeUndefined()
    c.advance(800)
    expect(done).toBe(10)
    expect(g.running).toBe(false)
    expect(c.pending()).toBe(0)
    // monotonic for a monotonic curve, no repeats
    for (let i = 1; i < frames.length; i++) expect(frames[i]).toBeGreaterThan(frames[i - 1])
  })
  it('zero duration jumps', () => {
    const c = fakeClock()
    let done: number | undefined
    new Glide({ from: 0, to: 3, seconds: 0, ease: 'linear', onFrame: () => {}, onDone: (v) => (done = v) }, c).start()
    expect(done).toBe(3)
  })
  it('cancel stops where it is and frees the frame', () => {
    const c = fakeClock()
    let cancelled: number | undefined
    const g = new Glide({ from: 0, to: 10, seconds: 1, ease: 'linear', onFrame: () => {}, onDone: () => {}, onCancel: (v) => (cancelled = v) }, c).start()
    c.advance(400)
    g.cancel()
    expect(cancelled).toBeCloseTo(4, 1)
    expect(c.pending()).toBe(0)
  })
})

describe('glideField: live frames, one undo step', () => {
  it('pushes frames on the live path and commits the final number once', () => {
    const c = fakeClock()
    const { ed, field, subscribe } = fakeEditor(20)
    glideField(field, 80, { seconds: 2, ease: 'linear', clock: c, subscribe })
    c.advance(1000)
    expect(ed.value).toBe(20) // the IR is untouched while it glides
    expect(ed.liveValue).toBeCloseTo(50, 0)
    expect(ed.liveCalls).toBeGreaterThan(30)
    c.advance(1100)
    expect(ed.value).toBe(80)
    expect(ed.commits).toBe(1)
    expect(ed.undo).toEqual([20]) // one undo step, back to 20
    expect(returnValue(field.id)).toBe(20)
  })
  it('without a live path, frames go through the drag path and still make one undo step', () => {
    const c = fakeClock()
    const { ed, field, subscribe } = fakeEditor(0, { live: false })
    glideField(field, 1, { seconds: 1, ease: 'easeOutQuad', clock: c, subscribe })
    c.advance(1200)
    expect(ed.value).toBe(1)
    expect(ed.commits).toBeGreaterThan(10)
    expect(ed.undo).toEqual([0])
  })
  it('rounds integer inputs on every frame', () => {
    const c = fakeClock()
    const seen = new Set<number>()
    const { field, subscribe } = fakeEditor(3, { hint: { min: 3, max: 12, step: 1, integer: true } })
    field.live = (v) => (seen.add(v), true)
    glideField(field, 9, { seconds: 1, ease: 'linear', clock: c, subscribe })
    c.advance(1200)
    for (const v of seen) expect(Number.isInteger(v)).toBe(true)
  })
  it('another edit of the number cancels the glide cleanly (no commit over it)', () => {
    const c = fakeClock()
    const { ed, field, subscribe } = fakeEditor(0)
    const g = glideField(field, 10, { seconds: 1, ease: 'linear', clock: c, subscribe })
    c.advance(300)
    ed.set(42) // someone typed 42 (or dragged it)
    ed.group = false
    expect(g.running).toBe(false)
    expect(glideOf(field.id)).toBeUndefined()
    c.advance(1000)
    expect(ed.value).toBe(42)
    expect(ed.undo).toEqual([0])
  })
  it('retargeting mid-glide continues from where it is, as one undo step; return goes back to the first start', () => {
    const c = fakeClock()
    const { ed, field, subscribe } = fakeEditor(0)
    glideField(field, 10, { seconds: 1, ease: 'linear', clock: c, subscribe })
    c.advance(500)
    const mid = glideOf(field.id)!.value
    const g2 = glideField(field, 2, { seconds: 1, ease: 'linear', clock: c, subscribe })
    expect(g2.spec.from).toBeCloseTo(mid)
    c.advance(1100)
    expect(ed.value).toBe(2)
    expect(ed.undo).toEqual([0])
    expect(returnValue(field.id)).toBe(0)
    glideBack(field, { seconds: 0.5, ease: 'linear', clock: c, subscribe })
    c.advance(600)
    expect(ed.value).toBe(0)
    expect(ed.undo).toEqual([0, 2])
  })
})

describe('Session (the ladder commit)', () => {
  it('revert leaves the document untouched', () => {
    const { ed, field } = fakeEditor(5)
    const s = new Session(field)
    s.push(6)
    s.push(7)
    s.revert()
    expect(ed.value).toBe(5)
    expect(ed.liveValue).toBe(5)
    expect(ed.commits).toBe(0)
  })
  it('commit is one undo step', () => {
    const { ed, field } = fakeEditor(5)
    const s = new Session(field)
    s.push(6)
    s.push(7)
    s.commit()
    expect(ed.value).toBe(7)
    expect(ed.undo).toEqual([5])
  })
  it('committing the unchanged value writes nothing', () => {
    const { ed, field } = fakeEditor(5)
    new Session(field).commit()
    expect(ed.commits).toBe(0)
  })
})
