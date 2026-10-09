import { Bridge, type FrameToHost, type HostToFrame, type RuntimeTransport } from '../../src/runtime'
import { MockHydra } from './mock-hydra'

/** The Bridge behind two structured-clone hops, reachable only through messages (like the real frame). */
export function loopbackTransport(log: Array<{ dir: 'h2f' | 'f2h'; msg: any }> = []) {
  return (container: HTMLElement): RuntimeTransport => {
    let cb: (m: FrameToHost) => void = () => {}
    const later = (f: () => void) => setTimeout(f, 0)
    const bridge = new Bridge({
      win: window,
      container,
      post: (m) => later(() => { log.push({ dir: 'f2h', msg: m }); cb(structuredClone(m)) }),
      Hydra: MockHydra as any,
    })
    return {
      send: (m: HostToFrame) => later(() => { log.push({ dir: 'h2f', msg: m }); bridge.handle(structuredClone(m)) }),
      onMessage: (f) => (cb = f),
      dispose: () => bridge.dispose(),
    }
  }
}

/** A minimal in-memory CacheStorage (enough for ScriptCache). */
export function memoryCacheStorage(): CacheStorage & { dump(): Map<string, Map<string, { body: string; headers: Record<string, string> }>> } {
  const caches = new Map<string, Map<string, { body: string; headers: Record<string, string> }>>()
  const open = async (name: string) => {
    if (!caches.has(name)) caches.set(name, new Map())
    const m = caches.get(name)!
    return {
      async match(url: string) {
        const e = m.get(String(url))
        return e ? new Response(e.body, { headers: e.headers }) : undefined
      },
      async put(url: string, res: Response) {
        const headers: Record<string, string> = {}
        res.headers.forEach((v, k) => (headers[k] = v))
        m.set(String(url), { body: await res.text(), headers })
      },
      async delete(url: string) {
        return m.delete(String(url))
      },
    } as unknown as Cache
  }
  return {
    open,
    has: async (n: string) => caches.has(n),
    delete: async (n: string) => caches.delete(n),
    keys: async () => [...caches.keys()],
    match: async () => undefined,
    dump: () => caches,
  } as any
}
