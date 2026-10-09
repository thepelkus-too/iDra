// SPDX-License-Identifier: MIT
// hydra-motion core: knob() and gate(). No dependencies and no globals here; src/index.js installs them.
//
// A knob is a function that returns a number. Hydra already calls function arguments every frame, so `osc(k)` needs no
// integration. Everything else (glides, holds, the gate) is a few numbers and a clock.

import { easingTable } from './easing.js'

const finite = (x) => typeof x === 'number' && isFinite(x)

/**
 * @param {object} env
 * @param {string[]} env.easings   Hydra's easing names (from hydra-synth at build time)
 * @param {object}   [env.global]  where Hydra's `time` and `bpm` live (default: globalThis)
 * @param {function} [env.warn]    console.warn stand-in
 */
export function createMotion(env) {
  const G = env.global || (typeof globalThis !== 'undefined' ? globalThis : {})
  const warn = env.warn || ((...a) => G.console && G.console.warn && G.console.warn(...a))
  const EASE = easingTable(env.easings)
  const warned = {}
  const warnOnce = (key, msg) => {
    if (warned[key]) return
    warned[key] = true
    warn('hydra-motion: ' + msg)
  }

  // ------------------------------------------------------------ clocks and durations
  const wallNow = () => (G.performance && typeof G.performance.now === 'function' ? G.performance.now() : Date.now()) / 1000
  /** Hydra's global `time` (seconds, scaled by `speed`, stops when speed = 0); wall time until Hydra has started. */
  const hydraNow = () => (finite(G.time) ? G.time : wallNow())
  const bpmNow = () => (finite(G.bpm) && G.bpm > 0 ? G.bpm : 30)

  /** Seconds from a duration: a number of seconds, or a string: '2b' (beats at Hydra's bpm), '1.5s', '250ms'. */
  function seconds(d) {
    if (d === undefined || d === null || d === '') return 0
    if (typeof d === 'number') return finite(d) && d > 0 ? d : 0
    const m = /^\s*(\d*\.?\d+(?:e[+-]?\d+)?)\s*(b|beats?|s|sec|ms)?\s*$/i.exec(String(d))
    if (!m) {
      warnOnce('dur:' + d, `"${d}" is not a duration (use seconds, '2b' for beats, '500ms'); using 0`)
      return 0
    }
    const n = parseFloat(m[1])
    const unit = (m[2] || 's').toLowerCase()
    if (unit[0] === 'b') return (n * 60) / bpmNow()
    if (unit === 'ms') return n / 1000
    return n
  }

  /** A curve from a name in Hydra's set, or a function t → number. Unknown names fall back to linear (warned once). */
  function curve(e) {
    if (typeof e === 'function') return e
    if (e === undefined || e === null || e === '') return EASE.linear
    if (Object.prototype.hasOwnProperty.call(EASE, e)) return EASE[e]
    warnOnce('ease:' + e, `unknown easing "${e}", using linear. Names: ${Object.keys(EASE).join(', ')}`)
    return EASE.linear
  }
  const shape = (f, p) => {
    let y
    try {
      y = f(p)
    } catch (err) {
      y = NaN
    }
    return finite(y) ? y : p
  }

  /** hold(v, attack, ease, id) or hold(v, { attack, ease, id }); release(time, ease, id) or release({ time, ease, id }) */
  const opts3 = (a, b, c, keys) => (a && typeof a === 'object' ? [a[keys[0]], a[keys[1]], a[keys[2]]] : [a, b, c])

  let nextHold = 1

  // ------------------------------------------------------------ knob
  function knob(initial, options) {
    const o = options && typeof options === 'object' ? options : {}
    const now = typeof o.now === 'function' ? o.now : o.clock === 'wall' ? wallNow : hydraNow
    let last = finite(initial) ? initial : 0
    // base: where the knob sits when nothing holds it (a glide from → to, or a constant when dur is 0)
    let base = { from: last, to: last, t0: 0, dur: 0, ease: EASE.linear }
    // holds: momentary values, most recent last; the most recent one is what you see
    let holds = []
    // tr: a transition of the visible value from `from` towards the current target (attack / release / retargeting)
    let tr = null
    let destroyed = false
    let wasBusy = false
    const listeners = []
    let polling = false

    const clock = () => {
      const t = now()
      return finite(t) ? t : wallNow()
    }
    // progress 0..1 of a segment; a clock that went backwards (Hydra's time was reset) restarts the segment from there
    const progress = (seg, t) => {
      if (!(seg.dur > 0)) return 1
      let p = (t - seg.t0) / seg.dur
      if (p < 0) {
        seg.t0 = t
        p = 0
      }
      return p >= 1 ? 1 : p
    }
    const baseAt = (t) => {
      const p = progress(base, t)
      if (p >= 1) {
        if (base.dur) base = { from: base.to, to: base.to, t0: t, dur: 0, ease: EASE.linear }
        return base.to
      }
      return base.from + (base.to - base.from) * shape(base.ease, p)
    }
    const target = (t) => (holds.length ? holds[holds.length - 1].value : baseAt(t))
    const evaluate = (t) => {
      const goal = target(t)
      if (tr) {
        const p = progress(tr, t)
        if (p >= 1) tr = null
        else return tr.from + (goal - tr.from) * shape(tr.ease, p)
      }
      return goal
    }
    const busyAt = () => !!tr || (!holds.length && base.dur > 0)

    function read() {
      if (destroyed) return last
      try {
        const v = evaluate(clock())
        if (finite(v)) last = v
      } catch (err) {
        /* never throw into Hydra's frame: keep the last good value */
      }
      const busy = busyAt()
      if (wasBusy && !busy) settle()
      wasBusy = busy
      return last
    }
    function settle() {
      for (const fn of listeners.slice()) {
        try {
          fn(last, k)
        } catch (err) {
          warnOnce('ondone', 'an onDone callback threw: ' + (err && err.message))
        }
      }
    }
    // onDone needs someone to look at the value; when nothing in the sketch reads the knob, poll while it moves
    function moved() {
      wasBusy = true
      if (!listeners.length || polling) return
      const raf = typeof G.requestAnimationFrame === 'function' ? (f) => G.requestAnimationFrame(f) : typeof G.setTimeout === 'function' ? (f) => G.setTimeout(f, 16) : null
      if (!raf) return
      polling = true
      const tick = () => {
        read()
        if (!destroyed && wasBusy) raf(tick)
        else polling = false
      }
      raf(tick)
    }

    const k = function hydraMotionKnob() {
      return read()
    }
    const current = (t) => {
      try {
        const v = evaluate(t)
        return finite(v) ? v : last
      } catch (err) {
        return last
      }
    }

    k.set = function set(v) {
      if (destroyed || !finite(v)) return k
      const t = clock()
      base = { from: v, to: v, t0: t, dur: 0, ease: EASE.linear }
      if (!holds.length) {
        tr = null
        last = v
      }
      read()
      return k
    }
    k.to = function to(v, dur, ease) {
      if (destroyed || !finite(v)) return k
      const t = clock()
      const d = seconds(dur)
      // not held: glide from what you see now (also mid-glide or mid-release); held: move the base behind the hold
      const from = holds.length ? baseAt(t) : current(t)
      if (!holds.length) tr = null
      base = d > 0 ? { from, to: v, t0: t, dur: d, ease: curve(ease) } : { from: v, to: v, t0: t, dur: 0, ease: EASE.linear }
      if (d > 0) moved()
      read()
      return k
    }
    k.hold = function hold(v, attack, ease, id) {
      ;[attack, ease, id] = opts3(attack, ease, id, ['attack', 'ease', 'id'])
      if (destroyed || !finite(v)) return k
      const t = clock()
      const from = current(t)
      const key = id === undefined || id === null || id === '' ? '#' + nextHold++ : String(id)
      holds = holds.filter((h) => h.id !== key)
      holds.push({ id: key, value: v })
      const d = seconds(attack)
      tr = d > 0 ? { from, t0: t, dur: d, ease: curve(ease) } : null
      if (d > 0) moved()
      read()
      return k
    }
    k.release = function release(time, ease, id) {
      ;[time, ease, id] = opts3(time, ease, id, ['time', 'ease', 'id'])
      if (destroyed || !holds.length) return k
      const key = id === undefined || id === null || id === '' ? holds[holds.length - 1].id : String(id)
      const i = holds.findIndex((h) => h.id === key)
      if (i < 0) return k
      const t = clock()
      const top = i === holds.length - 1
      const from = current(t)
      holds.splice(i, 1)
      if (top) {
        // back to the previous still-held value, else the base (which may itself still be gliding)
        const d = seconds(time)
        tr = d > 0 ? { from, t0: t, dur: d, ease: curve(ease) } : null
        if (d > 0) moved()
        else wasBusy = true
      }
      read()
      return k
    }
    k.releaseAll = function releaseAll(time, ease) {
      if (destroyed || !holds.length) return k
      const keep = holds[holds.length - 1]
      holds = [keep]
      return k.release(time, ease, keep.id)
    }
    k.onDone = function onDone(fn) {
      if (typeof fn !== 'function') return () => {}
      listeners.push(fn)
      if (busyAt()) moved()
      return () => {
        const i = listeners.indexOf(fn)
        if (i >= 0) listeners.splice(i, 1)
      }
    }
    k.destroy = function destroy() {
      read()
      destroyed = true
      listeners.length = 0
      return k
    }
    Object.defineProperties(k, {
      value: { get: read, enumerable: true },
      base: { get: () => (destroyed ? last : baseAt(clock())), enumerable: true },
      busy: { get: () => (read(), !destroyed && busyAt()), enumerable: true },
      held: { get: () => holds.length, enumerable: true },
      destroyed: { get: () => destroyed, enumerable: true },
      __hydraMotion: { value: 'knob' },
    })
    k.valueOf = read
    k.toString = () => String(read())
    return k
  }

  // ------------------------------------------------------------ gate
  /** An envelope 0..1: down() rises over `attack`, up() falls over `release`. Retriggering mid-way keeps the same rate. */
  function gate(options) {
    const o = options && typeof options === 'object' ? options : {}
    const k = knob(0, o)
    const attack = () => seconds(o.attack === undefined ? 0.01 : o.attack)
    const release = () => seconds(o.release === undefined ? 0.1 : o.release)
    const ease = (which) => (o.ease && typeof o.ease === 'object' ? o.ease[which] : o.ease)
    let open = false
    const g = function hydraMotionGate() {
      const v = k()
      return v < 0 ? 0 : v > 1 ? 1 : v
    }
    g.down = function down() {
      open = true
      k.to(1, attack() * (1 - clamp01(k())), ease('attack'))
      return g
    }
    g.up = function up() {
      open = false
      k.to(0, release() * clamp01(k()), ease('release'))
      return g
    }
    g.toggle = () => (open ? g.up() : g.down())
    g.onDone = (fn) => k.onDone((v) => fn(clamp01(v), g))
    g.destroy = () => (k.destroy(), g)
    Object.defineProperties(g, {
      value: { get: g, enumerable: true },
      open: { get: () => open, enumerable: true },
      busy: { get: () => k.busy, enumerable: true },
      __hydraMotion: { value: 'gate' },
    })
    g.valueOf = g
    g.toString = () => String(g())
    return g
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

  return {
    knob,
    gate,
    seconds,
    easings: Object.keys(EASE),
    ease: (name) => curve(name),
    isKnob: (x) => typeof x === 'function' && x.__hydraMotion === 'knob',
    isGate: (x) => typeof x === 'function' && x.__hydraMotion === 'gate',
  }
}
