# Blocks

Scratch-style Hydra: a chain is a stack of blocks that snap together, texture arguments are square sockets that take whole
stacks, and moving numbers are reporter blocks you drop into round slots. Aimed at play and discovery more than speed, with
the generated Hydra a tap away. Served at `/blocks/` inside the shell; it reads and writes the shared sketch format, so
anything made in another editor opens here and the other way round.

* `npm run dev -w blocks`: dev server
* `npm run test -w blocks`: unit tests (drops as pure functions, math reporters, layout and rendering over the whole corpus)
* `npm run build:all && node apps/blocks/e2e/acceptance.mjs`: the iPad acceptance run (Chromium, touch through CDP, software
  WebGL). Results land in [`shots/RESULTS.md`](shots/RESULTS.md) next to the screenshots.

## The block language

| Block | Hydra |
|---|---|
| **Hat** (rounded top) | the generator: `osc ( 20 , 0.1 , 0.8 )`. Hats never snap under anything; a hat dropped on empty workspace starts a script |
| **Stack block** | one chain call (Geometry, Color, Blend, Modulate, Plugins), coloured by category with an icon and a label |
| **Cap** `show on [o0 ▾]` | `.out(oN)`. A script with no `.out` ends in an open, dashed cap "not rendered" with a one-tap **show on o0**; its blocks are dimmed |
| **Round slot** | a number. Drag sideways to scrub (finer the further your finger is above or below), tap for the number editor, double-tap for the default |
| **Square socket** | a texture input. Takes a whole stack (hat + blocks, no cap), `o0`–`o3`, `s0`–`s3` or a picture variable. Lights up while you hold something it takes |
| **Reporters** | sine / saw / triangle / square waves and random steps (with `freq`, `amount`, `offset` slots), `time`, `mouse x/y`, `audio bin [0]` (core's `audioChip`, with a live meter), `volume`, a **pattern** step sequencer, and a JS expression. They write arrow functions or arrays |
| **Pattern** | a step sequencer in a pill: tap a step to type it, drag it up or down, ＋/− steps, `×` speed (`.fast`), `smooth` |
| **Math** | `( ) + ( )`, `−`, `×`, `÷`, `sin ( )`, `abs ( )`, `random`; they nest, and each hole takes a number, `time`, the mouse or another math block. Written as one arrow function, `() => Math.sin(time) * 0.5` |
| **set [name] to ⟨value⟩** | `const name = …`, with the same slots, sockets and reporters as any input; variables appear as reporters in the palette |
| **Setup blocks** | `camera → s0`, `image URL → s0`, `video URL → s0`, `screen → s0`, `bpm`, `speed`, `show [all outputs ▾]` |
| **advanced JS** | a raw statement: editable monospace text with a parse-status dot; code it recognises turns into blocks |
| **Comment bubble** | a comment, sitting just above the script after it |
| **Grey block** | a call the catalog does not know (a plugin that has not loaded): editable name, its arguments as slots. It turns into a real block in place when the plugin registers the function |
| **Switched-off block** (`//` pressed) | a commented-out line: `  // .rotate(0.8)`. Grey stripe, struck-through name, dimmed and striped, but still in place, selectable, and its slots still edit (inside the comment). A switched-off hat is the whole script, every line commented: `// noise(3)` / `//   .out(o1)` |

Every function block is generated from `core.catalog` (and regenerated on `catalog.subscribe`), so new or plugin functions
appear without code changes. There is a help line for each of the 52 built-in functions (≤ 12 words; `modulateHue`, `prev`
and `sum` are marked `TODO review`); plugin functions get a generic line naming the plugin.

## Gestures

| | |
|---|---|
| **Pan / zoom** | one finger on empty workspace pans; pinch zooms; trackpad scroll and ⌘-scroll too |
| **Move blocks** | press a block and move: it comes off with every block under it (as in Scratch). Press a hat: the whole script moves |
| **Snap** | while you hold something, every place that takes it lights up; the one under your finger glows; let go to snap |
| **Loose blocks** | drop blocks on empty workspace: they wait there, dashed and labelled "not in the code", until you snap them under a script |
| **Delete** | drop onto the palette or the 🗑 that appears while dragging; or select and tap Delete |
| **Reporters** | drag a reporter out of the palette into a slot or socket; drag it out of the slot to take it away (a wave leaves behind the number it was centred on) |
| **Palette** | left flyout in landscape, bottom drawer in portrait; category tabs and search. Tap a block to add it where it makes sense (a hat as a new script, a stack block under the selected block, a cap on the selected script); hold for a "what does this do?" card |
| **Numbers** | drag a round slot sideways to scrub (finer the further your finger is above or below); tap for the number editor (tabs **Keypad** with Glide, **Ladder**, **Pad**; the last tab is remembered); double-tap for the default |
| **Ladder** | long-press a number (hold still ⅓ s), then without lifting: slide up or down to pick the step, left or right to change the value by it (the step then stays put until you slide back to where you started); let go to keep it (one undo step), Esc to cancel. Hold still and let go: the Ladder tab |
| **Pads** | in a number's Pad tab, **Bind to a pad**: the number becomes a hydra-motion knob played from a floating pad (hold, latch or trigger). ⇄ → **Pads** shows or hides them |
| **Switch off / on** | the `//` at the end of a block. On a hat it switches the whole script (a `set` that holds a chain: the `set`); on a blend or modulate block it takes the picture in its socket along. A block inside a socket can't switch alone: its `//` is dashed and a tap says to switch the block that takes it (with a button for that). Switching off a `set` that other scripts use switches them too (a toast says so, with Undo). Also in the selection bar and the long-press menu |
| **Preview up to here** | the 👁 at the end of a block: a small picture of the chain from its hat to that block (switched-off blocks left out), in a popover anchored to the block. Tap the picture to play it larger. ≈ marks an approximate preview (it reads another output, `prev()` or a camera, from a copy of the main picture). Tapping elsewhere closes it, and a closed preview runs nothing |
| **Long-press a block** | hold still, then let go: **Preview up to here**, **Before / after (A/B)** (the chain without and with this block; tap the picture, then A or B), **Switch off / on**. Hold then move is still a drag |
| **Previews setting** | ⋯ → **Block previews: off / on demand / live**, shared by every editor (`idra.previews`). On demand (the default) shows a still picture until you tap it; live animates every visible peek (costs GPU and battery); off hides the eyes and the preview menu items |
| **Undo / redo** | two-finger tap / three-finger tap, the ↶ ↷ buttons, ⌘Z / ⇧⌘Z |
| **Keyboard** | ⌘D duplicate, ⌫ delete, ⌘K palette, ⌘Enter run, Esc clear |

Play: 🎲 **Surprise me** drops a random valid script (core's `randomSketch`); select a script and **✨ Mutate** nudges every
number a little; the **↶ scrubber** in the selection bar slides back through the last 20 states of the selected script (one
undo step when you let go); **Fold** shrinks a script to its hat. **New from a starter…** (in ⋯) offers seven classic idioms
(kaleidoscope, feedback trails, wobbly stripes, pulsing shape, pattern steps, two outputs mixed, colour cycle).

The output floats as a picture-in-picture window (drag its top to move it, its corner to resize, ⛶ for full screen). ▶ runs
again, ■ hushes until the next edit. **Code** opens the generated Hydra beside (landscape) or below (portrait) the
workspace, read-only until you switch on Edit, with the selected block highlighted; edits parse back, and text it does not
recognise becomes advanced-JS blocks.

## Switched-off blocks and previews (step 09)

Switching off is core's `disabled` flag, written as ordinary `//` comments, so the exported code still runs in plain Hydra
and means the same there. Nothing moves: a switched-off script keeps its place and its place in reading order, and the
layout is the same as with it on. A switched-off script writes no output, so it never marks another script "shadowed".

* **Importing commented-out code.** When a sketch arrives with code commented out that the importer can read (core's
  `report.revived`), those parts open as switched-off blocks, and the first time Blocks opens the sketch a note says
  "N commented-out chunks were revived as disabled". ✕ dismisses it for good (remembered per sketch in this browser, outside
  the sketch, so undo never brings it back). The note appears only for a sketch no editor has opened yet; one that another
  editor has already shown opens without it.
* **No old state to migrate.** Blocks never had a bypass, mute or solo flag of its own. Loose blocks (dragged off a script,
  "not in the code") are a different thing and stay as they are.
* **Previews** come from the kit's `PreviewPeek` on the kit's shared pool (at most two small hidden runtimes, never the
  main output). The palette thumbnails are unchanged.


The sketch (core's IR) is the only source of truth; the workspace is drawn from it and every drop is a pure function
(`applyDrop` in [`src/drop.ts`](src/drop.ts)) from (sketch, view, what you hold, where you let go) to a new sketch and view,
committed as one undo step. View state is `sketch.meta.blocks`: script positions, loose blocks, folded scripts and the camera.

* **Default view** (`autoView`, pure and deterministic): every top-level statement is a script, stacked in source order in
  columns that wrap at 1500 px; a comment sits right above the script after it.
* **Reading order is code order.** Scripts read top to bottom, columns left to right. Moving a script reorders the
  statements to match; a definition dragged below its first use is pulled back up to just before it, so core's `validate`
  never sees a variable used before its definition. An untouched layout reorders nothing.
* Statements that appear without a position (typed in the code view, or added by another editor) go after the last script
  if they are at the end of the code; otherwise the workspace is laid out again, so reading order stays code order.
* An output written twice marks the earlier script **shadowed**.
* An unchanged sketch exports byte for byte as it was imported; changing one number changes one line. Both are checked over
  the whole corpus in the unit tests and again in the browser.

## Known issues and limits

* When a call is edited, core's codegen writes it again and leaves out trailing arguments that equal the catalog default:
  `modulate(noise(3), 0.1)` with a new texture becomes `modulate(o0)`. It is the same sketch (same canonical form) but the
  user's explicit `0.1` disappears from the text. Graph has the same behaviour; see core change requests.
* A stack pulled out of a socket leaves the socket empty, which Hydra writes as `blend()` and reports as an error until
  something is dropped in. The socket says "drop a picture here".
* Output and source reporters (`o0`, `s0`) show a label and an icon but no live thumbnail yet.
* Text fields on blocks (names of unknown calls, JS reporters, comments, URLs, step values) use the system prompt. It works
  with the on-screen keyboard and Scribble but is plain.
* Block widths are estimated from the text for the default layout (heights are exact); the e2e run checks the corpus for
  overlaps in a real browser, and wide scripts get generous column gaps.
* Core's audio engine has no `beat`, so there is no beat reporter.
* `hydra-examples` has no license file, so the import check uses the corpus's own `03-blending.js` and `17-for-loop.js`.
* All browser checks are Chromium with software WebGL and emulated touch; nothing here was run on an iPad.
* The `//` and 👁 sit at the right end of each block, which is where the floating output window starts in landscape. Move
  the window (drag its top) or pan the workspace if it covers them.
* A `set` holding a number, a setting, a source and `show` switch as whole statements; comments and advanced-JS blocks have
  no `//` (comment raw code by hand in the code view).

## Core change requests

* **The preview pool can stay `starting` for good** (`packages/core/src/preview.ts`). `start()` checks `h.plan !== plan`
  (object identity) after `await s.rt.ready`, `rt.run` and the clock sync, but `handle.update()` always replans (a new plan
  object with the same key) and restarts only when the key changes. The kit's `PreviewPeek` calls `update()` right after
  opening, so the first peek in a cold pool never ran (stats: 0 runs, 0 frames). Fix: compare `h.plan?.key !== plan.key`
  in those three places. Until then Blocks wraps the pool (`blocksPreviewPool` in `src/ui/Chunk.tsx`) so `update()` waits
  until the handle has left `starting`. Every editor using `PreviewPeek` needs either the fix or the same wrapper.
* **Carry the import report to the editor.** `report.revived` is lost once the library stores the sketch, so Blocks infers
  "revived" from a sketch no editor has opened that already has switched-off parts. A field such as
  `meta.import = { revived }` written by `library.create`/import (and cleared by the first editor that shows it) would make
  the note exact and shared by every editor.
* **A "previews" control in the shell.** The preference is global (`idra.previews`) but only the harness had a control;
  Blocks adds one to its ⋯ menu. One place in the shell's settings would be clearer.
* Codegen keeping explicit default arguments (above) still stands.

## Retrospective

**Blockly or custom: custom.** The brief asked to prefer Blockly if it could express nested stacks in a value input,
per-category colours, number fields with hint ranges, a pattern field and catalog-generated blocks. On paper it can do all
of that (custom fields and mutators are its extension points). I built a small engine instead, for three reasons, in order
of weight:

1. **Two sources of truth.** Blockly owns its workspace model and serialisation. Keeping Hydra's IR as the only truth would
   mean mirroring every Blockly event into the IR and every IR change (code view, undo, other editors, live number drags)
   back into Blockly, and the exact-text promise (untouched export byte-identical, one number edit = one line) would depend
   on that mirror never drifting. Here the blocks are just a view of the IR, like every other editor in this repo.
2. **Size.** `blockly_compressed.js` alone is about 640 KB minified, 180 KB gzipped, before blocks, generators and a theme.
   This whole app is about 280 KB gzipped including CodeMirror and the shared core (the same as Patch Graph), so Blockly would
   have added roughly two thirds on top of it for an iPad PWA that has to load from the shell's cache.
3. **The shapes Hydra needs.** A socket that holds a whole stack (hat plus blocks, inside a value input) is a C-block in a
   value position, which Blockly supports only through custom rendering. The rest (drag, snap, highlight, zoom) was a few
   hundred lines because the IR already does the hard part.

What the custom engine costs: no free accessibility tree or keyboard navigation of blocks (Blockly has both), no free
collision handling, and widths are estimated rather than measured. If this editor grew up, keyboard navigation would be the
first thing to add.

**Where the block metaphor fights Hydra.**

* **Feedback.** In blocks, `o0` is a reporter like any other, so "read the output this script writes to" looks as ordinary as
  reading a number. It works (check 3), but nothing on screen says it is a loop. Highlighting a script whose sockets read its
  own output would help.
* **Order.** Scratch scripts run in parallel; Hydra statements run in order, and order decides which writer of an output
  wins and where variables exist. Tying code order to reading order (with defs hoisted) keeps that honest, and "shadowed"
  shows its consequence, but a user who drags a script to the side can change which picture they see.
* **Array modifiers.** `[3, 4, 6].fast(2).smooth(1)` is a value with behaviour attached. The pattern pill handles the common
  modifiers; `.ease()`, `.offset()` and `.fit()` survive round trips but have no controls.
* **Arrow functions.** Only the shapes the wave and math blocks write are read back as blocks; any other function stays a JS
  reporter with its text untouched. That is the right call for safety, but someone who types `() => Math.sin(time*2)` (no
  spaces) sees a JS pill rather than a sine block. A normaliser in core could widen this.
* **Defaults.** Scratch blocks always show every slot; Hydra code leaves defaults out. Slots at their default are dimmed,
  and the code stays as short as the user wrote it, which is the right compromise but means "the block shows 0.1, the code
  does not".

**Step 09 retrospective (switching off and previews).**

* **What felt right.** A `//` at the end of every block reads like the code it writes, and the switched-off look (grey
  stripe, struck name, dimmed and striped) is clear while the block stays editable. Putting the switch on the hat for a
  whole script matches how Scratch users think of a script as "the hat and what hangs from it".
* **What is clumsy.** Two more buttons on every block (34 px wide each, under the 44 pt guideline, like the editor's other
  small buttons) make wide blocks wider, and they sit where the floating output starts in landscape. A finger aimed at a
  number near the end of a block can land on the `//`. If that happens on an iPad, show the tools only on the selected
  script and keep the long-press menu for the rest.
* **Long-press.** Blocks had no long-press on blocks before, so "hold still, then let go" is new and opens the menu on
  release (hold then move stays a drag, so a slow pick-up never becomes a menu). Whether 460 ms feels right with a real
  finger is unverified; the block gets a white ring once the hold counts.
* **The pool bug** only showed in the browser: the kit's unit tests use a fake pool and the harness lab never calls
  `update()` right after `open()`. It cost the first run of the e2e check and is listed under core change requests.
* **Not verified without an iPad:** how the popover peek behaves while pinch-zooming (it stays where it opened; any touch
  outside closes it), Safari's WebGL context limit with the main output, the palette thumbnails and two preview runtimes
  alive at once, and the cost of `live` mode on battery.

**iPad checklist (step 09, Blocks).**

1. Tap the `//` on a modifier block: it greys and strikes through; Code shows `  // .rotate(…)`; tap again and the text is
   as before.
2. Edit a number on a switched-off block (scrub and keypad): the comment in Code changes, the picture does not.
3. Tap the `//` on a hat: the whole script greys out, its cap included; Code shows every line commented; the script does
   not move and other scripts keep their order.
4. Switch off a modulate block holding a noise stack: the noise goes with it, on one commented line.
5. Tap `//` on a block inside a socket: it explains, and its button switches the block that takes it.
6. Tap a block's 👁: a picture of the chain up to that block appears next to it; tap it to play larger; tap elsewhere and
   it goes away.
7. Hold a modifier block still, let go, choose Before / after: tap the picture, then A and B, and see the difference.
8. Hold a block and move without letting go: it is a drag, not the menu.
9. ⋯ → Block previews: cycle to off (eyes disappear), live (open peeks animate; watch heat and battery), back to on demand.
10. Import a .js file with commented-out code: the note "N commented-out chunks were revived as disabled" appears once;
    ✕ removes it and it stays gone after a reload.
11. Switch to Chain Stack and back with a block switched off: still off, same code.
12. With the output window in its default place (landscape), check whether it covers the `//` and 👁 of wide blocks.

**Recommendations.** Share the editor kit (store, runner, keypad, sliders, thumbnails, code drawer) as a core package rather
than copying it into each app; give core a template registry so starters appear in the shell's New menu; and let codegen
keep explicit default arguments a user typed.
