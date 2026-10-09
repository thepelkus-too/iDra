// Pure helpers for values: kind conversion, function-expression wrapping (scale/offset), number formatting.
// No DOM: unit-tested in test/conv.test.ts.
import {
  DEFAULT,
  arr,
  fnv,
  makeCall,
  makeChain,
  num,
  tex,
  type Catalog,
  type InputDef,
  type OutName,
  type RefName,
  type Value,
} from '@hydra-ipad/core'

// ---------------------------------------------------------------- number formatting

/** Decimal places needed to show a step like 0.01 / 0.5 / 1. */
export function decimalsOf(step: number): number {
  if (!(step > 0) || !isFinite(step)) return 2
  let d = 0
  let s = step
  while (d < 8 && Math.abs(Math.round(s) - s) > 1e-9) {
    s *= 10
    d++
  }
  return d
}

export function roundTo(v: number, step: number): number {
  if (!(step > 0)) return v
  const d = decimalsOf(step)
  return +(Math.round(v / step) * step).toFixed(Math.min(8, d))
}

/** Short, stable display for a number: at most 4 decimals, no trailing zeros. */
export function fmt(v: number): string {
  if (!isFinite(v)) return '0'
  if (Object.is(v, -0)) return '0'
  const a = Math.abs(v)
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) return v.toExponential(2)
  return String(+v.toFixed(4))
}

// ---------------------------------------------------------------- expression analysis

/** Scan an expression at nesting depth 0, ignoring strings. Calls `f(char, index)`; return true from f to stop. */
function scanTop(src: string, f: (ch: string, i: number) => boolean | void): void {
  let depth = 0
  let quote = ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (depth === 0 && f(ch, i)) return
  }
}

/** True when the expression contains only arithmetic at the top level (no ?:, ||, &&, comparison, assignment, comma, arrow). */
export function isSimpleArith(src: string): boolean {
  let ok = true
  scanTop(src, (ch) => {
    if ('?|&<>=,;:'.includes(ch)) {
      ok = false
      return true
    }
    return false
  })
  return ok
}

/** True when a binary + or - sits at the top level (so `body * k` needs parentheses). */
export function hasTopLevelAddSub(src: string): boolean {
  let found = false
  scanTop(src, (ch, i) => {
    if (ch !== '+' && ch !== '-') return false
    // unary when at the start or right after an operator / exponent marker
    let j = i - 1
    while (j >= 0 && src[j] === ' ') j--
    if (j < 0) return false
    const prev = src[j]
    if ('+-*/%(,=<>!&|?:'.includes(prev)) return false
    if ((prev === 'e' || prev === 'E') && /[\d.]/.test(src[j - 1] ?? '')) return false
    found = true
    return true
  })
  return found
}

const NUM = String.raw`(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`
const ARROW = /^\(\)\s*=>\s*/
const OFFSET_TAIL = new RegExp(String.raw`\s*([+-])\s*(${NUM})\s*$`, 'i')
const SCALE_TAIL = new RegExp(String.raw`\s*\*\s*(${NUM})\s*$`, 'i')

export interface FnWrap {
  /** the expression without the `() =>` and without the trailing `* scale + offset` */
  body: string
  scale: number
  offset: number
}

/** `() => body * scale + offset` → parts. Returns undefined when the source is not a zero-argument arrow. */
export function parseFnWrap(src: string): FnWrap | undefined {
  const m = ARROW.exec(src.trim())
  if (!m) return undefined
  let body = src.trim().slice(m[0].length)
  if (!body || body.startsWith('{')) return undefined
  if (!isSimpleArith(body)) return { body, scale: 1, offset: 0 }
  let offset = 0
  let scale = 1
  const o = OFFSET_TAIL.exec(body)
  if (o) {
    const rest = body.slice(0, o.index)
    // `time - 1 * 2` must not read as offset: only strip when what remains is non-empty
    if (rest.trim()) {
      offset = (o[1] === '-' ? -1 : 1) * Number(o[2])
      body = rest
    }
  }
  const s = SCALE_TAIL.exec(body)
  if (s) {
    const rest = body.slice(0, s.index)
    if (rest.trim() && !hasTopLevelAddSub(rest)) {
      scale = Number(s[1])
      body = rest
    }
  }
  if (!isFinite(scale) || !isFinite(offset)) return { body: src.trim().slice(m[0].length), scale: 1, offset: 0 }
  return { body: body.trim(), scale, offset }
}

export function composeFn(body: string, scale = 1, offset = 0): string {
  let b = body.trim() || '0'
  const simple = isSimpleArith(b)
  if (scale !== 1 && (!simple || hasTopLevelAddSub(b))) b = `(${b})`
  else if (offset !== 0 && !simple) b = `(${b})`
  let s = `() => ${b}`
  if (scale !== 1) s += ` * ${fmtLit(scale)}`
  if (offset !== 0) s += offset < 0 ? ` - ${fmtLit(-offset)}` : ` + ${fmtLit(offset)}`
  return s
}

const fmtLit = (v: number) => String(+v.toFixed(6))

/** Evaluate a purely numeric expression such as `0.5`, `1 / 4`, `Math.PI / 2`. Anything else → undefined. */
export function evalNumeric(src: string): number | undefined {
  const t = src.trim().replace(/Math\.PI/g, String(Math.PI))
  if (!t || !/^[\d\s.+\-*/()eE]+$/.test(t)) return undefined
  try {
    const v = new Function(`"use strict"; return (${t})`)() as unknown
    return typeof v === 'number' && isFinite(v) ? v : undefined
  } catch {
    return undefined
  }
}

/** A function whose body is a constant: `() => 0.5` → 0.5. */
export function numFromFn(src: string): number | undefined {
  const m = ARROW.exec(src.trim())
  if (!m) return undefined
  return evalNumeric(src.trim().slice(m[0].length))
}

// ---------------------------------------------------------------- value kinds

export type Kind = 'number' | 'function' | 'array' | 'texture' | 'ref' | 'var' | 'default' | 'vec' | 'js'

export function kindOf(v: Value): Kind {
  switch (v.k) {
    case 'num': return 'number'
    case 'fn': return 'function'
    case 'arr': return 'array'
    case 'tex': return 'texture'
    case 'ref': return 'ref'
    case 'var': return 'var'
    case 'default': return 'default'
    case 'vec4': return 'vec'
    case 'js': return 'js'
  }
}

export function defaultNumber(input: InputDef | undefined): number {
  const d = input?.default
  if (typeof d === 'number') return d
  if (Array.isArray(d) && typeof d[0] === 'number') return d[0]
  return 0
}

/** Best-effort number for a value: used when switching to Number or to build an array/function seed. */
export function valueToNumber(v: Value, input?: InputDef): number {
  switch (v.k) {
    case 'num': return v.v
    case 'fn': return numFromFn(v.src) ?? defaultNumber(input)
    case 'js': return evalNumeric(v.src) ?? defaultNumber(input)
    case 'arr': return v.v.length ? v.v[0] : defaultNumber(input)
    case 'vec4': return v.v.length ? v.v[0] : defaultNumber(input)
    default: return defaultNumber(input)
  }
}

/** The pocket a Texture switch puts in: `src(o1)` for a ref (same picture), otherwise a small noise. */
export function pocketFor(v: Value | undefined): Value {
  if (v?.k === 'ref') return tex(makeChain(makeCall('src', [v])))
  if (v?.k === 'tex') return v
  return tex(makeChain(makeCall('noise', [num(3)])))
}

/** A `tex` that is exactly `src(oN|sN)` collapses back to a plain ref (for the picker view). */
export function asPlainRef(v: Value): RefName | undefined {
  if (v.k === 'ref') return v.name
  if (v.k === 'tex' && v.chain.gen.fn === 'src' && v.chain.mods.length === 0) {
    const a = v.chain.gen.args[0]
    if (a?.k === 'ref') return a.name
  }
  return undefined
}

export function convertValue(v: Value, to: Kind, input?: InputDef, opts: { catalog?: Catalog; defNames?: string[] } = {}): Value {
  if (kindOf(v) === to && to !== 'default') return v
  const n = valueToNumber(v, input)
  switch (to) {
    case 'number': return num(n)
    case 'function': return v.k === 'js' ? fnv(`() => ${v.src}`) : fnv(`() => ${fmtLit(n)}`)
    case 'array': return arr([n])
    case 'texture': return pocketFor(v)
    case 'ref': return v.k === 'tex' && asPlainRef(v) ? { k: 'ref', name: asPlainRef(v)! } : { k: 'ref', name: 'o0' as OutName }
    case 'var': return { k: 'var', name: opts.defNames?.[0] ?? 'x' }
    case 'default': return DEFAULT
    case 'js': return { k: 'js', src: fmtLit(n) }
    case 'vec': return { k: 'vec4', v: input && Array.isArray(input.default) ? input.default.slice() : [n, n, n, n] }
  }
}

/** The kinds the long-press menu offers for an input of this glsl type. */
export function kindsFor(input: InputDef | undefined): Kind[] {
  if (input?.type === 'sampler2D') return ['texture', 'ref', 'var', 'default']
  if (input && input.type.startsWith('vec')) return ['vec', 'function', 'default']
  return ['number', 'function', 'array', 'texture', 'default']
}

export const KIND_LABEL: Record<Kind, string> = {
  number: 'Number',
  function: 'Function',
  array: 'Array',
  texture: 'Texture',
  ref: 'o / s',
  var: 'Variable',
  default: 'Default',
  vec: 'Vector',
  js: 'JS',
}

// ---------------------------------------------------------------- misc

/** `name(a, b)` style signature for tooltips and completion details. */
export function signature(fn: { name: string; inputs: InputDef[] }): string {
  const parts = fn.inputs.map((i) =>(i.type === 'sampler2D' ? i.name : `${i.name}=${Array.isArray(i.default) ? `[${i.default.join(', ')}]` : i.default ?? ''}`))
  return `${fn.name}(${parts.join(', ')})`
}
