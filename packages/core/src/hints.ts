// Hand-authored UI hints. They only add ranges/scales: defaults always come from the catalog.
// Keys are `fn.input`; a bare `*.input` key is a fallback for every function with that input name.

export interface Hint {
  min: number
  max: number
  step?: number
  /** slider should map logarithmically (ignored when min <= 0 unless `log` is explicitly paired with offset by the UI) */
  log?: boolean
  /** value wraps around (angles) */
  wrap?: boolean
  /** only whole numbers make sense */
  integer?: boolean
}

const PI = Math.PI
const h = (min: number, max: number, extra: Partial<Hint> = {}): Hint => ({ min, max, ...extra })

export const HINTS: Record<string, Hint> = {
  // sources
  'osc.frequency': h(0, 200, { log: true, step: 0.1 }),
  'osc.sync': h(-2, 2, { step: 0.01 }),
  'osc.offset': h(0, 2 * PI, { wrap: true, step: 0.01 }),
  'noise.scale': h(0, 50, { log: true, step: 0.1 }),
  'noise.offset': h(0, 2, { step: 0.01 }),
  'voronoi.scale': h(0, 50, { log: true, step: 0.1 }),
  'voronoi.speed': h(0, 5, { step: 0.01 }),
  'voronoi.blending': h(0, 5, { step: 0.01 }),
  'shape.sides': h(1, 20, { integer: true, step: 1 }),
  'shape.radius': h(0, 1.5, { step: 0.01 }),
  'shape.smoothing': h(0, 1, { step: 0.001 }),
  'gradient.speed': h(-5, 5, { step: 0.01 }),
  'solid.r': h(0, 1, { step: 0.01 }),
  'solid.g': h(0, 1, { step: 0.01 }),
  'solid.b': h(0, 1, { step: 0.01 }),
  'solid.a': h(0, 1, { step: 0.01 }),
  // coordinates
  'rotate.angle': h(-PI, PI, { wrap: true, step: 0.01 }),
  'rotate.speed': h(-5, 5, { step: 0.01 }),
  'scale.amount': h(0, 4, { step: 0.01 }),
  'scale.xMult': h(0, 4, { step: 0.01 }),
  'scale.yMult': h(0, 4, { step: 0.01 }),
  'scale.offsetX': h(0, 1, { step: 0.01 }),
  'scale.offsetY': h(0, 1, { step: 0.01 }),
  'pixelate.pixelX': h(1, 400, { log: true, step: 1 }),
  'pixelate.pixelY': h(1, 400, { log: true, step: 1 }),
  'repeat.repeatX': h(1, 20, { step: 0.1 }),
  'repeat.repeatY': h(1, 20, { step: 0.1 }),
  'repeat.offsetX': h(0, 1, { step: 0.01 }),
  'repeat.offsetY': h(0, 1, { step: 0.01 }),
  'repeatX.reps': h(1, 20, { step: 0.1 }),
  'repeatX.offset': h(0, 1, { step: 0.01 }),
  'repeatY.reps': h(1, 20, { step: 0.1 }),
  'repeatY.offset': h(0, 1, { step: 0.01 }),
  'kaleid.nSides': h(1, 24, { integer: true, step: 1 }),
  'scroll.scrollX': h(-1, 1, { step: 0.01 }),
  'scroll.scrollY': h(-1, 1, { step: 0.01 }),
  'scroll.speedX': h(-2, 2, { step: 0.01 }),
  'scroll.speedY': h(-2, 2, { step: 0.01 }),
  'scrollX.scrollX': h(-1, 1, { step: 0.01 }),
  'scrollX.speed': h(-2, 2, { step: 0.01 }),
  'scrollY.scrollY': h(-1, 1, { step: 0.01 }),
  'scrollY.speed': h(-2, 2, { step: 0.01 }),
  // colour
  'posterize.bins': h(1, 16, { step: 0.1 }),
  'posterize.gamma': h(0.1, 4, { step: 0.01 }),
  'shift.r': h(-1, 1, { step: 0.01 }),
  'shift.g': h(-1, 1, { step: 0.01 }),
  'shift.b': h(-1, 1, { step: 0.01 }),
  'shift.a': h(-1, 1, { step: 0.01 }),
  'invert.amount': h(0, 1, { step: 0.01 }),
  'contrast.amount': h(0, 4, { step: 0.01 }),
  'brightness.amount': h(-1, 1, { step: 0.01 }),
  'luma.threshold': h(0, 1, { step: 0.01 }),
  'luma.tolerance': h(0, 1, { step: 0.01 }),
  'thresh.threshold': h(0, 1, { step: 0.01 }),
  'thresh.tolerance': h(0, 1, { step: 0.01 }),
  'color.r': h(0, 3, { step: 0.01 }),
  'color.g': h(0, 3, { step: 0.01 }),
  'color.b': h(0, 3, { step: 0.01 }),
  'color.a': h(0, 3, { step: 0.01 }),
  'saturate.amount': h(0, 8, { step: 0.01 }),
  'hue.hue': h(0, 1, { wrap: true, step: 0.001 }),
  'colorama.amount': h(0, 0.2, { step: 0.0005 }),
  'r.scale': h(-3, 3, { step: 0.01 }),
  'r.offset': h(-1, 1, { step: 0.01 }),
  'g.scale': h(-3, 3, { step: 0.01 }),
  'g.offset': h(-1, 1, { step: 0.01 }),
  'b.scale': h(-3, 3, { step: 0.01 }),
  'b.offset': h(-1, 1, { step: 0.01 }),
  'a.scale': h(-3, 3, { step: 0.01 }),
  'a.offset': h(-1, 1, { step: 0.01 }),
  // combine
  'add.amount': h(0, 2, { step: 0.01 }),
  'sub.amount': h(0, 2, { step: 0.01 }),
  'blend.amount': h(0, 1, { step: 0.01 }),
  'mult.amount': h(0, 1, { step: 0.01 }),
  // combineCoord
  'modulate.amount': h(-1, 1, { step: 0.001 }),
  'modulateScale.multiple': h(-4, 4, { step: 0.01 }),
  'modulateScale.offset': h(-2, 4, { step: 0.01 }),
  'modulatePixelate.multiple': h(0, 100, { step: 0.1 }),
  'modulatePixelate.offset': h(0, 50, { step: 0.1 }),
  'modulateRotate.multiple': h(-PI, PI, { step: 0.01 }),
  'modulateRotate.offset': h(-PI, PI, { step: 0.01 }),
  'modulateHue.amount': h(-2, 2, { step: 0.01 }),
  'modulateKaleid.nSides': h(1, 24, { integer: true, step: 1 }),
  'modulateRepeat.repeatX': h(1, 20, { step: 0.1 }),
  'modulateRepeat.repeatY': h(1, 20, { step: 0.1 }),
  'modulateRepeat.offsetX': h(0, 1, { step: 0.01 }),
  'modulateRepeat.offsetY': h(0, 1, { step: 0.01 }),
  'modulateRepeatX.reps': h(1, 20, { step: 0.1 }),
  'modulateRepeatX.offset': h(0, 1, { step: 0.01 }),
  'modulateRepeatY.reps': h(1, 20, { step: 0.1 }),
  'modulateRepeatY.offset': h(0, 1, { step: 0.01 }),
  'modulateScrollX.scrollX': h(-1, 1, { step: 0.01 }),
  'modulateScrollX.speed': h(-2, 2, { step: 0.01 }),
  'modulateScrollY.scrollY': h(-1, 1, { step: 0.01 }),
  'modulateScrollY.speed': h(-2, 2, { step: 0.01 }),
  // fallbacks by input name
  '*.amount': h(0, 2, { step: 0.01 }),
}

/**
 * Heuristic range for an unhinted numeric input: [default/10 … default*10].
 * A zero default gets [-1, 1]; a negative default is mirrored so min < max.
 */
export function heuristicHint(def: number | undefined | null): Hint {
  const d = typeof def === 'number' && isFinite(def) ? def : 0
  if (d === 0) return { min: -1, max: 1, step: 0.01 }
  const a = d / 10
  const b = d * 10
  const min = Math.min(a, b)
  const max = Math.max(a, b)
  return { min, max, step: niceStep(max - min) }
}

export function niceStep(range: number): number {
  if (!(range > 0)) return 0.01
  const raw = range / 400
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / p
  const m = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10
  return m * p
}
