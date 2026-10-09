# Acceptance run

Chromium (software WebGL / SwiftShader), touch emulation via CDP. Generated 2026-10-09.

| # | check | result | note |
|---|---|---|---|
| 8a | chain strip: not-rendered chain flagged with one-tap "send to o0"; the earlier writer of an output is "shadowed" | pass |  |
| 8b | "send to o0" on a chain without .out | pass |  |
| 8c | render target toggle (One / All 4) and the Setup panel (sources, bpm, speed) | pass |  |
| 8d | dice: rolls randomSketch(seed) and shows the seed; long-press offers mutate; both undoable | pass |  |
| 8e | open another sketch from the sheet; import by paste; export .js; copy code | pass |  |
| 8f | raw statement: collapsed to its first line with a status dot, tap to edit as text; recognised text becomes blocks | pass |  |
| 8g | variable: chip names the definition and jumps to it; errors from the runtime become a red dot on the row responsible | pass |  |

## Measurements

