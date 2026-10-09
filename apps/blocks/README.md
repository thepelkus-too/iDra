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
| **Round slot** | a number. Drag sideways to scrub (finer the further your finger is above or below), tap for the keypad, double-tap for the default |
| **Square socket** | a texture input. Takes a whole stack (hat + blocks, no cap), `o0`–`o3`, `s0`–`s3` or a picture variable. Lights up while you hold something it takes |
| **Reporters** | sine / saw / triangle / square waves and random steps (with `freq`, `amount`, `offset` slots), `time`, `mouse x/y`, `audio bin [0]` (core's `audioChip`, with a live meter), `volume`, a **pattern** step sequencer, and a JS expression. They write arrow functions or arrays |
| **Pattern** | a step sequencer in a pill: tap a step to type it, drag it up or down, ＋/− steps, `×` speed (`.fast`), `smooth` |
| **Math** | `( ) + ( )`, `−`, `×`, `÷`, `sin ( )`, `abs ( )`, `random`; they nest, and each hole takes a number, `time`, the mouse or another math block. Written as one arrow function, `() => Math.sin(time) * 0.5` |
| **set [name] to ⟨value⟩** | `const name = …`, with the same slots, sockets and reporters as any input; variables appear as reporters in the palette |
| **Setup blocks** | `camera → s0`, `image URL → s0`, `video URL → s0`, `screen → s0`, `bpm`, `speed`, `show [all outputs ▾]` |
| **advanced JS** | a raw statement: editable monospace text with a parse-status dot; code it recognises turns into blocks |
| **Comment bubble** | a comment, sitting just above the script after it |
| **Grey block** | a call the catalog does not know (a plugin that has not loaded): editable name, its arguments as slots. It turns into a real block in place when the plugin registers the function |

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

## Workspace and code

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

**Recommendations.** Share the editor kit (store, runner, keypad, sliders, thumbnails, code drawer) as a core package rather
than copying it into each app; give core a template registry so starters appear in the shell's New menu; and let codegen
keep explicit default arguments a user typed.
