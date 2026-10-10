// iDra's side of hydra-motion (packages/motion, MIT): IR helpers for knobs, the plugin's registry entry, and the inlined
// "self-contained" block. The plugin is consumed only through its public surface, the built file and docs/motion.md, the
// same way as any third-party plugin; nothing here imports the package's source.
// Kept free of UI and runtime imports: the parser and codegen use it.

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

const NUM = '-?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?'
const KNOB_RE = new RegExp(`^knob\\(\\s*(${NUM})\\s*\\)$`, 'i')

/**
 * A `def` holding a knob: `name = knob(<initial>)`. The value is the `js` expression the importer produces for that text,
 * so it round-trips. It is a bare assignment (not `const`) so the knob is a global of the sketch, the name
 * `runtime.invoke` (and a person typing `k.hold(1)`) reaches, also inside the async wrapper used for `await`.
 */
export function knobDef(name: string, initial: number): DefStmt {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`"${name}" is not a variable name`)
  return { id: newId('s'), k: 'def', name, decl: 'bare', value: { k: 'js', src: `knob(${Number.isFinite(initial) && !Object.is(initial, -0) ? String(initial) : '0'})` } }
}

/** The initial number of a `knob(<n>)` value, or undefined. */
export function knobInitial(v: Value): number | undefined {
  if (v.k !== 'js' && v.k !== 'fn') return undefined
  const m = KNOB_RE.exec(v.src.trim())
  return m ? Number(m[1]) : undefined
}

/** Inverse of knobDef: `{ name, initial, decl }` for a def holding exactly `knob(<n>)`, else undefined. */
export function parseKnobDef(s: Stmt): { name: string; initial: number; decl: DefStmt['decl'] } | undefined {
  if (s.k !== 'def') return undefined
  const initial = knobInitial(s.value)
  return initial === undefined ? undefined : { name: s.name, initial, decl: s.decl }
}

/** Every knob def in a sketch. */
export function knobDefs(sketch: Sketch): Array<{ stmtId: string; name: string; initial: number; decl: DefStmt['decl'] }> {
  const out: Array<{ stmtId: string; name: string; initial: number; decl: DefStmt['decl'] }> = []
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
