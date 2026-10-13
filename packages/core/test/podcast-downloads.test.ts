// Node environment: fake-indexeddb keeps Node's Blobs intact (jsdom's Blob does not survive its structured clone).
import { describe, expect, test, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { downloadEpisode } from '../src/podcast'
import { AudioAssets, AudioAssetError } from '../src/audio-assets'

describe('episode downloads for offline listening', () => {
  const ep = { url: 'https://cdn.example/ep7.mp3', title: 'Episode 7', duration: 1800, size: 10 }
  const feed = { url: 'https://feeds.example/show.xml', title: 'Show' }
  const audio = (bytes = 10, headers: Record<string, string> = {}) => new Response(new Uint8Array(bytes).fill(7), { headers: { 'content-type': 'audio/mpeg', 'content-length': String(bytes), ...headers } })

  test('downloads with progress into the kept-audio store, as a Blob with its origin; replaces an earlier download', async () => {
    const assets = new AudioAssets({ indexedDB: new IDBFactory() })
    const progress: number[] = []
    const a = await downloadEpisode(ep, { assets, feed, proxy: null, fetch: async () => audio(), onProgress: (p) => progress.push(p.received) })
    expect(a).toMatchObject({ name: 'Episode 7', size: 10, type: 'audio/mpeg', origin: { url: ep.url, title: 'Episode 7', feedUrl: feed.url, feedTitle: 'Show', duration: 1800 } })
    expect(progress.at(-1)).toBe(10)
    const got = await assets.get(a.id)
    expect(got?.blob.size).toBe(10)
    expect((await assets.downloads()).map((d) => d.id)).toEqual([a.id])
    expect((await assets.findDownload(ep.url))?.id).toBe(a.id)
    const again = await downloadEpisode(ep, { assets, feed, proxy: null, fetch: async () => audio(12) })
    expect(again.id).toBe(a.id)
    expect(await assets.usage()).toBe(12)
    await assets.remove(a.id)
    expect(await assets.downloads()).toEqual([])
  })

  test('a host without CORS cannot be downloaded: said plainly, with the Files route', async () => {
    const assets = new AudioAssets({ indexedDB: new IDBFactory() })
    const err = await downloadEpisode(ep, { assets, proxy: null, fetch: async () => { throw new TypeError('Failed to fetch') } }).catch((e) => e)
    expect(err.code).toBe('no-cors')
    expect(err.message).toMatch(/Audio file…/)
    // with a proxy configured, it is tried
    const seen: string[] = []
    await downloadEpisode(ep, { assets, proxy: 'https://p.example/?u=', fetch: async (u) => { seen.push(u); if (!u.startsWith('https://p.example/')) throw new TypeError('x'); return audio() } })
    expect(seen.at(-1)).toBe('https://p.example/?u=' + encodeURIComponent(ep.url))
  })

  test('size caps: refused up front from the feed size or Content-Length, and while streaming', async () => {
    const assets = new AudioAssets({ indexedDB: new IDBFactory(), limits: { maxDownload: 100, maxTotal: 150 } })
    const fetch = vi.fn(async () => audio(10))
    await expect(downloadEpisode({ ...ep, size: 500 }, { assets, proxy: null, fetch })).rejects.toBeInstanceOf(AudioAssetError)
    expect(fetch).not.toHaveBeenCalled()
    await expect(downloadEpisode({ ...ep, size: undefined }, { assets, proxy: null, fetch: async () => audio(120) })).rejects.toThrow(/over|not kept/)
    // no Content-Length: the stream is cut off at the cap
    const big = () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(60)); c.close() } }), { headers: { 'content-type': 'audio/mpeg' } })
    await expect(downloadEpisode({ ...ep, size: undefined }, { assets, proxy: null, fetch: async () => big() })).rejects.toBeInstanceOf(AudioAssetError)
    await downloadEpisode({ ...ep, url: 'https://cdn.example/a.mp3', size: 90 }, { assets, proxy: null, fetch: async () => audio(90) })
    await expect(downloadEpisode({ ...ep, url: 'https://cdn.example/b.mp3', size: 90 }, { assets, proxy: null, fetch: async () => audio(90) })).rejects.toThrow(/Delete a download/)
  })

  test('cancel aborts the download and keeps nothing', async () => {
    const assets = new AudioAssets({ indexedDB: new IDBFactory() })
    const ctl = new AbortController()
    ctl.abort()
    const err = await downloadEpisode(ep, { assets, proxy: null, signal: ctl.signal, fetch: async (_u, init) => { if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError'); return audio() } }).catch((e) => e)
    expect(err.name).toBe('AbortError')
    expect(await assets.list()).toEqual([])
  })
})

// kept files are stored as Blobs, like downloads (jsdom's Blob doesn't survive fake-indexeddb, hence this file)
describe('AudioAssets (opt-in kept files)', () => {
  test('keeps, lists, returns and removes files within the caps', async () => {
    const assets = new AudioAssets({ indexedDB: new IDBFactory(), limits: { maxFile: 1000, maxTotal: 1500 } })
    const a = await assets.add(new Blob([new Uint8Array(800)], { type: 'audio/wav' }), 'a.wav')
    expect((await assets.list()).map((x) => x.name)).toEqual(['a.wav'])
    await expect(assets.add(new Blob([new Uint8Array(1200)]), 'big.wav')).rejects.toBeInstanceOf(AudioAssetError)
    await expect(assets.add(new Blob([new Uint8Array(900)]), 'b.wav')).rejects.toThrow(/more than/)
    const again = await assets.add(new Blob([new Uint8Array(800)]), 'a.wav') // same name+size replaces
    expect(again.id).toBe(a.id)
    const got = await assets.get(a.id)
    expect(got!.blob.size).toBe(800)
    await assets.remove(a.id)
    expect(await assets.list()).toEqual([])
  })
})
