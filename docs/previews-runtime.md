# Chunk previews: the runtime side

A chunk preview shows part of a chain on its own: "everything up to here" (a generator and its enabled modifiers up to
one call) or a before/after pair for one modifier. This page is about how they are made and what they cost. The editor
side (what to show, the trust rule, the preference) is in docs/FRONTEND_CONTRACT.md, section 8b, and the kit component
in docs/kit.md. (`docs/previews.md` is about something else: Vercel's preview URLs.)

## Pieces

| piece | where | what it does |
|---|---|---|
| `previewPlan(sketch, spec, { approximate })` | `packages/core/src/preview.ts` | the program a preview runs, or a polite refusal |
| `createPreviewPool(options)` | same | a pool of small hidden runtimes; hands out `PreviewHandle`s |
| `previewMode()` / `setPreviewMode()` / `onPreviewMode()` | same | the global preference: `off`, `demand` (default), `live` |
| frame loop, `snapshot`, `setImage`, `setTime` | `packages/core/src/runtime/bridge.ts` | what a preview runtime does differently from the main one |
| Previews lab | `apps/harness/src/previews-lab.ts` | every call of the open sketch as a thumbnail, with the pool's numbers |
| `<PreviewPeek>` | `packages/kit/src/PreviewPeek.tsx` | the thumbnail editors use |

## The plan

`previewPlan` builds a small sketch from the real one:

* the chunk itself, drawn to `o0` (and, for a before/after pair, the "after" to `o1`); disabled modifiers are left out,
  except the call the preview is about (so a switched-off modifier can be previewed before switching it on);
* the sketch's settings, defs, non-camera sources (images and videos load again in the preview), and raw
  `loadScript(…)` / `setFunction(…)` lines (plugins the chunk may call). Other raw code, other chains, `render()` and
  `hush()` are not run;
* call ids are kept, so the main runtime's live numbers (`setLive` table) apply to the preview unchanged.

**Approximations.** A preview can't see the main runtime's textures. A chunk that reads `o0`…`o3` reads a spare source
instead (`s4`…`s7`), `prev()` becomes `src()` of the copy of the output its chain draws to, and a camera or screen source
reads the same slot, filled with a copy of the main runtime's picture. The pool copies those pictures (`Runtime.snapshot`:
the output's framebuffer drawn into a 256×144 framebuffer and read back, or the source's element) about once a second
(`feedMs`) and hands them to the preview (`setImage`). The handle is `approximate`, with one plain sentence per reason in
`notes`. Without a main runtime, or with `{ approximate: false }`, such chunks are refused with a `reason` instead. A
preview never opens a camera or screen of its own (`initCam` / `initScreen` statements are dropped from the plan).

`prev()` in a def's chain (no output of its own) is refused.

## The pool

* **Size.** At most `size` runtimes (default 2) exist at once, whatever the number of handles. Handles compete for them:
  the opened one (`setActive(true)`) first, then the most recently asked. A handle without a runtime is `waiting` or
  `paused`, never failing. Runtimes left without a handle are kept for reuse and disposed after `idleMs` (20 s) without
  work; the pool's element is removed with them.
* **Picture.** 256×144 at most (`width`, `height`), each frame sent as `ImageBitmap`s (transferred, not copied) captured in
  the same task as the draw. A diff renders `o0`, captures it, draws `o1` to the canvas at the same Hydra time
  (`renderFbo`) and captures again.
* **Frame rate.** About 15 fps (`fps`, at most 30; `handle.setFps` lowers it per preview). The preview's frame loop is
  driven by the host (`loop` messages; hydra-synth runs with `autoLoop: false`), so a hidden preview costs nothing.
  Backpressure: a frame is not drawn until the page has acknowledged the last one.
* **Modes.** `demand`: a still picture (two frames, then the runtime goes back to the pool), refreshed when the chunk
  changes or the main runtime's numbers move; the opened one animates. `live`: every visible handle animates (as many at
  once as the pool has runtimes; the others wait their turn). `off`: nothing runs, handles say `off`.
* **Pausing.** Handles that are not visible (`setVisible(false)`, from an IntersectionObserver) and every handle while
  the page is hidden (`visibilitychange`) pause. The pool's hidden runtimes sit in a fixed element behind the page, inside
  the viewport, because browsers throttle frames that are scrolled away.
* **Following the main runtime.** Each run copies the main runtime's live table and its clock (`time()`), the clock is
  synced again every second while anything runs, and every `setLive` batch of the main runtime is forwarded
  (`Runtime.onLive`), so a dragged number moves the previews too.
* **Trust.** A handle opened with `trusted: false` is `untrusted` and nothing of it runs anywhere; `update({ trusted:
  true })` lets it start. The editor passes the same answer it uses for its own runs.
* **Errors** stay in the handle (`error` + `reason`): a preview's shader error never reaches the main runtime or the
  editor's problem list. An edit that changes the plan clears the error and tries again.
* `pool.stats`: runtimes alive now and at most, frames delivered, runs, pictures copied (with the average copy time) and
  failed copies. The harness lab shows them live.

## What it costs

Each preview runtime is a hydra-synth instance in its own sandboxed iframe: one WebGL context, four outputs (two
256×144 framebuffers each), eight sources, its compiled shaders, and a timer. Per running preview per frame: one Hydra
tick at 256×144 (the chunk's passes), one 2D copy into an `OffscreenCanvas`, one transfer to the page, and one 2D draw
into the thumbnail. Per approximated picture per second: a framebuffer read-back on the **main** runtime (a GPU
pipeline stall of a few milliseconds there), an `ImageBitmap`, and a 2D upload in the preview.

Measured in this repository's CI browser (`node scripts/e2e-previews.mjs`; Chromium with **software** WebGL):

| what | measured |
|---|---|
| runtimes alive at once | 2 (never more), counted from the pool's stats and the page's iframes |
| main output while previews run (live mode, 2 s) | pixel-identical to before (mean difference 0) |
| live mode | 11–20 preview frames per second in total across the running thumbnails |
| one copied picture (snapshot + transfer + upload) | 180–200 ms |
| on-demand still of a 5-call sketch, all five thumbnails | about 2 s from opening the tab |

**Software rendering numbers are not iPad numbers.** The CI browser renders WebGL on the CPU: everything above is slower
there, and its frame rates say nothing about a device's GPU or battery. On an iPad expect the GPU cost of each running
preview to be small next to the main output (a 256×144 picture is about 1/40 of a 1920×1080 one), and the real costs to
be elsewhere: each extra WebGL context (Safari limits how many a page may hold, and loses the oldest when there are too
many), the read-back stall on the main runtime once a second per approximated chunk, waking the GPU at all while the
main output is otherwise idle, and memory. `live` mode keeps the GPU busy for as long as thumbnails are on screen,
which shows up in battery life and heat; that is why `demand` is the default.

## Known gaps

* Pads (knob presses through `runtime.invoke`) move the main output but are not forwarded to previews; a chunk using a
  pad's knob shows the knob's resting value until it is run again.
* Only modifiers of a chain statement or a def's chain can be switched off; calls inside texture arguments can't (the
  call taking them can), and raw code is commented out by hand in the code view.
* Approximated pictures lag by up to a second and are 256×144, so fine detail and fast motion from other outputs look
  different from the main output. That is what the "≈" says.
* A chunk whose plugin is loaded with raw `loadScript` runs that script again in every preview runtime that shows it.
