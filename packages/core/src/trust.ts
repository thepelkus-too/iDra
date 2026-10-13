import { contentHash, contentString, type Sketch } from './ir'
import { parseKnob } from './motion-core'
import { isSafeExpression } from './safe-expr'
import { activeSketch } from './disable'
import { sriSync } from './sha256'
import type { Value } from './ir'

// "This sketch runs code. Run it?" — decides when the owner must say yes before a full run.
// `safe` runs (see codegen.toRunnable) skip everything listed here.

export interface RiskyPart {
  nodeId?: string
  kind: 'raw' | 'js-def' | 'unsafe-expression' | 'plugin' | 'source-args'
  /** short human-readable excerpt */
  excerpt: string
  /** complete text (what the fingerprint covers) */
  full: string
}

function unsafeValues(v: Value, out: Array<{ src: string }>) {
  if ((v.k === 'fn' || v.k === 'js') && !isSafeExpression(v.src)) out.push({ src: v.src })
  if (v.k === 'tex') {
    for (const c of [v.chain.gen, ...v.chain.mods]) for (const a of c.args) unsafeValues(a, out)
  }
}

/** The code that would run and needs approval. Disabled statements and modifiers never run, so they are not listed. */
export function riskyParts(input: Sketch): RiskyPart[] {
  const sketch = activeSketch(input)
  const parts: RiskyPart[] = []
  const mk = (nodeId: string | undefined, kind: RiskyPart['kind'], full: string, shown = full): RiskyPart => ({
    nodeId,
    kind,
    full,
    excerpt: shown.replace(/\s+/g, ' ').slice(0, 80),
  })
  for (const s of sketch.stmts) {
    if (s.k === 'raw') parts.push(mk(s.id, 'raw', s.code))
    else if (s.k === 'def') {
      // a knob's numbers and pads are plain data for the (separately approved) plugin: changing them is not new code
      if (s.value.k === 'js' && parseKnob(s.value)) parts.push(mk(s.id, 'js-def', `${s.name} = knob(…)`, `${s.name} = ${s.value.src}`))
      else if (s.value.k === 'js') parts.push(mk(s.id, 'js-def', `${s.name} = ${s.value.src}`))
      else {
        const bad: Array<{ src: string }> = []
        unsafeValues(s.value, bad)
        for (const b of bad) parts.push(mk(s.id, 'unsafe-expression', b.src))
      }
    } else if (s.k === 'chain') {
      const bad: Array<{ src: string }> = []
      for (const c of [s.chain.gen, ...s.chain.mods]) for (const a of c.args) unsafeValues(a, bad)
      for (const b of bad) parts.push(mk(s.id, 'unsafe-expression', b.src))
    } else if (s.k === 'source' && s.init.argsSrc !== undefined) {
      parts.push(mk(s.id, 'source-args', s.init.argsSrc))
    }
  }
  for (const p of sketch.plugins ?? []) parts.push(mk(undefined, 'plugin', p.name || p.url || p.id))
  return parts
}

/** Hash of exactly the risky content (the whole set at once). The trust gate itself compares piece by piece: `trustKeys`. */
export function trustFingerprint(sketch: Sketch): string {
  const parts = riskyParts(sketch).map((p) => [p.kind, p.full])
  const plugins = (sketch.plugins ?? []).map((p) => [p.id, p.url ?? null, p.src ?? null, p.integrity ?? null])
  return contentHash({ parts, plugins })
}

// a plugin's pasted source can be large and the gate runs on every edit: remember recent hashes
const keyCache = new Map<string, string>()
function keyOf(x: unknown): string {
  const s = contentString(x)
  let k = keyCache.get(s)
  if (k === undefined) {
    k = sriSync(s)
    if (keyCache.size > 500) keyCache.clear()
    keyCache.set(s, k)
  }
  return k
}

/**
 * One SHA-256 key per piece of code that needs approval: each risky part that runs (kind + complete text) and each plugin
 * (id, URL, pasted source, integrity). Approving a sketch stores these keys, and a later version runs without asking when
 * every key it has was approved: switching code off (`//`) or back on, or deleting it, never asks again; any new or changed
 * code does.
 */
export function trustKeys(sketch: Sketch): string[] {
  const keys = riskyParts(sketch)
    .filter((p) => p.kind !== 'plugin')
    .map((p) => keyOf(['part', p.kind, p.full]))
  for (const p of sketch.plugins ?? []) keys.push(keyOf(['plugin', p.id, p.url ?? null, p.src ?? null, p.integrity ?? null]))
  return keys
}

/** What the library stores for an approved sketch: every trust key the owner has said yes to. */
export interface TrustApproval {
  v: 2
  keys: string[]
}

/** Every piece of code that needs approval in `sketch` is among `approved`. */
export function trustCovered(sketch: Sketch, approved: Iterable<string>): boolean {
  const set = approved instanceof Set ? (approved as Set<string>) : new Set(approved)
  return trustKeys(sketch).every((k) => set.has(k))
}

/**
 * True when the sketch has raw statements, defs with arbitrary JS, expressions outside the safe subset or
 * plugins, and the owner has not approved all of that code (`approved` from the library: a `TrustApproval`, a set of
 * trust keys, or a fingerprint stored before approvals were per piece, which still matches exactly that content).
 */
export function needsTrustPrompt(sketch: Sketch, approved?: string | TrustApproval | Iterable<string> | null): boolean {
  if (riskyParts(sketch).length === 0) return false
  if (approved == null) return true
  if (typeof approved === 'string') return approved !== trustFingerprint(sketch)
  const record = (approved as TrustApproval).v === 2 ? (approved as TrustApproval) : undefined
  return !trustCovered(sketch, record ? record.keys : (approved as Iterable<string>))
}
