# Acceptance run

Chromium (software WebGL / SwiftShader), touch emulation via CDP. Generated 2026-10-09.

| # | check | result | note |
|---|---|---|---|
| 1 | build osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out() with touch only (landscape 1180×820) | pass | osc(20, 0.1, 0.8) .rotate(0.8) .modulate(noise(3)) .out() |
| 1 | build osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out() with touch only (portrait 820×1180) | pass | osc(20, 0.1, 0.8) .rotate(0.8) .modulate(noise(3)) .out() |
| 2 | build src(o0).modulateRotate(osc(3),0.5).blend(osc(20),0.1).out(o0) by touch; it runs; a loop that skips the output is refused with a red cable | pass | src(o0) .modulateRotate(osc(3), 0.5) .blend(osc(20), 0.1) .out(); refused: "This connection makes a loop. Loops must go through an output (o0–o3)." |
| 3 | an LFO wired into rotate.angle becomes an arrow function; an Array node into shape.sides becomes an array literal with .fast() | pass | osc(20, 0.1, 0.8).rotate(0.8).out() shape([3, 5.375, 7.75].fast(2)).out(o1) |
| 4 | import a blending example: every chain appears, laid out without overlap (corpus 03-blending.js; hydra-examples has no license to copy) | pass | 5 chains, 17 nodes, no overlaps |
| 5 | 60-node graph: pan and pinch-zoom frame times (software rendering) | pass | pan median 16.8 ms / p95 166.7 ms; pinch median 16.8 ms / p95 183.3 ms; zoom saved (k=0.185) |
| 6 | offline: after the shell has loaded once, an airplane-mode reload works and the edited sketch persists | pass | reloaded with the network off; the preview ran from the cached bundle; rotate(2) and the layout persisted |
| 7 | corpus: all 33 sketches open with no overlaps; every chain / def / comment / raw / setup statement has a node; untouched export identical; one number edit changes one line | pass | 33 sketches; 30 numeric edits (one line each) |
| 8 | switch to the harness and back: same sketch, same code, meta.graph intact, other apps' meta untouched | pass | meta keys: graph, harness, rack, stack |
| 9a | bypass a node: it stays on the canvas, marked, and the code omits it; bypass again restores it | pass |  |
| 9b | a node feeding two places is written twice (×2 badge); "bake" routes it through a free output | pass | osc(20, 0.1, 0.8) .rotate(0.8) .kaleid(4) .out(o1) noise() .blend(o1) src(o1).out() |
| 9c | pin a live preview on a node (its own small runtime); the code panel highlights the selected node | pass | highlighted ".rotate(0.8)" |
| 9d | performance mode: full-screen visuals with pinned controls that drive the sketch | pass |  |
| 9e | hold on empty canvas opens an add menu there; lasso mode selects a rectangle; two-finger tap undoes | pass | lasso: 7 selected |
| 9f | unknown call renders as a dashed generic node with an editable name; plugin functions are grouped under Plugins | pass |  |

## Measurements

* same pan with the preview hushed: median 16.7 ms, p95 50.1 ms over 168 frames
* 60-node graph (67 cards, SOFTWARE WebGL, live preview running): pan frame time median 16.8 ms, p95 166.7 ms over 156 frames; pinch median 16.8 ms, p95 183.3 ms over 696 frames
