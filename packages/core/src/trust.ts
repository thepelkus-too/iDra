import { contentHash, type Sketch } from './ir'
import { isSafeExpression } from './safe-expr'
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

export function riskyParts(sketch: Sketch): RiskyPart[] {
  const parts: RiskyPart[] = []
  const mk = (nodeId: string | undefined, kind: RiskyPart['kind'], full: string): RiskyPart => ({
    nodeId,
    kind,
    full,
    excerpt: full.replace(/\s+/g, ' ').slice(0, 80),
  })
  for (const s of sketch.stmts) {
    if (s.k === 'raw') parts.push(mk(s.id, 'raw', s.code))
    else if (s.k === 'def') {
      if (s.value.k === 'js') parts.push(mk(s.id, 'js-def', `${s.name} = ${s.value.src}`))
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

/** Hash of exactly the risky content. Approving a sketch stores this; any change to risky code invalidates it. */
export function trustFingerprint(sketch: Sketch): string {
  const parts = riskyParts(sketch).map((p) => [p.kind, p.full])
  const plugins = (sketch.plugins ?? []).map((p) => [p.id, p.url ?? null, p.src ?? null, p.integrity ?? null])
  return contentHash({ parts, plugins })
}

/**
 * True when the sketch has raw statements, defs with arbitrary JS, expressions outside the safe subset or
 * plugins, and the owner has not approved this exact content (`approvedFingerprint` from the library).
 */
export function needsTrustPrompt(sketch: Sketch, approvedFingerprint?: string | null): boolean {
  if (riskyParts(sketch).length === 0) return false
  return approvedFingerprint !== trustFingerprint(sketch)
}
