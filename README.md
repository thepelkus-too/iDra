# Hydra iPad

Shared foundation for several **iPad-first visual editors** for [Hydra](https://hydra.ojack.xyz), the livecoding video synth. This repository
contains the core (catalog, IR, text⇄IR, library, sandboxed runtime, audio), an installable shell/launcher, and a test harness. The editors
(`stack`, `graph`, `blocks`, `rack`) are built later, each on its own branch, as `apps/<name>` over this core.

* **Hydra source is authoritative.** The function catalog is derived from `hydra-synth/src/glsl/glsl-functions.js` at build/run time, never hand-copied.
* **Licence: AGPL-3.0**, except the hydra-motion plugin in `packages/motion`, which is MIT (see below). A running copy offers its source: every page shows **About / Source**.

```
packages/motion/          hydra-motion (MIT, standalone): knob() / gate() plugin for plain Hydra; see docs/motion.md
packages/core/            @hydra-ipad/core — no UI framework
  src/catalog.ts            live function catalog + hint layer (ranges) + plugin refresh
  src/ir.ts                 IR types, ids, meta helpers (withMeta…), traversal, setArg
  src/parse.ts              importText / fromCode  (acorn; never loses code)
  src/codegen.ts            toCode (format-preserving) · toCodeWithMap · toRunnable (live closures, safe mode)
  src/validate.ts analyze.ts autoLayout.ts randomize.ts trust.ts normalize.ts
  src/library.ts            shared IndexedDB library (+ fallbacks, revisions, backup, cross-tab)
  src/runtime/              host.ts (createRuntime) · bridge.ts (frame side) · protocol.ts · script-cache.ts · frame-entry.ts
  src/audio.ts hydra-audio.ts audio-panel.ts audio-sources.ts audio-chip.ts audio-bindings.ts audio-assets.ts
                            engine + sources (mic, input device, file, stream, tab), Hydra-compatible `a` with beat detection, panel, chips
  src/plugins.ts plugin-manager.ts plugin-id.ts   registry, installed plugins, manager UI / sheet, offline script cache
  src/midi.ts midi-panel.ts runtime/midi-shim.ts  MIDI hub, on-screen controller, frame-side Web MIDI stand-in
  plugins/registry.json     curated plugin list (URLs checked against each project's README)
  src/switcher.ts about.ts update-toast.ts capabilities.ts storage.ts ui.ts
  corpus/                   33 text-only sketches · src/corpus.ts   (import { corpus } from '@hydra-ipad/core/corpus')
  vite-plugin.mjs           hydraApp() — shared vite config for every app
apps/shell/               the ONLY PWA: launcher + library UI, manifest, root-scope service worker
apps/harness/             canvas + textarea + randomize + numbers + Diagnostics + Audio lab + Plugins + MIDI + isolation toggle
scripts/                  build-all.mjs · e2e.mjs · e2e-audio-plugins.mjs · live-edit-bench.mjs · serve.mjs · make-icons.mjs · fixtures/ (test-only)
docs/                     FRONTEND_CONTRACT.md IR.md previews.md security.md audio.md plugins.md midi.md live-edit.md ios-storage.md
vercel.json  .github/workflows/{ci,pages}.yml
```

## Commands

```
npm ci
npm test                              # core unit tests (vitest; 300+ tests incl. the 33-sketch corpus)
npm run typecheck
npm run build:all                     # dist/: shell at the root + dist/<name>/ for every apps/* with a build script + apps.json + sw.js
npm run serve                         # serve dist/ on :4173
npm run dev --workspace=harness       # vite dev server for one app
npm run test:e2e                      # Playwright/Chromium, iPad viewport, software WebGL
npm run test:e2e:audio                # audio sources, plugins, MIDI (local CORS/no-CORS servers, fake devices); screenshots in test-results/ipad
```

## Adding a front-end

Create `apps/<name>` (copy `apps/harness`) and follow **[docs/FRONTEND_CONTRACT.md](docs/FRONTEND_CONTRACT.md)**: routing (`/<name>/#/s/<id>`),
persistence through the IR and `library.autosave`, `meta[<name>]` only, `autoView(sketch)`, no hidden content, the trust gate, `audioChip`,
the chrome (switcher, About, audio panel, error surface) and the corpus tests. Adding the folder is the whole integration: `build:all`
discovers it, publishes `dist/<name>/` and lists it in `apps.json`, so the shell's "Open in…" and the switcher show it.

## The IR in one screen

A sketch is `stmts: Stmt[]` where `Stmt = chain | render | source | setting | def | comment | raw`, a chain is
`gen: Call` + `mods: Call[]` + `out`, and a `Call` has `Value` args: `num | fn | arr | tex | ref | vec4 | var | js | default`.
Statement order is semantic. Every node has an `id` and optional `meta`; each editor writes only `sketch.meta[<app>]`. Imported statements keep their
original text and a content hash, so unchanged statements (and unchanged calls inside an edited chain) are exported byte-for-byte. Details: **[docs/IR.md](docs/IR.md)**.

## iPad testing

Deploy (Vercel per-branch previews, GitHub Pages fallback): **[docs/previews.md](docs/previews.md)**. Open the **site root** in Safari → Share → *Add to Home Screen*;
editors then open inside the installed app. Storage in the installed app is separate from Safari's: **[docs/ios-storage.md](docs/ios-storage.md)**.
Camera and microphone need HTTPS and a tap; audio on iOS: **[docs/audio.md](docs/audio.md)**; plugins: **[docs/plugins.md](docs/plugins.md)**; MIDI: **[docs/midi.md](docs/midi.md)**; trust and isolation: **[docs/security.md](docs/security.md)**;
how numeric drags avoid recompiling: **[docs/live-edit.md](docs/live-edit.md)**; glides, holds and pads (hydra-motion): **[docs/motion.md](docs/motion.md)**.

## Branch / PR conventions

`main` is the shared base (core, shell, harness). Each piece of work is developed on the `claude/...` branch its session is given (the planned `proto/<name>` names were never used); an editor branch touches
**only `apps/<name>/**`**; core changes go in their own PR to `main`. Vercel builds a preview for every pushed branch.
*Note:* the first session on this repository was assigned the branch `claude/new-session-rpk2q8` rather than `main`, so the foundation is there until the owner merges it.

## Findings that differ from the brief (source wins)

* **`bpm(n)` does not exist.** `bpm` is a settable global (`bpm = 120`; `userProps` in `hydra-synth.js`), and the default is **30**, not 60 — arrays step `time * speed * (bpm / 60)` times per second. The IR's `setting` stmt emits `bpm = n`; `bpm(60)` is kept as `raw`.
* **`sum([1,1,1,1])` throws** in 1.4.0 ("Arguments must be a texture or GlslSource"; every `vec4` input is checked as a texture), and the float→vec4 auto-conversion table in `format-arguments.js` is never reached for a texture in a float slot (it generates a `vec4` into a `float` parameter, invalid GLSL). `validate` warns for both; `randomSketch` avoids them.
* **`HydraRenderer.eval()` discards the evaluation's value**, so an `await loadScript()` sketch cannot be awaited through it; the bridge calls the sandbox's indirect `eval` itself for async sketches.
* `glsl-functions.js` lists `combine`/`combineCoord` functions **without** their texture input (added by `generator-factory.processGlsl`); the catalog adds it back as an implicit first `sampler2D` input named `texture`. `src`'s own input is named `tex`.
* **Camera inside a sandboxed (opaque-origin) frame is denied** (Chromium, tested). Fallback: inline mode behind the trust gate. See `docs/security.md`.
* `hydra-synth` declares `"license": "AGPL"` with the AGPL-3.0 text and no "or later" grant in its sources, so this repo uses `AGPL-3.0-only` everywhere except `packages/motion` (the conservative reading). If the upstream author confirms "or later", loosen it.
* `hydra-examples` has **no licence file**, so the corpus is written from scratch (`packages/core/corpus/README.md`).
* A texture chain stored in a variable is safe to use as an **argument** in several places; calling a modifier **on** the variable mutates it (see `docs/IR.md`).
* Hydra's `hush()` also clears `update`/`afterUpdate`; before every run the bridge additionally resets `speed`/`bpm` to their defaults so a sketch without `speed = …` is not affected by the previous one.

## Known gaps

Audio sources, plugins and MIDI are in (see their docs; the on-iPad checklist is at the end of docs/audio.md). Not bundled: an HLS library for non-Safari browsers.
Also not done: host-side camera relay into the sandbox; the editors themselves; real-iPad verification of iOS audio (silent switch, interruptions), storage separation and Add-to-Home-Screen
behaviour (documented, not testable in the container); Vercel dashboard steps (documented, not executed). See the end-of-session summary for more.

## Licence and third-party code

AGPL-3.0-only (`LICENSE`), **except `packages/motion` (hydra-motion), which is MIT** (`packages/motion/LICENSE`, an SPDX `MIT`
header on every file). The split is deliberate: hydra-motion is a plugin any Hydra user can load, it will move to its own
repository (`packages/motion/EXTRACTING.md`), and it contains no AGPL code (its easing curves are its own; only the easing
*names* are read from hydra-synth at build time). iDra uses it only through its built file. See `LICENSES.md`. Bundled: **hydra-synth** (AGPL; https://github.com/ojack/hydra-synth), **regl** (MIT), **raf-loop** (MIT), **meyda** (MIT, host page only), **acorn** (MIT), **@dagrejs/dagre** (MIT).
Test-only, never bundled: **hydra-midi 0.4.6** (MIT, `scripts/fixtures/hydra-midi/`). Plugins in `plugins/registry.json` are fetched by the user's browser from their own hosts, never shipped.
The service-worker, silent-switch technique and everything else is original (the silent-switch idea follows activetheory/ios-silent-bypass, MIT, no code copied).
**If you host a modified copy, the AGPL requires you to offer the corresponding source to its users** — the *About / Source* link (from `package.json` → `repository`) does that for unmodified deployments; update `repository` if you fork.
