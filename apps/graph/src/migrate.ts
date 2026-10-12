// Old sketches: before core had a `disabled` flag, the graph "bypassed" a node by taking it out of the code and keeping it
// whole in `meta.graph.bypass` with the call it followed. On first open such a node goes back into its chain as a
// switched-off call (a `// .rotate()` line, so vanilla Hydra sees it too) and the old key is removed. Pure.
import { chainToCode, newId, setMeta, type Call, type Chain, type Sketch, type Stmt } from '@hydra-ipad/core'
import { APP } from './app'

interface Bypassed {
  call: Call
  after: string | null
}

/** Put `call` (switched off) right after call `after` in a top-level chain; undefined when `after` is not one of those. */
function insertAfter(stmts: Stmt[], after: string, call: Call): Stmt[] | undefined {
  const inChain = (c: Chain): Chain | undefined => {
    const i = c.gen.id === after ? 0 : c.mods.findIndex((m) => m.id === after) + 1
    if (i === 0 && c.gen.id !== after) return undefined
    const mods = c.mods.slice()
    mods.splice(i, 0, { ...call, disabled: true })
    return { ...c, mods }
  }
  for (let k = 0; k < stmts.length; k++) {
    const s = stmts[k]
    let next: Stmt | undefined
    if (s.k === 'chain') {
      const c = inChain(s.chain)
      if (c) next = { ...s, chain: c }
    } else if (s.k === 'def' && s.value.k === 'tex') {
      const c = inChain(s.value.chain)
      if (c) next = { ...s, value: { ...s.value, chain: c } }
    }
    if (next) {
      const out = stmts.slice()
      out[k] = next
      return out
    }
  }
  return undefined
}

/** The call as the comment a stranded bypassed node becomes (its neighbour is gone or sits inside a texture argument). */
function asComment(call: Call): Stmt {
  const code = chainToCode({ id: newId('h'), gen: { ...call, src: undefined }, mods: [] }, { fresh: true }).replace(/\s*\n\s*/g, ' ')
  return { id: newId('s'), k: 'comment', text: `bypassed in the graph, its neighbour is gone: .${code}` }
}

/**
 * Turn `meta.graph.bypass` into switched-off calls. Returns the same sketch when there is nothing to migrate. A bypassed
 * node whose neighbour no longer exists, or follows a call inside a texture argument (written on one line, where a
 * `//` line can't go), is kept as a comment rather than dropped.
 */
export function migrateBypass(sketch: Sketch): Sketch {
  const meta = sketch.meta?.[APP] as (Record<string, unknown> & { bypass?: Record<string, Bypassed> }) | undefined
  if (!meta || !('bypass' in meta)) return sketch
  let stmts = sketch.stmts
  const pending = new Map(Object.entries(meta.bypass ?? {}))
  // a bypassed node can follow another bypassed node: insert in passes until nothing moves
  for (let moved = true; moved && pending.size; ) {
    moved = false
    for (const [id, b] of pending) {
      if (b.after === null) continue
      const next = insertAfter(stmts, b.after, { ...b.call, id })
      if (!next) continue
      stmts = next
      pending.delete(id)
      moved = true
    }
  }
  for (const b of pending.values()) stmts = [...stmts, asComment(b.call)]
  const { bypass: _b, ...rest } = meta
  void _b
  return setMeta({ ...sketch, stmts }, APP, rest)
}
