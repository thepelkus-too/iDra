import { toCode } from './codegen'
import { importText } from './parse'
import { contentHash, newId, type Sketch } from './ir'
import { needsTrustPrompt, trustFingerprint } from './trust'
import { starters } from './starters'

// The shared sketch library. Every app on the origin reads and writes the same one.
// Backends, in order of preference: IndexedDB → localStorage → memory (private browsing).

export interface LibraryEntry {
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  /** small JPEG data URL */
  thumbnail?: string
  /** chains / raw count for list UIs */
  summary?: { stmts: number; raw: number }
}

export interface Revision {
  at: number
  sketch: Sketch
}

export type StoreName = 'sketches' | 'entries' | 'revisions' | 'trust' | 'kv'
const STORES: StoreName[] = ['sketches', 'entries', 'revisions', 'trust', 'kv']

export interface KV {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory'
  get<T>(store: StoreName, key: string): Promise<T | undefined>
  put(store: StoreName, key: string, value: unknown): Promise<void>
  delete(store: StoreName, key: string): Promise<void>
  keys(store: StoreName): Promise<string[]>
  all<T>(store: StoreName): Promise<T[]>
  close?(): void
}

// ------------------------------------------------------------------ backends

class MemoryKV implements KV {
  readonly kind = 'memory' as const
  private m = new Map<string, Map<string, unknown>>()
  private s(store: string) {
    let x = this.m.get(store)
    if (!x) this.m.set(store, (x = new Map()))
    return x
  }
  async get<T>(store: StoreName, key: string) {
    const v = this.s(store).get(key)
    return v === undefined ? undefined : (structuredClone(v) as T)
  }
  async put(store: StoreName, key: string, value: unknown) {
    this.s(store).set(key, structuredClone(value))
  }
  async delete(store: StoreName, key: string) {
    this.s(store).delete(key)
  }
  async keys(store: StoreName) {
    return [...this.s(store).keys()]
  }
  async all<T>(store: StoreName) {
    return [...this.s(store).values()].map((v) => structuredClone(v) as T)
  }
}

class LocalStorageKV implements KV {
  readonly kind = 'localstorage' as const
  constructor(private ls: Storage, private prefix = 'hydra-lib/') {}
  private k(store: string, key: string) {
    return `${this.prefix}${store}/${key}`
  }
  async get<T>(store: StoreName, key: string) {
    const raw = this.ls.getItem(this.k(store, key))
    return raw === null ? undefined : (JSON.parse(raw) as T)
  }
  async put(store: StoreName, key: string, value: unknown) {
    this.ls.setItem(this.k(store, key), JSON.stringify(value))
  }
  async delete(store: StoreName, key: string) {
    this.ls.removeItem(this.k(store, key))
  }
  async keys(store: StoreName) {
    const p = `${this.prefix}${store}/`
    const out: string[] = []
    for (let i = 0; i < this.ls.length; i++) {
      const k = this.ls.key(i)
      if (k && k.startsWith(p)) out.push(k.slice(p.length))
    }
    return out
  }
  async all<T>(store: StoreName) {
    const ks = await this.keys(store)
    const out: T[] = []
    for (const k of ks) {
      const v = await this.get<T>(store, k)
      if (v !== undefined) out.push(v)
    }
    return out
  }
}

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error ?? new Error('transaction aborted'))
  })

class IdbKV implements KV {
  readonly kind = 'indexeddb' as const
  constructor(private db: IDBDatabase) {}
  static open(factory: IDBFactory, name: string): Promise<IdbKV> {
    return new Promise((res, rej) => {
      const r = factory.open(name, 1)
      r.onupgradeneeded = () => {
        for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s)
      }
      r.onsuccess = () => res(new IdbKV(r.result))
      r.onerror = () => rej(r.error)
      r.onblocked = () => rej(new Error('indexedDB blocked'))
    })
  }
  async get<T>(store: StoreName, key: string) {
    const tx = this.db.transaction(store, 'readonly')
    return (await req(tx.objectStore(store).get(key))) as T | undefined
  }
  async put(store: StoreName, key: string, value: unknown) {
    const tx = this.db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    await txDone(tx)
  }
  async delete(store: StoreName, key: string) {
    const tx = this.db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    await txDone(tx)
  }
  async keys(store: StoreName) {
    const tx = this.db.transaction(store, 'readonly')
    return (await req(tx.objectStore(store).getAllKeys())).map(String)
  }
  async all<T>(store: StoreName) {
    const tx = this.db.transaction(store, 'readonly')
    return (await req(tx.objectStore(store).getAll())) as T[]
  }
  close() {
    this.db.close()
  }
}

export interface LibraryOptions {
  dbName?: string
  /** inject a backend (tests) */
  kv?: KV
  indexedDB?: IDBFactory
  localStorage?: Storage
  channelName?: string
  autosaveDelay?: number
  maxRevisions?: number
  /** minimum ms between revision snapshots of the same sketch */
  revisionInterval?: number
}

async function pickBackend(o: LibraryOptions): Promise<KV> {
  if (o.kv) return o.kv
  const idb = o.indexedDB ?? (globalThis as any).indexedDB
  if (idb) {
    try {
      const kv = await IdbKV.open(idb, o.dbName ?? 'hydra-ipad')
      // some private modes open fine but throw on write
      await kv.put('kv', '__probe__', 1)
      await kv.delete('kv', '__probe__')
      return kv
    } catch {
      /* fall through */
    }
  }
  try {
    const ls = o.localStorage ?? (globalThis as any).localStorage
    if (ls) {
      ls.setItem('__hydra_probe__', '1')
      ls.removeItem('__hydra_probe__')
      return new LocalStorageKV(ls)
    }
  } catch {
    /* fall through */
  }
  return new MemoryKV()
}

// ------------------------------------------------------------------ events

export interface LibraryChange {
  type: 'change'
  ids: string[]
  /** true when the change came from another tab/app */
  remote: boolean
}

export interface StorageInfo {
  backend: KV['kind']
  /** navigator.storage.persisted() */
  persisted?: boolean
  usage?: number
  quota?: number
  /** running as an installed home-screen app */
  standalone: boolean
  /** short plain-language note for the UI */
  note: string
}

export interface BackupBundle {
  app: 'hydra-ipad'
  kind: 'library'
  version: 1
  exportedAt: number
  sketches: Sketch[]
}

const light = (s: Sketch, thumbnail?: string): LibraryEntry => ({
  id: s.id,
  name: s.name,
  createdAt: s.createdAt,
  modifiedAt: s.modifiedAt,
  thumbnail,
  summary: { stmts: s.stmts.length, raw: s.stmts.filter((x) => x.k === 'raw').length },
})

export class Library {
  private kvP: Promise<KV> | undefined
  private listeners = new Set<(c: LibraryChange) => void>()
  private channel: BroadcastChannel | undefined
  private pending = new Map<string, Sketch>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private inflight: Promise<void> = Promise.resolve()
  private lastRev = new Map<string, number>()
  private readonly origin = newId('o')

  constructor(private opts: LibraryOptions = {}) {}

  // ---- plumbing
  private kv(): Promise<KV> {
    if (!this.kvP) {
      this.kvP = pickBackend(this.opts).then((kv) => {
        this.openChannel()
        return kv
      })
    }
    return this.kvP
  }
  /** Resolves when the backend is chosen. Safe to call repeatedly. */
  async ready(): Promise<KV['kind']> {
    return (await this.kv()).kind
  }
  private openChannel() {
    const name = this.opts.channelName ?? 'hydra-ipad-library'
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel(name)
        this.channel.onmessage = (ev) => {
          const d = ev.data
          if (d && d.type === 'change' && d.origin !== this.origin) this.emit({ type: 'change', ids: d.ids ?? [], remote: true })
        }
        return
      }
    } catch {
      /* fall back */
    }
    try {
      globalThis.addEventListener?.('storage', (ev: StorageEvent) => {
        if (ev.key === 'hydra-lib-ping' && ev.newValue) {
          try {
            const d = JSON.parse(ev.newValue)
            if (d.origin !== this.origin) this.emit({ type: 'change', ids: d.ids ?? [], remote: true })
          } catch {
            /* ignore */
          }
        }
      })
    } catch {
      /* ignore */
    }
  }
  private emit(c: LibraryChange) {
    for (const cb of [...this.listeners]) {
      try {
        cb(c)
      } catch {
        /* a bad listener must not break the library */
      }
    }
  }
  private announce(ids: string[]) {
    this.emit({ type: 'change', ids, remote: false })
    try {
      if (this.channel) this.channel.postMessage({ type: 'change', ids, origin: this.origin })
      else (this.opts.localStorage ?? (globalThis as any).localStorage)?.setItem('hydra-lib-ping', JSON.stringify({ ids, origin: this.origin, t: Date.now() }))
    } catch {
      /* ignore */
    }
  }

  /** Cross-tab / cross-app notifications (BroadcastChannel, falling back to `storage` events). */
  subscribe(cb: (c: LibraryChange) => void): () => void {
    this.listeners.add(cb)
    void this.kv()
    return () => this.listeners.delete(cb)
  }

  // ---- reads
  async list(): Promise<LibraryEntry[]> {
    const kv = await this.kv()
    const entries = await kv.all<LibraryEntry>('entries')
    return entries.sort((a, b) => b.modifiedAt - a.modifiedAt)
  }
  async get(id: string): Promise<Sketch | undefined> {
    const pending = this.pending.get(id)
    if (pending) return structuredClone(pending)
    return (await this.kv()).get<Sketch>('sketches', id)
  }
  async mostRecent(): Promise<Sketch | undefined> {
    const first = (await this.list())[0]
    return first ? this.get(first.id) : undefined
  }
  async count(): Promise<number> {
    return (await (await this.kv()).keys('entries')).length
  }

  // ---- writes
  async put(sketch: Sketch, opts: { touch?: boolean } = {}): Promise<Sketch> {
    const kv = await this.kv()
    const s: Sketch = opts.touch === false ? sketch : { ...sketch, modifiedAt: Date.now() }
    const prev = await kv.get<LibraryEntry>('entries', s.id)
    await kv.put('sketches', s.id, s)
    await kv.put('entries', s.id, { ...light(s, prev?.thumbnail) })
    this.announce([s.id])
    return s
  }
  async create(name = 'Untitled', code?: string): Promise<Sketch> {
    let sketch: Sketch
    if (code !== undefined) sketch = importText(code, { name }).sketch
    else {
      const t = Date.now()
      sketch = { version: 1, id: newId('k'), name, createdAt: t, modifiedAt: t, stmts: [] }
    }
    return this.put({ ...sketch, name })
  }
  async duplicate(id: string): Promise<Sketch | undefined> {
    const s = await this.get(id)
    if (!s) return undefined
    const t = Date.now()
    const copy: Sketch = { ...structuredClone(s), id: newId('k'), name: `${s.name} copy`, createdAt: t, modifiedAt: t }
    const saved = await this.put(copy)
    const thumb = (await (await this.kv()).get<LibraryEntry>('entries', id))?.thumbnail
    if (thumb) await this.setThumbnail(saved.id, thumb)
    return saved
  }
  async rename(id: string, name: string): Promise<void> {
    const s = await this.get(id)
    if (!s) return
    await this.put({ ...s, name })
  }
  async remove(id: string): Promise<void> {
    const kv = await this.kv()
    this.pending.delete(id)
    await kv.delete('sketches', id)
    await kv.delete('entries', id)
    await kv.delete('trust', id)
    for (const k of await kv.keys('revisions')) if (k.startsWith(id + ':')) await kv.delete('revisions', k)
    this.announce([id])
  }
  async setThumbnail(id: string, dataUrl: string): Promise<void> {
    const kv = await this.kv()
    const e = await kv.get<LibraryEntry>('entries', id)
    if (!e) return
    await kv.put('entries', id, { ...e, thumbnail: dataUrl })
    this.announce([id])
  }

  // ---- autosave + revisions
  /** Debounced save. Call `flush()` before navigating away. */
  autosave(sketch: Sketch): void {
    this.pending.set(sketch.id, sketch)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.opts.autosaveDelay ?? 400)
  }
  /** Write everything pending now. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.inflight = this.inflight.then(async () => {
      const batch = [...this.pending.values()]
      for (const s of batch) {
        const saved = await this.put(s)
        // only clear if nothing newer arrived while writing
        if (this.pending.get(s.id) === s) this.pending.delete(s.id)
        await this.snapshot(saved)
      }
    })
    return this.inflight
  }
  hasPending(): boolean {
    return this.pending.size > 0
  }
  private async snapshot(s: Sketch) {
    const kv = await this.kv()
    const now = Date.now()
    const last = this.lastRev.get(s.id)
    const interval = this.opts.revisionInterval ?? 15000
    if (last !== undefined && now - last < interval) return
    const keys = (await kv.keys('revisions')).filter((k) => k.startsWith(s.id + ':')).sort()
    if (keys.length) {
      const prev = await kv.get<Revision>('revisions', keys[keys.length - 1])
      if (prev && contentHash(prev.sketch.stmts) === contentHash(s.stmts)) return
    }
    this.lastRev.set(s.id, now)
    let at = now
    if (keys.length && keys[keys.length - 1] >= `${s.id}:${String(at).padStart(15, '0')}`) at = Number(keys[keys.length - 1].split(':')[1]) + 1
    await kv.put('revisions', `${s.id}:${String(at).padStart(15, '0')}`, { at, sketch: s } satisfies Revision)
    const all = [...keys, `${s.id}:${String(at).padStart(15, '0')}`]
    const max = this.opts.maxRevisions ?? 20
    for (const k of all.slice(0, Math.max(0, all.length - max))) await kv.delete('revisions', k)
  }
  /** Force a revision snapshot (e.g. before a risky operation). */
  async snapshotNow(id: string): Promise<void> {
    const s = await this.get(id)
    if (!s) return
    this.lastRev.delete(id)
    await this.snapshot(s)
  }
  async revisions(id: string): Promise<Revision[]> {
    const kv = await this.kv()
    const keys = (await kv.keys('revisions')).filter((k) => k.startsWith(id + ':')).sort().reverse()
    const out: Revision[] = []
    for (const k of keys) {
      const r = await kv.get<Revision>('revisions', k)
      if (r) out.push(r)
    }
    return out
  }
  async restoreRevision(id: string, at: number): Promise<Sketch | undefined> {
    const rev = (await this.revisions(id)).find((r) => r.at === at)
    if (!rev) return undefined
    await this.snapshotNow(id)
    return this.put({ ...rev.sketch, id })
  }

  // ---- import / export
  async exportJS(id: string): Promise<string> {
    const s = await this.get(id)
    if (!s) throw new Error(`no sketch ${id}`)
    return toCode(s)
  }
  async exportJSON(which: string | 'all'): Promise<string> {
    await this.flush()
    const ids = which === 'all' ? (await this.list()).map((e) => e.id) : [which]
    const sketches: Sketch[] = []
    for (const id of ids) {
      const s = await this.get(id)
      if (s) sketches.push(s)
    }
    const bundle: BackupBundle = { app: 'hydra-ipad', kind: 'library', version: 1, exportedAt: Date.now(), sketches }
    return JSON.stringify(bundle, null, 2)
  }
  /**
   * Restore a backup bundle, a single exported sketch, or an array of sketches.
   * Existing ids are replaced only when the backup copy is newer (or `overwrite: true`).
   */
  async restore(json: string | unknown, opts: { overwrite?: boolean } = {}): Promise<{ imported: number; replaced: number; skipped: number }> {
    const data = typeof json === 'string' ? JSON.parse(json) : json
    const list: unknown[] = Array.isArray(data) ? data : (data as any)?.sketches ? (data as any).sketches : [data]
    let imported = 0
    let replaced = 0
    let skipped = 0
    for (const raw of list) {
      const s = raw as Sketch
      if (!s || typeof s !== 'object' || !Array.isArray((s as any).stmts) || typeof s.id !== 'string') {
        skipped++
        continue
      }
      const existing = await this.get(s.id)
      if (existing && !opts.overwrite && existing.modifiedAt >= s.modifiedAt) {
        skipped++
        continue
      }
      await this.put({ ...s, version: 1 }, { touch: false })
      existing ? replaced++ : imported++
    }
    return { imported, replaced, skipped }
  }
  /** Import plain text (pasted or from a .js file) as a new sketch. */
  async importCode(name: string, code: string): Promise<{ sketch: Sketch; warnings: string[] }> {
    const r = importText(code, { name })
    const sketch = await this.put(r.sketch)
    return { sketch, warnings: r.warnings }
  }

  // ---- trust
  async approve(sketch: Sketch): Promise<void> {
    await (await this.kv()).put('trust', sketch.id, trustFingerprint(sketch))
  }
  async needsTrust(sketch: Sketch): Promise<boolean> {
    const fp = await (await this.kv()).get<string>('trust', sketch.id)
    return needsTrustPrompt(sketch, fp ?? null)
  }

  // ---- first run
  async seedIfEmpty(items: Array<{ name: string; code: string }> = starters): Promise<boolean> {
    const kv = await this.kv()
    if (await kv.get('kv', 'seeded')) return false
    await kv.put('kv', 'seeded', Date.now())
    if ((await kv.keys('entries')).length) return false
    for (const it of items) await this.create(it.name, it.code)
    return true
  }

  // ---- where is my data?
  async persist(): Promise<boolean> {
    try {
      return (await navigator.storage?.persist?.()) ?? false
    } catch {
      return false
    }
  }
  async storageInfo(): Promise<StorageInfo> {
    const kv = await this.kv()
    const standalone = isStandalone()
    let persisted: boolean | undefined
    let usage: number | undefined
    let quota: number | undefined
    try {
      persisted = await navigator.storage?.persisted?.()
      const est = await navigator.storage?.estimate?.()
      usage = est?.usage
      quota = est?.quota
    } catch {
      /* not available */
    }
    const where =
      kv.kind === 'indexeddb'
        ? `Saved in this ${standalone ? 'installed app' : 'browser'}'s own IndexedDB storage.`
        : kv.kind === 'localstorage'
          ? 'IndexedDB is unavailable; using the smaller localStorage fallback.'
          : 'Storage is unavailable (private browsing?): sketches only live until this page closes. Use Backup.'
    const ios =
      standalone || /iPad|iPhone|iPod/.test(globalThis.navigator?.userAgent ?? '') || (globalThis.navigator?.platform === 'MacIntel' && (globalThis.navigator?.maxTouchPoints ?? 0) > 1)
        ? ' On iPad, the Home Screen app and Safari keep separate libraries: sketches saved in one do not appear in the other. Use Backup / Restore to move them.'
        : ''
    return { backend: kv.kind, persisted, usage, quota, standalone, note: where + ios }
  }

  close() {
    this.channel?.close()
    void this.kvP?.then((k) => k.close?.())
  }
}

export function isStandalone(): boolean {
  try {
    return !!((globalThis.navigator as any)?.standalone || globalThis.matchMedia?.('(display-mode: standalone)').matches)
  } catch {
    return false
  }
}

let shared: Library | undefined
/** The process-wide library. Apps use this; tests construct their own. */
export function getLibrary(): Library {
  return (shared ??= new Library())
}
export function resetSharedLibrary(lib?: Library) {
  shared = lib
}

/** Small JPEG data URL from a canvas/video/image source. */
export function makeThumbnail(source: CanvasImageSource, width = 240, quality = 0.62): string | undefined {
  try {
    const sw = (source as any).videoWidth ?? (source as any).naturalWidth ?? (source as any).width ?? width
    const sh = (source as any).videoHeight ?? (source as any).naturalHeight ?? (source as any).height ?? width
    const height = Math.max(1, Math.round((width * sh) / Math.max(1, sw)))
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    c.getContext('2d')!.drawImage(source, 0, 0, width, height)
    return c.toDataURL('image/jpeg', quality)
  } catch {
    return undefined
  }
}
