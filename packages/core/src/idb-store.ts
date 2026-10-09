// A tiny key/value store over one IndexedDB object store, with an in-memory fallback (private browsing, tests without
// fake-indexeddb). Used for the opt-in audio file assets and the installed-plugin list; sketches have their own library.

export interface SimpleStore<T> {
  readonly kind: 'indexeddb' | 'memory'
  get(key: string): Promise<T | undefined>
  put(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  all(): Promise<T[]>
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, bad) => {
    r.onsuccess = () => ok(r.result)
    r.onerror = () => bad(r.error)
  })
}

export function memoryStore<T>(): SimpleStore<T> {
  const m = new Map<string, T>()
  return {
    kind: 'memory',
    async get(k) {
      return m.get(k)
    },
    async put(k, v) {
      m.set(k, v)
    },
    async delete(k) {
      m.delete(k)
    },
    async all() {
      return [...m.values()]
    },
  }
}

/** Open (or create) `dbName` with a single object store `store`. Falls back to memory if IndexedDB is unavailable. */
export async function openSimpleStore<T>(dbName: string, store: string, idb: IDBFactory | undefined = (globalThis as any).indexedDB): Promise<SimpleStore<T>> {
  if (!idb) return memoryStore<T>()
  let db: IDBDatabase
  try {
    db = await new Promise<IDBDatabase>((ok, bad) => {
      const r = idb.open(dbName, 1)
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store)
      }
      r.onsuccess = () => ok(r.result)
      r.onerror = () => bad(r.error)
      r.onblocked = () => bad(new Error('blocked'))
    })
  } catch {
    return memoryStore<T>()
  }
  const tx = (mode: IDBTransactionMode) => db.transaction(store, mode).objectStore(store)
  return {
    kind: 'indexeddb',
    async get(k) {
      return (await req(tx('readonly').get(k))) as T | undefined
    },
    async put(k, v) {
      await req(tx('readwrite').put(v, k))
    },
    async delete(k) {
      await req(tx('readwrite').delete(k))
    },
    async all() {
      return (await req(tx('readonly').getAll())) as T[]
    },
  }
}
