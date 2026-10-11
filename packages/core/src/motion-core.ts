// iDra's side of hydra-motion (packages/motion, MIT): IR helpers for knobs, the plugin's registry entry, and the inlined
// "self-contained" block. The plugin is consumed only through its public surface, the built file and docs/motion.md, the
// same way as any third-party plugin; nothing here imports the package's source.
// Kept free of UI and runtime imports: the parser and codegen use it.

import * as acorn from 'acorn'
import type { DefStmt, PluginRef, Sketch, Stmt, Value } from './ir'
import { newId } from './ir'
import { pluginRegistry, type RegistryEntry } from './plugins'
import { sriSync } from './sha256'
import easingNames from 'hydra-motion/dist/easings.json'

/** The plugin's name, its registry id and the `origin` of anything it registers (`plugin:hydra-motion`). */
export const MOTION_PLUGIN_ID = 'hydra-motion'
/** The only methods `runtime.invoke` forwards. */
export const MOTION_METHODS = ['set', 'to', 'hold', 'release'] as const
export type MotionMethod = (typeof MOTION_METHODS)[number]
/** The easing names hydra-motion accepts (Hydra's own set; from the package's built `dist/easings.json`). */
export const MOTION_EASINGS: readonly string[] = Object.freeze([...(easingNames as string[])])

// ------------------------------------------------------------------ registry entry and plugin ref

/** The registry entry for the hydra-motion build this site serves (URL resolved against the site root). */
export function motionRegistryEntry(): RegistryEntry {
  const e = pluginRegistry().find((x) => x.id === MOTION_PLUGIN_ID)
  if (!e) throw new Error('hydra-motion is missing from packages/core/plugins/registry.json (run scripts/sync-motion.mjs)')
  return e
}

/** The PluginRef a sketch carries to use hydra-motion: the pinned URL, its version and SRI. */
export function motionPluginRef(): PluginRef {
  const e = motionRegistryEntry()
  return { id: MOTION_PLUGIN_ID, name: e.name, url: e.url, integrity: e.integrity, version: e.version }
}

export function findMotionPlugin(sketch: Sketch): PluginRef | undefined {
  return (sketch.plugins ?? []).find((p) => p.id === MOTION_PLUGIN_ID)
}

/** The sketch with hydra-motion in `plugins` (kept where it is when it is already there). */
export function withMotion(sketch: Sketch): Sketch {
  if (findMotionPlugin(sketch)) return sketch
  return { ...sketch, plugins: [...(sketch.plugins ?? []), motionPluginRef()] }
}

// ------------------------------------------------------------------ knobs in the IR

/**
 * A pad as the code writes it, the second argument of `knob(<initial>, { pads: [...] })`: plain data hydra-motion ignores,
 * so the sketch runs anywhere, and iDra reads to draw the pads. `mode` defaults to 'hold'; `off` is a latch's "off" value
 * (default: the knob's initial); `attack` / `release` are seconds; `ease` is a hydra-motion easing name.
 */
export interface KnobPad {
  mode?: 'hold' | 'latch' | 'trigger'
  to: number
  off?: number
  attack?: number
  release?: number
  ease?: string
}

export interface KnobInfo {
  initial: number
  pads: KnobPad[]
}

const PAD_KEYS = ['mode', 'to', 'off', 'attack', 'release', 'ease'] as const

const fmtKnobNum = (n: number) => (Number.isFinite(n) && !Object.is(n, -0) ? String(n) : '0')

/** `{ mode: 'hold', to: 1.6, release: 0.15, ease: 'easeOutQuad' }`: keys in a fixed order, absent ones left out. */
function padLiteral(p: KnobPad): string {
  const parts: string[] = []
  for (const k of PAD_KEYS) {
    const v = p[k]
    if (v === undefined) continue
    parts.push(`${k}: ${typeof v === 'string' ? `'${v.replace(/[\\']/g, '')}'` : fmtKnobNum(v)}`)
  }
  return `{ ${parts.join(', ')} }`
}

/** The source of a knob: `knob(0.5)`, or with pads `knob(0.5, { pads: [{ mode: 'hold', to: 1 }] })`. */
export function knobSrc(initial: number, pads: KnobPad[] = []): string {
  if (!pads.length) return `knob(${fmtKnobNum(initial)})`
  return `knob(${fmtKnobNum(initial)}, { pads: [${pads.map(padLiteral).join(', ')}] })`
}

/**
 * A `def` holding a knob: `name = knob(<initial>)`, or `name = knob(<initial>, { pads: [...] })`. The value is the `js`
 * expression the importer produces for that text, so it round-trips. It is a bare assignment (not `const`) so the knob is
 * a global of the sketch, the name `runtime.invoke` (and a person typing `k.hold(1)`) reaches, also inside the async
 * wrapper used for `await`.
 */
export function knobDef(name: string, initial: number, pads: KnobPad[] = []): DefStmt {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`"${name}" is not a variable name`)
  return { id: newId('s'), k: 'def', name, decl: 'bare', value: { k: 'js', src: knobSrc(initial, pads) } }
}

// a literal: numbers (with a leading minus), strings, arrays and objects of them; anything else is not data
type Lit = number | string | boolean | Lit[] | { [k: string]: Lit }
function literal(n: any): Lit | undefined {
  if (!n) return undefined
  if (n.type === 'Literal') return typeof n.value === 'number' || typeof n.value === 'string' || typeof n.value === 'boolean' ? n.value : undefined
  if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return -n.argument.value
  if (n.type === 'ArrayExpression') {
    const out: Lit[] = []
    for (const e of n.elements) {
      const v = literal(e)
      if (v === undefined) return undefined
      out.push(v)
    }
    return out
  }
  if (n.type === 'ObjectExpression') {
    const out: { [k: string]: Lit } = {}
    for (const p of n.properties) {
      if (p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method) return undefined
      const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : undefined
      const v = literal(p.value)
      if (key === undefined || v === undefined) return undefined
      out[key] = v
    }
    return out
  }
  return undefined
}

function knobPad(x: Lit): KnobPad | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined
  if (Object.keys(x).some((k) => !(PAD_KEYS as readonly string[]).includes(k))) return undefined
  const num = (v: Lit | undefined) => (v === undefined ? undefined : typeof v === 'number' && Number.isFinite(v) ? v : NaN)
  const to = num(x.to)
  if (to === undefined || Number.isNaN(to)) return undefined
  const mode = x.mode
  if (mode !== undefined && mode !== 'hold' && mode !== 'latch' && mode !== 'trigger') return undefined
  const p: KnobPad = { to }
  if (mode !== undefined) p.mode = mode
  for (const k of ['off', 'attack', 'release'] as const) {
    const v = num(x[k])
    if (Number.isNaN(v)) return undefined
    if (v !== undefined) p[k] = v
  }
  if (x.ease !== undefined) {
    if (typeof x.ease !== 'string') return undefined
    p.ease = x.ease
  }
  return p
}

const knobCache = new Map<string, KnobInfo | null>()

/**
 * The knob in a value: `knob(<number>)` or `knob(<number>, { pads: [...] })` where the pads are plain data with known keys.
 * Any other form (another option, a computed value) is not a knob iDra edits: it stays code.
 */
export function parseKnob(v: Value): KnobInfo | undefined {
  if (v.k !== 'js' && v.k !== 'fn') return undefined
  const src = v.src.trim()
  if (!/^knob\s*\(/.test(src)) return undefined
  const hit = knobCache.get(src)
  if (hit !== undefined) return hit ?? undefined
  let out: KnobInfo | null = null
  try {
    const n: any = acorn.parseExpressionAt(src, 0, { ecmaVersion: 'latest' })
    if (n.end === src.length && n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'knob' && (n.arguments.length === 1 || n.arguments.length === 2)) {
      const initial = literal(n.arguments[0])
      const opts = n.arguments.length === 2 ? literal(n.arguments[1]) : {}
      if (typeof initial === 'number' && Number.isFinite(initial) && opts && typeof opts === 'object' && !Array.isArray(opts)) {
        const keys = Object.keys(opts)
        const raw = (opts as { pads?: Lit }).pads
        if (keys.every((k) => k === 'pads') && (raw === undefined || Array.isArray(raw))) {
          const pads = (raw ?? []).map(knobPad)
          if (pads.every((p) => p)) out = { initial, pads: pads as KnobPad[] }
        }
      }
    }
  } catch {
    out = null
  }
  if (knobCache.size > 500) knobCache.clear()
  knobCache.set(src, out)
  return out ?? undefined
}

/** The initial number of a knob value (see parseKnob), or undefined. */
export function knobInitial(v: Value): number | undefined {
  return parseKnob(v)?.initial
}

/** Inverse of knobDef: `{ name, initial, decl, pads }` for a def holding a knob iDra edits (see parseKnob), else undefined. */
export function parseKnobDef(s: Stmt): { name: string; initial: number; decl: DefStmt['decl']; pads: KnobPad[] } | undefined {
  if (s.k !== 'def') return undefined
  const k = parseKnob(s.value)
  return k ? { name: s.name, initial: k.initial, decl: s.decl, pads: k.pads } : undefined
}

/** Every knob def in a sketch. */
export function knobDefs(sketch: Sketch): Array<{ stmtId: string; name: string; initial: number; decl: DefStmt['decl']; pads: KnobPad[] }> {
  const out: Array<{ stmtId: string; name: string; initial: number; decl: DefStmt['decl']; pads: KnobPad[] }> = []
  for (const s of sketch.stmts) {
    const k = parseKnobDef(s)
    if (k) out.push({ stmtId: s.id, ...k })
  }
  return out
}

/** The argument Value that binds a parameter to a knob: `{ k: 'var', name }` (emitted as the bare name; Hydra calls it). */
export function knobArg(name: string): Value {
  return { k: 'var', name }
}

// ------------------------------------------------------------------ the inlined ("self-contained") block

// // ---- hydra-motion 0.1.0 · sha256-… · MIT · inlined plugin, do not edit ----
// <the built file, verbatim: its header carries the MIT licence>
// // ---- end hydra-motion 0.1.0 ----
const START_RE = /^\/\/ ---- hydra-motion (\S+) · (sha256-[A-Za-z0-9+/]+=*) · MIT · inlined plugin, do not edit ----\n/
const endLine = (version: string) => `// ---- end hydra-motion ${version} ----\n`

export interface MotionPrelude {
  /** the whole block, delimiters included, exactly as in the text */
  block: string
  version: string
  integrity: string
  /** the plugin source between the delimiters */
  source: string
}

/** The block for a plugin source (`version` and SRI go in the opening line). */
export function motionPrelude(source: string, version: string, integrity: string = sriSync(source)): string {
  const src = source.endsWith('\n') ? source : source + '\n'
  return `// ---- hydra-motion ${version} · ${integrity} · MIT · inlined plugin, do not edit ----\n${src}${endLine(version)}`
}

/**
 * The inlined block at the very start of `text`, when its delimiters are intact AND its source still hashes to the SRI in
 * the opening line. Anything else (an edited block, a different layout) is not recognised and imports as ordinary code.
 */
export function splitPrelude(text: string): (MotionPrelude & { rest: string }) | undefined {
  const m = START_RE.exec(text)
  if (!m) return undefined
  const [first, version, integrity] = m
  const end = endLine(version)
  const at = text.indexOf('\n' + end, first.length - 1)
  if (at < 0) return undefined
  const source = text.slice(first.length, at + 1)
  if (sriSync(source) !== integrity) return undefined
  const block = text.slice(0, at + 1 + end.length)
  return { block, version, integrity, source, rest: text.slice(block.length) }
}

/** The PluginRef for an imported block: the registry's when it is that exact build, otherwise the block's own code. */
export function preludePluginRef(p: MotionPrelude): PluginRef {
  let reg: RegistryEntry | undefined
  try {
    reg = motionRegistryEntry()
  } catch {
    reg = undefined
  }
  if (reg && reg.integrity === p.integrity) return motionPluginRef()
  return { id: MOTION_PLUGIN_ID, name: MOTION_PLUGIN_ID, src: p.source, integrity: p.integrity, version: p.version }
}

/** The block toCode puts first: the imported one, while the sketch still uses that exact plugin. */
export function activePrelude(sketch: Sketch): string | undefined {
  const head = sketch.src?.head
  if (!head) return undefined
  const p = splitPrelude(head)
  const ref = findMotionPlugin(sketch)
  return p && ref && ref.integrity === p.integrity ? head : undefined
}
