// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, expect, test, vi } from 'vitest'
import { mountSwitcher, parseRoute, routeHash, siteRoot } from '../src/switcher'
import { Library } from '../src/library'
import { mountAbout, LICENSE_NAME } from '../src/about'

describe('routes', () => {
  test('parseRoute / routeHash', () => {
    expect(parseRoute('#/s/abc123')).toEqual({ sketchId: 'abc123' })
    expect(parseRoute('#/s/abc123?x=1')).toEqual({ sketchId: 'abc123' })
    expect(parseRoute('#/s/a%20b')).toEqual({ sketchId: 'a b' })
    expect(parseRoute('')).toEqual({})
    expect(parseRoute('#/other')).toEqual({})
    expect(routeHash('a b')).toBe('#/s/a%20b')
    expect(parseRoute(routeHash('k1x'))).toEqual({ sketchId: 'k1x' })
  })
  test('site root: apps are one level below the shell', () => {
    expect(siteRoot('graph', 'https://x.test/graph/').href).toBe('https://x.test/')
    expect(siteRoot('shell', 'https://x.test/').href).toBe('https://x.test/')
  })
})

describe('switcher', () => {
  test('lists the editors plus Library and navigates to ../<app>/#/s/<id> after flushing', async () => {
    const lib = new Library({ kv: undefined, indexedDB: new (await import('fake-indexeddb')).IDBFactory(), dbName: 's' })
    const flush = vi.spyOn(lib, 'flush')
    const nav: string[] = []
    const el = document.createElement('div')
    document.body.appendChild(el)
    const sw = mountSwitcher(el, {
      current: 'harness',
      sketchId: 'sk1',
      library: lib,
      apps: [
        { name: 'harness', title: 'Harness', path: 'harness/' },
        { name: 'graph', title: 'Graph', path: 'graph/', description: 'nodes' },
      ],
      manifestUrl: 'http://localhost/none.json',
      navigate: (u) => nav.push(u),
    })
    const links = [...el.querySelectorAll('a')]
    expect(links.map((a) => a.textContent)).toEqual(['Librarylibrary'.replace('library', 'all sketches'), 'Harness', 'Graphnodes'].map((s) => s))
    expect(links[2].getAttribute('href')).toMatch(/\/graph\/#\/s\/sk1$/)
    expect(links[1].getAttribute('aria-current')).toBe('page')
    links[2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 10))
    expect(flush).toHaveBeenCalled()
    expect(nav).toHaveLength(1)
    expect(nav[0]).toMatch(/\/graph\/#\/s\/sk1$/)
    sw.refresh('sk2')
    expect(el.querySelectorAll('a')[2].getAttribute('href')).toMatch(/#\/s\/sk2$/)
    sw.destroy()
    lib.close()
  })
})

describe('about', () => {
  test('shows a source link and the license', () => {
    const el = document.createElement('div')
    mountAbout(el, { repo: 'https://github.com/o/r' })
    expect(el.querySelector('a')!.getAttribute('href')).toBe('https://github.com/o/r')
    expect(el.textContent).toContain(LICENSE_NAME)
  })
})
