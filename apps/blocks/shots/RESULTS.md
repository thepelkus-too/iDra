# Acceptance run

Chromium (software WebGL / SwiftShader), touch emulation via CDP. Generated 2026-10-12.

| # | check | result | note |
|---|---|---|---|
| 1 | build osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out() with touch only (landscape 1180×820) | pass | osc(20, 0.1, 0.8)   .rotate(0.8)   .modulate(noise(3))   .out() |
| 1 | build osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out() with touch only (portrait 820×1180) | pass | osc(20, 0.1, 0.8)   .rotate(0.8)   .modulate(noise(3))   .out() |
| 2 | a sine wave reporter in rotate.angle becomes an arrow function; a pattern in shape.sides becomes an array with modifiers | pass | osc(20, 0.1, 0.8).rotate(() => Math.sin(time * 1) * 0.7854 + 0.8).out() · osc(20, 0.1, 0.8).rotate(() => Math.sin(time) * 0.5).out() |
| 3 | drop o0 into modulate's texture socket of a script that shows on o0: feedback runs | pass | osc(10, 0.1, 0.8).modulate(o0, 0.2).out(o0) |
| 4 | import a multi-script example: every statement becomes blocks, laid out without overlap; tidy gives the same; export identical (corpus 03-blending.js and 17-for-loop.js; hydra-examples has no license to copy) | pass | 03-blending.js: 7 statements (0 raw); 17-for-loop.js: 3 statements (1 raw) |
| 5 | every catalog function has a palette block, a category and a help line; hold a block for its help card | pass | 52 functions in 5 categories, all with help (3 marked TODO review: modulateHue, prev, sum); kaleid: “Mirror into a kaleidoscope with this many sides.” |
| 6 | offline: after the shell has loaded once, an airplane-mode reload works and the edited sketch persists | pass | reloaded with the network off; the preview ran from the cached bundle; rotate(2) and the layout persisted |
| 7 | corpus: all 35 sketches open with no overlaps; every statement and call is a visible block; untouched export identical; one number edit changes one line | pass | 35 sketches; 32 numeric edits (one line each) |
| 8 | switch to the harness and back: same sketch, same code, meta.blocks intact, other apps' meta untouched | pass | meta keys: blocks, graph, harness, stack |
| 9a | blocks come off with everything under them, wait loose on the workspace (not in the code), snap back; dropped on the palette they are deleted | pass | osc(10).out() noise(3).rotate(1).out(o1)  |
| 9b | a script dropped into a socket moves inside it (its cap goes); dragged back out it is its own script, not rendered | pass | osc(10).blend().out()  noise(3)  |
| 9c | dice drops a random valid script; mutate nudges every number; the ↶ scrubber slides back through the script's states; fold hides blocks but not code | pass | voronoi(5, () => 1.4 + Math.sin(time * 0.2) * 0.75, () => 1.4 + Math.sin(time * 1) * 0.75) |
| 9d | unknown call renders as a grey block with an editable name; it upgrades in place when a plugin registers it, under a Plugins tab | pass | grey → plugin block, same code |
| 9e | two-finger tap undoes, three-finger tap redoes; pinch zooms the workspace; code view shows the selected block | pass | undo/redo by finger taps; zoom changed |
| 9f | full-screen output, and back | pass |  |
| 9g | a starter opens as a new sketch | pass | 1 statement(s) |
| 10 | full-background preview: the output fills the screen behind the workspace; numbers still edit on the veil; the switcher menu takes taps; a panel again on toggle | pass | output behind the workspace in both orientations; keypad edit on the veil; switcher items on top |
| 11a | switch a block off by touch: the code comments that line only; it stays visible, editable and selectable; the hat switches its script; back on gives the same text | pass | rotate → // .rotate(…); modulate with noise(3) on one line; the hat comments its script; all back on |
| 11b | preview "up to here" from a block's eye; A/B a modifier from its long-press menu; closing stops the preview | pass | prefix still luma 133; A/B mean difference 103/255; no frames after closing; pool runtimes at most 1 |
| 11c | switch editors on a sketch with switched-off parts and back: same code, the same blocks off | pass | Blocks → Chain Stack → Blocks → Harness → Blocks |
| 11d | importing commented-out code: revived chunks show as switched-off blocks, with a one-time, dismissible note | pass | 9 revived; 12 drawn switched off; note gone after dismiss and reload |

## Notes

* Blocks had no bypass, mute or solo state of its own (only loose blocks, which are not in the code), so step 09 has no old view state to migrate.

