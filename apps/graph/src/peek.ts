// What a node's preview shows, as a core PreviewSpec (docs/previews-runtime.md). Pure, unit-tested.
import { walkChains, type PreviewSpec, type Sketch } from '@hydra-ipad/core'
import type { GNode } from './model'

/** Where call `id` sits: its chain and whether it is a modifier (A/B needs one). */
function chainOf(sk: Sketch, id: string): { chainId: string; mod: boolean; label: string } | undefined {
  for (const { chain } of walkChains(sk)) {
    const calls = [chain.gen, ...chain.mods]
    const i = calls.findIndex((c) => c.id === id)
    if (i >= 0) return { chainId: chain.id, mod: i > 0, label: calls.slice(0, i + 1).map((c) => c.fn).join(' → ') }
  }
  return undefined
}

/** The preview a node shows: up to a call, or (an output) the whole chain that writes it last; a diff for A/B on a modifier. */
export function previewSpecFor(sk: Sketch, n: GNode, ab = false): { spec: PreviewSpec; label: string; mod: boolean } | undefined {
  if (n.kind === 'call') {
    const at = chainOf(sk, n.id)
    if (!at) return undefined
    if (ab && at.mod) return { spec: { kind: 'diff', callId: n.id }, label: `${n.call!.fn}, before and after`, mod: true }
    return { spec: { kind: 'prefix', chainId: at.chainId, upToCallId: n.id }, label: at.label, mod: at.mod }
  }
  if (n.kind === 'out') {
    const writers = sk.stmts.filter((s) => s.k === 'chain' && !s.disabled && (s.chain.out === undefined ? 'o0' : s.chain.out) === n.name)
    const last = writers[writers.length - 1]
    if (!last || last.k !== 'chain') return undefined
    return { spec: { kind: 'prefix', chainId: last.chain.id }, label: `${n.name}`, mod: false }
  }
  return undefined
}
