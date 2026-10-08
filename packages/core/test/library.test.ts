// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, test } from 'vitest'
import { Library } from '../src/library'
import { fromCode } from '../src/parse'
import { toCode } from '../src/codegen'
import { withMeta } from '../src/ir'
import { appStorage } from '../src/storage'

let n = 0
const fresh = (extra = {}) => new Library({ indexedDB: new IDBFactory(), dbName: 'db' + n++, channelName: 'ch' + n, autosaveDelay: 10, revisionInterval: 0, ...extra })
const libs: Library[] = []
const mk = (extra = {}) => {
  const l = fresh(extra)
  libs.push(l)
  return l
}
afterEach(() => libs.splice(0).forEach((l) => l.close()))

describe('library', () => {
  test('uses IndexedDB when available', async () => {
    expect(await mk().ready()).toBe('indexeddb')
  })

  test('CRUD', async () => {
    const lib = mk()
    const a = await lib.create('first', 'osc(10).out()')
    const b = await lib.create('second')
    expect((await lib.list()).map((e) => e.name).sort()).toEqual(['first', 'second'])
    expect(toCode((await lib.get(a.id))!)).toBe('osc(10).out()')
    await lib.rename(b.id, 'renamed')
    expect((await lib.get(b.id))!.name).toBe('renamed')
    const dup = (await lib.duplicate(a.id))!
    expect(dup.id).not.toBe(a.id)
    expect(dup.name).toBe('first copy')
    expect(toCode(dup)).toBe('osc(10).out()')
    await lib.remove(a.id)
    expect(await lib.get(a.id)).toBeUndefined()
    expect(await lib.count()).toBe(2)
  })

  test('list is newest-first and mostRecent works', async () => {
    const lib = mk()
    const a = await lib.create('a', 'osc().out()')
    await new Promise((r) => setTimeout(r, 5))
    const b = await lib.create('b', 'noise().out()')
    expect((await lib.list())[0].id).toBe(b.id)
    expect((await lib.mostRecent())!.id).toBe(b.id)
    void a
  })

  test('autosave is debounced; flush writes immediately; get sees pending edits', async () => {
    const lib = mk({ autosaveDelay: 5000 })
    const s = await lib.create('x', 'osc(10).out()')
    const edited = fromCode('osc(99).out()', { id: s.id, name: 'x' })
    lib.autosave(edited)
    expect(lib.hasPending()).toBe(true)
    expect(toCode((await lib.get(s.id))!)).toBe('osc(99).out()') // read-your-writes
    await lib.flush()
    expect(lib.hasPending()).toBe(false)
    const lib2 = new Library({ indexedDB: (lib as any).opts.indexedDB, dbName: (lib as any).opts.dbName })
    libs.push(lib2)
    expect(toCode((await lib2.get(s.id))!)).toBe('osc(99).out()')
  })

  test('keeps the last ~20 revisions per sketch, newest first', async () => {
    const lib = mk({ maxRevisions: 20 })
    const s = await lib.create('x', 'osc(0).out()')
    for (let i = 1; i <= 30; i++) {
      lib.autosave(fromCode(`osc(${i}).out()`, { id: s.id, name: 'x' }))
      await lib.flush()
      await new Promise((r) => setTimeout(r, 1))
    }
    const revs = await lib.revisions(s.id)
    expect(revs.length).toBe(20)
    expect(toCode(revs[0].sketch)).toBe('osc(30).out()')
    const restored = (await lib.restoreRevision(s.id, revs[5].at))!
    expect(toCode(restored)).toBe(toCode(revs[5].sketch))
  })

  test('backup and restore (JSON), including foreign meta', async () => {
    const lib = mk()
    let s = await lib.create('x', 'osc(10).out()')
    s = await lib.put(withMeta(s, 'graph', { zoom: 2 }))
    const json = await lib.exportJSON('all')
    expect(JSON.parse(json).app).toBe('hydra-ipad')
    const other = mk()
    const r = await other.restore(json)
    expect(r.imported).toBe(1)
    expect(((await other.get(s.id))!.meta as any).graph.zoom).toBe(2)
    // restoring older data over newer is skipped unless overwrite is requested
    expect((await other.restore(json)).skipped).toBe(1)
    expect((await other.restore(json, { overwrite: true })).replaced).toBe(1)
    // a lone sketch and an array also restore
    expect((await mk().restore(JSON.stringify(s))).imported).toBe(1)
    expect((await mk().restore([s])).imported).toBe(1)
    expect((await mk().restore('{"nonsense":1}')).skipped).toBe(1)
  })

  test('exportJS returns the original text byte for byte', async () => {
    const lib = mk()
    const code = '// hi\nosc(10)   .out( )\n\nupdate = () => {}\n'
    const s = await lib.create('x', code)
    expect(await lib.exportJS(s.id)).toBe(code)
  })

  test('cross-tab notifications via BroadcastChannel', async () => {
    const idb = new IDBFactory()
    const a = new Library({ indexedDB: idb, dbName: 'shared', channelName: 'same' })
    const b = new Library({ indexedDB: idb, dbName: 'shared', channelName: 'same' })
    libs.push(a, b)
    await a.ready()
    await b.ready()
    const seen: Array<{ ids: string[]; remote: boolean }> = []
    b.subscribe((c) => seen.push({ ids: c.ids, remote: c.remote }))
    const s = await a.create('x', 'osc().out()')
    await new Promise((r) => setTimeout(r, 30))
    expect(seen.some((e) => e.remote && e.ids.includes(s.id))).toBe(true)
  })

  test('falls back to localStorage, then memory', async () => {
    const throwingIdb = { open: () => { throw new Error('denied') } } as unknown as IDBFactory
    const lsLib = new Library({ indexedDB: throwingIdb })
    libs.push(lsLib)
    expect(await lsLib.ready()).toBe('localstorage')
    await lsLib.create('x', 'osc().out()')
    expect((await lsLib.list()).length).toBe(1)
    const brokenLs = { setItem() { throw new Error('quota') }, removeItem() {}, getItem() { return null }, key() { return null }, length: 0 } as unknown as Storage
    const memLib = new Library({ indexedDB: throwingIdb, localStorage: brokenLs })
    libs.push(memLib)
    expect(await memLib.ready()).toBe('memory')
    const s = await memLib.create('m', 'osc().out()')
    expect(toCode((await memLib.get(s.id))!)).toBe('osc().out()')
    expect((await memLib.storageInfo()).note).toMatch(/Backup/)
  })

  test('first-run seeding happens once, even after everything is deleted', async () => {
    const lib = mk()
    expect(await lib.seedIfEmpty()).toBe(true)
    expect(await lib.count()).toBe(3)
    for (const e of await lib.list()) await lib.remove(e.id)
    expect(await lib.seedIfEmpty()).toBe(false)
    expect(await lib.count()).toBe(0)
  })

  test('trust approvals are per exact content', async () => {
    const lib = mk()
    const s = await lib.create('x', 'update = () => {}\nosc().out()')
    expect(await lib.needsTrust(s)).toBe(true)
    await lib.approve(s)
    expect(await lib.needsTrust(s)).toBe(false)
    const changed = fromCode('update = () => { hack() }\nosc().out()', { id: s.id })
    expect(await lib.needsTrust(changed)).toBe(true)
    const safe = await lib.create('y', 'osc().out()')
    expect(await lib.needsTrust(safe)).toBe(false)
  })

  test('storageInfo explains where data lives', async () => {
    const info = await mk().storageInfo()
    expect(info.backend).toBe('indexeddb')
    expect(info.note.length).toBeGreaterThan(10)
  })
})

describe('appStorage', () => {
  test('namespaces keys with hydra-<app>: and never throws', () => {
    const s = appStorage('graph')
    s.set('zoom', 1.5)
    expect(localStorage.getItem('hydra-graph:zoom')).toBe('1.5')
    expect(s.get('zoom')).toBe(1.5)
    expect(s.get('missing', 7)).toBe(7)
    expect(appStorage('stack').get('zoom')).toBeUndefined()
    expect(s.keys()).toContain('zoom')
    s.remove('zoom')
    expect(s.get('zoom')).toBeUndefined()
    const broken = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') }, removeItem() { throw new Error('x') }, key() { return null }, length: 0 } as unknown as Storage
    const b = appStorage('x', broken)
    expect(() => b.set('a', 1)).not.toThrow()
    expect(b.get('a')).toBe(1) // memory fallback
  })
})
