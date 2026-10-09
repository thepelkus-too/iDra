// How a module's inputs become controls: texture inputs are patch jacks, natural pairs are XY pads, r/g/b/a runs are a colour
// block with a swatch, every other number is a knob. Generated from the catalog (plugins and unknown calls get the generic
// knob panel). Pure.
import type { Catalog, InputDef } from '@hydra-ipad/core'

export type Control =
  | { t: 'knob'; i: number; inp?: InputDef }
  | { t: 'xy'; x: number; y: number; ix: InputDef; iy: InputDef }
  | { t: 'rgba'; is: number[]; inputs: InputDef[] }
  | { t: 'jack'; i: number; inp: InputDef }
  | { t: 'vec'; i: number; inp: InputDef }

export const XY_PAIRS: Array<[string, string]> = [
  ['pixelX', 'pixelY'],
  ['repeatX', 'repeatY'],
  ['offsetX', 'offsetY'],
  ['scrollX', 'scrollY'],
  ['speedX', 'speedY'],
  ['xMult', 'yMult'],
]

/** The controls of a call, in input order (a pair or a colour block sits where its first input is). */
export function panelOf(fn: string, nArgs: number, cat: Catalog): Control[] {
  const inputs = cat.has(fn) ? cat.inputs(fn) : []
  const n = Math.max(inputs.length, nArgs)
  const names = inputs.map((x) => x.name)
  const used = new Set<number>()
  const out: Control[] = []
  // colour: r, g, b (and a) in a row of float inputs
  const r = names.indexOf('r')
  if (r >= 0 && names[r + 1] === 'g' && names[r + 2] === 'b' && inputs.slice(r, r + 3).every((x) => x.type === 'float')) {
    const len = names[r + 3] === 'a' && inputs[r + 3].type === 'float' ? 4 : 3
    const is = Array.from({ length: len }, (_, k) => r + k)
    is.forEach((i) => used.add(i))
    out.push({ t: 'rgba', is, inputs: is.map((i) => inputs[i]) })
  }
  for (const [a, b] of XY_PAIRS) {
    const x = names.indexOf(a)
    const y = names.indexOf(b)
    if (x < 0 || y < 0 || used.has(x) || used.has(y) || inputs[x].type !== 'float' || inputs[y].type !== 'float') continue
    used.add(x)
    used.add(y)
    out.push({ t: 'xy', x, y, ix: inputs[x], iy: inputs[y] })
  }
  for (let i = 0; i < n; i++) {
    if (used.has(i)) continue
    const inp = inputs[i]
    if (inp?.type === 'sampler2D') out.push({ t: 'jack', i, inp })
    else if (inp?.type.startsWith('vec')) out.push({ t: 'vec', i, inp })
    else out.push({ t: 'knob', i, inp })
  }
  const first = (c: Control) => (c.t === 'xy' ? Math.min(c.x, c.y) : c.t === 'rgba' ? c.is[0] : c.i)
  return out.sort((a, b) => first(a) - first(b))
}

/** Integer-valued inputs get detents on their knob. */
export function isInteger(fn: string, name: string, cat: Catalog): boolean {
  if (cat.hint(fn, name).integer) return true
  return /^(sides|nSides|bins|reps|pixelX|pixelY)$/.test(name)
}
