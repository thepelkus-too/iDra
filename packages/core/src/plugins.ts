// Plugins (Hydra extensions) on the HOST side: the curated registry, the owner's installed list, fetching + hashing for
// the "show the URL and a hash before first enabling" step, sketch helpers, and an event when a runtime has loaded one.
// Plugin code itself is only ever evaluated inside the sandboxed runtime frame (runtime.loadPlugin), never in this page.

import registryJson from '../plugins/registry.json'
import { openSimpleStore, type SimpleStore } from './idb-store'
import type { PluginRef, Sketch, Stmt } from './ir'
import { loadScriptUrls, pluginIdFromUrl } from './plugin-id'
import { getScriptCache, integrityOf, isPinnedScriptUrl, sha256Hex, type ScriptCache } from './runtime/script-cache'

export { pluginIdFromUrl, loadScriptUrls } from './plugin-id'

// ------------------------------------------------------------------ registry

export interface RegistryEntry {
  id: string
  name: string
  author: string
  license: string
  homepage: string
  url: string
  version: string
  /** `functions`: registers Hydra functions; `js`: only adds globals; `mixed`: both */
  kind: 'functions' | 'js' | 'mixed'
  description: string
  verified: { status: 'verified' | 'unverified'; checked: string; how: string }
}

/** The curated list in `packages/core/plugins/registry.json`. */
export function pluginRegistry(): RegistryEntry[] {
  return (registryJson as { plugins: RegistryEntry[] }).plugins.map((e) => ({ ...e }))
}
export function registryEntryForUrl(url: string): RegistryEntry | undefined {
  return pluginRegistry().find((e) => e.url === url)
}

/** Version from a CDN URL (`hydra-midi@0.4.6` → `0.4.6`, `@latest` → `latest`). */
export function versionFromUrl(url: string): string | undefined {
  const m = /@((?:v?\d+\.\d+\.\d+[\w.+-]*)|latest|[0-9a-f]{7,40})(?=\/|$)/i.exec(url)
  return m ? m[1] : undefined
}

// ------------------------------------------------------------------ installed plugins

export interface InstalledPlugin {
  id: string
  name: string
  url?: string
  /** pasted code */
  src?: string
  /** hex SHA-256 of the content the owner approved */
  hash?: string
  integrity?: string
  size: number
  version?: string
  /** false for `@latest` / unversioned URLs (they revalidate online and may change) */
  pinned: boolean
  registryId?: string
  verified?: 'verified' | 'unverified'
  /** filled in after a runtime loaded it: functions it registered, globals it added, built-ins it replaced */
  functions?: string[]
  globals?: string[]
  shadows?: string[]
  lastError?: string
  addedAt: number
  loadedAt?: number
}

/** What the owner sees before installing: URL, size, version, hash, pinning, registry verification. */
export interface PluginPreview {
  id: string
  name: string
  url?: string
  src: string
  size: number
  hash?: string
  integrity?: string
  version?: string
  pinned: boolean
  from: 'network' | 'cache' | 'pasted'
  registry?: RegistryEntry
  warning?: string
}

export class PluginStore {
  private storeP?: Promise<SimpleStore<InstalledPlugin>>
  private listeners = new Set<() => void>()
  constructor(private opts: { indexedDB?: IDBFactory; cache?: ScriptCache } = {}) {}
  private store() {
    return (this.storeP ??= openSimpleStore<InstalledPlugin>('hydra-ipad-plugins', 'plugins', this.opts.indexedDB ?? (globalThis as any).indexedDB))
  }
  get cache(): ScriptCache {
    return this.opts.cache ?? getScriptCache()
  }
  async list(): Promise<InstalledPlugin[]> {
    return (await (await this.store()).all()).sort((a, b) => a.name.localeCompare(b.name))
  }
  async get(id: string): Promise<InstalledPlugin | undefined> {
    return (await this.store()).get(id)
  }
  async put(p: InstalledPlugin): Promise<void> {
    await (await this.store()).put(p.id, p)
    this.emit()
  }
  async remove(id: string): Promise<void> {
    await (await this.store()).delete(id)
    this.emit()
  }
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private emit() {
    for (const cb of [...this.listeners]) cb()
  }

  /** Fetch (through the offline cache) and describe a URL plugin without running it. */
  async preview(url: string, o: { refresh?: boolean } = {}): Promise<PluginPreview> {
    const clean = url.trim()
    if (!/^https?:\/\//i.test(clean) && !/^\.{0,2}\//.test(clean)) throw new Error('Enter an http(s) URL of a script (jsDelivr, unpkg, raw GitHub …).')
    const abs = new URL(clean, typeof location !== 'undefined' ? location.href : 'https://x.invalid/').href
    const r = await this.cache.get(abs, o)
    const reg = registryEntryForUrl(abs)
    const pinned = isPinnedScriptUrl(abs)
    return {
      id: reg?.id ?? pluginIdFromUrl(abs),
      name: reg?.name ?? pluginIdFromUrl(abs),
      url: abs,
      src: r.text,
      size: r.text.length,
      hash: r.hash ?? (await sha256Hex(r.text)),
      integrity: pinned ? await integrityOf(r.text) : undefined,
      version: reg?.version ?? versionFromUrl(abs),
      pinned,
      from: r.from,
      registry: reg,
      warning: r.warning,
    }
  }
  /** Describe pasted code. */
  async previewSource(src: string, name: string): Promise<PluginPreview> {
    const id = 'pasted-' + (name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin')
    return { id, name: name.trim() || 'pasted plugin', src, size: src.length, hash: await sha256Hex(src), integrity: await integrityOf(src), pinned: true, from: 'pasted' }
  }
  /** Install what the owner has seen in the preview. */
  async install(p: PluginPreview): Promise<InstalledPlugin> {
    const prev = await this.get(p.id)
    const rec: InstalledPlugin = {
      ...(prev ?? {}),
      id: p.id,
      name: p.name,
      url: p.url,
      src: p.from === 'pasted' ? p.src : undefined,
      hash: p.hash,
      integrity: p.integrity,
      size: p.size,
      version: p.version,
      pinned: p.pinned,
      registryId: p.registry?.id,
      verified: p.registry?.verified.status,
      addedAt: prev?.addedAt ?? Date.now(),
    }
    await this.put(rec)
    return rec
  }
  /** Record what a runtime reported after loading a plugin (see `onPluginLoaded`). */
  async record(id: string, info: { functions?: string[]; globals?: string[]; shadows?: string[]; error?: string; hash?: string }): Promise<void> {
    const p = await this.get(id)
    if (!p) return
    await this.put({
      ...p,
      functions: info.functions ?? p.functions,
      globals: info.globals ?? p.globals,
      shadows: info.shadows ?? p.shadows,
      lastError: info.error,
      loadedAt: info.error ? p.loadedAt : Date.now(),
    })
  }
}

let shared: PluginStore | undefined
export function getPluginStore(): PluginStore {
  if (!shared) {
    shared = new PluginStore()
    // keep the installed list's "functions it added" current from any runtime on this page
    onPluginLoaded((e) => void shared!.record(e.id, e).catch(() => {}))
  }
  return shared
}
export function setPluginStore(s: PluginStore | undefined) {
  shared = s
}

/** The PluginRef a sketch carries for an installed plugin. */
export function pluginRefFor(p: Pick<InstalledPlugin, 'id' | 'name' | 'url' | 'src' | 'integrity' | 'version'>): PluginRef {
  const ref: PluginRef = { id: p.id, name: p.name }
  if (p.url) ref.url = p.url
  if (p.src !== undefined) ref.src = p.src
  if (p.integrity) ref.integrity = p.integrity
  if (p.version) ref.version = p.version
  return ref
}

// ------------------------------------------------------------------ sketch helpers

/** `await loadScript('<url>')` calls in a sketch's raw statements (imported text keeps them as raw, byte-for-byte). */
export function findLoadScripts(sketch: Sketch): Array<{ stmtId: string; url: string; inPlugins: boolean }> {
  const out: Array<{ stmtId: string; url: string; inPlugins: boolean }> = []
  const have = new Set((sketch.plugins ?? []).map((p) => p.url).filter(Boolean))
  for (const s of sketch.stmts) {
    if (s.k !== 'raw') continue
    for (const url of loadScriptUrls(s.code)) out.push({ stmtId: s.id, url, inPlugins: have.has(url) })
  }
  return out
}

/** True when a raw statement already loads this URL (then toCode does not add another `loadScript` line). */
export function sketchLoadsUrl(stmts: Stmt[], url: string): boolean {
  return stmts.some((s) => s.k === 'raw' && loadScriptUrls(s.code).includes(url))
}

export function withPlugin(sketch: Sketch, ref: PluginRef): Sketch {
  const list = (sketch.plugins ?? []).filter((p) => p.id !== ref.id)
  return { ...sketch, plugins: [...list, ref] }
}
export function withoutPlugin(sketch: Sketch, id: string): Sketch {
  const list = (sketch.plugins ?? []).filter((p) => p.id !== id)
  const next: Sketch = { ...sketch, plugins: list }
  if (!list.length) delete next.plugins
  return next
}
/** "Add to plugins" for a `loadScript` line already in the sketch: caches it for offline use; the line stays as it is. */
export function pluginRefFromUrl(url: string): PluginRef {
  const reg = registryEntryForUrl(url)
  const ref: PluginRef = { id: reg?.id ?? pluginIdFromUrl(url), name: reg?.name ?? pluginIdFromUrl(url), url }
  const v = reg?.version ?? versionFromUrl(url)
  if (v) ref.version = v
  return ref
}

// ------------------------------------------------------------------ load events (runtime → manager)

export interface PluginLoadedEvent {
  id: string
  url?: string
  hash?: string
  functions: string[]
  globals: string[]
  shadows: string[]
  error?: string
  from?: string
}
const loadedListeners = new Set<(e: PluginLoadedEvent) => void>()
/** Fired by every runtime on this page after it loaded (or failed to load) a plugin. */
export function onPluginLoaded(cb: (e: PluginLoadedEvent) => void): () => void {
  loadedListeners.add(cb)
  return () => loadedListeners.delete(cb)
}
export function emitPluginLoaded(e: PluginLoadedEvent): void {
  for (const cb of [...loadedListeners]) {
    try {
      cb(e)
    } catch {
      /* ignore */
    }
  }
}
