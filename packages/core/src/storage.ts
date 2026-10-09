// Per-app private UI preferences (panel sizes, last tab ...). Sketches NEVER live here: they live in the shared
// library (library.ts). All apps share one origin on Vercel, so every key is namespaced `hydra-<app>:`.

export interface AppStorage {
  readonly prefix: string
  get<T = unknown>(key: string, fallback?: T): T | undefined
  set(key: string, value: unknown): void
  remove(key: string): void
  keys(): string[]
  clear(): void
}

const memory = new Map<string, string>()

function backend(): Storage | undefined {
  try {
    const ls = globalThis.localStorage
    const k = '__hydra_probe__'
    ls.setItem(k, '1')
    ls.removeItem(k)
    return ls
  } catch {
    return undefined
  }
}

/** Prefix helper: `appStorage('graph').set('zoom', 1.2)` writes `hydra-graph:zoom`. Never throws. */
export function appStorage(app: string, store?: Storage): AppStorage {
  const prefix = `hydra-${app}:`
  const ls = store ?? backend()
  const read = (k: string): string | null => {
    try {
      return ls ? ls.getItem(prefix + k) : (memory.get(prefix + k) ?? null)
    } catch {
      return memory.get(prefix + k) ?? null
    }
  }
  const write = (k: string, v: string) => {
    try {
      if (ls) ls.setItem(prefix + k, v)
      else memory.set(prefix + k, v)
    } catch {
      memory.set(prefix + k, v)
    }
  }
  return {
    prefix,
    get<T>(key: string, fallback?: T) {
      const raw = read(key)
      if (raw === null) return fallback
      try {
        return JSON.parse(raw) as T
      } catch {
        return fallback
      }
    },
    set(key, value) {
      write(key, JSON.stringify(value))
    },
    remove(key) {
      try {
        ls?.removeItem(prefix + key)
      } catch {
        /* ignore */
      }
      memory.delete(prefix + key)
    },
    keys() {
      const out: string[] = []
      try {
        if (ls) for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i)
          if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length))
        }
      } catch {
        /* ignore */
      }
      for (const k of memory.keys()) if (k.startsWith(prefix) && !out.includes(k.slice(prefix.length))) out.push(k.slice(prefix.length))
      return out
    },
    clear() {
      for (const k of this.keys()) this.remove(k)
    },
  }
}
