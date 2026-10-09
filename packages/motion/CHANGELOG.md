<!-- SPDX-License-Identifier: MIT -->
# Changelog

## 0.1.0 (unreleased: no tag yet)

- `knob(initial, { clock })` with `set`, `to`, `hold`, `release`, `releaseAll`, `onDone`, `destroy`, `value`, `base`, `busy`, `held`.
- Stacked holds; `to`/`set` while held move the base.
- Durations in seconds, beats (`'2b'`, at Hydra's `bpm`), `'s'` and `'ms'`; Hydra or wall clock.
- Hydra's easing names (read from hydra-synth at build time) or a function.
- `gate({ attack, release, ease })` with `down`, `up`, `toggle`.
- Single ES2019 IIFE, MIT header, about 3.5 KB gzipped.

Release tags are `hydra-motion-v<semver>`.
