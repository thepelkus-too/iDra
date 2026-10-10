// Easing curves for glides drawn and run in the editor. The NAMES are Hydra's own, taken from the same list hydra-motion
// ships (core's MOTION_EASINGS, read from packages/motion/dist/easings.json, which its build reads from hydra-synth); the
// curves follow the definitions in docs/motion.md, and test/easing.test.ts checks them against the built plugin's
// `hydraMotion.ease(name)` at many fractions, so a glide in the editor and a pad's glide in the sketch move the same way.
import { MOTION_EASINGS } from '@hydra-ipad/core'

export const EASINGS: readonly string[] = MOTION_EASINGS

const POWERS: Record<string, number> = { Quad: 2, Cubic: 3, Quart: 4, Quint: 5 }

/** t ∈ [0, 1] → eased fraction. Unknown names are linear (as in the plugin). */
export function ease(name: string | undefined): (t: number) => number {
  if (name === 'sin') return (t) => (1 - Math.cos(Math.PI * t)) / 2
  const m = /^ease(InOut|In|Out)(Quad|Cubic|Quart|Quint)$/.exec(String(name))
  if (!m) return (t) => t
  const p = POWERS[m[2]]
  if (m[1] === 'In') return (t) => Math.pow(t, p)
  if (m[1] === 'Out') return (t) => 1 - Math.pow(1 - t, p)
  const k = Math.pow(2, p - 1)
  return (t) => (t < 0.5 ? k * Math.pow(t, p) : 1 - Math.pow(2 - 2 * t, p) / 2)
}

/** The curve picker's order: the gentle ones first. Every name is one of EASINGS (checked by the tests). */
export const EASE_PRESETS: readonly string[] = ['linear', 'sin', 'easeInOutQuad', 'easeInOutCubic', 'easeInQuad', 'easeOutQuad', 'easeInCubic', 'easeOutCubic', 'easeInOutQuint', 'easeInQuart', 'easeOutQuart', 'easeInQuint', 'easeOutQuint', 'easeInOutQuart'].filter((n) => EASINGS.includes(n))

/** A small SVG path (0..w × 0..h, y up) of a curve, for the picker's thumbnails. */
export function easePath(name: string, w = 28, h = 20, n = 24): string {
  const f = ease(name)
  const pts: string[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    pts.push(`${(t * w).toFixed(1)} ${(h - f(t) * h).toFixed(1)}`)
  }
  return `M ${pts.join(' L ')}`
}

/** Short label: "in-out cubic", "sine", "linear". */
export function easeLabel(name: string): string {
  if (name === 'sin') return 'sine'
  const m = /^ease(InOut|In|Out)(\w+)$/.exec(name)
  if (!m) return name
  return `${m[1] === 'InOut' ? 'in-out' : m[1].toLowerCase()} ${m[2].toLowerCase()}`
}
