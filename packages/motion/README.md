<!-- SPDX-License-Identifier: MIT -->
# hydra-motion

Glides, holds and pads for [Hydra](https://hydra.ojack.xyz). One small script (about 3.5 KB gzipped, no dependencies)
that adds **`knob`** and **`gate`**: functions that return a number, which Hydra already calls every frame.

```js
await loadScript('https://cdn.jsdelivr.net/gh/<owner>/<repo>@hydra-motion-v0.1.0/packages/motion/dist/hydra-motion.js')

k = knob(0.5)                     // k() returns the current number
osc(k, 0.1, 0.8).out()            // pass the knob itself (not k()): Hydra calls it every frame

k.to(1, 2, 'easeInOutCubic')      // glide to 1 over 2 seconds; retarget any time, it starts from where it is
k.to(0, '4b')                     // durations: seconds, '4b' (beats at Hydra's bpm), '1.5s', '250ms'
k.set(0.2)                        // jump
k.hold(0.9)                       // momentary: go to 0.9 (optionally hold(0.9, attackSeconds)) and stay…
k.release(0.15, 'easeOutQuad')    // …then glide back to where it was before the hold
```

The URL above is the form for tagged releases; use the exact tag you want (see CHANGELOG.md). Write `k = knob(…)`
(no `const`) so you can reach `k` from later evaluations.

## Knob

| | |
|---|---|
| `knob(initial = 0, { clock })` | `clock: 'hydra'` (default) follows Hydra's `time`, so `speed` scales it and `speed = 0` pauses glides; `'wall'` uses real time and keeps moving while Hydra is paused |
| `k()` / `k.value` | the current number (always a finite number) |
| `k.set(v)` | jump |
| `k.to(v, dur, ease)` | glide from the current value; calling it mid-glide retargets smoothly |
| `k.hold(v, attack, ease, id)` | momentary value; `hold(v, { attack, ease, id })` also works |
| `k.release(time, ease, id)` | end a hold (the most recent one when `id` is left out); `release({ time, ease, id })` also works |
| `k.releaseAll(time, ease)` | end every hold |
| `k.base` | the value the knob returns to when nothing holds it |
| `k.busy` | true while the visible value is moving |
| `k.held` | number of holds |
| `k.onDone(fn)` | `fn(value, k)` each time the knob settles; returns an unsubscribe function |
| `k.destroy()` | freeze at the current value |

**Holds stack** (two pads on one knob): the most recent hold wins; releasing it returns to the previous hold that is still
down, otherwise to the base. `k.to` and `k.set` while held move the base, not the held value, and a release glides
to wherever the base is by then.

**Easings** are Hydra's own set, the same names as arrays' `.ease(name)`: `linear`, `easeInQuad`, `easeOutQuad`,
`easeInOutQuad`, the same for `Cubic`, `Quart` and `Quint`, and `sin`. A function `t => …` (0..1 → 0..1) works too.

**Never throws into Hydra's frame.** Bad input is ignored, an easing function that throws is treated as linear,
and the knob keeps returning its last good number.

Note: `osc(k * 2)` evaluates once (it is a number by then). For arithmetic, pass a function: `osc(() => k() * 2)`.
Re-running the code makes fresh knobs, as with any variable.

## Gate

```js
g = gate({ attack: 0.02, release: 0.4, ease: 'easeOutQuad' })   // or ease: { attack, release }
osc(10).mult(solid(1, 1, 1), g).out()
g.down()   // rise to 1 over `attack`
g.up()     // fall to 0 over `release`
g.toggle(); g.open; g.busy; g.onDone(fn)
```

Retriggering mid-way keeps the same rate (a half-open gate takes half the attack time to open).

## Globals

Only `knob`, `gate` and `hydraMotion` (`version`, `knob`, `gate`, `easings`, `ease(name)`, `seconds(dur)`, `isKnob`,
`isGate`). If a global called `knob` or `gate` already exists it is left alone (a warning says so); use
`hydraMotion.knob(…)` then. Loading the script twice keeps the first copy.

## Build and test

```sh
npm install
npm run build   # dist/hydra-motion.js (ES2019, one file) and dist/easings.json
npm test        # node --test: unit tests with a fake clock, easing parity with hydra-synth's arrays, the built file
```

The easing names are read from the installed `hydra-synth` (a dev dependency) at build time; the curves are this
package's own code, and a test checks every curve against Hydra's array `.ease()` at the same fractions.

## Licence

MIT (`LICENSE`). The built file carries the licence in its header comment, so a sketch that inlines it stays attributed.
