// SPDX-License-Identifier: MIT
// Easing curves keyed by Hydra's easing names. The NAMES come from the installed hydra-synth at build time
// (scripts/build.mjs reads its easing-functions.js); the CURVES are written here from their mathematical definitions:
//   linear            t
//   sin               half a cosine: (1 - cos(pi t)) / 2
//   easeIn<P>         t^p
//   easeOut<P>        1 - (1 - t)^p
//   easeInOut<P>      2^(p-1) t^p below one half, 1 - (2 - 2t)^p / 2 above
// with Quad, Cubic, Quart, Quint = powers 2, 3, 4, 5. A name outside these families has no curve, and the build fails
// instead of shipping a plugin that silently disagrees with Hydra.

const POWERS = { Quad: 2, Cubic: 3, Quart: 4, Quint: 5 }

/** The curve for an easing name, or undefined when the name is not one of the families above. */
export function curveFor(name) {
  if (name === 'linear') return (t) => t
  if (name === 'sin') return (t) => (1 - Math.cos(Math.PI * t)) / 2
  const m = /^ease(InOut|In|Out)(Quad|Cubic|Quart|Quint)$/.exec(String(name))
  if (!m) return undefined
  const p = POWERS[m[2]]
  if (m[1] === 'In') return (t) => Math.pow(t, p)
  if (m[1] === 'Out') return (t) => 1 - Math.pow(1 - t, p)
  const k = Math.pow(2, p - 1)
  return (t) => (t < 0.5 ? k * Math.pow(t, p) : 1 - Math.pow(2 - 2 * t, p) / 2)
}

/** Name → curve for every name in `names`; throws if one has no curve. */
export function easingTable(names) {
  const table = {}
  for (const n of names) {
    const f = curveFor(n)
    if (!f) throw new Error(`hydra-motion: no curve for Hydra easing "${n}"; add its family to src/easing.js`)
    table[n] = f
  }
  return table
}
