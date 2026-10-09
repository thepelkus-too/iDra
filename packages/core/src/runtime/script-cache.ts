// Host-side fetching + caching of plugin / loadScript sources, so a sketch that uses `await loadScript(url)` still works
// offline after it has run once. The frame never touches the network for scripts: it asks the host, which passes text.
//
// Cache policy, by URL:
//  * pinned (an exact version, e.g. `hydra-midi@0.4.6`, or a commit): served from the cache once fetched, never refetched;
//  * floating (`@latest`, no version, a branch, any other host): network first while online so fixes arrive, the cached
//    copy when offline, and a warning that the result may change between runs.
// Entries live in Cache Storage (`hydra-ipad-scripts-v1`) keyed by URL, with the fetch time and a SHA-256 of the text.

export interface ScriptFetchResult {
  text: string
  from: 'network' | 'cache'
  /** hex SHA-256 of the text (absent where WebCrypto is unavailable) */
  hash?: string
  /** true for floating URLs (`@latest`, branches, unversioned) */
  latest?: boolean
  /** shown to the owner, e.g. "uses @latest: results may change" */
  warning?: string
}

export interface ScriptCacheOptions {
  fetch?: typeof fetch
  cacheStorage?: CacheStorage
  cacheName?: string
}

export interface ScriptCacheEntry {
  url: string
  size: number
  hash?: string
  fetchedAt?: number
  latest: boolean
}

export const SCRIPT_CACHE_NAME = 'hydra-ipad-scripts-v1'

/** Is this URL pinned to immutable content? (`@1.2.3`, `@<commit sha>`, `?v=` does NOT count) */
export function isPinnedScriptUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const p = u.pathname
  if (/@latest(\/|$)/i.test(p)) return false
  // jsDelivr/unpkg/esm: name@version where version is semver (no ranges) or a 7–40 hex commit
  const m = /@(v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?|[0-9a-f]{7,40})(\/|$)/i.exec(p)
  if (m) return true
  // raw.githubusercontent.com/<user>/<repo>/<sha>/file
  if (u.host === 'raw.githubusercontent.com') return /^\/[^/]+\/[^/]+\/[0-9a-f]{40}\//i.test(p)
  return false
}

export async function sha256Hex(text: string): Promise<string | undefined> {
  try {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return undefined
  }
}

/** SRI string (`sha256-<base64>`) for a text, to pin a plugin ref to exactly what the owner approved. */
export async function integrityOf(text: string): Promise<string | undefined> {
  try {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    let bin = ''
    new Uint8Array(d).forEach((b) => (bin += String.fromCharCode(b)))
    return 'sha256-' + btoa(bin)
  } catch {
    return undefined
  }
}

export class ScriptCache {
  private mem = new Map<string, { text: string; hash?: string; fetchedAt: number }>()
  constructor(private opts: ScriptCacheOptions = {}) {}

  private async store(): Promise<Cache | undefined> {
    try {
      const cs = this.opts.cacheStorage ?? (globalThis as any).caches
      return cs ? await cs.open(this.opts.cacheName ?? SCRIPT_CACHE_NAME) : undefined
    } catch {
      return undefined
    }
  }

  private async cached(url: string): Promise<{ text: string; hash?: string; fetchedAt?: number } | undefined> {
    const m = this.mem.get(url)
    if (m) return m
    try {
      const hit = await (await this.store())?.match(url)
      if (!hit) return undefined
      const text = await hit.text()
      const at = Number(hit.headers.get('x-hydra-fetched-at')) || undefined
      const entry = { text, hash: hit.headers.get('x-hydra-sha256') ?? (await sha256Hex(text)), fetchedAt: at ?? 0 }
      this.mem.set(url, entry)
      return entry
    } catch {
      return undefined
    }
  }

  private async network(url: string): Promise<{ text: string; hash?: string }> {
    const f = this.opts.fetch ?? (globalThis as any).fetch?.bind(globalThis)
    if (!f) throw new Error('fetch is not available')
    const res = await f(url, { credentials: 'omit', cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const hash = await sha256Hex(text)
    const fetchedAt = Date.now()
    this.mem.set(url, { text, hash, fetchedAt })
    try {
      const c = await this.store()
      const headers: Record<string, string> = { 'content-type': 'text/javascript', 'x-hydra-fetched-at': String(fetchedAt) }
      if (hash) headers['x-hydra-sha256'] = hash
      await c?.put(url, new Response(text, { headers }))
    } catch {
      /* quota etc. */
    }
    return { text, hash }
  }

  /**
   * Pinned URLs: cache first. Floating URLs: network first (fresh code), cache as the offline fallback.
   * Throws only if neither works. `{ refresh: true }` always tries the network first.
   */
  async get(url: string, o: { refresh?: boolean } = {}): Promise<ScriptFetchResult> {
    const latest = !isPinnedScriptUrl(url)
    const warning = latest ? `${url} is not pinned to a version (e.g. @latest): what it does may change between runs` : undefined
    if (!latest && !o.refresh) {
      const c = await this.cached(url)
      if (c) return { text: c.text, from: 'cache', hash: c.hash, latest, warning }
    }
    let netErr: unknown
    try {
      const r = await this.network(url)
      return { text: r.text, from: 'network', hash: r.hash, latest, warning }
    } catch (e) {
      netErr = e
    }
    const c = await this.cached(url)
    if (c) return { text: c.text, from: 'cache', hash: c.hash, latest, warning }
    throw new Error(`could not fetch ${url}${netErr ? ` (${(netErr as Error).message ?? netErr})` : ''} and no cached copy exists`)
  }

  /** Cached copy only (no network). */
  async peek(url: string): Promise<string | undefined> {
    return (await this.cached(url))?.text
  }

  /** What is cached for a URL (size, hash, when), without touching the network. */
  async info(url: string): Promise<ScriptCacheEntry | undefined> {
    const c = await this.cached(url)
    return c ? { url, size: c.text.length, hash: c.hash, fetchedAt: c.fetchedAt || undefined, latest: !isPinnedScriptUrl(url) } : undefined
  }

  async remove(url: string): Promise<void> {
    this.mem.delete(url)
    try {
      await (await this.store())?.delete(url)
    } catch {
      /* ignore */
    }
  }
}

let shared: ScriptCache | undefined
/** The page-wide script cache (one per page; Cache Storage is shared by every app on the origin). */
export function getScriptCache(): ScriptCache {
  return (shared ??= new ScriptCache())
}

/** Verify a Subresource-Integrity style string (`sha256-<base64>`, also sha384/sha512). */
export async function verifyIntegrity(text: string, integrity: string): Promise<boolean> {
  const m = /^(sha256|sha384|sha512)-(.+)$/.exec(integrity.trim())
  if (!m) return false
  const algo = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' }[m[1] as 'sha256']
  const digest = await crypto.subtle.digest(algo, new TextEncoder().encode(text))
  let bin = ''
  new Uint8Array(digest).forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin) === m[2]
}
