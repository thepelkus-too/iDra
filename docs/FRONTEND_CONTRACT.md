# Front-end contract

Everything an editor (`apps/stack`, `apps/graph`, `apps/blocks`, `apps/rack`, …) must do. The core lives in `packages/core`
and is imported as `@hydra-ipad/core`; **editors never edit it**. If something is missing, add an optional field to your
`meta[<app>]` object or ask for a core change in its own PR.

## 0. Skeleton

```
apps/<name>/package.json     { "name": "<name>", "hydra": { "title", "description", "order"? }, "scripts": { "predev", "dev", "prebuild", "build" } }
apps/<name>/vite.config.mjs  import { hydraApp } from '@hydra-ipad/core/vite'; export default hydraApp(import.meta.url)
apps/<name>/index.html       viewport meta with user-scalable=no + viewport-fit=cover; NO manifest, NO service worker
apps/<name>/src/main.ts
```

Copy `apps/harness` (package.json, vite.config.mjs, tsconfig.json, env.d.ts, index.html). Any directory under `apps/` with a `build`
script is picked up by `npm run build:all`, built to `dist/<name>/` and listed in `dist/apps.json` (title/description from the
`hydra` field). Dev: `npm run dev --workspace=<name>`. Editors **do not** register service workers or manifests: the shell is the only
PWA and its root-scope worker covers every editor (this is what keeps an installed iPad app inside its scope when you switch editors).
`hydraApp` builds with `base: './'`, copies the sandboxed-frame bundle next to your page as `hydra-frame.js` and defines
`__REPO_URL__`, `__COMMIT__`, `__BRANCH__`. Call `applyAppBase()` for the iPad baseline CSS (no tap delay, safe areas, no rubber banding).

## 1. Routing

* An editor is opened as `/<app>/#/s/<sketchId>`. `parseRoute(location.hash) → {sketchId?}`; `routeHash(id)` builds it.
* With no id: open `library.mostRecent()`, or `library.create()` if the library is empty; then `history.replaceState(null, '', routeHash(id))`.
* Listen to `hashchange` (the shell/switcher may deep-link while you are open): `await library.flush()` first, then load the new sketch.

## 2. Persistence

* The IR is the single source of truth. Every edit produces a new `Sketch` (immutable helpers: `setArg`, `mapCalls`, `withMeta`, spread) and goes to `getLibrary().autosave(sketch)` (debounced; `flush()` on `pagehide`, `visibilitychange→hidden`, and before navigating).
* **Write only `sketch.meta[<app>]`** (use `withMeta(sketch, '<app>', patch)`; the one exception is the shared kit's `meta.kit`, section 8a). Preserve every other `meta` key and every unknown field on every node. Per-node view state goes in `node.meta[<app>]` (`withNodeMeta`).
* Private UI preferences (panel sizes, last tab) go through `appStorage('<app>')` → `hydra-<app>:` keys. Sketches never go to `localStorage`.
* Thumbnails: after a run settles, `runtime.thumbnail()` → `library.setThumbnail(id, dataUrl)` (the shell shows them).

## 3. `autoView(sketch)`

Each editor exports `autoView(sketch): AppMeta` that builds a sensible default view state for a sketch with no `meta[<app>]` (including sketches imported from plain text) using `describe(sketch)` (chains, outputs, feedback, shadowing, defs and uses, raw/comment counts, `activeRender`, `usesCamera`, …) and, for spatial UIs, `autoLayout(sketch)` (`positions` per call/def/output/note node id, `boxes` per chain/stmt id). It runs on first open and on an **Arrange** action; the result is saved with `withMeta`. Pure function: no DOM, so it is unit-testable against the corpus.

## 4. Nothing is hidden, nothing is dropped

Every editor must show an **editable** representation of:

| content | what to show |
|---|---|
| `raw` stmt | its text, editable; show parse status (re-run `importText` on the edit: recognised → replace with the recognised stmts, otherwise keep as `raw`) |
| `def` / `var` | the definition as a named, editable value (number/function/array/texture chain/JS); `var` args show the name and where it is defined (`describe().defs[i].uses`) |
| `comment` | text, in its position |
| chain with `out: null` | a visibly "not rendered" chain with an action that sets `out` |
| `source`, `setting`, `render` | their own controls |
| unknown calls | a generic call with editable name and arguments (`catalog.get(fn) === undefined`) |
| `js` / `fn` values | the source text (and for audio chips, knobs: `parseAudioChip`) |

## 5. Statement order

IR order is semantic: defs must precede uses and the last chain written to an output wins. If your UI lets users move things spatially, **you** decide IR order deterministically (reading order unless the user reorders explicitly), then run `validate(sketch)` and surface `error`s (`var-before-def`, `wrong-position`, `texture-missing`, `unknown-var`, …); `warning`/`info` are advice (`unknown-function`, `not-rendered`, `too-many-args`).

## 6. Chrome every editor mounts

```ts
mountSwitcher(el, { current: '<app>', sketchId })   // await library.flush() then navigates to ../<other>/#/s/<id>
mountAbout(el, { build })                            // "About / Source · AGPL-3.0": REQUIRED on every page (AGPL §13)
mountAudioPanel(el)                                  // source, transport, meters, cutoff/scale/smooth/bins, monitor
mountUpdateToast()                                   // "Update available — Reload"; never reloads on its own
const rt = createRuntime(stageEl, { audio: getAudioEngine(), catalog })
rt.onError(showErrors)                               // shader compile warnings + thrown errors + camera denials
```

`createRuntime` defaults to `isolation: 'iframe'` (sandboxed, opaque origin). Keep it. Offer inline only as an explicit, trust-gated fallback (camera/screen sources; see `docs/security.md`).

### Backdrop (full-background preview)

Every editor offers the preview as a **panel** (its own layout) or as the **full background**, the way hydra.ojack.xyz shows
code over the running texture. `createBackdrop` (core, `backdrop.ts`) owns the shared preference (`hydra-core:previewPlacement`,
so switching editors keeps it), the veil strength, the `hi-backdrop` class on `<html>` and the runtime's resolution (the screen's
aspect while it is on, longest side ≤ 1280, re-fitted on rotation; `base` again when it is off).

```ts
const backdrop = createBackdrop({ base: { width: 960, height: 540 }, setResolution: (w, h) => rt?.setResolution(w, h) })
createRuntime(stageEl, { ...backdrop.resolution(), … })   // start at the right size; call backdrop.refresh() after a restart
backdrop.toggle() · backdrop.cycleVeil() · backdrop.subscribe(cb) · backdrop.state  // { placement: 'panel' | 'backdrop', veil }
```

* **Never move the stage element** to show it full screen: moving an iframe reloads it. Put `data-hi-backdrop="stage"` on the
  element that holds it; core's CSS pins that element to the viewport (`position:fixed; inset:0; z-index:0; pointer-events:none`)
  while `html.hi-backdrop` is set. Its ancestors must not have `transform`, `filter`, `contain` or `container-type` (each makes a
  containing block for fixed elements). `data-hi-backdrop="hide"` hides an element while the backdrop is on, `"only"` shows it only then.
* Give your own panels `position:relative` and a `z-index` of 1 or more, decreasing from top to bottom (Chain Stack: top bar 3, strip 2, stack 1), so drop-downs such as the switcher's menu open over the panels below them, and a `background: var(--hi-veil)` (a near-black wash whose alpha follows
  the veil strength) under `html.hi-backdrop`; let the editing area take the space the preview used. `--hi-veil-line` and
  `--hi-ink-shadow` (text shadow for text drawn straight on the texture) are there too. Code views: transparent editor, a veil
  behind each line (Chain Stack: `.cm-line{width:fit-content;background:var(--hi-veil)}`).
* Show a toggle in the top bar (and the veil choice while it is on). Status that lived on the preview (safe mode, last good
  frame) must stay visible somewhere else.

### Trust gate

Before the **first** run of a sketch: `if (await library.needsTrust(sketch))` show **"This sketch runs code. Run it?"** (`riskyParts(sketch)` lists why).
Until the owner accepts, run `rt.run(sketch, { safe: true })` (recognised chains/settings/sources only; raw code, plugins and expressions outside the safe subset are skipped, `RunResult.skipped` tells you what). "Always for this sketch" → `library.approve(sketch)` (the approval is a hash of exactly the risky content; changing it asks again).

## 7. Audio and plugins

* Bind audio **only** with `audioChip(bin, scale?, offset?)` → the `fn` Value `() => a.fft[bin] * scale + offset`. Never call `getUserMedia` or create an `AudioContext`; `getAudioEngine()` is the only one and runs in the host page (the frame is never given the mic).
* `catalog.subscribe(cb)` re-renders your function picker when a plugin registers functions (`catalog.refresh(delta)` is called by the runtime for you). Show functions whose `origin` starts with `plugin:` under their own group (`catalog.groups()`). Inputs of other types (vec2/vec3/int) are generic: `InputDef.type` + `Value` `vec4` (2–4 numbers).
* All runtime calls are **asynchronous** (`run`, `hush`, `screenshot`, `time`, `loadPlugin`, `getCatalogDelta`, …); `setLive` is fire-and-forget.

### 7a. Additions (audio sources, plugins, MIDI)

Everything below is **additive**: nothing above changed, and an editor that ignores it keeps working.

* **Audio bindings.** For a parameter's "bind to audio" UI use `audioBindings()`: `list()` (fft0…fftN with band names, `vol`; `beat` is meter-only),
  `chip(id, { scale, offset, smooth?, threshold? })` → a Value, `identify(value)` → `{ id, opts }` or undefined, and
  `subscribe(id, cb, { fps })` for live meter values. `audioChip(bin, scale, offset)` is unchanged; `audioSignalChip` builds the
  smoothed (`js`) and threshold (`fn`) variants. `parseAudioBinding(value)` reads all forms. Show `js`/`fn` source as before when a value is
  not a chip.
* **Audio panel.** `mountAudioPanel(el)` now has input device, stream URL, tab audio (where supported) and "Other apps…" sources, a
  *tap to resume* control and feedback hint. Same call, nothing to do. If you build your own panel, read `engine.needsResume`, `engine.hint`,
  `engine.analysis` (`'ok' | 'waiting' | 'blocked' | 'off'`) and `engine.lastError` (`AudioStartError`, `.canPlayOnly` for streams without CORS).
* **Switcher tools.** `mountSwitcher` adds *Plugins…* and *MIDI controller…* to the ⇄ menu (opt out with `tools: false`). Pass
  `sketchAccess: { get: () => currentSketch, set: (s) => { /* your store */ } }` so the Plugins sheet edits your in-memory sketch; without it the
  sheet edits the saved copy and **reloads the page** on close when the plugin list changed.
* **Plugins.** `sketch.plugins` is the list of `PluginRef`s (`{ id, name, url?, src?, integrity?, version? }`); the runtime loads them in order
  before every full run (never in safe mode). Use `withPlugin` / `withoutPlugin`; never drop `plugins` when you rebuild a sketch (spread it).
  `toCode` prepends `await loadScript(url)` for URL plugins whose line is not already in the code. Function pickers: keep using
  `catalog.subscribe` + `catalog.groups()`; plugin functions arrive with `origin: 'plugin:<id>'`.
* **Runtime.** `createRuntime` forwards the page's MIDI hub by default (`midi: null` turns that off) and refuses plugins in inline mode
  (it reports a warning and runs the rest). `PluginResult` gains `globals`, `shadows`, `warning`. Runtime warnings now include
  "plugin X replaces the built-in function …", "… is not pinned to a version", and the no-Web-MIDI warning: show `kind: 'warning'` errors.
* **MIDI.** Optional: `midiBanner(sketch, { onController })` returns the "Web MIDI isn't available…" banner (or null) to put near your preview;
  `midiChip({ kind, index, channel?, min?, max? })` / `parseMidiChip` for MIDI bindings (a `js` value such as `cc(1).range(0, 1)`).
* **Diagnostics link.** `diagnosticsHref(appName)` → the harness's Diagnostics tab (`harness/?tab=diag`).

See docs/audio.md, docs/plugins.md and docs/midi.md.

### 7b. Additions (hydra-motion: glides, holds, pads)

Additive again; an editor that ignores it keeps working. Details and the frozen plugin surface: docs/motion.md.

* **Knobs.** A knob is a def `k = knob(0.5)`: make it with `knobDef(name, initial)`, read it with `parseKnobDef(stmt)` /
  `knobDefs(sketch)`, and bind a numeric argument to it with `setArg(sketch, callId, i, knobArg(name))` (a `{ k: 'var', name }`
  value). Add the plugin with `withMotion(sketch)` (the registry's pinned ref). Show a knob def like any def; never turn it
  into a `const`, or pads cannot reach it.
* **Pads.** `rt.invoke(name, 'set' | 'to' | 'hold' | 'release', args)` calls the knob's method in the running sketch
  (numbers and short strings only; ordered, never coalesced; returns false and reports a warning when refused). Give each
  pad its own hold id (`rt.invoke('k', 'hold', [v, attack, ease, padId])`, release with the same id) so two fingers work.
  Easing names for pickers: `MOTION_EASINGS`.
* **Export.** `exportWithPrelude(sketch)` is the "self-contained" export (plugin inlined); `toCode` is unchanged. Mount
  `mountCompatBadge(el, sketch, { audio: getAudioEngine() })` next to your Export button and call `.update(sketch)` on change;
  `describe(sketch).compat` has the same answer without the audio source.
* **Safe mode** runs knob defs as their initial numbers; nothing to do.

## 8. Fast numeric edits

On a numeric drag call `rt.setLive(liveId(call.id, argIndex), value)` for instant feedback (no recompile, coalesced to one message per frame), update the IR with `setArg`, and `autosave`. `rt.run(sketch)` after any edit is always correct: when only numbers changed it detects identical code and just updates the live table (`RunResult.recompiled === false`). Only plain `num` args of catalog-known `float` inputs are live; everything else recompiles. See `docs/live-edit.md`.

### 8a. Numbers (the shared number editor)

Every numeric value in every editor is edited with `@hydra-ipad/kit` (docs/kit.md), so a number behaves the same
everywhere:

* **Tap** opens `openNumberEditor`: Keypad (with Glide and "Loop between values"), Ladder, Pad. The last tab is remembered
  per editor (`appStorage('<app>')`, key `numberTab`), as are the glide's duration and curve.
* **Long-press** (350 ms, 8 px slop) opens the ladder under the finger; up/down picks a magnitude, left/right steps by it
  (24 px per step). A control that already has a long-press action keeps it for a long-press *without* movement (Chain
  Stack's kind menu, the rack's knob menu); otherwise that opens the editor's Ladder tab. Drag-to-scrub and double-tap reset
  are unchanged: a move past the slop before 350 ms is the control's own drag.
* **One gesture, one undo step.** Ladder gestures and glides push intermediate values through `setLive` when the number has
  a live slot (section 8) and commit once at the end; without a live slot they use the editor's coalesced drag commits.
  Any other edit of a gliding number cancels the glide.
* **Describe numbers as `NumberField`s** (`id`, `label`, `get`, `def`, `hint`, `onChange(v, phase)`, optional `live`, and
  `arg: { callId, index }` when the number is a call's argument) and register the editor once with `setKitHost` (docs/kit.md).
  Put `padsTool()` in the switcher's `extraTools` (an additive `mountSwitcher` option) so "Pads" is in the ⇄ menu.
* **Pads.** "Bind to a pad" writes a knob def with `knobDef` (section 7b: a bare assignment, never `const`, although the
  original plan said `const`) before the first statement using the call, and the argument becomes a reference to it.
  Pads are inert until the sketch is trusted.
* **The `meta.kit` exception.** Pad configuration is shared by every editor, so it lives in `sketch.meta.kit` (`pads`,
  `dock`), a namespace owned by the kit and written **only** through its helpers (`withKitMeta`, `withPads`, `updatePad`,
  `bindToPad`, `unbindKnob`). This is the one exception to "write only `meta[<app>]`" (section 2). An editor never writes
  `meta.kit` itself and preserves it like any other key. Undo restores `meta[<app>]`, not `meta.kit`: a pad whose knob def
  is gone is ignored (`livePads`) and comes back with redo.

## 9. Tests every editor must pass

Using `import { corpus } from '@hydra-ipad/core/corpus'` (33 sketches, one deliberately broken):

1. open every corpus sketch (`importText(entry.code).sketch`) without throwing,
2. show every chain, def, raw block and comment (count them against `describe(sketch)`),
3. preserve raw code byte-for-byte,
4. for an untouched sketch, `toCode(sketch) === entry.code`,
5. one numeric edit changes exactly one line of the export,
6. `autoView` is deterministic and does not drop `meta` of other apps,
7. a sketch carrying other apps' `meta` comes back untouched (`withMeta` tests in `packages/core/test/ir.test.ts` show the pattern).

## 10. Branch and PR conventions

Each editor is developed on the `claude/...` branch its session is given (the planned `proto/<name>` names were never used) and touches **only** `apps/<name>/**` (plus its own tests). Do not edit `packages/core`, `apps/shell`, `apps/harness`, root configs or docs from an editor branch. Vercel gives every pushed branch a preview URL (`docs/previews.md`); open the PR against `main`.
