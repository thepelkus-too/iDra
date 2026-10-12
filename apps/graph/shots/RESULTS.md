# Acceptance run

Chromium (software WebGL / SwiftShader), touch emulation via CDP. Generated 2026-10-12.

| # | check | result | note |
|---|---|---|---|
| 1 | build osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out() with touch only (landscape 1180×820) | pass | osc(20, 0.1, 0.8) .rotate(0.8) .modulate(noise(3)) .out() |
| 1 | build osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out() with touch only (portrait 820×1180) | pass | osc(20, 0.1, 0.8) .rotate(0.8) .modulate(noise(3)) .out() |
| 2 | build src(o0).modulateRotate(osc(3),0.5).blend(osc(20),0.1).out(o0) by touch; it runs; a loop that skips the output is refused with a red cable | pass | src(o0) .modulateRotate(osc(3), 0.5) .blend(osc(20), 0.1) .out(); refused: "This connection makes a loop. Loops must go through an output (o0–o3)." |
| 3 | an LFO wired into rotate.angle becomes an arrow function; an Array node into shape.sides becomes an array literal with .fast() | pass | osc(20, 0.1, 0.8).rotate(0.8).out() shape([3, 5.375, 7.75].fast(2)).out(o1) |
| 4 | import a blending example: every chain appears, laid out without overlap (corpus 03-blending.js; hydra-examples has no license to copy) | pass | 5 chains, 17 nodes, no overlaps |
| 5 | 60-node graph: pan and pinch-zoom frame times (software rendering) | pass | pan median 16.7 ms / p95 216.7 ms; pinch median 50 ms / p95 266.6 ms; zoom saved (k=0.185) |
| 6 | offline: after the shell has loaded once, an airplane-mode reload works and the edited sketch persists | pass | reloaded with the network off; the preview ran from the cached bundle; rotate(2) and the layout persisted |
| 7 | corpus: all 35 sketches open with no overlaps; every chain / def / comment / raw / setup statement has a node; untouched export identical; one number edit changes one line | pass | 35 sketches; 32 numeric edits (one line each) |
| 8 | switch to the harness and back: same sketch, same code, meta.graph intact, other apps' meta untouched | pass | meta keys: graph, harness, rack, stack |
| 9a | switch a node off from the selection bar: it stays on the canvas, dimmed, and the code comments it out; on again restores it | pass |  |
| 9b | a node feeding two places is written twice (×2 badge); "bake" routes it through a free output | pass | osc(20, 0.1, 0.8) .rotate(0.8) .kaleid(4) .out(o1) noise() .blend(o1) src(o1).out() |
| 9c | pin an "up to here" preview from the selection bar; the code panel highlights the selected node | pass | highlighted ".rotate(0.8)" |
| 9d | performance mode: full-screen visuals with pinned controls that drive the sketch | pass |  |
| 9e | hold on empty canvas opens an add menu there; lasso mode selects a rectangle; two-finger tap undoes | pass | lasso: 7 selected |
| 9f | unknown call renders as a dashed generic node with an editable name; plugin functions are grouped under Plugins | pass |  |
| 10 | full-background preview: the output fills the screen behind the canvas; numbers still edit on the veil; the switcher menu takes taps; a panel again on toggle | pass | output behind the canvas in both orientations; keypad edit on the veil; switcher items on top |
| 11a | switch rotate off with its // : dashed and dimmed, cables kept but carrying nothing; the export comments it out and leaves its siblings as they were | pass | export: "  // .rotate(0.8)" on its own line, kaleid and the noise chain unchanged |
| 11b | re-enable: the export is byte-identical to the import again | pass |  |
| 11c | a generator's // switches its whole chain; the chain's nodes all look off; tapping any of them switches it back | pass |  |
| 11d | preview up to here: a node's 👁 pins a still of its chain up to that node (on demand), drawn by the shared pool (at most 2 runtimes) | pass | still lit 100%; pool {"runtimes":1,"maxRuntimes":1,"frames":2,"runs":1,"feeds":0,"feedMs":0,"feedFailures":0} |
| 11e | A/B a modifier: the pinned preview turns into before/after; expanded, A and B switch | pass | expanded: animated with A · before / B · after; folded: a still again |
| 11f | previews follow the preference (⋯ → Node previews) and pause offscreen and in performance mode | pass | live: running while visible, paused when panned away; gone in performance mode; off hides them |
| 11g | switch to Chain Stack and back on the same sketch with a node off: the flag and the code survive both ways | pass |  |
| 12a | an old sketch with a bypassed node (meta.graph.bypass) opens with it switched off in place; the old key is gone from the saved copy | pass |  |
| 12b | importing commented-out code: the revived chunks are switched-off nodes, with a one-time note | pass | 2 commented-out chunks were revived as disabled. Tap a node's // to switch it on. OK |

## Measurements

* same pan with the preview hushed: median 16.7 ms, p95 83.3 ms over 153 frames
* 60-node graph (67 cards, SOFTWARE WebGL, live preview running): pan frame time median 16.7 ms, p95 216.7 ms over 161 frames; pinch median 50 ms, p95 266.6 ms over 672 frames
