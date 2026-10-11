<!-- SPDX-License-Identifier: MIT -->
# Changelog

## 0.2.0 (unreleased: no tag yet)

- `knob(initial, { pads: [{ mode, to, off, attack, release, ease }] })` reads its pads (0.1.0 ignored the option).
- `k.press(i)` / `k.lift(i)` play pad `i`: Hold (holds under the pad's own id until lifted), Latch (each press toggles
  between `to` and `off`), Trigger (glides to `to` and stays). Defaults match iDra's pad editor.
- `k.pads`: the pads as the knob read them.
- Additive: everything from 0.1.0 behaves the same.

## 0.1.0 (unreleased: no tag yet)

- `knob(initial, { clock })` with `set`, `to`, `hold`, `release`, `releaseAll`, `onDone`, `destroy`, `value`, `base`, `busy`, `held`.
- Stacked holds; `to`/`set` while held move the base.
- Durations in seconds, beats (`'2b'`, at Hydra's `bpm`), `'s'` and `'ms'`; Hydra or wall clock.
- Hydra's easing names (read from hydra-synth at build time) or a function.
- `gate({ attack, release, ease })` with `down`, `up`, `toggle`.
- Single ES2019 IIFE, MIT header, about 3.5 KB gzipped.

Release tags are `hydra-motion-v<semver>`.
