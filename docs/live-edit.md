# Fast numeric edits: what we found

**Goal:** dragging a number must feel instant. **Constraint:** hydra-synth bakes some numbers into shader source.

## How hydra-synth treats an argument (from `src/format-arguments.js`, v1.4.0)

| argument | what happens | cost of changing it |
|---|---|---|
| `number` | `ensure_decimal_dot(value)` — the literal is **pasted into the GLSL string** (`osc(…, 20., 0.1, 0.8)`) | a different fragment-shader string → new compile + link every time |
| `function` | wrapped in a closure, `isUniform = true`, becomes `uniform float <name><index>` read **every frame** | none: the shader text is unchanged |
| `array` | same as function (`arrayUtils.getValue(arr)`), a uniform that steps with `time * speed * bpm/60` | none |
| texture / `oN` / `sN` | `sampler2D` uniform | none |

(regl caches programs by source text, so going back to a value you already used does not relink; a drag through new values does.)

## What we do

`toRunnable(sketch, { live: true })` (used by `runtime.run`) emits every plain `num` argument of a catalog `float` input as a closure
over a live table that lives in the sketch frame:

```js
osc(() => __hl["cabc12:0"], () => __hl["cabc12:1"], 0.8)     // before
__hl = { "cabc12:0": 20, "cabc12:1": 0.1 }                    // initial live table (sent with the run message)
```

* The **generated code does not contain the numbers**, so two sketches that differ only in numbers produce byte-identical code.
  `runtime.run()` compares the code with the last evaluated code: identical → it only queues the changed live values
  (`RunResult.recompiled === false`); different (add/remove/reorder/change a function, change an array/function/var, edit raw code) → one re-evaluation.
* `runtime.setLive(id, v)` / `setLiveBatch(table)` are fire-and-forget; calls are coalesced to **one `postMessage` per animation frame** (`liveMessages` in `runtime.stats`).
  Ids come from `liveId(call.id, argIndex)`.
* Only `float` inputs of functions in the catalog are live-ised; `vec4`, textures, arrays, unknown plugin functions stay as written. Every other value kind still recompiles.
* A number that is *already* a function/array stays what it is.

## Measured (`node scripts/live-edit-bench.mjs`, Chromium, software WebGL — counts are GPU-independent, milliseconds are not device numbers)

| scenario | edits | `linkProgram` | `compileShader` |
|---|---|---|---|
| A. number edited in the text, re-run (`osc(11..50, 0.1).rotate(0.5)`) | 40 | **40** | **40** |
| B. same edit through `runtime.run(sketch)` (live mode) | 40 | **0** | **0** (`recompiles` = 0) |
| C. `setLive` ×2000 in bursts of 200 per frame | 2000 calls | 0 | 0, → **10 messages** (one per frame), ≈0.7 µs CPU per call on the main thread |

Visual equivalence is part of the e2e run: for 10 seeded random sketches (with `speed = 0` so time is frozen) the live-closure render and the
baked-number render are **pixel-identical** (0 of 5184 sampled pixels differ by more than 3/255).

## Trade-offs

* A per-frame JS call for every live number (a closure returning `table[id]`) — negligible next to rendering, but it is not zero; a sketch with hundreds of numbers pays hundreds of calls per frame. Uniform upload happens for every function argument whether or not it changed.
* GLSL constant folding is lost for those numbers (every Hydra function takes them as ordinary `float`s and the only loops have constant bounds, so nothing breaks; the GPU does a few more multiplies).
* The first run of a sketch compiles a slightly different shader than the text version would. The exported text is unaffected (`toCode` always writes numbers).
* Across the iframe boundary a drag costs one small structured-clone message per frame; there is no per-event async round trip.
* If an editor wants *exactly* the baked behaviour (e.g. benchmarking), `toRunnable(sketch, { live: false })` is available.
