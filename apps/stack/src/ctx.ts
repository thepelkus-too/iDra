// Process-wide handles the components share. Set once in main.tsx (tests set their own).
import { catalog, getAudioEngine, getLibrary, type AudioEngine, type BackdropController, type BackdropState, type Catalog, type Library, type Sketch } from '@hydra-ipad/core'
import { setKitHost, type History } from '@hydra-ipad/kit'
import { useEffect, useState } from 'preact/hooks'
import type { Runner } from './runner'
import { Store, type CommitOpts } from './store'

export interface Ctx {
  store: Store
  runner: Runner
  lib: Library
  audio: AudioEngine
  catalog: Catalog
  /** full-background preview (absent in unit tests: the preview is then a panel) */
  backdrop?: BackdropController
}

export const ctx: Ctx = {
  store: undefined as unknown as Store,
  runner: undefined as unknown as Runner,
  lib: getLibrary(),
  audio: getAudioEngine(),
  catalog,
}

// the kit edits through the store like everything else; its popovers, sheets and pads follow the document
setKitHost({
  app: 'stack',
  sketch: () => ctx.store.sketch,
  commit: (next, opts) => ctx.store.commit(next, opts),
  endGroup: () => ctx.store.endGroup(),
  subscribe: (cb) => (ctx.store ? ctx.store.subscribe(cb) : () => {}),
  invoke: (name, method, args) => ctx.runner?.rt?.invoke(name, method, args) ?? false,
  trusted: () => !!ctx.runner && !ctx.runner.trust.pending,
  approveOnce: () => ctx.runner?.approveOnce(),
})

/** What the undo taps and ⌘Z / ⌘Enter act on. */
export const history = (): History => ({ undo: () => ctx.store.undo(), redo: () => ctx.store.redo(), run: () => ctx.runner.run(true) })

/** Apply a pure edit to the current sketch. */
export function edit(f: (s: Sketch) => Sketch, opts?: CommitOpts): void {
  const next = f(ctx.store.sketch)
  if (next !== ctx.store.sketch) ctx.store.commit(next, opts)
}

/** Re-render the calling component whenever the store changes (animation-frame coalesced). */
export function useStore(): Store {
  const [, set] = useState(0)
  useEffect(() => ctx.store.subscribe(() => set((v) => v + 1)), [])
  return ctx.store
}

export function useRunner(): Runner {
  const [, set] = useState(0)
  useEffect(() => ctx.runner.subscribe(() => set((v) => v + 1)), [])
  return ctx.runner
}

/** The preview placement and veil, re-rendering on change. */
export function useBackdrop(): BackdropState {
  const [, set] = useState(0)
  useEffect(() => ctx.backdrop?.subscribe(() => set((v) => v + 1)), [])
  return ctx.backdrop?.state ?? { placement: 'panel', veil: 'medium' }
}
