# The shared kit (`@hydra-ipad/kit`)

`packages/kit` holds the Preact pieces every editor uses to edit numbers and show popovers. It is AGPL-3.0-only like the
editors, depends on `@hydra-ipad/core` and `preact`, and is consumed as TypeScript source (no build step; each editor's Vite
and Vitest compile it with the editor's own `jsx: automatic, jsxImportSource: preact`). Core stays framework-free.

## What is in it

| module | exports | notes |
|---|---|---|
| `conv.ts` | `clamp`, `fmt`, `roundTo`, `wrapInto`, `decimalsOf` | pure number helpers |
| `overlay.tsx` | `OverlayHost`, `openPopover`, `closePopover`, `closeAllPopovers`, `popoverOpen`, `openSheet`, `closeSheet`, `sheetOpen`, `toast`, `hud`, `closeAllOverlays`, `setOverlaySource`, `useOverlaySource` | one sheet, stacked popovers, toasts, the scrub HUD |
| `gestures.ts` | `TAP_SLOP`, `LONG_MS`, `usePress`, `isTextTarget`, `useTapGestures`, `useShortcuts`, `useLayout`, `useNarrow`, `History` | pointer-event helpers, two/three-finger undo/redo, ⌘Z/⌘Y/⌘Enter |
| `Keypad.tsx` | `Keypad` | digits, `.`, `±`, ⌫, `×2 ÷2 −1 +1 +step`, OK, reset to default |
| `NumSlider.tsx` | `NumSlider` | the horizontal number control of Patch Graph, Blocks and Rack |
| `styles.ts` | `KIT_CSS` | popovers, sheets, toasts, HUD, keypad, number editor, ladder, pads |
| `host.ts` | `KitHost`, `setKitHost`, `kitHost`, `kitPrefs`, `useHost` | what the kit needs from the editor (see below) |
| `field.ts` | `NumberField`, `Session`, `simpleField`, `hasLiveSlot`, `glideField`, `glideBack`, `returnValue` | a number as the editor describes it; one gesture = one undo step |
| `ladder.ts`, `Ladder.tsx` | `magnitudes`, `ladderValue`, `moveLadder`, `keyLadder`, `LadderGesture`, `LadderLayer`, `LadderPanel` | the long-press ladder: pure math, the gesture, the floating column, the tab |
| `glide.ts`, `easing.ts` | `parseDuration`, `startGlide`, `cancelGlide`, `EASINGS`, `EASE_PRESETS`, `ease`, `easePath` | frame-by-frame glides on an injectable clock; curve names from hydra-motion |
| `NumberEditor.tsx` | `NumberEditor`, `openNumberEditor`, `loopValue`, `sketchBpm` | the tabbed popover every number opens |
| `pads.ts`, `PadDock.tsx` | `bindToPad`, `unbindKnob`, `padsOf`, `livePads`, `withPads`, `padPress`, `padRelease`, `PadDock`, `PadStrip`, `PadEditor`, `padsTool`, `showPadDock` | knob binding, `meta.kit.pads`, the floating pads |

## How an editor adopts it

1. Add `"@hydra-ipad/kit": "*"` to the editor's dependencies (`npm install` links the workspace).
2. Tell the overlays what to follow, once, before rendering (each editor does it in its `ctx.ts`):
   ```ts
   setOverlaySource((cb) => (ctx.store ? ctx.store.subscribe(cb) : () => {}))
   ```
   Open popovers and sheets then re-render on every store change (undo while one is open, the preview updating, …).
3. Mount `<OverlayHost />` once, and pass a `History` to the undo gestures and shortcuts:
   ```ts
   export const history = (): History => ({ undo: () => ctx.store.undo(), redo: () => ctx.store.redo(), run: () => ctx.runner.run(true) })
   useTapGestures(history)
   useShortcuts(history, (e, mod) => /* app keys; return true when handled */ false, flush)
   ```
4. Register the editor with the kit once (also in `ctx.ts`); this replaces step 2's `setOverlaySource`:
   ```ts
   setKitHost({
     app: APP,
     sketch: () => ctx.store.sketch,
     commit: (next, o) => ctx.store.commit(next, o),
     endGroup: () => ctx.store.endGroup(),
     subscribe: (cb) => ctx.store.subscribe(cb),
     invoke: (name, method, args) => ctx.runner?.rt?.invoke(name, method, args) ?? false,
     trusted: () => !!ctx.runner && !ctx.runner.trust.pending,
     approveOnce: () => (ctx.runner?.track(ctx.store.sketch), ctx.runner?.approveOnce()),
   })
   ```
   and add `padsTool()` to the switcher's `extraTools` so "Pads" is in the ⇄ menu.
5. Put `${KIT_CSS}` into the editor's stylesheet and override after it if the editor needs its own look (Chain Stack keeps
   its overlay z-index of 1000, a 720 px wide sheet and its keypad key font). The number controls' own sizes
   (`.numslider` in Graph and Blocks, `.tok.num` in Chain Stack) stay with each editor.

6. Describe each number as a `NumberField` and open `openNumberEditor(anchor, field)` on tap. `NumSlider` does both when
   given an `id` (and `live` / `arg` when the number is a call's argument). Other controls attach a `LadderGesture` to their
   pointer handlers (Chain Stack's `Scrub`, the rack's `Knob`).

## Numbers: the editor, the ladder, glides and pads

**`NumberField`** is the one description every piece takes: `id` (stable per number), `label`, `get()`, `def`, `hint`,
`onChange(v, 'drag' | 'key' | 'end')` (the editor's existing commit path: drags coalesce into one undo step, `'end'` closes
it), optionally `live(v)` (push to `setLive` without touching the IR; return false when the number has no live slot, see
`hasLiveSlot`) and `arg: { callId, index }` (the number is a call's argument: enables "Loop between values" and the Pad tab).

**One gesture, one undo step.** A `Session` wraps every ladder gesture and glide: intermediate values go to `live` when the
number has a live slot (no IR change, no recompile) or else to `onChange(v, 'drag')`; the end is a single `'key'` commit (or
the last `'drag'`) followed by `'end'`. Cancelling (Esc, `pointercancel`) puts the live slot or the drag back.

**The number editor** (`openNumberEditor`) is a popover with three tabs; the last one is remembered per editor in
`appStorage(app)` (`numberTab`).

* *Keypad*: the keypad as before, plus Glide. With Glide on, a typed number (Go) or a nudge is a target the value glides to
  over the chosen duration (`1`, `0.5s`, `250ms`, or beats: `2b` at the sketch's `bpm`, Hydra's default 30) along the chosen
  curve (14 presets, names from hydra-motion's `easings.json` through core's `MOTION_EASINGS`). A new target mid-glide
  retargets from where the value is and stays the same undo step. Any other edit of the number cancels the glide where it
  is. "↩" glides back to the value before the first glide. Duration, curve and the toggle persist (`glideDur`,
  `glideEase`, `glideOn`). "Loop between a and b" replaces the argument with `[a, b].smooth(1).ease('curve').fast(n)`,
  `n = 60 / (bpm × seconds)` so each value lasts the glide's duration.
* *Ladder*: the same ladder as the long-press, as a panel: drag on the rungs, or focus it and use ← → (step) ↑ ↓ (rung),
  Enter (commit), Esc (cancel); − / + buttons for one step each.
* *Pad*: "Bind to a pad", then the pad's mode and values (below).

**The ladder.** Long-press a number (350 ms, 8 px slop) and it opens under the finger: rungs are powers of ten from about
the hint's range down to its step (1 for integers; a step like 0.05 is the last rung itself), at most eight, starting on
about a tenth of the range. Moving up or down picks a rung (40 px per rung, the highlighted one pulses on each change),
moving left or right steps by it (24 px per step). The first step lands on the rung's grid (0.83 → 0.9), the value is
untouched until a full step, angles wrap, everything else clamps to the hint range widened to keep an out-of-range value
reachable. Release commits one undo step; release without moving is the control's own long-press (Chain Stack's kind menu,
the rack's knob menu) or, where there is none, the editor's Ladder tab. A move past the slop before 350 ms is the
control's own drag (scrub, knob turn); the ladder never fires then. While the ladder is open it holds off page scrolling.

**Pads.** "Bind to a pad" writes `<fn><Input> = knob(<current>)` (core's `knobDef`, a bare assignment as the contract
requires) before the first statement that uses the call, replaces the argument with a reference to it, adds the
hydra-motion plugin (`withMotion`), and adds a Hold pad. Pad modes: **Hold** (press glides to the value over *attack*,
release glides back over *release*), **Latch** (each press toggles between two values), **Trigger** (press glides to the
value and stays). "Unbind" turns every reference back into the knob's base number and drops the def and its pads. Pads call
`runtime.invoke` with their own hold id, so two fingers on two pads work. `PadDock` floats the pads over any editor (drag
by the grip; positions saved as fractions of the viewport); `PadStrip` lays them out in a row for a host (the rack's
performance mode pins it). Pads stay inert, with a note, until the sketch is trusted. Binding on a sketch that was already
trusted re-approves it once (the new code is the owner's own); otherwise the trust banner asks as usual.

**`sketch.meta.kit`** is the kit's own namespace, shared by every editor, written only through `withKitMeta`, `withPads`
and `updatePad`: `{ pads: PadConfig[], dock?: boolean }`. A `PadConfig` is `{ id, knob, label, mode, value, value2?,
attack, release, ease, x?, y? }`. Undo restores `stmts` and `meta[<app>]` only, so undoing a bind leaves the pad's config;
`livePads` shows only pads whose knob def exists, and redo brings the binding back with its pad.

## Reconciled when the copies were merged

`Keypad`, `NumSlider`, `overlay` and `gestures` were byte-identical in Graph, Blocks and Rack; Chain Stack had its own copies.

* **Keypad**: Chain Stack's was identical apart from its imports (`wrapInto` came from `Scrub`).
* **overlay**: identical apart from the store hook. The kit has no store: `useStore()` became `useOverlaySource()`, fed by
  `setOverlaySource`.
* **gestures**: `useTapGestures` and `useShortcuts` read `ctx.store`/`ctx.runner`; they now take a `History`. Chain Stack's
  own `usePress`, `TAP_SLOP` and `LONG_MS` were identical and are gone; its swipe and reorder gestures stay in
  `apps/stack/src/gestures.ts`. Chain Stack's private `useLayout`, `isTextTarget`, `useShortcuts` and `useTapGestures` (in
  `App.tsx`) were the same code; the kit's two-finger undo also ignores taps that start on `[data-no-undo-tap]` (no Chain Stack
  element carries it, so nothing changes there). Chain Stack's ⌘D is its `useShortcuts` extra.
* **conv**: Graph, Blocks and Rack had a number-only `conv.ts` (moved whole). Chain Stack's `conv.ts` also holds value-kind
  conversions; only its `decimalsOf`, `roundTo` and `fmt` (identical) moved, and it re-exports them so its tests run unchanged.
* **CSS**: the kit carries Graph/Blocks/Rack's rules (the same in all three). Chain Stack's differed in five places, kept as
  overrides in its stylesheet: overlays `z-index:1000` (40 elsewhere), `user-select:none` on popovers, `.sheet.wide` 720 px
  (760 elsewhere), keypad keys `600 19px` with nudges at 16 px (20 px and 15 px elsewhere), and an OK key at weight 600. It
  gained `.overlays>.toasts{pointer-events:none}` (the toast column no longer blocks touches between toasts).

## Follow-up candidates (not merged yet)

These are still copied per editor. Graph, Blocks and Rack share `apps/<app>/src/kit/*`; Chain Stack has its own versions.

| file | Graph = Blocks = Rack? | vs Chain Stack | what differs |
|---|---|---|---|
| `store.ts` | Rack differs (8 lines) | 38 lines | Rack: `keepOnUndo` (stored scenes and pins survive undo). Graph/Blocks/Rack: `hold()` (a gesture merges commits whatever the time between them), a 200-step history cap, `APP` from `../app` instead of `StackMeta` |
| `runner.ts`, `problems.ts`, `thumbs.ts`, `model.ts`, `Menu.tsx` | yes | header comment only | nothing else: ready to move |
| `ctx.ts` | yes | 14 lines | `useCatalogVersion` lives in Chain Stack's `ui/Picker.tsx`; comments |
| `actions.ts` | yes | 81 lines | Chain Stack's has row actions (duplicate statement, …) the others don't |
| `Chrome.tsx` | yes | ~420 lines | top bar, banners, audio/plugins/MIDI sheets: same pieces, different layout |
| `CodeDrawer.tsx`, `raw.tsx`, `reconcile.ts`, `mods.ts`, `boot.tsx`, `styles.ts` (rest) | yes | no counterpart (Chain Stack has `ui/CodeView.tsx`, `view.ts`, `main.tsx`) | move as is for the three, then adopt in Chain Stack |

Suggested order: `runner`, `problems`, `thumbs`, `model`, `Menu` (no behaviour change), then `store` (take Graph's `hold()`
and the history cap; make Rack's `keepOnUndo` an option), then the code drawer and boot.

## Tests

* Unit (`npm test -w @hydra-ipad/kit`): the conversions, the ladder math (rungs per hint, default rung, grid snapping, wrap,
  widened clamp, the pointer and keyboard state machine), glides on a fake clock (duration parsing with beats, frame values,
  one undo step on the live path and on the drag path, retargeting, cancel on another edit, return), the curves against the
  built hydra-motion's own `ease`, and the pad helpers (binding, names, nested calls, round trip, unbind, `livePads` after
  undo, press and release per mode, `loopValue`).
* End to end (`node scripts/e2e-numbers.mjs`, in CI): each editor at 1180×820 and 820×1180 with real timed touches through
  the DevTools protocol: tap opens the tabbed editor and the tab is remembered; a 450 ms hold then a slide steps by 0.1,
  then by 10, and the release is one undo step; the Ladder tab from a keyboard; a glide to a typed target moves the picture
  and lands as one undo step, and ↩ glides back; binding a pad, holding it changes the rendered output and letting go
  restores it. In landscape also: the self-contained export runs in a plain hydra-synth page on another origin and its knob
  still plays, and the next editor opens the sketch with the binding, the pad and the open dock.

## Retrospective (step 07)

* **The ladder feels right on paper and in emulation; it is unproven under a real finger.** 24 px per step and 40 px per
  rung came from arithmetic (ten 0.1 steps across a 0..1 input in one comfortable sweep, rungs as tall as the drawn rows),
  not from an iPad. Emulated touches are perfectly steady; a real finger drifts a few points vertically while sliding
  sideways, which could flip rungs by accident. If it does, add hysteresis on the rung (switch only after 60 % of a row).
* **Long-press conflicts were the main design problem.** Chain Stack and Rack already used long-press for their menus. The
  rule chosen: hold then *move* is the ladder, hold then *let go* is the old menu. It keeps every existing test and habit,
  but the menu now opens on release instead of at 460 ms, which may feel slower. Graph and Blocks had no long-press on
  numbers, so there it opens the Ladder tab.
* **Two real bugs only showed up end to end.** (1) Under load (a recompile), the long-press timer could fire before a quick
  tap's release was handled, so a tap opened the Ladder tab; the release now checks the events' own timestamps. Graph's
  corpus acceptance caught it. (2) Binding on a sketch whose first statement is the bound chain glued the new def to the
  chain in the export (`k = knob(0.8)osc(…)`); the unit tests only bound chains that were not first.
* **Trust and pads.** Binding adds a plugin and a JS def, which makes the sketch "risky". Binding on an already trusted
  sketch re-approves it once (the code is the owner's own). That exposed a race in each editor's runner (an async library
  lookup could overwrite a fresh approval), fixed in all four copies, another reason to move the runner into the kit next.
* **Undo and `meta.kit`.** Undo restores `meta[<app>]`, not `meta.kit`, so an undone bind leaves its pad config behind.
  Pads whose knob is gone are hidden instead of extending every store's undo. A cleaner fix is for the stores to snapshot
  `meta.kit` too, once the store is shared.
* **`const` vs bare.** The plan said `const name = knob(…)`; core's `knobDef` and the contract require a bare assignment so
  `runtime.invoke` can reach the knob. Followed core.
* **Glide without a live slot.** Numbers that are not plain arguments of catalog float inputs (settings, array steps,
  modulator rates) glide through the editor's coalesced drag commits instead of `setLive`, so each frame recompiles. That is
  correct but heavier; on an older iPad a long glide on such a number may stutter.
* **Not verified without an iPad:** feel of the step and rung sizes, whether iOS Safari's own long-press callout or text
  selection ever fires first (the controls set `user-select: none` and cancel `contextmenu`), Apple Pencil hover and
  pressure with the ladder, two hands on two pads plus a third finger on the ladder, and frame rate during glides.

## iPad checklist

1. Tap a number in each editor: the editor opens beside it, tabs switch, the tab you leave on is the one you get next time.
2. Hold a number still for about ⅓ s, then slide: the ladder appears under your finger; up/down changes the step with a
   visible pulse, left/right steps the value; lift: one ↶ undoes it. Slide right away instead: the old scrub/knob turn.
3. Hold and lift without moving: Chain Stack shows the kind menu, Rack the knob menu, Graph and Blocks the Ladder tab.
4. Double-tap a number: still resets to the default. Two-finger tap: still undoes.
5. Keypad with Glide on: type 2, Go; the preview moves over the duration; ↶ once returns to the old value. Try `2b`.
   Tap ↩ to glide back. Try "Loop between …" and check the code.
6. Pad tab → Bind to a pad: the pad appears bottom right; hold it with one finger, then a second pad with another finger;
   drag a pad by its grip; open ⇄ → Pads in each editor; in Rack performance mode, toggle Pads.
7. Open a shared sketch with a pad: the pad is dimmed until you tap Run it.
8. Export with "Make this sketch self-contained", paste into hydra.ojack.xyz, run `oscOffset.hold(3)` (your knob's name).
9. Hardware keyboard: Ladder tab, arrows, Enter, Esc. Apple Pencil: hold and slide on a number.
