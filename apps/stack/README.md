# Chain Stack

A text-shaped, touch-first editor for [Hydra](https://github.com/hydra-synth/hydra-synth). It keeps the *shape of Hydra code*
(a vertical stack of dot-calls) and makes every token a touch target. It reads like the code, so someone who knows Hydra is at
home, and someone who does not can learn the vocabulary by tapping.

```
┌───────────────────────────────────────────┬──────────────┐
│ // osc ( 20 , 0.1 , 0.8 )          👁  ⌖  │ [ search   ] │  generator row (pinned first); its // switches the whole chain
│ // .rotate ( 0.8 , 0 )             👁  ⋮⋮ │  RECENT      │  modifier row (long-press ⋮⋮ and drag; swipe left deletes, right switches off)
│    ┌ peek: osc → rotate ┐                 │  ▣ .kaleid() │  the eye: "preview up to here", under the row
│ // .kaleid ( 4 )  (dimmed: switched off)  │  GEOMETRY    │  a switched-off row stays in place, dimmed; in the code it is `// .kaleid(4)`
│ ═══════════════ drop here ═══════════════ │  ▣ .pixelate │  ← dragging a chip from the tray opens a gap between rows
│ // .modulate ( ┌ noise(3) ┐ , 0.1 ) 👁  ⋮⋮ │  ▣ .repeat() │  a texture argument is an inline pocket holding a nested stack
│    .out ( o0 )                            │  …           │  pinned last
└───────────────────────────────────────────┴──────────────┘
                                         operator tray: beside the stack in landscape, along the bottom in portrait
```

It is one of the four prototype editors on the shared core (`packages/core`): same IR, same library, same runtime. It touches
only `apps/stack/`; everything else comes from `@hydra-ipad/core`.

```
npm run build:all                 # shell + every editor → dist/   (the app is served at /stack/)
npm run dev --workspace=stack     # vite dev server
npm test --workspace=stack        # 513 unit/UI tests (conversions, IR edits, autoView, reconcile, store, tray drops, corpus rendering in jsdom)
npm run typecheck --workspace=stack
node apps/stack/e2e/acceptance.mjs [--skip-build] [--only=1,2,6]   # real Chromium, touch input, software WebGL → apps/stack/shots/
```

## Interaction cheatsheet

| Gesture | Where | Does |
|---|---|---|
| **tap** a function name | any row | function picker: grouped (Generators · Geometry · Color · Blend · Modulate · Plugins), searchable, 64×64 live thumbnails. Unknown names can be typed. |
| **drag** a number sideways | number | scrub. Move the finger *down* while dragging for finer steps (×1 → ×0.1 → ×0.01 → ×0.001 at 56 / 120 / 200 pt). A bubble above the finger shows the value and the step. |
| **tap** a number | number | the number editor. **Keypad**: digits, `.`, `±`, `⌫`, nudges `×2 ÷2 −1 +1 +step`, *Reset to default*; every key applies at once and the whole visit is one undo step. With **Glide** on, a typed number (Go) or a nudge is a target the value glides to (duration in seconds or beats, `2b`; a curve); ↩ glides back; *Loop between* writes `[a, b].smooth(1).ease(…).fast(n)`. **Ladder**: the ladder below as a panel (arrow keys work). **Pad**: bind the number to a pad. The last tab is remembered. |
| **long-press and slide** | number | the **ladder**: rungs from a decade above the input's range to a decade below its step appear under the finger; slide up/down to pick one, left/right to step by it (24 pt per step; once the value moves, the rung stays put until you slide back to where you started); let go to keep it (one undo step), Esc to cancel. |
| ⇄ → **Pads** | top bar | the floating pads of numbers bound to pads (hold, latch or trigger; drag them by their grip). |
| **long-press** a parameter (and let go without moving) | any argument | kind menu: *Number · Function · Array · Texture · Default* (for texture slots also **o / s** and **variable**), parameter name, catalog default, *Reset to default*. Conversions are sensible: number→array `[n]`, number→function `() => n`, function→number evaluates once (or takes the default), ref ⇄ `src(ref)` pocket. |
| tap a **ƒ** chip | function value | chips (`time`, `mouse.x/y`, `Math.sin(time)`, `a.fft[0]`, `bpm`, …) insert into a one-line expression field; scale / offset scrubs wrap it as `() => expr * scale + offset`. `a.fft[n]` gets a **bin picker** and a **live meter**. Free text stays editable (autocorrect and smart quotes off). |
| tap an **array** chip | array value | step strip: drag the bars, `＋ / −` steps, `fast`, `smooth`, `ease`, `offset`, and a playhead that follows `time × speed × bpm/60`. |
| tap `⋮⋮` | modifier row | the row menu (as above). |
| **long-press and drag** `⋮⋮` | modifier row | reorder (generator and `.out` are pinned). The list auto-scrolls at the edges. |
| **swipe left** | free area of a modifier row (names and chips count as free; numbers scrub) | delete, with an Undo toast. |
| tap / long-press-drag `⠿` | statement gutter | statement menu / reorder statements (defs must stay above their uses; the editor shows a red dot if you break that). |
| ＋ | top bar | show / hide the **operator tray**: search, *Favourites* and *Recent*, then the same groups and thumbnails as the picker (Geometry · Color · Blend · Modulate · Plugins · Generators), one monospace `.name()` chip each. It sits beside the stack in landscape and along the bottom in portrait, and folds to a thin handle (tap it to open). |
| **drag** a chip out of the tray | operator tray | move the finger across the tray (up in portrait, sideways in landscape; any mouse drag) and the chip follows: thin gaps open between rows (the target gap shows a line and the rows below part), the stack auto-scrolls at its edges. Drop between two rows to insert there; drop on a texture parameter (`o1`, a pocket, `＋ texture`) to make or extend a pocket (a generator replaces / starts the pocket, a modifier joins it; `o1` becomes `src(o1).mod()`); drop a generator between statements for a new chain. Release over the tray to cancel. Pointer Events, so Pencil works the same. |
| **tap** a chip | operator tray | insert after the selected row (at the end of the active chain when nothing is selected; a generator starts a new chain after the selected statement). Hold still on a chip: add to / remove from favourites. |
| type + **Enter** | tray search | insert the first match after the selected row (keyboard path). A name the catalog does not know can be used as is (*Use “name”*). |
| **drag a row onto the tray** | `⋮⋮` / `⠿` reorder drag, tray open | the open tray turns into *Drop here to delete*; dropping deletes the row (or statement), with an Undo toast. |
| `//` | gutter of each row | switch the row **off / on**. Off is ordinary commented-out code (`// .rotate(0.8)`, or `// ` before every line of a statement), so the export still runs in vanilla Hydra; the row stays where it is, dimmed and striped, and its numbers stay editable. On the generator row it switches the whole chain; settings, sources, `render()` and plain variables have it under `⠿`. Calls inside a pocket have none (that chain is written on one line): switch the call that takes it. A refusal (e.g. a variable still used) is said in a toast, with *Switch the whole thing off* when that helps. Also in the row menu and the statement menu. |
| **swipe right** | free area of a row | switch it off / on, with an Undo toast. |
| 👁 | right of each top-level row | **preview up to here**: a small live picture of the generator and the switched-on modifiers down to this row, under the row (one open at a time). Tap the picture to enlarge and animate it; ≈ marks an approximation (it reads another output, `prev()` or a camera, seen through a copy of the main output). Previews never touch the main output and run only once the sketch is trusted. |
| **long-press** a function name | any row | the row menu: *Switch off*, *Preview up to here*, **What does this do? (A/B)** (before / after this modifier, A · B toggle on the enlarged peek), duplicate, move, *Insert modifier above / below…* (opens the tray at that point, filtered to modifiers), change function, delete. |
| *Previews: on demand / live / off* | ⋯ menu | the shared preview preference (all editors): on demand shows a still that refreshes when the chunk changes, live animates every visible peek, off hides every eye. |
| `＋ Add` | bottom | chain, variable (number / function / array / texture), source, bpm, speed, `render()`, comment, raw code. |
| **two-finger tap** / **three-finger tap** | stack side | undo / redo (also the ↶ ↷ buttons). A touch over the preview belongs to the preview's own document. |
| 🎲 | top bar | `randomSketch(seed)`; the seed is shown. **Long-press**: mutate the active chain (gentle / normal / bold), roll again, choose a seed, add a random chain. |
| **Blocks \| Code** | top bar | the same sketch as text (CodeMirror 6, Hydra-aware completion). Edits are parsed back on a pause or on blur; selecting a block highlights its text and the other way round. A syntax error keeps the blocks on the last good version and says so. |
| ⌘Z · ⇧⌘Z · ⌘Enter · ⌘D | hardware keyboard | undo · redo · run again · duplicate the selected row |
| ◧ / ▣ | top bar | preview as a **panel** (beside the stack in landscape, on top in portrait) or as the **full background**: the live output fills the screen behind the stack and the code, like hydra.ojack.xyz, and the stack takes the whole area. The choice is shared with the other editors and survives reloads. While it is on, the swatch next to it sets how dark the backing behind text is (light · medium · strong). |
| Apple Pencil | everywhere | Pointer Events: `pen` behaves like touch. *Pencil pressure* (⋯ menu, off by default) makes a hard press scrub 4× finer. |

Chain strip (under the top bar): **Setup** (sources, bpm, speed, render), one chip per chain in source order labelled by output (a switched-off chain is dashed and tagged *off*),
`＋` for a new chain, and **One | All 4** for the render target. A chain without `.out()` is flagged *not rendered* with a one-tap
**send to o0** (the first free output when o0 is taken); when two chains write the same output the earlier one is *shadowed*.

## What every sketch looks like here

Any sketch in the shared library, including one imported from plain text, opens with a default view built by
`autoView(sketch)` (`src/view.ts`, saved to `meta.stack`, rebuilt by *⋯ → Arrange*):

* every statement is a row, in source order. Chains are chain-stacks; each `def` is a `name = value` row using the same scrub / array /
  function editors; `var` references are chips that jump to the definition; comments are dim note rows; `raw` statements are monospace
  rows collapsed to their first line with a status dot (green: recognised, would become blocks · amber: kept as code · red: syntax
  error), tap to edit as text and *recognised text becomes blocks when you leave the field*;
* unknown calls (a plugin that is not loaded) are generic rows with an editable name and arguments; they upgrade when the plugin
  registers (`catalog.subscribe`);
* sources, `bpm`/`speed` and `render()` have their own rows and controls;
* switched-off (disabled) statements and modifiers are rows like any other, dimmed and striped (the kit's `.is-disabled`). A sketch
  whose commented-out code the importer revived says so once, on first open: *N commented-out chunks were revived as disabled*
  (dismissible; `meta.stack.revived` holds the count until then).

`meta.stack` holds view state only (`mode`, `active` chain, `renderMode`, the rows and strip as built, the revived-note count).
Switching off is in the code (`//`), never in `meta.stack`: Chain Stack never had a bypass / mute / solo flag, so there is nothing to migrate. It is not in the undo history.
Other apps' `meta` is never touched (tested). The IR is the only source of truth: every edit is a new immutable `Sketch` handed to
`library.autosave`.

## How it fits together

* `src/model.ts` identity-preserving IR edits (untouched statements keep their object identity), argument references, spacing repair
  after statement inserts/moves (`respace`: the whitespace before a statement lives on the statement, core expects editors to keep it
  sane).
* `src/view.ts` `autoView`, the strip, and `reconcile(prev, parsed)`: after a text edit the new parse keeps the ids and meta of
  statements, chains and calls that are still "the same thing" (LCS on content, then pairing in order), so selection and the active
  chain survive typing.
* `src/store.ts` the sketch, unlimited undo/redo, coalescing (a scrub is one step), view-only commits.
* `src/runner.ts` the runtime: trust gate (`riskyParts`, `library.needsTrust/approve`; safe-mode runs until the owner says yes), a
  "last good version" so a failing run puts the previous program back instead of a black or frozen preview, error collection,
  fast numeric path.
* `src/ui/*` Preact components: `Scrub`, `Keypad`, `ArgView` (every value kind), `FnEditor`, `ArrEditor`, `Picker`, `Tray`, `Rows`, `Chrome`, `CodeView`.
* `src/tray.ts` where a tapped or dropped operator lands (`tapTarget`) and what the drop does to the IR (`dropOperator`: a gap,
  a texture parameter, a new chain); pure and unit-tested. `src/drag.ts` the chip drag itself (ghost, gaps, parting rows,
  auto-scroll). `src/peek.ts` which row's preview is open, and the preview pool the rows use (see Core change requests, 7).
* `src/problems.ts` which row owns a problem: `validate()` already names nodes; thrown errors are attributed by name
  (`x is not defined / not a function`); everything else goes in the banner at the top of the stack.

Fast numeric edits follow `docs/live-edit.md`: a drag calls `rt.setLive(liveId(call, i), v)` and updates the IR with a coalesced
commit; the run is skipped until the gesture ends, then `rt.run(sketch)` (which detects "only numbers changed" and does not
recompile). Numbers that are not live (a `def`, `bpm`, `speed`, plugin functions the catalog does not know) recompile once per frame at most.

Audio is only ever bound with `audioChip`; `mountAudioPanel` is mounted in a sheet. Nothing here calls `getUserMedia` or creates an
`AudioContext`. All runtime calls are asynchronous. The app registers no service worker and no manifest (the shell's root-scope worker
covers `/stack/`); app-private preferences use the `hydra-stack:` prefix.

## Acceptance (run here; see `shots/RESULTS.md` for the last run)

Chromium with software WebGL (SwiftShader) and touch emulation through `Input.dispatchTouchEvent`, at 1180×820 and 820×1180.
**Frame-time numbers are software rendered and say nothing about an iPad.**

| # | brief | result |
|---|---|---|
| 1 | build `osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out()` using touch only, both orientations | pass (identical canonical IR; `.modulate(noise(3))` because 0.1 is modulate's default, which codegen drops) |
| 2 | scrub: preview within one frame, ≥ 30 fps | **Partly verifiable here.** What holds: 0 recompiles; `setLive` runs inside the pointer event (p95 < 1 ms after `pointermove`) and core coalesces it to one `postMessage` per frame; the preview pixels change; the app's own cost is negligible (`store.commit` with every listener: median 0.1 ms; main-thread script time 4–7 ms per second both idle and while dragging, no long tasks). What does not: host-page frames during a 180-move CDP touch drag have median 16.7 ms (60 fps) but **p95 ≈ 83 ms and ~27 % of frames slower than 33 ms**, against an idle baseline of ~12–16 %. That slowdown is SwiftShader redrawing the sandboxed canvas on the same CPU, not our code, but with no GPU here I cannot show ≥ 30 fps on a device. The frame's own fps cannot be read from outside the sandbox, so host rAF is only a proxy. |
| 3 | number → array → function; code view follows; code edits update blocks | pass |
| 4 | reorder, undo, redo | pass (long-press drag, buttons, two/three-finger taps, ⌘Z/⇧⌘Z) |
| 5 | offline reload, sketches persist | pass (shell loaded once; `context.setOffline(true)`; reload; the frame bundle comes from the shell's cache) |
| 6 | corpus: 33 sketches, nothing hidden, export identical, one edit = one line | pass for all 33 (incl. `24-broken` and `33-crlf`); `initScreen()` sketches log a console permissions-policy line from the sandboxed frame |
| 7 | switch to the harness and back | pass: same sketch and code (including a switched-off `// .kaleid(4)`, still a disabled row when back); `meta.stack`, `meta.graph`, `meta.rack` unchanged |
| 13a | switch off with `//` and with a swipe right; export comments that line only; switch back on (byte-identical); the generator's `//` comments the whole chain; undo | pass |
| 13b | the eye: a peek under the row renders from the preview pool without re-running the main runtime; *Previews: off* hides every eye | pass (software WebGL: one still frame on demand) |
| 13c | A/B a modifier from the long-press menu; the A · before / B · after toggle | pass |
| 13d | drag a chip from the tray into a gap (the line shows and rows part while dragging); a generator dropped on a pocket replaces its generator | pass |
| 13e | no-drag paths: long-press → *Insert above* opens the tray filtered to modifiers; search + Enter inserts after the selected row; dragging a row onto the tray deletes it, with undo | pass |
| 13f | reorder by the handle and swipe-left delete still work next to drag-in | pass |
| 13g | importing commented-out code: revived chunks are disabled rows; the one-time note is dismissible and stays dismissed | pass (no old bypass flag exists in `meta.stack`, so there is no migration to test) |

Plus checks for the strip flags, setup sheet, dice and mutate, open / import / export, raw editing, error attribution and the
last-good-frame fallback, the trust gate, the audio chip meter, the picker with thumbnails and plugins, unknown calls, six layouts
down to 320 pt (Slide Over), the picture-in-picture preview, the full-background preview (12a/12b), Apple Pencil input, texture kinds, selection sync, MIDI / camera
banners, statement reordering, thumbnails (160×90) and completion.

## Screenshots

`shots/` has the full set from the last acceptance run (`RESULTS.md` is the table). A few:

| | |
|---|---|
| ![built by touch, landscape](shots/01-landscape-built.jpg) | ![portrait, preview on top](shots/01-portrait-built.jpg) |
| ![kind menu](shots/03-kind-menu.jpg) | ![array step strip](shots/03-array-editor.jpg) |
| ![function editor](shots/03-function-editor.jpg) | ![code view](shots/03-code-view.jpg) |
| ![audio chip: bin picker and meter](shots/09-audio-chip.jpg) | ![operator tray with thumbnails](shots/09-tray.jpg) |
| ![dragging an operator in: the gap opens](shots/13-drag-in.jpg) | ![a row dragged onto the tray: delete zone](shots/13-drag-out.jpg) |
| ![a switched-off modifier](shots/13-disabled-row.jpg) | ![a switched-off chain](shots/13-disabled-chain.jpg) |
| ![preview up to here](shots/13-peek-prefix.jpg) | ![A/B: before and after a modifier](shots/13-peek-ab.jpg) |
| ![revived commented-out code](shots/13-revived.jpg) | ![tray in portrait](shots/01-portrait-tray.jpg) |
| ![chain strip flags](shots/08-strip-flags.jpg) | ![trust gate](shots/09-trust-gate.jpg) |
| ![error: last good frame](shots/09-error-last-good-frame.jpg) | ![Slide Over, 320 pt](shots/10-layout-slide-over-320.jpg) |
| ![full background, blocks](shots/12-backdrop-landscape-blocks.jpg) | ![full background, code](shots/12-backdrop-portrait-code.jpg) |

## Known issues

* **Not tested on an iPad.** Everything above is Chromium with emulated touch. Safari specifics (pointer-capture on touch, `touch-action`
  hand-off, container-query units for the 16:9 preview, the on-screen keyboard over popovers, iOS's own 3-finger edit gestures) are
  implemented from the platform docs, not observed.
* Editing a number inside a `def` that holds a chain re-lays that definition out (core regenerates it from scratch); on chains
  at statement level only the edited call's line changes.
* Dice replaces all statements (undoable, toast says the seed); mutate only touches the active chain.
* Renaming a variable follows `var` references in blocks, not text inside `raw` rows.
* Plugin functions are only listed once a plugin has been loaded by a sketch or the runtime; there is no plugin manager here.
* `s0.initCam()` / `initScreen()` cannot get permission inside the sandboxed frame; the banner offers a trust-gated switch to inline mode
  (not exercised with a real camera).
* The thumbnail runtime is a second WebGL context created on first use of the picker and disposed after 20 s idle.
* Two-finger / three-finger taps do nothing over the preview (a separate document).
* `meta.stack.rows` / `chains` record the view as built; the UI always renders from `sketch.stmts`, so they can lag behind later edits.
  Only `mode`, `active` and `renderMode` are read back.

## Core change requests (not made; listed in the PR)

1. `codegen.emitChainTopLike`: honour `call.src` / `chain.src` inside def-held chains, so one numeric edit changes one line there too.
2. Statement-level helpers (`insertStmt`, `moveStmt`, `removeStmt`) that repair `src.before`; editors currently each carry a copy (`model.respace`).
3. `runtime.run`: keep the previous outputs until the new evaluation has succeeded (today `resetForRun` blacks every output first,
   so an editor has to re-run the last good sketch to avoid a black preview).
4. Node attribution for runtime errors: `toRunnable` could return ids by line/column so thrown errors map to rows without guessing from the message.
5. A cheap clock for the array playhead (`rt.clock()` returning time, speed, bpm) instead of polling `rt.time()`.
6. Frame `allow="display-capture"` (or a quieter failure) for `initScreen()` sketches.
7. **Preview pool: a handle can stay in `starting` for ever.** `createPreviewPool`'s `start()` compares `h.plan !== plan` by
   identity after `await s.rt.ready`, and every `handle.update()` makes a new plan object (same `key`). `PreviewPeek` calls
   `update()` right after `open()`, so the first preview in a cold pool never runs (stats: `runs 0, frames 0`). Fix: compare
   `h.plan?.key !== plan.key` (three places). Until then `src/peek.ts` wraps the pool so `update()` waits while a handle is
   `starting` (the blocks editor hit the same bug).
8. **Keep the import report.** `library.create(name, code)` drops `importText`'s report, so an editor can't tell commented-out
   code the importer revived from chunks someone switched off in another editor. Chain Stack counts disabled nodes on its
   first open of a sketch instead; storing `report.revived` (or the whole report) with the entry would make the note exact.
9. **`canDisable` for calls in a pocket could offer `instead` as a cascade**, so a single tap can switch the call that takes
   the pocket without a second step; today the stack shows no toggle in pockets and points to the row menu of the outer call.

## Step 09: switching off, previews and drag-in, in retrospect

Again: none of this was held on an iPad. It was driven with emulated touch (CDP) at 1180×820 and 820×1180 in Chromium with
software WebGL.

**What felt right.** `//` in the gutter reads exactly like what it does: the dimmed row next to it *is* `// .rotate(0.8)`, and
the export says the same thing, so there is nothing new to learn and nothing hidden in `meta`. Swiping right to switch off pairs
naturally with swiping left to delete. The eye under a row answers "what does the chain look like at this point?" without
leaving the stack, and *What does this do?* with its A/B toggle is the quickest way I found to understand an unfamiliar
modifier. Dragging a chip into a gap is direct: the line and the parting rows say where it will land before you let go.

**Did drag-in make the stack feel too much like blocks?** Somewhat, and less than I feared. What keeps it code-shaped: the
chips are monospace `.name()` text, a drop inserts one line and nothing snaps or nests visually beyond the pockets that were
already there, and values are never dropped into slots (only operators into gaps or texture parameters). What pulls it
towards blocks: the tray is a palette, and once it is open it is tempting to build by dragging rather than by reading the
code. Changes I would make: keep the tray closed by default (it is) and open it from a gap (*insert here*) rather than from
the top bar; show the chip's code in the ghost while dragging (`.kaleid(4)` with defaults, not `.kaleid()`); and drop the
thumbnails on small screens, where they make it look like a block palette.

**What was clumsy.**
1. *Row width.* Every top-level row now carries a `//` toggle on the left and an eye plus a handle on the right (≈ 120 pt).
   At 45 % width a three-argument `osc` wraps; with the side tray open the stack takes 58 % so it does not get worse, but in
   Split View it will. The eye could move into the long-press menu on narrow layouts.
2. *Starting a chip drag.* A drag has to begin across the tray's scroll direction (up in portrait, sideways in landscape);
   a diagonal start scrolls the tray instead. It works but is invisible; a short hold that "lifts" the chip would be clearer.
3. *Dragging a row to the tray to delete it* works, but the row only follows the finger vertically (reorder keeps it in its
   column), so you drop "the finger" on the tray, not the row. Swipe-left is still the better delete.
4. *Pockets.* Calls in a pocket have no `//` (core refuses them, rightly) and no eye, to keep pockets readable; that is a gap
   in "every row" that users will notice.
5. *Previews in software WebGL* show one still frame on demand after ≈ 1–3 s; on a GPU it should be much quicker, but I could
   not measure it. The first peek waits for a preview runtime to boot.
6. *A switched-off chain draws nothing*, so with one chain the main preview goes black. That is honest (it is what Hydra
   does) but surprising; the strip chip says *off*, the stack row is dimmed.

### iPad checklist (step 09, Chain Stack)

- [ ] `//` toggles respond to a finger and to Pencil; a switched-off row is clearly dimmed but readable in both orientations and in the full-background preview.
- [ ] Swipe right on a row's name switches it off/on; swipe left still deletes; neither fires while scrolling the stack vertically.
- [ ] The generator's `//` switches the whole chain; the strip chip shows *off*; switching on restores the exact text (check Code view).
- [ ] The eye opens a peek under the row within a second or two; tapping it enlarges and animates; scrolling it offscreen stops it (watch battery / heat with *Previews: live*).
- [ ] Long-press a modifier's name → *What does this do?*: A/B toggle shows before and after.
- [ ] *Previews: off* in ⋯ hides every eye; *on demand* brings them back.
- [ ] The ＋ in the top bar opens the tray beside the stack (landscape) and along the bottom (portrait); its handle folds and reopens it; the on-screen keyboard does not cover the search field in portrait.
- [ ] Dragging a chip up (portrait) or sideways (landscape) lifts it out of the tray; dragging along the tray scrolls it instead; the stack auto-scrolls near its top and bottom edges while dragging.
- [ ] Drop between two rows, on `o1` / a pocket, and (a generator) between statements; release over the tray cancels.
- [ ] Drag a row by `⋮⋮` onto the tray: *Drop here to delete* shows, the row is deleted, Undo brings it back.
- [ ] Long-press a name → *Insert modifier above…* opens the tray filtered to modifiers; a hardware keyboard can type in the search and press Enter.
- [ ] Import a sketch with commented-out code: the note says how many chunks were revived; Dismiss sticks after a reload.
- [ ] Apple Pencil: drag-in, swipe and the toggles work with the Pencil exactly as with a finger.

## What felt clumsy on touch, and what I would change

Honest caveat first: I never held this on an iPad. These are the rough edges I hit driving it with emulated touch at iPad sizes
and reading the screenshots; real fingers will find more.

1. **Rows wrap.** At 45 % width a four-argument call (`color`, `scroll`, `modulateScale` with a pocket) breaks over two or three
   lines and the `( … , … )` shape stops reading like code. 44 pt targets are the cost. *Change:* fold trailing default arguments
   behind a single `⋯` chip until touched; let the divider between stack and preview be dragged.
2. **A scrub has to start sideways.** Rows scroll vertically (`touch-action: pan-y`), so a drag that begins diagonally or downwards
   scrolls the list instead, and the "finer when the finger is lower" trick only works once the horizontal drag has begun. It is learnable
   but invisible. *Change:* a short press-and-hold that arms the scrub (like the reorder handle), or a first-use hint.
3. **Dim default arguments invite accidental edits.** Touching one turns it into an explicit argument (it disappears from the export
   again only when it is trailing and equal to the default). They also take the room that costs item 1. *Change:* see 1.
4. **Long-press is slow and silent.** 460 ms before the kind menu, no haptics in Safari, and it competes with the start of a slow
   scrub. The menu is a popover, not the radial menu the brief sketched, because a radial has to dodge screen edges and nested pockets.
   *Change:* a visible `⋯` affordance on the focused row, and a real radial for the five kinds.
5. **Popovers sit on top of what you are editing.** The keypad (≈ 270 × 400 pt) covers the three rows below the number; the function
   editor plus its keypad covers most of the stack in portrait. *Change:* dock the editors to the free half of the screen, or
   dim and push the stack instead of overlaying it.
6. **Pockets get cramped.** The nested rows only indent ≈ 10 pt, the `⇄` button (44 pt) sits over the pocket's `＋ add` row, and a
   pocket in a pocket in a pocket is hard to see. *Change:* depth-aware indentation and a pocket header line instead of a corner button.
7. **Multi-finger undo is fragile.** It cannot work over the preview (a different document), and on an iPad three fingers also mean the
   system's copy/paste/undo gestures. The buttons and ⌘Z are the reliable path.
8. **Thumbnails arrive one by one.** Software WebGL took ≈ 0.3 s per function, so the first picker shows a screen of `…`. A GPU will be
   faster but I could not measure it. *Change:* render them in idle time after load and cache them in IndexedDB.
9. **Two handles on one card.** `⠿` (statement) and `⋮⋮` (row) look alike and do different things. *Change:* only show the
   statement handle on long-press of the card background.
10. **Typing code on a glass keyboard is the slow path.** CodeMirror works, completion works, but there is no row of `( ) { } . , =>`
    above the on-screen keyboard. *Change:* add one.
11. **Setup is in two places.** The Setup sheet lists rows that are also in the stack. It is a shortcut, but a duplicate is a smell.
12. **Banners eat the small screens.** At 320 pt the trust banner plus an error banner take over 150 pt of the stack pane.
13. **The 16:9 preview letterboxes** in portrait Split View, wasting the top 40 %. *Change:* let the preview fill and crop, or shrink the pane to the picture.
