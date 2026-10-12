// Which row's chunk preview is open under it (one at a time: the pool only has a couple of runtimes).
import type { PreviewHandle, PreviewPool, PreviewSpec, Sketch } from '@hydra-ipad/core'
import { kitPreviewPool } from '@hydra-ipad/kit'
import { useEffect, useState } from 'preact/hooks'

export interface OpenPeek {
  /** the call whose row shows the peek */
  callId: string
  chainId: string
  /** prefix: "up to here"; diff: before/after this modifier (A/B) */
  kind: 'prefix' | 'diff'
}

let current: OpenPeek | undefined
const listeners = new Set<() => void>()

export function openPeek(): OpenPeek | undefined {
  return current
}

export function setPeek(p: OpenPeek | undefined): void {
  current = p
  listeners.forEach((l) => l())
}

/** Open `p`, or close it when that exact peek is already open. */
export function togglePeek(p: OpenPeek): void {
  setPeek(current && current.callId === p.callId && current.kind === p.kind ? undefined : p)
}

export function usePeek(): OpenPeek | undefined {
  const [, bump] = useState(0)
  useEffect(() => {
    const l = () => bump((v) => v + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  return current
}

// ---------------------------------------------------------------- the pool, with a workaround for a core race

type Update = Parameters<PreviewHandle['update']>[0]

/**
 * A handle whose `update()` waits while it is `starting`. Core's pool compares plans by identity after awaiting the
 * runtime, and every `update()` makes a new plan (same key), so the update PreviewPeek sends right after opening leaves a
 * cold pool's first preview in `starting` forever (Core change request in the README: compare `plan.key`).
 */
export function deferWhileStarting(h: PreviewHandle): PreviewHandle {
  let pending: Update | undefined
  const off = h.onState(() => {
    if (h.state === 'starting' || !pending) return
    const p = pending
    pending = undefined
    h.update(p)
  })
  return new Proxy(h, {
    get(t, k) {
      if (k === 'update')
        return (o: Update) => {
          if (t.state === 'starting') pending = { ...pending, ...o }
          else t.update(o)
        }
      if (k === 'close')
        return () => {
          off()
          t.close()
        }
      const v = Reflect.get(t, k, t)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
}

let pool: PreviewPool | undefined

/** The kit's shared pool, handing out handles that defer updates while starting. */
export function stackPreviewPool(): PreviewPool {
  pool ??= new Proxy(kitPreviewPool(), {
    get(t, k) {
      if (k === 'open') return (spec: PreviewSpec, c: { sketch: Sketch; trusted: boolean }) => deferWhileStarting(t.open(spec, c))
      const v = Reflect.get(t, k, t)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
  return pool
}
