// SPDX-License-Identifier: MIT
// Entry of dist/hydra-motion.js: installs `knob`, `gate` and `window.hydraMotion`, and nothing else.
// __HM_VERSION__ and __HM_EASINGS__ are filled in by scripts/build.mjs.
/* global __HM_VERSION__, __HM_EASINGS__ */

import { createMotion } from './motion.js'

const G = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : self
const VERSION = __HM_VERSION__
const prev = G.hydraMotion

// Loaded again (a self-contained sketch re-run, or loadScript twice): the same version keeps the first copy.
if (!(prev && prev.__hydraMotion && prev.version === VERSION)) {
  const m = createMotion({ easings: __HM_EASINGS__, global: G })
  const api = Object.freeze({ version: VERSION, ...m, __hydraMotion: true })
  for (const name of ['knob', 'gate']) {
    const cur = G[name]
    // never overwrite somebody else's global (another plugin's, or the sketch's own); ours from an older copy is replaced
    if (cur !== undefined && !(prev && prev.__hydraMotion && cur === prev[name])) {
      if (G.console) G.console.warn(`hydra-motion: a global "${name}" already exists, so it was left alone; use hydraMotion.${name}(…) instead`)
      continue
    }
    G[name] = api[name]
  }
  G.hydraMotion = api
}
