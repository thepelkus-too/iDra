// Switching nodes off and on, the graph's way round core's rules (core/disable.ts). Pure, unit-tested.
//
// A node is a call (one of possibly several written copies) or a statement. What the `//` toggle on a node switches:
//   * a modifier: that call (and its copies, so every place it is written agrees);
//   * a generator: its whole chain statement (core refuses a generator alone; in a graph the generator stands for the chain);
//   * anything inside a switched-off statement: that statement, so the toggle switches back on what the node shows as off;
//   * a call inside a texture argument: itself; core refuses it and the toggle explains, offering the call taking it.
import { locate, setDisabled, walkChains, type Sketch, type Stmt } from '@hydra-ipad/core'
import type { GNode } from './model'

export interface OffTarget {
  /** the statement or call id the toggle switches */
  id: string
  /** what it is, for the toggle's accessible name ("rotate", "the o1 chain") */
  what: string
}

function stmtWhat(s: Stmt): string {
  switch (s.k) {
    case 'chain':
      return s.chain.out === null ? 'the chain' : `the ${s.chain.out ?? 'o0'} chain`
    case 'def':
      return `"${s.name}"`
    case 'source':
      return `the ${s.slot} source`
    case 'setting':
      return s.name
    case 'render':
      return 'render()'
    default:
      return 'this'
  }
}

/** What the `//` toggle on node `n` switches, or undefined for nodes that never switch (outputs, modulators, notes, raw code). */
export function offTarget(sketch: Sketch, n: GNode): OffTarget | undefined {
  if (n.kind === 'call') {
    const at = locate(sketch, n.id)
    if (!at?.call) return undefined
    if (at.stmt.disabled || (at.position === 'gen' && !at.nested)) return { id: at.stmt.id, what: stmtWhat(at.stmt) }
    return { id: n.id, what: at.call.fn }
  }
  if (n.kind === 'def' || n.kind === 'source' || n.kind === 'setting' || n.kind === 'render') return { id: n.id, what: stmtWhat(n.stmt!) }
  return undefined
}

/**
 * A node written more than once (`meta.graph.links`: copy id → node id) is switched as one: after switching `nodeId`,
 * give its copies the same flag. Copies core refuses to switch (inside a texture argument) keep theirs.
 */
export function syncCopies(sketch: Sketch, links: Record<string, string>, nodeId: string): Sketch {
  const want = !!locate(sketch, nodeId)?.call?.disabled
  let out = sketch
  for (const [copy, orig] of Object.entries(links)) {
    if (orig !== nodeId) continue
    const at = locate(out, copy)
    if (at?.call && !!at.call.disabled !== want) out = setDisabled(out, copy, want)
  }
  return out
}

/**
 * Switched-off chunks that came from commented-out code (the importer revives `// .rotate(1)` lines and `//`-commented
 * statements as disabled nodes), as opposed to ones switched off in an editor: a revived call keeps the comment opener it
 * was read with (`src.lead`), a revived statement's original text is the comment.
 */
export function revivedCount(sketch: Sketch): number {
  let n = 0
  for (const s of sketch.stmts) if (s.disabled && s.src?.text.startsWith('//')) n++
  for (const { chain } of walkChains(sketch)) for (const m of chain.mods) if (m.disabled && m.src?.lead !== undefined) n++
  return n
}
