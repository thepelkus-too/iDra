// Podcast feeds and pasted audio URLs for the audio panel's "Podcast / URL" source. Everything here runs in the HOST page.
// A web page can read a feed, and analyse its audio, only when each host sends CORS headers; the code says plainly which
// part was refused and offers the routes that do work (a direct audio URL, the Files picker, the mic or an input device).
// Nothing here extracts audio from YouTube, Vimeo, Spotify or Apple Podcasts pages: those links get an explanation only.
// See docs/audio.md › Podcasts.

import { openSimpleStore, type SimpleStore } from './idb-store'
import { isHlsUrl, proxiedUrl } from './audio-sources'

// ------------------------------------------------------------------ build-time proxy hook (unset by default)

declare const __AUDIO_PROXY_URL__: string | undefined

/**
 * The `AUDIO_PROXY_URL` build setting, or undefined. The repo ships no proxy and no default: whoever sets it runs their own
 * (docs/audio.md › Running your own proxy). `override` is for tests; `null` forces "no proxy".
 */
export function audioProxyUrl(override?: string | null): string | undefined {
  if (override !== undefined) return override || undefined
  try {
    if (typeof __AUDIO_PROXY_URL__ !== 'undefined' && __AUDIO_PROXY_URL__) return __AUDIO_PROXY_URL__
  } catch {
    /* not defined in this build */
  }
  return undefined
}

// ------------------------------------------------------------------ links we recognise but cannot use

export interface UnsupportedService {
  service: 'YouTube' | 'Vimeo' | 'Spotify' | 'Apple Podcasts' | 'SoundCloud'
  message: string
}

const ROUTES = 'What works instead: download your own copy of the audio and pick it under “Audio file…”, or play it on another device (or this one through a loopback cable) and use the Microphone or “Input device…”.'

/** Recognise links to services whose audio a web page cannot read, with a short, kind explanation. */
export function recognizeUnsupported(url: string): UnsupportedService | undefined {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return undefined
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '')
  const is = (...hs: string[]) => hs.some((x) => host === x || host.endsWith('.' + x))
  if (is('youtube.com', 'youtu.be', 'youtube-nocookie.com'))
    return { service: 'YouTube', message: `YouTube plays inside its own player and doesn’t let web pages hear the sound, so it can’t drive visuals here (and copying the audio out would break YouTube’s terms). ${ROUTES}` }
  if (is('vimeo.com'))
    return { service: 'Vimeo', message: `Vimeo plays inside its own player and doesn’t let web pages hear the sound, so it can’t drive visuals here. ${ROUTES}` }
  if (is('spotify.com', 'spotify.link'))
    return { service: 'Spotify', message: `Spotify’s audio is protected and only plays in Spotify’s own player. If the show is a podcast that is also published elsewhere, paste its RSS feed instead. ${ROUTES}` }
  if (is('podcasts.apple.com', 'itunes.apple.com'))
    return { service: 'Apple Podcasts', message: `That is an Apple Podcasts page, not the podcast itself. Most shows publish an RSS feed (look for “RSS” on the show’s website) — paste that here. ${ROUTES}` }
  if (is('soundcloud.com', 'on.soundcloud.com'))
    return { service: 'SoundCloud', message: `SoundCloud pages play in SoundCloud’s own player, which web pages can’t listen to. If the track is downloadable, save it and use “Audio file…”; a SoundCloud podcast’s RSS feed can be pasted here. ${ROUTES}` }
  return undefined
}

// ------------------------------------------------------------------ feed parsing

export interface PodcastEpisode {
  /** guid, else the audio URL */
  id: string
  title: string
  /** ms since epoch, when the feed gives a parseable date */
  date?: number
  /** seconds */
  duration?: number
  /** bytes, from the enclosure length when > 0 */
  size?: number
  url: string
  type?: string
}

export interface PodcastFeed {
  url: string
  title: string
  episodes: PodcastEpisode[]
}

/** itunes:duration: `HH:MM:SS`, `MM:SS`, plain seconds (also with decimals). Undefined when unreadable. */
export function parseDuration(s: string | null | undefined): number | undefined {
  if (s == null) return undefined
  const t = String(s).trim()
  if (!t) return undefined
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t))
  const m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?(\.\d+)?$/.exec(t)
  if (!m) return undefined
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number)
  if (parts.slice(1).some((p) => p >= 60)) return undefined
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|wav|flac|mp2|weba)(\?|#|$)/i
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi)(\?|#|$)/i

/** True for an enclosure the audio panel can use: audio types (and HLS); video and unknown non-audio types are skipped. */
export function isAudioEnclosure(url: string, type?: string | null): boolean {
  const ty = (type ?? '').toLowerCase().trim()
  if (ty.startsWith('audio/') || ty === 'application/vnd.apple.mpegurl' || ty === 'application/x-mpegurl') return true
  if (ty.startsWith('video/')) return false
  if (ty && ty !== 'application/octet-stream') return false
  return AUDIO_EXT.test(url) || (isHlsUrl(url) && !VIDEO_EXT.test(url))
}

function localName(n: Element): string {
  return (n.localName || n.nodeName).replace(/^.*:/, '').toLowerCase()
}
function kids(el: Element, name: string, prefix?: string): Element[] {
  return Array.from(el.children).filter((c) => localName(c) === name && (prefix === undefined || (c.prefix ?? '') === prefix || c.nodeName.toLowerCase() === `${prefix}:${name}`))
}
function text(el: Element | undefined): string {
  return (el?.textContent ?? '').trim()
}
function firstText(el: Element, names: Array<[string, string?]>): string {
  for (const [n, p] of names) {
    const t = text(kids(el, n, p)[0])
    if (t) return t
  }
  return ''
}
function parseDate(s: string): number | undefined {
  if (!s) return undefined
  const t = Date.parse(s)
  return isNaN(t) ? undefined : t
}
function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}

export class PodcastError extends Error {
  constructor(message: string, readonly code: 'no-cors' | 'unreachable' | 'http' | 'not-a-feed' | 'too-large' | 'invalid') {
    super(message)
    this.name = 'PodcastError'
  }
}

/**
 * Parse RSS 2.0 (with iTunes tags) or Atom. Items without a usable audio enclosure (video, ads served as video, missing
 * enclosures) are left out; of several enclosures the first audio one wins. Throws PodcastError('not-a-feed').
 */
export function parseFeed(xml: string, feedUrl = ''): PodcastFeed {
  const Parser = (globalThis as any).DOMParser as typeof DOMParser | undefined
  if (!Parser) throw new PodcastError('This browser cannot read XML feeds.', 'not-a-feed')
  const doc = new Parser().parseFromString(xml, 'application/xml')
  const root = doc.documentElement
  if (!root || doc.getElementsByTagName('parsererror').length) throw new PodcastError('This is not a podcast feed (it is not valid RSS or Atom).', 'not-a-feed')
  const rootName = localName(root)
  const episodes: PodcastEpisode[] = []
  let title = ''
  if (rootName === 'rss' || rootName === 'rdf') {
    const channel = kids(root, 'channel')[0] ?? root
    title = firstText(channel, [['title']])
    const items = rootName === 'rdf' ? kids(root, 'item') : kids(channel, 'item')
    for (const it of items) {
      const encs = kids(it, 'enclosure').map((e) => ({ url: e.getAttribute('url') ?? '', type: e.getAttribute('type'), length: e.getAttribute('length') }))
      const media = Array.from(it.getElementsByTagName('*'))
        .filter((e) => localName(e) === 'content' && e.getAttribute('url'))
        .map((e) => ({ url: e.getAttribute('url') ?? '', type: e.getAttribute('type'), length: e.getAttribute('fileSize') }))
      const enc = [...encs, ...media].find((e) => e.url && isAudioEnclosure(e.url, e.type))
      if (!enc) continue
      const url = absolute(enc.url, feedUrl)
      const size = Number(enc.length)
      episodes.push({
        id: text(kids(it, 'guid')[0]) || url,
        title: firstText(it, [['title'], ['title', 'itunes']]) || url.split('/').pop() || 'Episode',
        date: parseDate(firstText(it, [['pubdate'], ['date', 'dc']])),
        duration: parseDuration(firstText(it, [['duration', 'itunes'], ['duration']])),
        size: size > 0 ? size : undefined,
        url,
        type: enc.type ?? undefined,
      })
    }
  } else if (rootName === 'feed') {
    title = text(kids(root, 'title')[0])
    for (const it of kids(root, 'entry')) {
      const link = kids(it, 'link').find((l) => l.getAttribute('rel') === 'enclosure' && isAudioEnclosure(l.getAttribute('href') ?? '', l.getAttribute('type')))
      if (!link) continue
      const url = absolute(link.getAttribute('href') ?? '', feedUrl)
      const size = Number(link.getAttribute('length'))
      episodes.push({
        id: text(kids(it, 'id')[0]) || url,
        title: text(kids(it, 'title')[0]) || url.split('/').pop() || 'Episode',
        date: parseDate(text(kids(it, 'published')[0]) || text(kids(it, 'updated')[0])),
        duration: parseDuration(firstText(it, [['duration', 'itunes'], ['duration']])),
        size: size > 0 ? size : undefined,
        url,
        type: link.getAttribute('type') ?? undefined,
      })
    }
  } else throw new PodcastError('This is not a podcast feed (it is not RSS or Atom).', 'not-a-feed')
  return { url: feedUrl, title: title || hostOf(feedUrl) || 'Podcast', episodes }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

// ------------------------------------------------------------------ what is this URL?

export type UrlResolution =
  | { kind: 'unsupported'; service: UnsupportedService['service']; message: string }
  | { kind: 'feed'; feed: PodcastFeed; viaProxy: boolean }
  | { kind: 'audio'; url: string }
  /** the host doesn't let browsers read it: it may still be audio that plays (try it as a stream, play-only if need be) */
  | { kind: 'blocked'; url: string; looksLikeFeed: boolean; message: string }
  | { kind: 'error'; message: string; code: PodcastError['code'] }

export const FEED_LIMITS = {
  /** feeds larger than this are not parsed (bytes) */
  maxFeedBytes: 15 * 1024 * 1024,
  timeoutMs: 20000,
}

export const FEED_BLOCKED_TEXT =
  'This podcast’s host doesn’t let web pages read its feed (no CORS headers), so the episode list can’t be shown. Two routes work: paste one episode’s direct audio URL (in most podcast apps: Share › Copy link to the episode file, or the “Download” link on the show’s site), or download the episode and pick it under “Audio file…”.'

export function looksLikeFeedUrl(url: string): boolean {
  return /(\.(rss|xml|atom)(\?|#|$))|\/(feed|rss|podcast)s?(\/|\.|\?|$)|[?&](format|feed)=rss/i.test(url)
}

/** A link that is plainly an audio file or HLS playlist by its extension (no request needed). */
export function isDirectAudioUrl(url: string): boolean {
  let path: string
  try {
    path = new URL(url.trim()).pathname
  } catch {
    return false
  }
  return isHlsUrl(url) || (AUDIO_EXT.test(path) && !looksLikeFeedUrl(url))
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

async function readCapped(res: Response, cap: number): Promise<string> {
  const len = Number(res.headers.get('content-length'))
  if (len > cap) throw new PodcastError(`The feed is ${Math.round(len / 1048576)} MB, too large to read here.`, 'too-large')
  const body = res.body as ReadableStream<Uint8Array> | null
  if (!body?.getReader) return res.text()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.byteLength
    if (n > cap) {
      void reader.cancel().catch(() => {})
      throw new PodcastError(`The feed is over ${Math.round(cap / 1048576)} MB, too large to read here.`, 'too-large')
    }
    chunks.push(value)
  }
  const all = new Uint8Array(n)
  let o = 0
  for (const c of chunks) {
    all.set(c, o)
    o += c.byteLength
  }
  return new TextDecoder().decode(all)
}

/**
 * Work out what a pasted URL is: an unsupported service, an RSS/Atom feed (fetched and parsed), a direct audio URL, or a
 * URL whose host refuses browsers (CORS). Direct audio files are recognised by extension or by the response's
 * Content-Type, and their body is cancelled at once (a long episode is never downloaded here).
 */
export async function resolveAudioUrl(raw: string, opts: { fetch?: FetchLike; proxy?: string | null; timeoutMs?: number; maxFeedBytes?: number } = {}): Promise<UrlResolution> {
  const url = raw.trim()
  const bad = recognizeUnsupported(url)
  if (bad) return { kind: 'unsupported', ...bad }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: 'error', code: 'invalid', message: 'Paste a full link that starts with https://' }
  }
  if (!/^https?:$/.test(parsed.protocol)) return { kind: 'error', code: 'invalid', message: 'Paste an http(s) link to a podcast feed or an audio file.' }
  if (isDirectAudioUrl(url)) return { kind: 'audio', url }
  const f: FetchLike = opts.fetch ?? ((i, init) => fetch(i, init))
  const proxy = audioProxyUrl(opts.proxy)
  const cap = opts.maxFeedBytes ?? FEED_LIMITS.maxFeedBytes
  const attempt = async (target: string): Promise<Response> => {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : undefined
    const t = setTimeout(() => ac?.abort(), opts.timeoutMs ?? FEED_LIMITS.timeoutMs)
    try {
      return await f(target, { mode: 'cors', credentials: 'omit', redirect: 'follow', signal: ac?.signal })
    } finally {
      clearTimeout(t)
    }
  }
  let res: Response
  let viaProxy = false
  try {
    res = await attempt(url)
  } catch {
    // CORS refusal and network failure look the same to fetch(); a no-cors request tells them apart
    let reachable = false
    try {
      await f(url, { mode: 'no-cors', credentials: 'omit' })
      reachable = true
    } catch {
      /* unreachable */
    }
    if (!reachable) return { kind: 'error', code: 'unreachable', message: 'Could not reach that address. Check the link and the connection.' }
    if (proxy) {
      try {
        res = await attempt(proxiedUrl(proxy, url))
        viaProxy = true
      } catch {
        return blocked(url)
      }
    } else return blocked(url)
  }
  if (!res.ok) {
    void res.body?.cancel?.().catch(() => {})
    return { kind: 'error', code: 'http', message: `The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.` }
  }
  const type = (res.headers.get('content-type') ?? '').toLowerCase()
  if (type.startsWith('audio/') || type.includes('mpegurl')) {
    void res.body?.cancel?.().catch(() => {})
    return { kind: 'audio', url }
  }
  if (type.startsWith('video/')) {
    void res.body?.cancel?.().catch(() => {})
    return { kind: 'error', code: 'not-a-feed', message: 'That link is a video file. Use an audio file or a podcast feed.' }
  }
  try {
    const xml = await readCapped(res, cap)
    return { kind: 'feed', feed: parseFeed(xml, res.url || url), viaProxy }
  } catch (e) {
    if (e instanceof PodcastError) return { kind: 'error', code: e.code, message: e.message }
    return { kind: 'error', code: 'unreachable', message: `Could not read the feed: ${(e as Error).message}` }
  }
}

function blocked(url: string): UrlResolution {
  const looksLikeFeed = looksLikeFeedUrl(url)
  return { kind: 'blocked', url, looksLikeFeed, message: looksLikeFeed ? FEED_BLOCKED_TEXT : 'The host doesn’t let web pages read this link (no CORS headers). Trying it as an audio stream: it may play without driving visuals.' }
}

// ------------------------------------------------------------------ recent feeds and positions (this device only)

export interface RecentFeed {
  url: string
  title: string
  episodes: number
  openedAt: number
}
export interface EpisodePosition {
  /** episode audio URL */
  url: string
  feedUrl?: string
  position: number
  duration?: number
  updatedAt: number
}

export const PODCAST_LIMITS = {
  /** recent feeds remembered; the least recently opened is dropped first */
  feeds: 12,
  /** episode positions remembered; the least recently played is dropped first */
  positions: 200,
}

type Row = ({ t: 'feed' } & RecentFeed) | ({ t: 'pos' } & EpisodePosition)

/**
 * Recent feeds and the last position per episode, in IndexedDB (`hydra-ipad-podcasts`) on this device only, never in a
 * sketch. Capped (PODCAST_LIMITS); `forgetFeed` / `forgetAll` clear it.
 */
export class PodcastLibrary {
  private storeP: Promise<SimpleStore<Row>> | undefined
  constructor(private opts: { indexedDB?: IDBFactory; limits?: Partial<typeof PODCAST_LIMITS>; now?: () => number } = {}) {}
  private store() {
    return (this.storeP ??= openSimpleStore<Row>('hydra-ipad-podcasts', 'state', this.opts.indexedDB ?? (globalThis as any).indexedDB))
  }
  get limits() {
    return { ...PODCAST_LIMITS, ...this.opts.limits }
  }
  private now() {
    return this.opts.now?.() ?? Date.now()
  }
  private async rows() {
    return (await this.store()).all()
  }
  async recentFeeds(): Promise<RecentFeed[]> {
    return (await this.rows())
      .filter((r): r is { t: 'feed' } & RecentFeed => r.t === 'feed')
      .map(({ t: _t, ...f }) => f)
      .sort((a, b) => b.openedAt - a.openedAt)
  }
  async rememberFeed(feed: PodcastFeed): Promise<void> {
    const s = await this.store()
    await s.put('feed:' + feed.url, { t: 'feed', url: feed.url, title: feed.title, episodes: feed.episodes.length, openedAt: this.now() })
    const all = await this.recentFeeds()
    for (const old of all.slice(this.limits.feeds)) await this.forgetFeed(old.url)
  }
  async positions(): Promise<EpisodePosition[]> {
    return (await this.rows())
      .filter((r): r is { t: 'pos' } & EpisodePosition => r.t === 'pos')
      .map(({ t: _t, ...p }) => p)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }
  async position(url: string): Promise<EpisodePosition | undefined> {
    const r = await (await this.store()).get('pos:' + url)
    if (!r || r.t !== 'pos') return undefined
    const { t: _t, ...p } = r
    return p
  }
  async savePosition(url: string, position: number, info: { duration?: number; feedUrl?: string } = {}): Promise<void> {
    if (!isFinite(position) || position < 0) return
    const s = await this.store()
    await s.put('pos:' + url, { t: 'pos', url, position, duration: info.duration && isFinite(info.duration) ? info.duration : undefined, feedUrl: info.feedUrl, updatedAt: this.now() })
    const all = await this.positions()
    for (const old of all.slice(this.limits.positions)) await s.delete('pos:' + old.url)
  }
  /** Forget a feed and every position saved for its episodes. */
  async forgetFeed(feedUrl: string): Promise<void> {
    const s = await this.store()
    await s.delete('feed:' + feedUrl)
    for (const p of await this.positions()) if (p.feedUrl === feedUrl) await s.delete('pos:' + p.url)
  }
  async forgetAll(): Promise<void> {
    const s = await this.store()
    for (const r of await s.all()) await s.delete(r.t === 'feed' ? 'feed:' + r.url : 'pos:' + r.url)
  }
}

let shared: PodcastLibrary | undefined
export function getPodcastLibrary(): PodcastLibrary {
  return (shared ??= new PodcastLibrary())
}

/** Where to resume: the saved position, unless it is in the first 5 s or the last 30 s (then start from the top). */
export function resumePoint(p: EpisodePosition | undefined, duration?: number): number {
  if (!p) return 0
  const d = duration ?? p.duration
  if (p.position < 5) return 0
  if (d && p.position > d - 30) return 0
  return p.position
}
