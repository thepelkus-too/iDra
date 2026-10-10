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
| `styles.ts` | `KIT_CSS` | popovers, sheets, toasts, HUD, keypad |

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
4. Put `${KIT_CSS}` into the editor's stylesheet and override after it if the editor needs its own look (Chain Stack keeps
   its overlay z-index of 1000, a 720 px wide sheet and its keypad key font). The number controls' own sizes
   (`.numslider` in Graph and Blocks, `.tok.num` in Chain Stack) stay with each editor.

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
