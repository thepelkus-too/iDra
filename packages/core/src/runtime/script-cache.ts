// Host-side fetching + caching of plugin / loadScript sources, so a sketch that uses `await loadScript(url)`
// still works offline after it has run once. The frame never touches the network for scripts: it asks the host.

export interface ScriptFetchResult {
  text: string
  from: 'network' | 'cache'
}

export interface ScriptCacheOptions {
  fetch?: typeof fetch
  cacheStorage?: CacheStorage
  cacheName?: string
}

export class ScriptCache {
  private mem = new Map<string, string>()
  constructor(private opts: ScriptCacheOptions = {}) {}

  private async store(): Promise<Cache | undefined> {
    try {
      const cs = this.opts.cacheStorage ?? (globalThis as any).caches
      return cs ? await cs.open(this.opts.cacheName ?? 'hydra-ipad-scripts-v1') : undefined
    } catch {
      return undefined
    }
  }

  /** Network first (fresh code), cache as the offline fallback. Throws only if both fail. */
  async get(url: string): Promise<ScriptFetchResult> {
    const f = this.opts.fetch ?? (globalThis as any).fetch?.bind(globalThis)
    let netErr: unknown
    if (f) {
      try {
        const res = await f(url, { credentials: 'omit' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        this.mem.set(url, text)
        try {
          const c = await this.store()
          await c?.put(url, new Response(text, { headers: { 'content-type': 'text/javascript' } }))
        } catch {
          /* quota etc. */
        }
        return { text, from: 'network' }
      } catch (e) {
        netErr = e
      }
    }
    const m = this.mem.get(url)
    if (m !== undefined) return { text: m, from: 'cache' }
    try {
      const c = await this.store()
      const hit = await c?.match(url)
      if (hit) return { text: await hit.text(), from: 'cache' }
    } catch {
      /* ignore */
    }
    throw new Error(`could not fetch ${url}${netErr ? ` (${(netErr as Error).message ?? netErr})` : ''} and no cached copy exists`)
  }

  /** Cached copy only (no network). */
  async peek(url: string): Promise<string | undefined> {
    const m = this.mem.get(url)
    if (m !== undefined) return m
    try {
      const hit = await (await this.store())?.match(url)
      return hit ? await hit.text() : undefined
    } catch {
      return undefined
    }
  }
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
