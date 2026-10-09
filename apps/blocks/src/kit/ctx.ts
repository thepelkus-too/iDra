// Process-wide handles the components share. Set once in boot (tests set their own).
import { catalog, getAudioEngine, getLibrary, type AudioEngine, type Catalog, type Library, type Sketch } from '@hydra-ipad/core'
import { useEffect, useState } from 'preact/hooks'
import type { Runner } from './runner'
import { Store, type CommitOpts } from './store'

export interface Ctx {
  store: Store
  runner: Runner
  lib: Library
  audio: AudioEngine
  catalog: Catalog
}

export const ctx: Ctx = {
  store: undefined as unknown as Store,
  runner: undefined as unknown as Runner,
  lib: getLibrary(),
  audio: getAudioEngine(),
  catalog,
}

/** Apply a pure edit to the current sketch. */
export function edit(f: (s: Sketch) => Sketch, opts?: CommitOpts): void {
  const next = f(ctx.store.sketch)
  if (next !== ctx.store.sketch) ctx.store.commit(next, opts)
}

export function useStore() {
  const [, set] = useState(0)
  useEffect(() => ctx.store.subscribe(() => set((v) => v + 1)), [])
  return ctx.store
}

export function useRunner(): Runner {
  const [, set] = useState(0)
  useEffect(() => ctx.runner.subscribe(() => set((v) => v + 1)), [])
  return ctx.runner
}

/** Re-render when a plugin adds functions to the catalog. */
export function useCatalogVersion(): number {
  const [v, set] = useState(ctx.catalog.version)
  useEffect(() => ctx.catalog.subscribe(() => set(ctx.catalog.version)), [])
  return v
}
