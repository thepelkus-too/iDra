# Acceptance run

Chromium (software WebGL / SwiftShader), touch emulation via CDP. Generated 2026-10-09.

| # | check | result | note |
|---|---|---|---|
| 1 | build osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out() with touch only (landscape 1180×820) | pass | osc(20, 0.1, 0.8) .rotate(0.8) .modulate(noise(3)) .out() |
| 1 | build osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out() with touch only (portrait 820×1180) | pass | osc(20, 0.1, 0.8) .rotate(0.8) .modulate(noise(3)) .out() |
| 2 | scrub a number: live, no recompile, preview changes, host stays responsive | pass | median 60 fps (p95 100 ms; idle p95 50 ms), 0 recompiles, 179 live calls → 178 messages (software WebGL) |
| 3 | number → array → function chip; the code view follows each change; typing in the code view updates the blocks | pass | array [0.8, …, 0.2] → function Math.sin(time) * 2 → code edit → blocks |
| 3b | a syntax error in the code view keeps the blocks on the last good version and says so | pass |  |
| 4 | reorder two modifiers by drag; undo; redo (buttons, two-finger and three-finger taps) | pass |  |
| 4b | swipe a row left to delete it, with an undo toast; the generator and .out stay pinned | pass |  |
| 4c | ⌘D duplicates the selected row; ⌘Enter re-runs | pass |  |
| 5 | offline: after the shell has loaded once, an airplane-mode reload works and the edited sketch persists | pass | reloaded with the network off; the preview ran from the cached frame bundle; rotate(2) persisted |
| 6 | corpus: all 33 sketches open, every chain / def / comment / raw statement is visible and editable, untouched export is identical, one edit changes one line | pass | 33 sketches; 30 numeric edits (one line each), 11 raw rows opened |
| 7 | switch to the harness and back: same sketch, same code, meta.stack intact, other apps' meta untouched | pass | meta keys now: graph, harness, rack, stack; stack, graph and rack unchanged |
| 8a | chain strip: not-rendered chain flagged with one-tap "send to o0"; the earlier writer of an output is "shadowed" | pass |  |
| 8b | "send to o0" on a chain without .out | pass |  |
| 8c | render target toggle (One / All 4) and the Setup panel (sources, bpm, speed) | pass |  |
| 8d | dice: rolls randomSketch(seed) and shows the seed; long-press offers mutate; both undoable | pass |  |
| 8e | open another sketch from the sheet; import by paste; export .js; copy code | pass |  |
| 8f | raw statement: collapsed to its first line with a status dot, tap to edit as text; recognised text becomes blocks | pass |  |
| 8g | variable: chip names the definition and jumps to it; errors from the runtime become a red dot on the row responsible | pass |  |
| 9a | a thrown error never freezes or blacks out the preview: last good frame stays; the row gets a red dot; fixing it recovers | pass | brightness good 127 → after error 127 |
| 9b | trust gate: sketches with raw code run in safe mode until the owner says yes; "Always" is remembered across reloads | pass |  |
| 9c | audio chip: a.fft[n] becomes a bin picker with scale/offset fields and a live meter next to the field | pass |  |
| 9d | function picker: grouped, searchable, live thumbnails; plugin functions appear under "Plugins" and an unknown call upgrades when the plugin loads | pass | 3+ thumbnails rendered; Plugins group present |
| 9e | an unknown call stays editable: name, arguments (add / convert / remove) | pass |  |
| 10a | layout ipad-landscape-1366 (1366×1024): nothing overflows, top bar and strip stay usable, every control ≥ 44pt | pass | 1366×1024 |
| 10a | layout ipad-portrait-820 (820×1180): nothing overflows, top bar and strip stay usable, every control ≥ 44pt | pass | 820×1180 |
| 10a | layout split-view-half-507 (507×1024): nothing overflows, top bar and strip stay usable, every control ≥ 44pt | pass | 507×1024 |
| 10a | layout split-view-narrow-375 (375×1024): nothing overflows, top bar and strip stay usable, every control ≥ 44pt | pass | 375×1024 |
| 10a | layout slide-over-320 (320×800): nothing overflows, top bar and strip stay usable, every control ≥ 44pt | pass | 320×800 |
| 10a | layout landscape-split-678 (678×820): nothing overflows, top bar and strip stay usable, every control ≥ 44pt | pass | 678×820 |
| 10b | portrait: preview on top (≈40%), collapsible to a floating picture-in-picture handle that restores on tap | pass |  |
| 10c | Apple Pencil: pointerType pen scrubs a number like a finger | pass |  |
| 10d | selecting a row in the blocks highlights its text in the code view, and the cursor in the code selects the row | pass |  |
| 10e | texture arguments: o/s picker, pocket ⇄ ref conversion, variable reference | pass |  |
| 10f | core banners: Web MIDI not available; camera sources offer inline mode (trust-gated) | pass on re-run | timed out once in the full run (waiting for the inline banner after the switch to inline mode); passed when block 10 was re-run on its own (11/11) |
| 11a | statements reorder by long-press drag on the gutter handle (and keep valid spacing); statement menu duplicates and deletes with undo | pass |  |
| 11b | autosave without a button; thumbnails are 160×90 snapshots in the shared library; the audio panel opens | pass | thumbnail 160×90 |
| 11c | code view completion knows Hydra: modifiers after a dot, generators and globals at the start of a statement | pass |  |
| 12a | backdrop: the preview fills the screen behind the editor, the stack takes the whole area, the frame is not re-created and renders at the screen's aspect | pass | canvas 820×1180 |
| 12b | backdrop: rotating re-fits the render size; the choice survives a reload and is shared with the other editors; turning it off restores the panel | pass |  |

## Measurements

* software WebGL (SwiftShader, no GPU), 1180×820: idle baseline: 71 host frames, median 16.7 ms (60 fps), p95 50.0 ms, max 83 ms, 11.3 % of frames slower than 33 ms
* main-thread script time per second (CDP Performance metrics): idle 4 ms/s, while scrubbing 6 ms/s; layout 0 → 6 ms/s, style recalculation 0 → 1 ms/s
* our synchronous cost per edit (store.commit with all listeners): median 0.10 ms, p95 0.20 ms over 179 commits
* main-thread long tasks (> 50 ms) in the host page: 0 while idle for 2 s, 0 while scrubbing
* software WebGL, same page while scrubbing 180 pointer moves: scrub: 427 host frames, median 16.7 ms (60 fps), p95 100.0 ms, max 183 ms, 33.3 % of frames slower than 33 ms; 179 setLive calls → 178 postMessages, 0 recompiles; pointermove→setLive p95 0.40 ms
