// What the kit needs from the editor it runs in, registered once at boot (each editor's ctx.ts). The kit edits the sketch
// only through `commit`, the same store every other edit goes through, so undo, autosave and the preview behave as usual.
import { appStorage, type AppStorage, type MotionMethod, type Sketch } from '@hydra-ipad/core'
import { useEffect, useState } from 'preact/hooks'
import { setOverlaySource } from './overlay'

export interface KitHost {
  /** the editor's name (`stack`, `graph`, …): kit preferences go to `appStorage(app)` */
  app: string
  sketch(): Sketch
  /** an undoable edit; `view` = saved but not undoable and no re-run (pad layout); `coalesce` merges a gesture */
  commit(next: Sketch, opts?: { view?: boolean; coalesce?: string }): void
  /** end a coalesced gesture */
  endGroup?(): void
  /** the store's change subscription (popovers, sheets and the pad dock follow it) */
  subscribe(cb: () => void): () => void
  /** runtime.invoke on the running sketch (a pad press) */
  invoke(name: string, method: MotionMethod, args: Array<number | string>): boolean
  /** the sketch runs its code (not safe mode): pads are inert until then */
  trusted(): boolean
  /** run the current content as trusted once (after the owner's own bind on an already trusted sketch) */
  approveOnce?(): void
}

let host: KitHost | undefined
const listeners = new Set<() => void>()

export function setKitHost(h: KitHost): void {
  host = h
  setOverlaySource((cb) => h.subscribe(cb))
  listeners.forEach((l) => l())
}

export function kitHost(): KitHost | undefined {
  return host
}

/** Kit preferences of the current editor (last number-editor tab, glide duration and curve, …). */
export function kitPrefs(): AppStorage {
  return appStorage(host?.app ?? 'kit')
}

/** Re-render on every store change (and when the host is set). */
export function useHost(): KitHost | undefined {
  const [, set] = useState(0)
  useEffect(() => {
    const bump = () => set((v) => v + 1)
    listeners.add(bump)
    const un = host?.subscribe(bump)
    return () => {
      listeners.delete(bump)
      un?.()
    }
  }, [])
  return host
}
