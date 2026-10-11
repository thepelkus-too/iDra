# hydra-motion: glides, holds and pads

Everything iDra does for animated values is ordinary Hydra code plus one small MIT plugin that anyone can load by hand,
so a sketch exported from iDra runs in vanilla Hydra (https://hydra.ojack.xyz). The UI only writes that code and calls the
same methods a person could type.

The plugin lives in `packages/motion` (MIT; the rest of the repo is AGPL-3.0-only) as a self-contained workspace that will
move to its own repository (`packages/motion/EXTRACTING.md`). iDra consumes only its **public surface**: the built file
`dist/hydra-motion.js`, `dist/easings.json`, and this document.

## The plugin (frozen surface: 0.1.x, plus the pads added in 0.2.0)

```js
k = knob(0.5)                     // a function: k() → number; Hydra calls it every frame
osc(k, 0.1, 0.8).out()
k.to(1, 2, 'easeInOutCubic')      // glide from wherever it is now (retargetable mid-flight)
k.set(0.2)                        // jump
k.hold(0.9, 0)                    // momentary: go to 0.9 (attack seconds), stay
k.release(0.15, 'easeOutQuad')    // glide back to the value from before the hold

p = knob(0.5, { pads: [{ mode: 'hold', to: 1 }, { mode: 'latch', to: 0 }] })   // 0.2.0: pads written in the code
p.press(0)                        // what iDra's pad buttons do: Hold goes to 1 and stays…
p.lift(0)                         // …until lifted; p.press(1) toggles the latch between 0 and 0.5
```

| member | meaning |
|---|---|
| `knob(initial = 0, { clock: 'hydra' \| 'wall', now, pads })` | a knob; `now` is a custom clock in seconds (tests); `pads` (0.2.0) below |
| `k()`, `k.value`, `+k` | current number; always finite, last good value on bad input |
| `k.set(v)` | jump (while held: moves the base) |
| `k.to(v, dur, ease)` | glide from the current value (while held: glides the base behind the hold) |
| `k.hold(v, attack?, ease?, id?)` / `k.hold(v, { attack, ease, id })` | push a momentary value; the same `id` replaces its own hold |
| `k.release(time?, ease?, id?)` / `k.release({ time, ease, id })` | pop a hold (default: the most recent) |
| `k.releaseAll(time?, ease?)` | pop every hold |
| `k.base`, `k.busy`, `k.held`, `k.destroyed` | base value, moving?, number of holds, frozen? |
| `k.press(i = 0)` / `k.lift(i = 0)` (0.2.0) | play pad `i` of the `pads` option, see **Pads**; anything else is a no-op |
| `k.pads` (0.2.0) | the pads as the knob read them (frozen; a pad it could not read is `null`) |
| `k.onDone(fn)` | `fn(value, k)` each time it settles; returns unsubscribe |
| `k.destroy()` | freeze |
| `gate({ attack = 0.01, release = 0.1, ease, clock })` | envelope 0..1: `g.down()`, `g.up()`, `g.toggle()`, `g()`, `g.open`, `g.busy`, `g.onDone` |
| `hydraMotion` | `{ version, knob, gate, easings, ease(name), seconds(dur), isKnob(x), isGate(x) }` |

**Stacked holds.** Most recent hold wins. Releasing it returns to the previous hold still down, else to the base. Releasing
an older hold changes nothing visible. A release glides towards the base's *current* value (it may itself be gliding).

**Pads (0.2.0).** `knob(0.5, { pads: [{ mode, to, off, attack, release, ease }, …] })` is the format iDra's pad editor
writes, and `k.press(i)` / `k.lift(i)` are what its pad buttons call, so a sketch plays its pads the same way in vanilla
Hydra. *Hold* (the default mode): press holds `to` (over `attack`) under the pad's own hold id, lift releases it (over
`release`), so two pads held at once stack like any two holds. *Trigger*: press glides to `to` over `attack` and it stays;
lift does nothing. *Latch*: each press toggles, to `to` over `attack`, then back to `off` over `release`; lift does nothing.
Left-out fields take the pad editor's defaults: `attack` 0, `release` 0.15, `ease` `'easeOutQuad'`, and `off` is the
knob's initial number. A pad without a number `to` (or an unknown mode, which plays as Hold) is warned about once. The
latch state lives in the knob, so re-running the code starts every latch off. 0.1.0 ignores the option.

**Durations.** A number is seconds. Strings: `'2b'` beats at Hydra's `bpm` when the call is made (`60 / bpm` seconds per
beat; Hydra's default bpm is 30, the same beat Hydra's arrays step on), `'1.5s'`, `'250ms'`. Anything else is 0 (warned once).

**Clocks.**
* `'hydra'` (default): Hydra's global `time`. It advances by `dt × speed`, so `speed = 2` doubles glide speed and
  `speed = 0` **pauses glides and releases** (a hold with no attack still shows at once; its release finishes when the clock
  runs again). Before Hydra has started, wall time. If `time` jumps backwards, a running glide restarts from there.
* `'wall'`: `performance.now()`. Ignores `speed`; keeps moving while Hydra is paused. Beats still use `bpm`.

**Easings.** Hydra's own names, the set arrays accept in `.ease(name)`: read from the installed hydra-synth's
`easing-functions.js` at build time (never copied by hand) into the built file and `dist/easings.json`. The curves are the
plugin's own code, written from their definitions (no code from hydra-synth, which is AGPL), and a parity test checks every
name against Hydra's array `.ease()` at the same fractions (difference < 1e-12). A function `t → number` also works.
Unknown names fall back to linear (warned once).

**Safety.** Returns only numbers and never throws into Hydra's per-frame call. Adds no globals beyond `knob`, `gate` and
`hydraMotion`; if `knob` or `gate` already exists (not ours) it is left alone with a warning. Loading it again keeps the
first copy. The names collide with nothing in Hydra's catalog or the curated registry's plugins (tested).

**Re-running code** creates fresh knobs (as with any variable): structural edits in iDra, which recompile the sketch, reset
knobs to their initial values. Number drags do not recompile.

**Package.** One ES2019 IIFE, MIT licence in the header comment, about 4 KB gzipped (budget 6 KB, checked by the build).

## Where the file comes from

| use | URL |
|---|---|
| iDra (registry entry, pinned by SRI) | `<site>/plugins/hydra-motion@<version>/hydra-motion.js` (`packages/core/plugins/registry.json` stores it site-relative) |
| earlier versions (sketches pinned to them) | the same form, `<site>/plugins/hydra-motion@0.1.0/hydra-motion.js`: served from `packages/core/plugins/archive/` |
| stable URL on the deployed site | `<site>/plugins/hydra-motion.js` (always the build on that deployment) |
| tagged releases (jsDelivr) | `https://cdn.jsdelivr.net/gh/thepelkus-too/iDra@hydra-motion-v<version>/packages/motion/dist/hydra-motion.js` |

**No `hydra-motion-v*` tag exists yet**, so there is no working jsDelivr URL yet; the form above starts working once a tag
is pushed (`hydra-motion-v0.1.0` on the last commit that built 0.1.0, `hydra-motion-v0.2.0` on the commit that releases 0.2.0). The built file is committed (`packages/motion/dist/`) so that URL serves it.
`scripts/build-all.mjs` builds the workspace, refreshes the registry entry (`scripts/sync-motion.mjs`: URL, version, SRI) and
copies the file to `dist/plugins/`, where the service worker precaches it for offline use. CI fails if the committed file or
the registry entry is stale.

**Every version stays served.** A sketch pins the exact build it was made with (URL and SRI), and the registry only names
the current one, so binding never upgrades an existing sketch. `packages/motion/dist/` holds only the current build; each
earlier one is kept byte for byte in `packages/core/plugins/archive/hydra-motion@<version>/` with its SRI in
`archive/integrity.json`, and `sync-motion --copy` serves it at its old pinned path. `sync-motion --check` fails if an
archived file changed, or if the registry moves past a version that is not archived yet. **To release a new version:**
archive the current built file first (`archive/README.md`), then bump `packages/motion/package.json` (and the dependency in
`packages/core/package.json`), build, and add a CHANGELOG entry.

## iDra integration (core)

```ts
import { knobDef, parseKnobDef, knobDefs, knobArg, withMotion, motionPluginRef, MOTION_EASINGS, exportWithPrelude,
         compat, mountCompatBadge } from '@hydra-ipad/core'

let s = withMotion(sketch)                          // adds the registry's pinned PluginRef (url, version, integrity)
s = { ...s, stmts: [knobDef('k', 0.5), ...s.stmts] } // `k = knob(0.5)`: a def whose value is the js expression
s = setArg(s, callId, 2, knobArg('k'))              // bind a numeric argument: { k: 'var', name: 'k' }
rt.invoke('k', 'press', [0])                         // a pad press: pad 0 of k's pads (0.2.0)
rt.invoke('k', 'lift', [0])
rt.invoke('k', 'hold', [0.9, 0, 'linear', 'padA'])  // the same by hand (what pads send to a sketch pinned to 0.1.0)
rt.invoke('k', 'release', [0.15, 'easeOutQuad', 'padA'])
```

* **IR.** `knobDef(name, initial, pads?)` is a bare assignment (`k = knob(0.5)`, not `const`), so the knob is a global of the
  sketch: reachable by `runtime.invoke`, and by a person typing `k.hold(1)`, also when the sketch has `await` and runs
  inside an async wrapper. iDra's pads are plain data in the options, `knob(0.5, { pads: [{ mode: 'hold', to: 1 }] })`,
  which the plugin plays with `press` / `lift` (0.2.0; 0.1.0 ignores it). `parseKnobDef(stmt)` recognises exactly `knob(<number>)` and `knob(<number>, { pads: [...] })`
  whose pads use only `mode`, `to`, `off`, `attack`, `release` and `ease` as literals (any decl); other forms stay code.
  `importText`/`toCode` round-trip both. Use `knobDefs(sketch)` to list them.
* **Safe mode** (untrusted sketch, or the harness's *safe* box) never loads plugins, so a knob def runs as its initial
  number (`k = 0.5`) and the sketch still shows; `RunResult.skipped` says so.
* **`runtime.invoke(name, method, args)`**: host → frame, for pad presses. Refused (returns `false`, reports a `warning`)
  unless `name` is a def of the sketch last run, `method` is `set | to | hold | release | press | lift`, and args are at most 6 finite
  numbers or strings of up to 64 characters. The frame checks again and requires `hydraMotion.isKnob(window[name])`. Nothing
  is evaluated as text. Fire-and-forget, delivered in order, never coalesced (unlike `setLive`), queued until the frame is
  ready; works in iframe and inline modes.
* **`exportWithPrelude(sketch, { source? })`** ("Make this sketch self-contained"; the shell's *Export .js, self-contained*):
  the plugin's built file inlined at the top instead of an `await loadScript(…)` line, between delimiters:

  ```
  // ---- hydra-motion 0.2.0 · sha256-… · MIT · inlined plugin, do not edit ----
  /*! hydra-motion v0.2.0 | SPDX-License-Identifier: MIT …the MIT licence… */
  (()=>{…})();
  // ---- end hydra-motion 0.2.0 ----
  k = knob(0.5)
  …
  ```

  Only the plugin carries a licence notice; the sketch's own licence is its author's business. The importer recognises the
  block **only when its delimiters are intact and its contents still hash to the SRI in the opening line**; it becomes the
  plugin (the registry's ref when it is that exact build, otherwise a pasted-code ref with that source), not raw code, and the
  exact text is kept in `sketch.src.head`, so: re-import does not duplicate it, `toCode` of an untouched import is byte-identical,
  and `exportWithPrelude` is idempotent. An edited block is ordinary code. Other plugins keep their `loadScript` lines.
  Default exports of sketches without the block are unchanged.
* **`compat(sketch, { audioSource? })`** → `{ vanilla: 'yes' | 'with-plugin' | 'no', needs, reasons }`. `with-plugin` lists
  plugin URLs (from `sketch.plugins` and `loadScript` lines; also when `knob()`/`gate()` is used without loading
  hydra-motion). `no`: pasted-code plugins (the text can't carry them) and audio from a file, stream, chosen input device or
  tab (vanilla Hydra's `a` is microphone-only). An inlined block counts as `yes`. `describe(sketch).compat` has it (without
  the audio source). `mountCompatBadge(el, sketch, { audio: getAudioEngine() })` is a tappable chip for next to Export
  ("Plain Hydra" / "Hydra + plugin" / "Needs iDra"); `.update(sketch)` when the sketch changes.
* **Harness → Motion lab**: loads a lab sketch (`k`, plus `p` driving `speed` so the lab can pause Hydra's clock) and gives a
  slider (`k.set`), glide buttons with duration and curve pickers (`k.to`), attack/release pickers and two hold pads (`k.hold`
  / `k.release`, one pointer each, so two fingers work), all through `runtime.invoke`.

## Tests

* `packages/motion`: `npm test -w hydra-motion` (fake clock: glides, retargeting, set, holds, stacked holds, base moves while
  held, beats at several bpm, easing parity with Hydra, gate, wall vs Hydra clock, bad input; the built file's globals,
  warning, idempotent load, ES2019, size, licence header; SPDX on every file and no imports from outside the package).
* `packages/core/test/motion.test.ts`: registry/SRI, names, IR round-trip, safe mode, prelude export/import round-trip and
  idempotence, compat, the badge, `runtime.invoke` ordering and whitelist in inline and message-only transports.
* `scripts/e2e-motion.mjs` (Chromium, iPad viewport, touch): the Motion lab in the sandboxed iframe with two real touch
  points, glides, pause; **the vanilla compatibility test**: the exported self-contained lab sketch pasted into a plain
  hydra-synth page on another origin with no iDra code, driven by `k.hold`/`k.release`, output changes and comes back;
  offline reload.

## iPad checklist

On the deployed site (Safari and the installed app):

1. Harness → **Motion lab** → *Load lab sketch*. The chip at the top says *Hydra + plugin*.
2. Hold **Pad A** with one finger: the picture goes red. Keep it down and press **Pad B** with a second finger: it goes blue
   (most recent wins). Lift B: back to red. Lift A: back to the middle over 0.15 s. Try attack 0.2 and release 2b.
3. Glide buttons with a few curves and durations, including `1b`/`4b`; drag the slider while a glide runs (it jumps, no fight).
4. **Pause (speed = 0)**, then hold Pad A: the change shows at once. Lift it: with the *hydra* clock it stays until you
   *Resume*, then finishes. Switch *Clock* to *wall*, *Load lab sketch* again, repeat: the release finishes while paused.
5. Turn on Airplane Mode and **reload** (Safari and the installed app): the lab sketch runs and the pads work.
6. Shell → a sketch's ⋯ → *Export .js, self-contained*; open the file, copy it into https://hydra.ojack.xyz, run it, then
   type `k.hold(1)` and `k.release(0.5)`.
7. In any editor, bind a number to a pad, make a second pad (Latch) and a third (Trigger). Play each one with a finger,
   then hold the Hold pad and a second pad together. Export it self-contained, paste it into https://hydra.ojack.xyz, and
   type `<knob>.press(0)`, `<knob>.lift(0)`, `<knob>.press(1)` (twice) and `<knob>.press(2)`: each does what its pad did.
8. Open a sketch you bound to a pad before this update (it is pinned to 0.1.0): it still loads and its pads still play.
