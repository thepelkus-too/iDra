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
| **Lanes O0–O3** | one row per output. A chain sits in the lane of the output it writes, as modules in signal order: generator → modifiers → an **output tile** (tap: show this lane, move the row to another lane, unplug, remove). Two chains on one output stack as rows in source order; the earlier one is dimmed and tagged **shadowed**. Each lane has a 🔒 lock, a ⚄ dice (a random chain from core's `randomSketch`), a ⤳ morph (nudge every number, crossfaded over 8 beats) and a ◱ **audition** (that lane full screen for a moment, see below). A switched-off row is greyed and tagged **off**, and shadows nothing. Lanes scroll sideways |
| **Module** | one Hydra call. Tap the name to select it (the code drawer highlights its line), tap again to swap the function from a picker of the same type (inputs whose names match keep their values). `//` switches it off (on a generator: the whole row), ⚄ random values, ⋯ switch off / **before / after** / pin the switch or the preview to performance mode / move / duplicate / remove. Under the title, a small **preview of the chain up to this module**. Panels are generated from `core.catalog`, so plugin functions get one too |
| **Knob** | every number input. Drag up or right to turn it up; Apple Pencil is four times finer; put a second finger on a knob you are turning for ×0.1. Integer inputs (`sides`, `nSides`, `pixelX`…) have detents. Tap: the number editor (tabs **Keypad** with Glide, **Ladder**, **Pad**; the last tab is remembered). Double-tap: default. Long-press and slide: the **ladder** (up/down picks the step, left/right changes the value by it and then holds that step until you slide back, let go to keep it as one undo step, Esc cancels). Long-press and let go without moving: name and exact value, pin, modulate, reset. A dim knob is at its default (not written in the code) |
| **Pads** | in a knob's Pad tab, **Bind to a pad**: the knob becomes a hydra-motion knob played from a floating pad (hold, latch or trigger). ⇄ → **Pads** shows or hides them; in performance mode **Pads** pins them along the bottom |
| **XY pad** | the natural pairs `pixelX/Y`, `repeatX/Y`, `offsetX/Y`, `scrollX/Y`, `speedX/Y`, `xMult/yMult`, with a small knob for each underneath (for the keypad and modulation) |
| **Colour block** | `r, g, b(, a)` runs (`solid`, `color`) as vertical faders with a swatch |
| **Patch jack** | a texture input. Tap for O0–O3, S0–S3, a picture variable or a new **mini-module** (a nested chain: tap its header to open it in place as a sub-rack, two levels deep at most); or drag a lane chip from the mixer onto it |
| **Mixer** (left in landscape, top in portrait) | what is on screen (`render(oN)` or all four), a 4×4 **routing matrix** (row reads column: an empty lane starts `src(oN)`, a busy one gets `.blend(src(oN), 0.5)`; the diagonal is feedback; tapping a lit cell takes the read out again) and lane/source chips to drag onto jacks |
| **Mod bay** (bottom) | Sine / Saw / Triangle / Square / Random-step LFOs, Steps, Time, Mouse X / Y, Audio bins 0–3 and Volume (core's engine and `audioChip`, with live meters), Expression, and the **Mouse XY pad**, which drives Hydra's `mouse` from touch through core's `runtime.setMouse` |
| **Scenes** (right) | eight slots: hold to store, tap to recall with a crossfade of 0, 1, 2, 4 or 8 beats (the ♩ button) |
| **Trays** (below the lanes) | **Unplugged** chains (no `.out`, one tap to patch into a lane), **Vars** (`const k = …`: a knob, or the modulator's face, with its own `//`; picture variables as sub-racks; a knob using a variable shows a dashed ring that opens it), **Raw JS** (grey, editable, with a parse dot), **Notes** (comments) and **Setup** (bpm, speed, sources, render). Nothing is hidden |
| **Top bar** | bpm (with **tap** tempo), speed, ▮▮ freeze (speed 0, tap again to thaw), ◧ full-background preview and its veil, undo/redo, S0–S3 sources, Code, ▶ run, ■ hush, **Perform**, ⋯ (also **Module previews: on demand / live / off**) |

**Modulation.** Drag a tile from the bay onto any knob (or tap the tile, then tap a knob). The knob grows a yellow ring
showing how far it swings around its centre; drag on the ring to change the depth, inside it to move the centre; tap it
for the editor (shape, rate in Hz or synced to ¼ ½ 1 2 4 beats, depth, centre; bin and meter for audio; steps with
`fast`/`smooth`/`ease`/`offset` for step sequencers; text for expressions). Long-press → Remove puts the plain number it
was centred on back. Every modulator is written in the kit's shared form (`() => Math.sin(time * 2) * 0.4 + 0.8`, arrays for
steps, `audioChip` for audio), so another editor reads the same thing back.

**Switching off.** `//` on a module takes it out of what runs without taking it off the rack: it stays where it is, greyed
and striped (the kit's `.is-disabled`), its knobs still turn (the values wait in the comment), and the code shows it as an
ordinary commented-out line, so the export still runs in vanilla Hydra and every other editor reads it back switched off:

```js
osc(20, 0.1, 0.8).rotate(0.8)
  // .kaleid(5)
  .out()
```

A generator's `//` switches its whole row (`// osc(…).out()`); a variable's switches the `const` (and, with a toast and
Undo, the statements that use it). Calls inside a mini-module can't be switched alone (they are written inline); their
`//` is dashed, and a tap says so and offers to switch the module that takes them. Switching a `blend`/`modulate` takes
its texture input with it. Switching is one undo step and recompiles once (measured below). The switch is core's
`disabled` flag through the kit's `DisableToggle`; the routing matrix, shadowing, the lane audition and the dice all
ignore switched-off code.

**Previews.** Every module shows a 96×54 thumbnail of its chain *up to and including it* (a switched-off module previews
what it would do). With previews **on demand** (the default, shared with every editor) a thumbnail is a still that
refreshes when the chain changes or a number moves; tap it to expand and animate it. **Live** animates every visible
thumbnail (two at once, the pool's size; the rest take turns), which costs battery. **Off** hides them. "≈" marks a
preview that reads another lane, `prev()` or a camera through a copy of the main picture about once a second. ⋯ →
**Before / after** opens an A/B of that module. While numbers move (a knob turn, a glide, a scene fade) the stills wait
and catch up 0.4 s after the numbers rest, so previews never take frames from the main output mid-gesture; an expanded
preview keeps animating. Previews and switches are off the performance surface unless pinned: nothing of the rack's
previews runs while performing or auditioning.

**Audition.** ◱ on a lane shows that lane full screen: the output runs the sketch with `render(oN)` added, the sketch
itself is not touched (no edit, no undo step, nothing saved; the library thumbnail waits). Edits made meanwhile run
auditioned too. **Back** or Esc returns.

**Revived comments.** A sketch the rack opens for the first time whose commented-out code the importer revived (a
`// .rotate(1)` line, a `// noise().out(o1)` statement) shows those chunks switched off, with a one-time note "N
commented-out chunks were revived as disabled".

**Scenes.** A scene is the sketch's statements as they were when stored, in `meta.rack.scenes`. Recalling one interpolates
every number both versions share through core's live-parameter table (`runtime.setLiveBatch`, one message per frame), then
commits the stored statements as one undo step. When only numbers differ the code is unchanged throughout and nothing
recompiles (checked in the acceptance run: 0 recompiles, ~50 live messages for a 2 s fade). When the structure differs the
shared numbers still glide, and the new structure swaps in at the end. Which modules are switched off is part of the
statements, so a scene stores it with the values, and recalling a scene with a different on/off swaps it in at the end
of the fade. Undo takes a recall back; stored scenes, pins and
locks are not edits, so undo leaves them alone.

**Performance mode.** **Perform** (or ⛶ on the output, or `P`) shows the output full screen with up to eight pinned
controls along the bottom edge and the stored scenes on the right. Pin a knob from its long-press menu, and a module's
`//` switch or its preview from the module's ⋯ menu.
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
* anything structural (adding, swapping, switching off, patching a jack).

Two fingers on two knobs is the brief's frame-time test: each knob captures its own pointer, both values go out on the
live path, and both changes together are one undo step. Measured in the container with **software WebGL** (not an iPad):
median frame time 16.7 ms idle and 16.7 ms while dragging two knobs at 60 Hz, 0 recompiles (p95 rises under SwiftShader;
see `shots/RESULTS.md`).

## View state

`sketch.meta.rack` holds only what the code cannot say: `scenes`, `pins` (up to eight: knobs `callId:i` / `d:defId`,
switches `off:id`, previews `pv:chainId:callId`, the pad strip `kit:pads`), `frozen` lanes, open mini-modules (`open`)
and the crossfade length in beats (`fade`). Switched-off modules are in the code, not here.

**Migrating old sketches.** The rack used to bypass a module by taking it out of the code and remembering it in
`meta.rack.bypass`. On first open such a sketch gets each bypassed module back in its chain, switched off, and the key
is removed and saved (`migrateBypass` in `ops.ts`, run from boot's `migrate` hook). Modules are put back as the old ⏻
would have put them back in list order; when two were bypassed next to each other in a particular order, the old view
state does not record enough to restore their original order exactly. The lane layout is derived from the code every time, so
it cannot disagree with it. `autoView` is pure and returns `{ v: 1, fade: 4 }`.

An unchanged sketch exports byte for byte as it was imported; turning one knob changes one line. Both are checked over the
whole corpus in the unit tests and again in the browser.

## Known issues and limits

* **Output tiles have no thumbnail of their own.** The last module's preview is the lane's picture, and ◱ auditions the
  whole lane; the tile says whether the lane is on screen and switches it.
* **Audio smoothing and threshold are global** (the Audio panel's `setSmooth`/`setCutoff`), not per assignment as the brief
  asks: `audioChip` is `() => a.fft[bin] * scale + offset` and nothing more. A per-assignment form would need core to add it
  to `audioChip`/`parseAudioChip` so every editor reads it back (core change request).
* **Beat-synced rates are converted to Hz when chosen.** Changing the bpm later does not re-time existing LFOs; core has no
  beat clock to reference.
* **Knobs turn linearly** (vertical, plus a little horizontal), not circularly; a circular gesture fought with lane scrolling.
* `vec4` inputs (rare: some plugin functions) are shown read-only on the module and edited in the code drawer.
* **Switching recompiles.** Measured in the acceptance run (software WebGL): one recompile per toggle, the run itself
  about 160–210 ms, and the worst frame gap around it 130–150 ms. That is a visible hitch in software rendering; on an iPad
  the shader compile is the cost to watch (see the retrospective).
* Pad presses (`runtime.invoke`) move the main output but not the previews (core's known gap); a module preview shows a
  pad-bound knob at rest.
* When a call is edited, core's codegen writes it again: explicit default arguments disappear
  (`blend(src(o0), 0.5)` becomes `blend(src(o0))`) and a call written over several lines comes back on one. Same sketch,
  different text; Patch Graph and Blocks behave the same way.
* Text fields (variable names, notes, unknown function names, source URLs) use the system prompt.
* All browser checks are Chromium with software WebGL and emulated touch; nothing here was run on an iPad. Camera and
  microphone were not exercised.
* `hydra-examples` has no license file, so the import check uses the corpus's own `03-blending.js` and `17-for-loop.js`.

## Retrospective (step 09: switching off and previews)

* **The `//` button reads well as "off" on a module**, better than ⏻ did, because it says what happens to the code. It
  is small (36 px wide in the title bar, 40 px tall) next to ⚄ and ⋯; on glass that row may be cramped. If it is, the
  module's ⋯ → Switch off is the fallback, and pinning the switch gives a 64 px button in performance mode.
* **Recompile on toggle.** One recompile per switch, ~160–210 ms in software GL with one long frame. While performing that
  would read as a stutter at the moment of the switch. The screenshots show no black frame, but they are not frame-exact,
  so whether the switch glitches on screen is unverified until an iPad run; if it does, the cheaper switch above is the fix.
* **Previews cost the main output frames** in the container until the stills were held during gestures: with core's
  on-demand refresh, each burst of live numbers re-ran every visible still, and the two-knob check's p95 frame time went
  from 50 ms to 100–117 ms (software GL). Holding stills while numbers move brought it to 67–83 ms; the rest is the
  preview runtimes simply existing. An iPad's GPU should make this much smaller, but it is the number to check.
* **Previews on every module** make the rack feel more like a signal chain you can read: you see what each stage adds.
  They also make every module 60 px taller and, in live mode, keep the GPU busy; on-demand stills are the right default.
  The pool's two runtimes mean a rack of twelve modules fills in its stills one pair at a time.
* **Audition** uses the main runtime (a `render()` added at run time) instead of a preview, so the picture is full
  resolution and exact; the cost is one recompile in and one out.
* **Migration** of the old bypass is exact for the common cases and approximate for one ordering case (above).
* **The stuck preview** only showed up end to end: unit tests use a fake pool, and core's own browser check opens
  previews from the harness, which does not call `update()` right after opening.

### iPad checklist (rack, step 09)

1. Tap `//` on a modifier while the sketch runs: the module greys out in place, the picture changes once; note any
   stutter or black frame at the moment of the switch, with a heavy sketch too.
2. Turn a knob on a switched-off module, switch it on: the new value is used.
3. `//` on a generator: the whole row is greyed and tagged off; the lane's matrix row goes dark.
4. Long-press a mini-module call's dashed `//`: the explanation appears with "Switch the whole thing off".
5. Previews on demand: scroll the rack; the stills fill in; tap one: it grows and animates; tap again to fold. Check the
   battery/heat in **live** mode over five minutes, and that Safari does not drop the main output (WebGL context limit).
6. ⋯ → Before / after on a `kaleid`: A and B differ; switch between them with a finger.
7. ◱ on a lane: that lane full screen at full resolution; Back returns; the sketch's code is unchanged.
8. Store a scene, switch a module off, store another, recall each: on/off swaps at the end of the fade.
9. Pin a module's switch and its preview, enter Perform: the 64 px switch toggles reliably with a thumb; the preview
   animates only when tapped (on demand).
10. Open a sketch saved by the old rack with a bypassed module: it comes back switched off, in place.
11. Import code with `//` lines in it: the one-time note appears once.
12. Switch to Chain Stack or Blocks and back on a sketch with a switched-off module: still off, in place.

## Retrospective (first version)

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

From step 09 (disabling and previews):

* **`PreviewPeek` `open` prop.** A before/after peek is only useful expanded; the rack clicks the peek open after mounting
  it. An initial `open` (or `defaultOpen`) prop would do it properly.
* **Forward pad presses to previews** (already listed in docs/previews-runtime.md as a known gap).
* **A cheaper switch.** Switching a module off changes the code key, so the runtime recompiles the whole sketch. A
  pass-through uniform per switchable modifier (compiled in, flipped through the live table) would make `//` as cheap as
  a knob for performance; it would only be worth it if the iPad shows a glitch.

Earlier:

* Ship the editor kit (store, runner, keypad, sliders, overlays, code drawer, backdrop wiring) as a shared package instead
  of a copy in each app.
* Render a chosen output into a small canvas, for per-lane thumbnails on output tiles.
* Per-assignment smoothing and threshold in `audioChip` / `parseAudioChip`.
* Put `def` numbers (and arguments at their default) in the live table, so variable knobs and first touches do not
  recompile.
* A beat clock (beats since start at the sketch's bpm) for beat-synced modulators that follow tempo changes.
* Let codegen keep explicit default arguments a user typed.
