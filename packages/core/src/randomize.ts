import { catalog as defaultCatalog, type Catalog, type FnDef } from './catalog'
import {
  arr,
  makeCall,
  makeChain,
  newSketch,
  num,
  OUT_NAMES,
  chainStmt,
  fnv,
  tex,
  DEFAULT,
  type ArrMods,
  type Call,
  type Chain,
  type OutName,
  type Sketch,
  type Value,
} from './ir'

export interface RandomOptions {
  catalog?: Catalog
  minMods?: number
  maxMods?: number
  /** probability that a combine/combineCoord texture is a nested chain (otherwise another output) */
  nestedP?: number
  fnP?: number
  arrP?: number
  out?: OutName
  /** number of top-level chains (each to a different output) */
  chains?: number
  name?: string
}

/** mulberry32 */
export function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  }
}

const round = (x: number, step: number) => {
  const s = step > 0 ? step : 0.01
  const v = Math.round(x / s) * s
  return +v.toFixed(4)
}

type R = ReturnType<typeof rng>

function floatValue(fn: FnDef, idx: number, r: R, cat: Catalog, o: Required<Pick<RandomOptions, 'fnP' | 'arrP'>>): Value {
  const input = fn.inputs[idx]
  const def = typeof input.default === 'number' ? input.default : 0
  const h = cat.hint(fn.name, input.name)
  const span = h.max - h.min
  // stay near the default with some jitter so results look intentional
  let base = def + (r.next() - 0.5) * span * 0.35
  base = Math.min(h.max, Math.max(h.min, base))
  const one = (): number => (h.integer ? Math.round(base) : round(base, h.step ?? 0.01))
  const roll = r.next()
  if (roll < o.fnP) {
    const mid = round((h.min + h.max) / 2 * 0.5 + def * 0.5, h.step ?? 0.01)
    const amp = round(span * 0.15, h.step ?? 0.01) || 0.1
    const speed = r.pick([0.2, 0.5, 1, 2])
    return fnv(`() => ${mid} + Math.sin(time * ${speed}) * ${amp}`)
  }
  if (roll < o.fnP + o.arrP) {
    const n = r.int(2, 4)
    const vals = Array.from({ length: n }, () => {
      const v = Math.min(h.max, Math.max(h.min, def + (r.next() - 0.5) * span * 0.4))
      return h.integer ? Math.round(v) : round(v, h.step ?? 0.01)
    })
    const mods: ArrMods = {}
    if (r.chance(0.5)) mods.fast = r.pick([0.5, 2, 4])
    if (r.chance(0.4) && !h.integer) mods.smooth = 1
    return arr(vals, mods)
  }
  if (r.chance(0.4)) return DEFAULT
  return num(one())
}

function makeFnCall(fn: FnDef, r: R, cat: Catalog, opts: Required<Omit<RandomOptions, 'catalog' | 'out' | 'chains' | 'name'>>, depth: number): Call {
  const args: Value[] = []
  fn.inputs.forEach((input, i) => {
    if (input.type === 'sampler2D') {
      if (fn.name === 'src') args.push({ k: 'ref', name: r.pick(['s0', 's1', 's2', 's3']) })
      else if (depth < 2 && r.chance(opts.nestedP)) args.push(tex(makeNested(r, cat, opts, depth + 1)))
      else args.push({ k: 'ref', name: r.pick(OUT_NAMES) })
    } else if (input.type === 'float') {
      args.push(floatValue(fn, i, r, cat, opts))
    } else {
      args.push(DEFAULT)
    }
  })
  // trim trailing defaults so the sketch is in canonical form
  while (args.length && args[args.length - 1].k === 'default') args.pop()
  return makeCall(fn.name, args)
}

const BORING_GENS = new Set(['src', 'prev', 'solid'])

function makeNested(r: R, cat: Catalog, opts: Required<Omit<RandomOptions, 'catalog' | 'out' | 'chains' | 'name'>>, depth: number): Chain {
  const gens = cat.list('src').filter((f) => !BORING_GENS.has(f.name))
  const mods = cat.list('mod').filter((f) => f.type === 'coord' || f.type === 'color')
  const gen = makeFnCall(r.pick(gens), r, cat, opts, depth)
  const n = r.int(0, 2)
  return makeChain(gen, Array.from({ length: n }, () => makeFnCall(r.pick(mods), r, cat, opts, depth)))
}

/** A valid, reasonable-looking sketch: generator + 2–5 modifiers, occasional nested textures, functions, arrays. */
export function randomSketch(seed: number, options: RandomOptions = {}): Sketch {
  const cat = options.catalog ?? defaultCatalog
  const r = rng(seed)
  const opts = {
    minMods: options.minMods ?? 2,
    maxMods: options.maxMods ?? 5,
    nestedP: options.nestedP ?? 0.6,
    fnP: options.fnP ?? 0.1,
    arrP: options.arrP ?? 0.08,
  }
  const gens = cat.list('src').filter((f) => !BORING_GENS.has(f.name))
  const mods = cat.list('mod')
  const nChains = options.chains ?? 1
  const stmts = []
  for (let c = 0; c < nChains; c++) {
    const gen = makeFnCall(r.pick(gens), r, cat, opts, 0)
    const n = r.int(opts.minMods, opts.maxMods)
    const ms: Call[] = []
    let combos = 0
    for (let i = 0; i < n; i++) {
      let f = r.pick(mods)
      // keep at most two texture-taking modifiers so shaders stay small
      if ((f.type === 'combine' || f.type === 'combineCoord') && combos >= 2) f = r.pick(mods.filter((m) => m.type === 'coord' || m.type === 'color'))
      if (f.type === 'combine' || f.type === 'combineCoord') combos++
      ms.push(makeFnCall(f, r, cat, opts, 0))
    }
    const out = nChains === 1 ? (options.out ?? 'o0') : OUT_NAMES[c % 4]
    stmts.push(chainStmt(makeChain(gen, ms, out)))
  }
  return newSketch(options.name ?? `random ${seed}`, stmts)
}
