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
* **Write only `sketch.meta[<app>]`** (use `withMeta(sketch, '<app>', patch)`). Preserve every other `meta` key and every unknown field on every node. Per-node view state goes in `node.meta[<app>]` (`withNodeMeta`).
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

### Trust gate

Before the **first** run of a sketch: `if (await library.needsTrust(sketch))` show **"This sketch runs code. Run it?"** (`riskyParts(sketch)` lists why).
Until the owner accepts, run `rt.run(sketch, { safe: true })` (recognised chains/settings/sources only; raw code, plugins and expressions outside the safe subset are skipped, `RunResult.skipped` tells you what). "Always for this sketch" → `library.approve(sketch)` (the approval is a hash of exactly the risky content; changing it asks again).

## 7. Audio and plugins

* Bind audio **only** with `audioChip(bin, scale?, offset?)` → the `fn` Value `() => a.fft[bin] * scale + offset`. Never call `getUserMedia` or create an `AudioContext`; `getAudioEngine()` is the only one and runs in the host page (the frame is never given the mic).
* `catalog.subscribe(cb)` re-renders your function picker when a plugin registers functions (`catalog.refresh(delta)` is called by the runtime for you). Show functions whose `origin` starts with `plugin:` under their own group (`catalog.groups()`). Inputs of other types (vec2/vec3/int) are generic: `InputDef.type` + `Value` `vec4` (2–4 numbers).
* All runtime calls are **asynchronous** (`run`, `hush`, `screenshot`, `time`, `loadPlugin`, `getCatalogDelta`, …); `setLive` is fire-and-forget.

## 8. Fast numeric edits

On a numeric drag call `rt.setLive(liveId(call.id, argIndex), value)` for instant feedback (no recompile, coalesced to one message per frame), update the IR with `setArg`, and `autosave`. `rt.run(sketch)` after any edit is always correct: when only numbers changed it detects identical code and just updates the live table (`RunResult.recompiled === false`). Only plain `num` args of catalog-known `float` inputs are live; everything else recompiles. See `docs/live-edit.md`.

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

Each editor lives on its own branch (`proto/stack`, `proto/graph`, `proto/blocks`, `proto/rack`) and touches **only** `apps/<name>/**` (plus its own tests). Do not edit `packages/core`, `apps/shell`, `apps/harness`, root configs or docs from an editor branch. Vercel gives every pushed branch a preview URL (`docs/previews.md`); open the PR against `main`.
