// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  PodcastLibrary,
  isAudioEnclosure,
  isDirectAudioUrl,
  parseDuration,
  parseFeed,
  recognizeUnsupported,
  resolveAudioUrl,
  resumePoint,
} from '../src/podcast'
import { AudioEngine, AudioStartError, StreamSource, proxiedUrl } from '../src/audio'

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Test Show</title>
  <item>
    <title>Long one</title>
    <guid isPermaLink="false">ep-3</guid>
    <link>https://show.example/episodes/3</link>
    <pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate>
    <itunes:duration>1:02:03</itunes:duration>
    <enclosure url="https://cdn.example/ep3.mp3" length="48000000" type="audio/mpeg"/>
  </item>
  <item>
    <title>Short one</title>
    <link>javascript:alert(1)</link>
    <itunes:duration>12:34</itunes:duration>
    <enclosure url="ep2.m4a" length="0" type="audio/x-m4a"/>
  </item>
  <item>
    <title>Seconds only</title>
    <itunes:duration>754</itunes:duration>
    <enclosure url="https://cdn.example/trailer.mp4" type="video/mp4"/>
    <enclosure url="https://cdn.example/ep1.mp3" type="audio/mpeg"/>
  </item>
  <item>
    <title>Video ad</title>
    <enclosure url="https://ads.example/spot.mp4" type="video/mp4"/>
  </item>
  <item><title>No enclosure at all</title></item>
  <item>
    <enclosure url="https://cdn.example/untitled.mp3"/>
  </item>
</channel>
</rss>`

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Show</title>
  <entry>
    <title>First</title><id>urn:1</id><published>2026-10-01T00:00:00Z</published>
    <link rel="alternate" href="https://show.example/1"/>
    <link rel="enclosure" href="https://show.example/1.ogg" type="audio/ogg" length="1234"/>
  </entry>
  <entry><title>Video only</title><link rel="enclosure" href="https://show.example/2.webm" type="video/webm"/></entry>
</feed>`

describe('feed parsing', () => {
  test('iTunes durations: HH:MM:SS, MM:SS, seconds; junk is undefined', () => {
    expect(parseDuration('1:02:03')).toBe(3723)
    expect(parseDuration('12:34')).toBe(754)
    expect(parseDuration('754')).toBe(754)
    expect(parseDuration('754.6')).toBe(755)
    expect(parseDuration('0:05')).toBe(5)
    expect(parseDuration('')).toBeUndefined()
    expect(parseDuration(null)).toBeUndefined()
    expect(parseDuration('about an hour')).toBeUndefined()
    expect(parseDuration('1:75')).toBeUndefined()
  })

  test('RSS 2.0 with iTunes tags: episodes with title, date, duration, size; video/ad items and empty items skipped', () => {
    const f = parseFeed(RSS, 'https://feeds.example/show.xml')
    expect(f.title).toBe('Test Show')
    expect(f.episodes.map((e) => e.title)).toEqual(['Long one', 'Short one', 'Seconds only', 'untitled.mp3'])
    const [a, b, c, d] = f.episodes
    expect(a).toMatchObject({ id: 'ep-3', page: 'https://show.example/episodes/3', duration: 3723, size: 48000000, url: 'https://cdn.example/ep3.mp3', date: Date.UTC(2026, 9, 5, 10) })
    // relative enclosure resolved against the feed; length 0 → unknown size; missing guid → url as id
    // only an http(s) <link> is kept as the episode page
    expect(b).toMatchObject({ page: undefined, url: 'https://feeds.example/ep2.m4a', size: undefined, duration: 754, id: 'https://feeds.example/ep2.m4a' })
    // several enclosures: the first audio one wins
    expect(c.url).toBe('https://cdn.example/ep1.mp3')
    expect(c.duration).toBe(754)
    // missing title, date, duration, type
    expect(d).toMatchObject({ title: 'untitled.mp3', date: undefined, duration: undefined })
  })

  test('Atom: rel=enclosure links', () => {
    const f = parseFeed(ATOM, 'https://show.example/atom')
    expect(f.title).toBe('Atom Show')
    expect(f.episodes).toHaveLength(1)
    expect(f.episodes[0]).toMatchObject({ id: 'urn:1', title: 'First', url: 'https://show.example/1.ogg', page: 'https://show.example/1', size: 1234, date: Date.UTC(2026, 9, 1) })
  })

  test('not a feed', () => {
    expect(() => parseFeed('<html><body>hi</body></html>')).toThrow(/not a podcast feed/)
    expect(() => parseFeed('this is not xml <')).toThrow(/not a podcast feed/)
  })

  test('audio enclosure recognition', () => {
    expect(isAudioEnclosure('x.mp3', 'audio/mpeg')).toBe(true)
    expect(isAudioEnclosure('x.mp4', 'video/mp4')).toBe(false)
    expect(isAudioEnclosure('https://a/b.mp3', '')).toBe(true)
    expect(isAudioEnclosure('https://a/b.mp3?x=1', null)).toBe(true)
    expect(isAudioEnclosure('https://a/b.pdf', 'application/pdf')).toBe(false)
    expect(isAudioEnclosure('https://a/live.m3u8', 'application/vnd.apple.mpegurl')).toBe(true)
  })
})

describe('links to services whose audio a page cannot read', () => {
  test.each([
    ['https://www.youtube.com/watch?v=abc', 'YouTube'],
    ['https://youtu.be/abc', 'YouTube'],
    ['https://m.youtube.com/watch?v=abc', 'YouTube'],
    ['https://music.youtube.com/watch?v=abc', 'YouTube'],
    ['https://vimeo.com/12345', 'Vimeo'],
    ['https://player.vimeo.com/video/1', 'Vimeo'],
    ['https://open.spotify.com/episode/xyz', 'Spotify'],
    ['https://podcasts.apple.com/us/podcast/x/id1', 'Apple Podcasts'],
    ['https://soundcloud.com/a/b', 'SoundCloud'],
  ])('%s → %s, with the working alternatives', (url, service) => {
    const r = recognizeUnsupported(url)
    expect(r?.service).toBe(service)
    expect(r?.message).toMatch(/Audio file…/)
    expect(r?.message).toMatch(/Microphone/)
  })
  test('ordinary links are not flagged', () => {
    expect(recognizeUnsupported('https://feeds.example/show.xml')).toBeUndefined()
    expect(recognizeUnsupported('https://notyoutube.com/x.mp3')).toBeUndefined()
    expect(recognizeUnsupported('not a url')).toBeUndefined()
    // SoundCloud podcast RSS feeds are feeds, not SoundCloud pages
    expect(recognizeUnsupported('https://feeds.soundcloud.com/users/soundcloud:users:123/sounds.rss')).toBeUndefined()
    expect(recognizeUnsupported('https://soundcloud.com/someone/sounds.rss')).toBeUndefined()
  })
})

const res = (body: string, type: string, status = 200) => new Response(body, { status, headers: { 'content-type': type } })

describe('resolveAudioUrl', () => {
  test('direct audio by extension needs no request; HLS too', async () => {
    const fetch = vi.fn()
    expect(await resolveAudioUrl('https://cdn.example/ep.mp3', { fetch, proxy: null })).toEqual({ kind: 'audio', url: 'https://cdn.example/ep.mp3' })
    expect((await resolveAudioUrl('https://cdn.example/live.m3u8', { fetch, proxy: null })).kind).toBe('audio')
    expect(fetch).not.toHaveBeenCalled()
    expect(isDirectAudioUrl('https://cdn.example/feed/episode.mp3')).toBe(false) // looks like a feed path: ask the server
  })
  test('a feed with CORS is fetched and parsed', async () => {
    const fetch = vi.fn(async () => res(RSS, 'application/rss+xml'))
    const r = await resolveAudioUrl('https://feeds.example/show', { fetch, proxy: null })
    expect(r.kind).toBe('feed')
    if (r.kind === 'feed') expect(r.feed.episodes).toHaveLength(4)
    expect((fetch.mock.calls[0] as unknown[])[1]).toMatchObject({ mode: 'cors', credentials: 'same-origin' })
  })
  test('audio recognised by Content-Type', async () => {
    const r = await resolveAudioUrl('https://radio.example/live', { fetch: async () => res('xx', 'audio/mpeg'), proxy: null })
    expect(r).toEqual({ kind: 'audio', url: 'https://radio.example/live' })
  })
  test('no CORS: reachable without CORS → blocked, with the working routes for a feed', async () => {
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.mode === 'cors') throw new TypeError('Failed to fetch')
      return new Response(null, { status: 200 })
    })
    const r = await resolveAudioUrl('https://feeds.example/show.rss', { fetch, proxy: null })
    expect(r.kind).toBe('blocked')
    if (r.kind === 'blocked') {
      expect(r.looksLikeFeed).toBe(true)
      expect(r.message).toMatch(/direct audio URL/)
      expect(r.message).toMatch(/Audio file…/)
    }
    const r2 = await resolveAudioUrl('https://radio.example/live', { fetch, proxy: null })
    expect(r2.kind === 'blocked' && r2.looksLikeFeed).toBe(false)
  })
  test('unreachable and HTTP errors are said plainly', async () => {
    const down = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await resolveAudioUrl('https://nowhere.example/feed', { fetch: down, proxy: null })).toMatchObject({ kind: 'error', code: 'unreachable' })
    expect(await resolveAudioUrl('https://x.example/feed', { fetch: async () => res('no', 'text/plain', 404), proxy: null })).toMatchObject({ kind: 'error', code: 'http' })
    expect(await resolveAudioUrl('ftp://x.example/feed', { proxy: null })).toMatchObject({ kind: 'error', code: 'invalid' })
    expect((await resolveAudioUrl('https://youtu.be/x', { proxy: null })).kind).toBe('unsupported')
  })
  test('the optional proxy is used only after a CORS refusal', async () => {
    const seen: string[] = []
    const fetch = vi.fn(async (u: string, init?: RequestInit) => {
      seen.push(`${init?.mode}:${u}`)
      if (u.startsWith('https://proxy.example/')) return res(RSS, 'application/xml')
      if (init?.mode === 'cors') throw new TypeError('Failed to fetch')
      return new Response(null)
    })
    const r = await resolveAudioUrl('https://feeds.example/show.xml', { fetch, proxy: 'https://proxy.example/get?u={url}' })
    expect(r.kind === 'feed' && r.viaProxy).toBe(true)
    expect(seen.at(-1)).toBe('cors:https://proxy.example/get?u=' + encodeURIComponent('https://feeds.example/show.xml'))
    expect(proxiedUrl('https://p.example/?url=', 'https://a/b c')).toBe('https://p.example/?url=https%3A%2F%2Fa%2Fb%20c')
  })
  test('through the feed proxy: relative links resolve against the feed, the feed keeps its own URL; a refusal is "blocked"', async () => {
    const rel = RSS.replace('https://cdn.example/ep3.mp3', 'media/ep3.mp3')
    const fetch = vi.fn(async (u: string, init?: RequestInit) => {
      if (u.startsWith('/api/feed?url=')) return u.includes('radio') ? res('not a feed', 'text/plain', 415) : new Response(rel, { headers: { 'content-type': 'application/rss+xml', 'x-feed-url': 'https://feeds.example/final/show.xml' } })
      if (init?.mode === 'cors') throw new TypeError('Failed to fetch')
      return new Response(null)
    })
    const r = await resolveAudioUrl('https://feeds.example/show.rss', { fetch, proxy: '/api/feed?url=' })
    expect(r.kind).toBe('feed')
    if (r.kind === 'feed') {
      expect(r.viaProxy).toBe(true)
      expect(r.feed.url).toBe('https://feeds.example/show.rss')
      expect(r.feed.episodes[0].url).toBe('https://feeds.example/final/media/ep3.mp3')
    }
    // a radio stream without CORS: the feeds-only proxy refuses it, and it is tried as a stream as before
    expect(await resolveAudioUrl('https://radio.example/live', { fetch, proxy: '/api/feed?url=' })).toMatchObject({ kind: 'blocked', looksLikeFeed: false })
    const r2 = await resolveAudioUrl('https://radio.example/live', { fetch, proxy: '/api/feed?url=' })
    expect(r2.kind === 'blocked' && r2.message).toMatch(/feed proxy couldn’t read it either: it answered 415/)
    // the site's own proxy may need the deployment's cookies (Vercel preview protection)
    expect(fetch.mock.calls.find(([u]) => String(u).startsWith('/api/feed'))?.[1]).toMatchObject({ credentials: 'same-origin' })
  })
  test('feeds over the size cap are refused', async () => {
    const r = await resolveAudioUrl('https://feeds.example/show', { fetch: async () => res(RSS, 'application/xml'), proxy: null, maxFeedBytes: 100 })
    expect(r).toMatchObject({ kind: 'error', code: 'too-large' })
  })
})

describe('recent feeds and positions', () => {
  const feed = (url: string, n = 2) => ({ url, title: url, episodes: Array.from({ length: n }, (_, i) => ({ id: String(i), title: String(i), url: `${url}/${i}.mp3` })) })
  test('positions persist per episode; the cap drops the least recently played', async () => {
    let t = 0
    const lib = new PodcastLibrary({ indexedDB: new IDBFactory(), limits: { positions: 3 }, now: () => ++t })
    for (const i of [1, 2, 3, 4]) await lib.savePosition(`https://a/${i}.mp3`, i * 60, { duration: 3600, feedUrl: 'https://a' })
    expect((await lib.positions()).map((p) => p.url)).toEqual(['https://a/4.mp3', 'https://a/3.mp3', 'https://a/2.mp3'])
    expect((await lib.position('https://a/2.mp3'))?.position).toBe(120)
    expect(await lib.position('https://a/1.mp3')).toBeUndefined()
    // a fresh instance over the same database reads them back
    await lib.savePosition('https://a/3.mp3', 99)
    expect((await lib.positions())[0]).toMatchObject({ url: 'https://a/3.mp3', position: 99 })
  })
  test('recent feeds are capped; forget removes a feed and its positions; forgetAll clears everything', async () => {
    let t = 0
    const lib = new PodcastLibrary({ indexedDB: new IDBFactory(), limits: { feeds: 2 }, now: () => ++t })
    await lib.rememberFeed(feed('https://one'))
    await lib.savePosition('https://one/0.mp3', 30, { feedUrl: 'https://one' })
    await lib.rememberFeed(feed('https://two'))
    await lib.savePosition('https://two/0.mp3', 40, { feedUrl: 'https://two' })
    await lib.rememberFeed(feed('https://three', 5))
    const recent = await lib.recentFeeds()
    expect(recent.map((f) => f.url)).toEqual(['https://three', 'https://two'])
    expect(recent[0].episodes).toBe(5)
    expect(await lib.position('https://one/0.mp3')).toBeUndefined() // dropped with its feed
    await lib.forgetFeed('https://two')
    expect((await lib.recentFeeds()).map((f) => f.url)).toEqual(['https://three'])
    expect(await lib.position('https://two/0.mp3')).toBeUndefined()
    await lib.savePosition('https://x.mp3', 10)
    await lib.forgetAll()
    expect(await lib.recentFeeds()).toEqual([])
    expect(await lib.positions()).toEqual([])
  })
  test('resume point skips the first seconds and the last half minute', () => {
    expect(resumePoint(undefined)).toBe(0)
    expect(resumePoint({ url: 'u', position: 3, updatedAt: 0 })).toBe(0)
    expect(resumePoint({ url: 'u', position: 600, updatedAt: 0 }, 3600)).toBe(600)
    expect(resumePoint({ url: 'u', position: 3590, updatedAt: 0 }, 3600)).toBe(0)
  })
})

// ------------------------------------------------------------------ stream source: positions, speed, proxy, play-only

type Plan = (el: any) => 'ok' | 'error'
function elements(plan: Plan) {
  const made: any[] = []
  const factory = () => {
    const ls: Record<string, Array<() => void>> = {}
    const el: any = {
      crossOrigin: null, muted: false, paused: true, ended: false, readyState: 0, duration: NaN, currentTime: 0, playbackRate: 1, loop: false, preload: '',
      addEventListener: (e: string, f: () => void) => (ls[e] = [...(ls[e] || []), f]),
      removeEventListener: (e: string, f: () => void) => (ls[e] = (ls[e] || []).filter((x) => x !== f)),
      removeAttribute: () => {},
      load: () => {},
      play: vi.fn(async () => { el.paused = false }),
      pause: vi.fn(() => { el.paused = true }),
      set src(v: string) {
        el._src = v
        const r = plan(el)
        setTimeout(() => {
          if (r === 'ok') {
            el.duration = 3600
            el.readyState = 1
            ;(ls.loadedmetadata || []).forEach((f) => f())
          }
          ;(ls[r === 'ok' ? 'canplay' : 'error'] || []).forEach((f) => f())
        }, 0)
      },
      get src() { return el._src },
    }
    made.push(el)
    return el
  }
  return { factory, made }
}
const ctx = () => {
  const mk = (x: object = {}) => ({ connect() {}, disconnect() {}, ...x })
  return {
    state: 'running', sampleRate: 44100, destination: mk(),
    resume: async () => {}, addEventListener: () => {},
    createMediaElementSource: (el: any) => mk({ el }),
    createMediaStreamSource: (s: any) => mk({ s }),
    createGain: () => mk({ gain: { value: 1 } }),
    createAnalyser: () => mk({ fftSize: 0, getFloatTimeDomainData: (b: Float32Array) => b.fill(0) }),
  } as any
}

describe('StreamSource for episodes', () => {
  test('starts at the saved position with the chosen speed; stop() remembers the place for the next start', async () => {
    const { factory, made } = elements(() => 'ok')
    const s = new StreamSource('https://cdn.example/ep.mp3', { createElement: factory, startAt: 600, rate: 1.5, name: 'Episode 3' })
    await s.start(ctx())
    expect(s.label).toBe('Episode 3')
    expect(made[0].currentTime).toBe(600)
    expect(made[0].playbackRate).toBe(1.5)
    s.transport!.rate = 2
    expect(made[0].playbackRate).toBe(2)
    made[0].currentTime = 900
    s.stop()
    await s.start(ctx())
    expect(made[1].currentTime).toBe(900)
    expect(made[1].playbackRate).toBe(2)
  })

  test('analysis allowed vs play-only: no CORS → no-cors error; asPlayOnly keeps name, position and speed', async () => {
    const { factory, made } = elements((el) => (el.crossOrigin === 'anonymous' ? 'error' : 'ok'))
    const s = new StreamSource('https://cdn.example/nocors.mp3', { createElement: factory, startAt: 120, rate: 1.25, name: 'Ep' })
    const err = await s.start(ctx()).catch((e) => e)
    expect(err).toBeInstanceOf(AudioStartError)
    expect(err.code).toBe('no-cors')
    const p = s.asPlayOnly()
    expect(p.playOnly).toBe(true)
    expect(p.label).toBe('Ep')
    await p.start(ctx())
    await new Promise((r) => setTimeout(r, 5)) // metadata arrives after play-only returns
    const el = made.at(-1)
    expect(el.crossOrigin).toBeNull()
    expect(el.currentTime).toBe(120)
    expect(el.playbackRate).toBe(1.25)
  })

  test('engine states: analysis allowed → running/waiting; play-only → analysis off', async () => {
    const mkEngine = () => new AudioEngine({ contextFactory: () => ctx(), scheduler: () => () => {}, silentBypass: false, analyze: () => ({ total: 0, specific: new Array(24).fill(0) }) })
    const ok = mkEngine()
    ok.setSource(new StreamSource('https://cdn.example/ep.mp3', { createElement: elements(() => 'ok').factory }))
    await ok.start()
    expect([ok.state, ok.analysis]).toEqual(['running', 'waiting'])
    const blocked = mkEngine()
    blocked.setSource(new StreamSource('https://cdn.example/nocors.mp3', { createElement: elements((el) => (el.crossOrigin === 'anonymous' ? 'error' : 'ok')).factory }))
    await blocked.start().catch(() => {})
    expect(blocked.state).toBe('error')
    expect(blocked.lastError?.canPlayOnly).toBe(true)
    blocked.setSource((blocked.source as StreamSource).asPlayOnly())
    await blocked.start()
    expect([blocked.state, blocked.analysis, blocked.source?.playOnly]).toEqual(['running', 'off', true])
  })

  test('with AUDIO_PROXY_URL set, a no-CORS episode is analysed through the proxy', async () => {
    const { factory, made } = elements((el) => (String(el.src).startsWith('https://proxy.example/') ? 'ok' : 'error'))
    const s = new StreamSource('https://cdn.example/nocors.mp3', { createElement: factory, proxy: 'https://proxy.example/?url=' })
    const node: any = await s.start(ctx())
    expect(s.viaProxy).toBe(true)
    expect(node.el.src).toBe('https://proxy.example/?url=' + encodeURIComponent('https://cdn.example/nocors.mp3'))
    expect(node.el.crossOrigin).toBe('anonymous')
    expect(made.length).toBe(2)
  })
})

