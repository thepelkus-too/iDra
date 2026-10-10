// SPDX-License-Identifier: MIT
// Where the installed hydra-synth keeps its easing functions and array helpers (it does not export them, so resolve the
// package entry and look next to it). Used by the build (easing names) and by the parity test.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(import.meta.resolve('hydra-synth'))
export const hydraSrc = dirname(entry)
export const easingFile = join(hydraSrc, 'lib', 'easing-functions.js')
export const arrayUtilsFile = join(hydraSrc, 'lib', 'array-utils.js')

/** Hydra's easing names, in its own order. */
export async function hydraEasingNames() {
  const mod = await import(easingFile)
  return Object.keys(mod.default)
}
