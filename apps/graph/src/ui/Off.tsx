// The `//` toggle on a node, and the one-time note about commented-out code that came back as switched-off nodes.
import { DisableToggle } from '@hydra-ipad/kit'
import { metaNow } from '../doc'
import { ctx, useStore } from '../kit/ctx'
import type { GNode } from '../model'
import { offTarget, revivedCount, syncCopies } from '../off'

/** The kit's `//` toggle for what this node switches (off.ts); nothing for nodes that never switch. */
export function NodeOff({ n }: { n: GNode }) {
  const sk = ctx.store.sketch
  const t = offTarget(sk, n)
  if (!t) return null
  const commit = (next: typeof sk) => ctx.store.commit(t.id === n.id && n.kind === 'call' ? syncCopies(next, metaNow(next).links ?? {}, n.id) : next)
  return (
    <span class="noff" data-testid="node-off" data-target={t.id}>
      <DisableToggle id={t.id} what={t.what} sketch={sk} onChange={commit} />
    </span>
  )
}

/** "N commented-out chunks were revived as disabled": once per sketch, until dismissed (remembered in the view state). */
export function RevivedNote() {
  useStore()
  const sk = ctx.store.sketch
  const n = revivedCount(sk)
  if (n <= (metaNow(sk).revivedSeen ?? 0)) return null
  return (
    <div class="banner info revived" role="status" data-testid="revived-note">
      <span>
        {n} commented-out chunk{n > 1 ? 's were' : ' was'} revived as disabled. Tap a node's <code>//</code> to switch it on.
      </span>
      <button type="button" class="btn sm" data-testid="revived-dismiss" onClick={() => ctx.store.setView({ revivedSeen: n })}>
        OK
      </button>
    </div>
  )
}
