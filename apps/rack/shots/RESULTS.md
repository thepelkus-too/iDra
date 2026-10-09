# Acceptance run

Chromium (software WebGL / SwiftShader), touch emulation via CDP. Generated 2026-10-09.

| # | check | result | note |
|---|---|---|---|
| 1 | build osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out() with touch only, using knobs and module pickers (landscape 1180×820) | pass | osc(20, 0.1, 0.8)   .rotate(0.8)   .modulate(noise(3))   .out() |
| 1 | build osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out() with touch only, using knobs and module pickers (portrait 820×1180) | pass | osc(20, 0.1, 0.8)   .rotate(0.8)   .modulate(noise(3))   .out() |
| 2 | drag an LFO onto rotate.angle: the code drawer shows an arrow function; the ring sets the depth; remove it again | pass | () => Math.sin(time * 1) * 0.7854 + 0.8 → ring → () => Math.sin(time * 1) * 2.67 + 0.8 → removed: rotate(0.8) |
| 3 | patch lane o1 into lane o0's modulate texture jack; route o0 into itself (feedback) from the matrix | pass | osc(20, 0.1, 0.8).rotate(0.8).modulate(o1).blend(src(o0)).out() |
| 4 | store two scenes with different knob values; recall with a 4-beat crossfade; numbers-only differences never recompile | pass | fade 2318 ms, 43 live messages, 0 recompiles; undo restored scene 2's values |
| 5 | performance mode with 4 pinned controls, full screen; a pinned knob plays; exit restores the rack | pass | four pinned knobs over the full-screen output; exit back to the rack |
| 10 | two knobs turned at once at 60 Hz: each keeps its own finger, no recompile, one undo step, frame time flat (software GL) | pass | idle 16.7/50 ms, dragging 16.7/100 ms (median/p95); 263 live messages, 0 recompiles |
| 11 | full-background mode: the output fills the screen behind the rack; knobs still work on the veil; the switcher menu takes taps | pass | output behind the rack in both orientations; keypad edit on the veil; switcher items on top |
| 12 | bypass keeps a module in place out of the code; an unknown call is a grey module that upgrades when its plugin loads; the Mouse XY pad drives mouse; a locked lane ignores the dice | pass | bypass round trip exact; grey → plugin module; mouse 928,506; dice skipped the locked lane |
| 6 | import multi-chain examples: every chain becomes a lane row of modules; vars, notes, raw and setup each have a place; export identical (corpus 03-blending.js and 17-for-loop.js; hydra-examples has no license to copy) | pass | 03-blending.js: 7 statements, 11 modules; 17-for-loop.js: 3 statements, 0 modules |
| 7 | offline: after the shell has loaded once, an airplane-mode reload works; the edit and the stored scene persist | pass | reloaded with the network off; the preview ran from the cached bundle; rotate(2) and scene 3 persisted |
| 8 | corpus: all 33 sketches open; every chain, call, def, comment and raw statement is visible; untouched export identical; one knob changes one line | pass | 33 sketches; 30 knob edits (one line each) |
| 9 | switch to the harness and back: same sketch, same code, meta.rack (with its scenes) intact, other apps' meta untouched | pass | meta keys: graph, harness, rack, stack |

## Notes

* Check 10 frame times (software WebGL in a container, not an iPad): idle median 16.7 ms / p95 50 ms; two knobs dragged at 60 Hz median 16.7 ms / p95 100 ms; 263 live messages, 0 recompiles.

