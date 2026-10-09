/// <reference path="types.d.ts" />
import glslFunctions from 'hydra-synth/src/glsl/glsl-functions.js'
import { HINTS, heuristicHint, type Hint } from './hints'

export type FnType = 'src' | 'coord' | 'color' | 'combine' | 'combineCoord'
export type Position = 'gen' | 'mod'

export interface InputDef {
  name: string
  /** glsl type: float, vec4, sampler2D, or anything a plugin declares (vec2, vec3, int ...) */
  type: string
  /** catalog default; null/undefined for texture inputs. vec4 defaults are broadcast to an array. */
  default?: number | number[] | null
  /** true for the texture slot that combine/combineCoord functions take implicitly */
  implicit?: boolean
}

export interface FnDef {
  name: string
  type: FnType
  inputs: InputDef[]
  /** 'builtin' for functions from glsl-functions.js, 'plugin:<id>' for runtime-registered ones */
  origin: string
  glsl?: string
}

/** What the runtime reports after a `setFunction` call (inputs are the ones the author declared). */
export interface CatalogDelta {
  name: string
  type: string
  inputs: Array<{ name: string; type: string; default?: unknown }>
  origin: string
  glsl?: string
}

export const TEXTURE_INPUT_NAME = 'texture'

const VALID_TYPES: FnType[] = ['src', 'coord', 'color', 'combine', 'combineCoord']

export function isTexType(t: string): boolean {
  return t === 'sampler2D'
}

function normalizeDefault(type: string, d: unknown): number | number[] | null | undefined {
  if (d === undefined || d === null) return d as null | undefined
  if (type.startsWith('vec')) {
    const n = parseInt(type.slice(3), 10) || 4
    if (Array.isArray(d)) return d.map(Number)
    return Array(n).fill(Number(d))
  }
  if (typeof d === 'number') return d
  if (Array.isArray(d)) return d.map(Number)
  const n = Number(d)
  return isFinite(n) ? n : null
}

function toFnDef(raw: CatalogDelta, origin: string): FnDef | undefined {
  if (!VALID_TYPES.includes(raw.type as FnType)) return undefined
  const type = raw.type as FnType
  const inputs: InputDef[] = raw.inputs.map((i) => ({
    name: i.name,
    type: i.type,
    default: normalizeDefault(i.type, i.default),
  }))
  if (type === 'combine' || type === 'combineCoord') {
    inputs.unshift({ name: TEXTURE_INPUT_NAME, type: 'sampler2D', default: null, implicit: true })
  }
  return { name: raw.name, type, inputs, origin, glsl: raw.glsl }
}

export type CatalogListener = (change: { added: string[]; replaced: string[] }) => void

export class Catalog {
  private fns = new Map<string, FnDef>()
  private listeners = new Set<CatalogListener>()
  /** bumps on every refresh, so UIs can cheaply detect changes */
  version = 0

  constructor(delta: CatalogDelta[] = []) {
    this.refresh(delta, { silent: true })
  }

  /** Build a catalog from hydra-synth's own function table. */
  static fromHydra(): Catalog {
    const raw = glslFunctions()
    return new Catalog(raw.map((f) => ({ ...f, origin: 'builtin' })))
  }

  has(name: string): boolean {
    return this.fns.has(name)
  }
  get(name: string): FnDef | undefined {
    return this.fns.get(name)
  }
  list(type?: FnType | 'gen' | 'mod'): FnDef[] {
    const all = [...this.fns.values()]
    if (!type) return all
    if (type === 'gen') return all.filter((f) => f.type === 'src')
    if (type === 'mod') return all.filter((f) => f.type !== 'src')
    return all.filter((f) => f.type === type)
  }
  names(): string[] {
    return [...this.fns.keys()]
  }
  /** Group by origin for pickers: builtin first, then each plugin under its own group. */
  groups(): Array<{ origin: string; fns: FnDef[] }> {
    const by = new Map<string, FnDef[]>()
    for (const f of this.fns.values()) {
      const arr = by.get(f.origin) ?? []
      arr.push(f)
      by.set(f.origin, arr)
    }
    return [...by.entries()]
      .sort(([a], [b]) => (a === 'builtin' ? -1 : b === 'builtin' ? 1 : a.localeCompare(b)))
      .map(([origin, fns]) => ({ origin, fns }))
  }
  position(name: string): Position | undefined {
    const f = this.fns.get(name)
    if (!f) return undefined
    return f.type === 'src' ? 'gen' : 'mod'
  }
  inputs(name: string): InputDef[] {
    return this.fns.get(name)?.inputs ?? []
  }
  /** Index of the texture slot for combine/combineCoord/src, else -1. */
  textureIndex(name: string): number {
    return this.inputs(name).findIndex((i) => isTexType(i.type))
  }

  /** UI range for an input: explicit hint → name fallback → heuristic from the default. */
  hint(fn: string, input: string): Hint {
    const direct = HINTS[`${fn}.${input}`]
    if (direct) return direct
    const f = this.fns.get(fn)
    const def = f?.inputs.find((i) => i.name === input)?.default
    // plugin/unhinted inputs: heuristic around the default; builtin name-fallbacks only for builtins
    if (f?.origin === 'builtin') {
      const generic = HINTS[`*.${input}`]
      if (generic) return generic
    }
    return heuristicHint(typeof def === 'number' ? def : Array.isArray(def) ? def[0] : undefined)
  }
  hasExplicitHint(fn: string, input: string): boolean {
    return !!HINTS[`${fn}.${input}`]
  }

  /**
   * Apply the transforms a runtime reports (plugin `setFunction` calls). Existing names are replaced,
   * so a plugin can override a builtin; `origin` then changes to `plugin:<id>`.
   */
  refresh(delta: CatalogDelta[], opts: { silent?: boolean } = {}): void {
    if (!delta || delta.length === 0) return
    const added: string[] = []
    const replaced: string[] = []
    for (const d of delta) {
      const def = toFnDef(d, d.origin || 'builtin')
      if (!def) continue
      if (this.fns.has(def.name)) replaced.push(def.name)
      else added.push(def.name)
      this.fns.set(def.name, def)
    }
    if (added.length === 0 && replaced.length === 0) return
    this.version++
    if (!opts.silent) for (const cb of [...this.listeners]) cb({ added, replaced })
  }

  /** Remove everything a plugin registered (used when a plugin is unloaded). */
  removeOrigin(origin: string): void {
    let any = false
    for (const [k, v] of this.fns) {
      if (v.origin === origin) {
        this.fns.delete(k)
        any = true
      }
    }
    if (any) {
      this.version++
      for (const cb of [...this.listeners]) cb({ added: [], replaced: [] })
    }
  }

  subscribe(cb: CatalogListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
}

/** Process-wide default catalog. Editors share it so a runtime-reported plugin shows up everywhere. */
export const catalog = Catalog.fromHydra()
