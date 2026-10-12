// The kit's shared preview pool, with a guard around `handle.update()` (a Core change request in the README).
//
// Core's pool restarts nothing when an update leaves the plan's key unchanged, but `start()` checks the plan by object
// identity after awaiting the runtime, and every update makes a new plan object. <PreviewPeek> updates right after it
// opens, so the first preview of a cold pool is abandoned in `starting` and never draws. The guard drops updates that
// change nothing, and holds the others until the handle has left `starting`.
import { type PreviewHandle, type PreviewPool } from '@hydra-ipad/core'
import { kitPreviewPool } from '@hydra-ipad/kit'

type Next = Parameters<PreviewHandle['update']>[0]

function guard(h: PreviewHandle, first: { sketch: Next['sketch']; trusted: boolean }): PreviewHandle {
  let last: Next = { ...first, spec: h.spec }
  let pending: Next | undefined
  const flush = () => {
    if (!pending || h.state === 'starting') return
    const p = pending
    pending = undefined
    h.update(p)
  }
  h.onState(flush)
  const update = (next: Next) => {
    const changed = (Object.keys(next) as Array<keyof Next>).some((k) => next[k] !== undefined && next[k] !== last[k])
    if (!changed) return
    last = { ...last, ...next }
    pending = { ...pending, ...next }
    flush()
  }
  return new Proxy(h, { get: (t, k) => (k === 'update' ? update : Reflect.get(t, k)) })
}

let pool: PreviewPool | undefined

/** The editor's preview pool (the kit's shared one), handing out guarded handles. */
export function graphPreviewPool(): PreviewPool {
  if (pool) return pool
  const base = kitPreviewPool()
  pool = {
    open: (spec, ctx) => guard(base.open(spec, ctx), ctx),
    get stats() {
      return base.stats
    },
    get mode() {
      return base.mode
    },
    setMode: (m) => base.setMode(m),
    dispose: () => base.dispose(),
  }
  return pool
}
