# Rack

Hydra as an instrument: a rack of modules with big knobs, XY pads and patch jacks, a bay of modulation sources you drag
onto knobs, eight scenes with crossfades, and a performance mode. The code is secondary and lives in a drawer. Served at
`/rack/` inside the shell; it reads and writes the shared sketch format, so anything made in another editor opens here and
the other way round.

* `npm run dev -w rack`: dev server
* `npm run test -w rack`: unit tests (layout, panels, edits, modulation, crossfades and a render of every corpus sketch)
* `npm run build:all && node apps/rack/e2e/acceptance.mjs`: the iPad acceptance run (Chromium, touch through CDP, software
  WebGL). Results land in [`shots/RESULTS.md`](shots/RESULTS.md) next to the screenshots.

## The rack

| Part | What it is |
|---|---|
| **Lanes O0–O3** | one row per output. A chain sits in the lane of the output it writes, as modules in signal order: generator → modifiers → an **output tile** (tap: show this lane, move the row to another lane, unplug, remove). Two chains on one output stack as rows in source order; the earlier one is dimmed and tagged **shadowed**. Each lane has a 🔒 lock, a ⚄ dice (a random chain from core's `randomSketch`) and a ⤳ morph (nudge every number, crossfaded over 8 beats). Lanes scroll sideways |
| **Module** | one Hydra call. Tap the name to select it (the code drawer highlights its line), tap again to swap the function from a picker of the same type (inputs whose names match keep their values). ⏻ bypass, ⚄ random values, ⋯ move / duplicate / remove. Panels are generated from `core.catalog`, so plugin functions get one too |
| **Knob** | every number input. Drag up or right to turn it up; Apple Pencil is four times finer; put a second finger on a knob you are turning for ×0.1. Integer inputs (`sides`, `nSides`, `pixelX`…) have detents. Tap: keypad. Double-tap: default. Long-press: name and exact value, pin, modulate, reset. A dim knob is at its default (not written in the code) |
| **XY pad** | the natural pairs `pixelX/Y`, `repeatX/Y`, `offsetX/Y`, `scrollX/Y`, `speedX/Y`, `xMult/yMult`, with a small knob for each underneath (for the keypad and modulation) |
| **Colour block** | `r, g, b(, a)` runs (`solid`, `color`) as vertical faders with a swatch |
| **Patch jack** | a texture input. Tap for O0–O3, S0–S3, a picture variable or a new **mini-module** (a nested chain: tap its header to open it in place as a sub-rack, two levels deep at most); or drag a lane chip from the mixer onto it |
| **Mixer** (left in landscape, top in portrait) | what is on screen (`render(oN)` or all four), a 4×4 **routing matrix** (row reads column: an empty lane starts `src(oN)`, a busy one gets `.blend(src(oN), 0.5)`; the diagonal is feedback; tapping a lit cell takes the read out again) and lane/source chips to drag onto jacks |
| **Mod bay** (bottom) | Sine / Saw / Triangle / Square / Random-step LFOs, Steps, Time, Mouse X / Y, Audio bins 0–3 and Volume (core's engine and `audioChip`, with live meters), Expression, and the **Mouse XY pad**, which drives Hydra's `mouse` from touch through core's `runtime.setMouse` |
| **Scenes** (right) | eight slots: hold to store, tap to recall with a crossfade of 0, 1, 2, 4 or 8 beats (the ♩ button) |
| **Trays** (below the lanes) | **Unplugged** chains (no `.out`, one tap to patch into a lane), **Vars** (`const k = …`: a knob, or the modulator's face; picture variables as sub-racks; a knob using a variable shows a dashed ring that opens it), **Raw JS** (grey, editable, with a parse dot), **Notes** (comments) and **Setup** (bpm, speed, sources, render). Nothing is hidden |
| **Top bar** | bpm (with **tap** tempo), speed, ▮▮ freeze (speed 0, tap again to thaw), ◧ full-background preview and its veil, undo/redo, S0–S3 sources, Code, ▶ run, ■ hush, **Perform**, ⋯ |

**Modulation.** Drag a tile from the bay onto any knob (or tap the tile, then tap a knob). The knob grows a yellow ring
showing how far it swings around its centre; drag on the ring to change the depth, inside it to move the centre; tap it
for the editor (shape, rate in Hz or synced to ¼ ½ 1 2 4 beats, depth, centre; bin and meter for audio; steps with
`fast`/`smooth`/`ease`/`offset` for step sequencers; text for expressions). Long-press → Remove puts the plain number it
was centred on back. Every modulator is written in the kit's shared form (`() => Math.sin(time * 2) * 0.4 + 0.8`, arrays for
steps, `audioChip` for audio), so another editor reads the same thing back.

**Scenes.** A scene is the sketch's statements as they were when stored, in `meta.rack.scenes`. Recalling one interpolates
every number both versions share through core's live-parameter table (`runtime.setLiveBatch`, one message per frame), then
commits the stored statements as one undo step. When only numbers differ the code is unchanged throughout and nothing
recompiles (checked in the acceptance run: 0 recompiles, ~50 live messages for a 2 s fade). When the structure differs the
shared numbers still glide, and the new structure swaps in at the end. Undo takes a recall back; stored scenes, pins and
locks are not edits, so undo leaves them alone.

**Performance mode.** **Perform** (or ⛶ on the output, or `P`) shows the output full screen with up to eight pinned
controls as translucent knobs along the bottom edge and the stored scenes on the right. Pin from any knob's long-press menu.
Exit restores the rack. This is separate from the full-background mode (◧), where the rack stays usable on a veil over the
running output.

**Keyboard.** `1`–`8` recall, ⇧`1`–`8` store, `P` perform, space freeze, ⌘E code, ⌘Z / ⇧⌘Z, Esc.

## Knob policy: why drags never recompile

Core compiles every numeric argument of a float input as a closure over a live table (`() => __hl["c12:0"]`), so the
compiled code does not contain the numbers. A knob drag therefore sends the value on the live path first
(`runtime.setLive`, coalesced to one message per frame) and then writes a **plain number** into the IR. The code key is
unchanged, so the runtime only updates its table: no re-evaluation, no shader rebuild. The IR keeps static numbers, so the
exported code stays readable and turning one knob changes one line. There is nothing to "bake" afterwards, because nothing
was ever written as a closure.

What does recompile, and why:

* the **first** turn of a knob that is at its default: the argument was not in the code, so the code text changes once;
* a modulated knob's centre or depth: the modulator is a function in the code (throttled to about eight rewrites a second);
* a variable's knob (`const k = 2`): core does not put `def` values in the live table;
* anything structural (adding, swapping, bypassing, patching a jack).

Two fingers on two knobs is the brief's frame-time test: each knob captures its own pointer, both values go out on the
live path, and both changes together are one undo step. Measured in the container with **software WebGL** (not an iPad):
median frame time 16.7 ms idle and 16.7 ms while dragging two knobs at 60 Hz, 0 recompiles (p95 rises under SwiftShader;
see `shots/RESULTS.md`).

## View state

`sketch.meta.rack` holds only what the code cannot say: `scenes`, `pins` (up to eight `callId:i` / `d:defId` keys),
`bypass` (modules taken out of the code with where they sat, so ⏻ puts them back exactly), `frozen` lanes, open
mini-modules (`open`) and the crossfade length in beats (`fade`). The lane layout is derived from the code every time, so
it cannot disagree with it. `autoView` is pure and returns `{ v: 1, fade: 4 }`.

An unchanged sketch exports byte for byte as it was imported; turning one knob changes one line. Both are checked over the
whole corpus in the unit tests and again in the browser.

## Known issues and limits

* **Output tiles have no live thumbnail.** The runtime renders one output; a picture per lane needs core to render a chosen
  output into a small canvas (core change request). The tile says whether the lane is on screen and switches it.
* **Audio smoothing and threshold are global** (the Audio panel's `setSmooth`/`setCutoff`), not per assignment as the brief
  asks: `audioChip` is `() => a.fft[bin] * scale + offset` and nothing more. A per-assignment form would need core to add it
  to `audioChip`/`parseAudioChip` so every editor reads it back (core change request).
* **Beat-synced rates are converted to Hz when chosen.** Changing the bpm later does not re-time existing LFOs; core has no
  beat clock to reference.
* **Knobs turn linearly** (vertical, plus a little horizontal), not circularly; a circular gesture fought with lane scrolling.
* `vec4` inputs (rare: some plugin functions) are shown read-only on the module and edited in the code drawer.
* Bypass is view state: another editor sees the module gone (it is not in the code). A bypassed module whose chain is
  deleted elsewhere is dropped from the view.
* When a call is edited, core's codegen writes it again: explicit default arguments disappear
  (`blend(src(o0), 0.5)` becomes `blend(src(o0))`) and a call written over several lines comes back on one. Same sketch,
  different text; Patch Graph and Blocks behave the same way.
* Text fields (variable names, notes, unknown function names, source URLs) use the system prompt.
* All browser checks are Chromium with software WebGL and emulated touch; nothing here was run on an iPad. Camera and
  microphone were not exercised.
* `hydra-examples` has no license file, so the import check uses the corpus's own `03-blending.js` and `17-for-loop.js`.

## Retrospective

**Where a knob-first UI hides Hydra's structure.**

* **Nesting.** A texture argument is a whole chain. As a mini-module it reads as "a jack with something plugged in", which
  is right for `modulate(noise(3))` and wrong for `blend(src(o1).scale(2).kaleid(4))`, where the interesting part is
  buried two taps deep. The graph editor shows this structure honestly; the rack hides it on purpose.
* **Order of statements.** Lanes are sorted by output, so the rack cannot show that a later chain shadows an earlier one
  until you notice the "shadowed" tag, nor that a `const` must come before its use. Moving a row to another lane keeps its
  place in the code, which is invisible here.
* **Functions as values.** Anything that is not one of the recognised modulator shapes is an "ƒ" knob. That is safe (the
  text is never rewritten) but opaque: `() => Math.sin(time*2)` with no spaces is an expression, not a sine.
* **Feedback.** The matrix diagonal makes feedback a single tap, which is lovely, and also hides that it is `blend` with a
  fixed 0.5 at the end of the chain rather than something structural.

**Modules that need their own layout beyond the generic knob panel.** `color`/`solid` (a real colour picker, not four
faders), `kaleid`/`shape` sides (a stepped selector reads better than a knob), `scrollX/Y` with speed (a joystick that
writes both position and speed), `modulateScale`/`modulateRepeat` (their many parameters want two rows and a preview),
`src` (a source picker with the camera or image preview instead of a jack), `thresh`/`luma` (a curve with the threshold and
tolerance drawn on it), and every step sequencer (a proper grid, not a list of sliders).

**Before showing it to a performer** I would: make scene recall quantised to the next beat and add a crossfader between
two scenes; give each lane a level fader (wrapping its chain in a `blend` the performer never sees is the obvious hack;
core support would be cleaner); put a live thumbnail on every output tile; add MIDI learn on knobs (core already detects
Web MIDI); make the knob response curve follow the hint (`log` for frequencies); and test on a real iPad, where two-handed
knob turning, Pencil precision and frame time are the things this container cannot tell us.

## Core change requests

* Ship the editor kit (store, runner, keypad, sliders, overlays, code drawer, backdrop wiring) as a shared package instead
  of a copy in each app.
* Render a chosen output into a small canvas, for per-lane thumbnails on output tiles.
* Per-assignment smoothing and threshold in `audioChip` / `parseAudioChip`.
* Put `def` numbers (and arguments at their default) in the live table, so variable knobs and first touches do not
  recompile.
* A beat clock (beats since start at the sketch's bpm) for beat-synced modulators that follow tempo changes.
* Let codegen keep explicit default arguments a user typed.
