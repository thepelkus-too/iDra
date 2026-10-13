// Which row's chunk preview is open under it (one at a time: the pool only has a couple of runtimes).
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
