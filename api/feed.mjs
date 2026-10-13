// Feeds-only CORS proxy for the Podcast / URL source (docs/audio.md › Running your own proxy). Deployed with the site on
// Vercel and used only after a feed host refuses CORS (FEED_PROXY_URL=/api/feed?url=, set in vercel.json's buildCommand).
// It is not an open relay: it answers same-origin requests only (no Access-Control-Allow-Origin, so other sites' pages
// cannot read it), GET only, http(s) targets on public addresses only (checked at connect time and on every redirect),
// RSS/Atom/XML responses only, at most 10 MB, no cookies or credentials either way. Audio is never proxied here.
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import { BlockList, isIP } from 'node:net'

export const LIMITS = { maxBytes: 10 * 1024 * 1024, timeoutMs: 10000, maxRedirects: 5 }
const TYPES = /^(application\/(rss\+xml|atom\+xml|xml|rdf\+xml)|text\/xml)\b/i

const blocked = new BlockList()
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]])
  blocked.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]]) blocked.addSubnet(net, bits, 'ipv6')

/** True for loopback, private, link-local, CGNAT, multicast, documentation and metadata addresses. */
export function isPrivateAddress(addr) {
  const v = isIP(addr)
  if (v === 4) return blocked.check(addr, 'ipv4')
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr)
    if (mapped) return blocked.check(mapped[1], 'ipv4')
    return blocked.check(addr, 'ipv6')
  }
  return true
}

/** dns.lookup that refuses private addresses: used as the connect-time lookup, so DNS rebinding can't slip past. */
export function publicLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err)
    const bad = addrs.find((a) => isPrivateAddress(a.address))
    if (bad || !addrs.length) return cb(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }))
    if (options?.all) return cb(null, addrs)
    cb(null, addrs[0].address, addrs[0].family)
  })
}

class ProxyError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function get(target, lookup, isPrivate, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u
    try {
      u = new URL(target)
    } catch {
      return reject(new ProxyError(400, 'invalid url'))
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new ProxyError(400, 'only http(s) urls'))
    if (u.username || u.password) return reject(new ProxyError(400, 'no credentials in urls'))
    if (isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivate(u.hostname.replace(/^\[|\]$/g, ''))) return reject(new ProxyError(403, 'blocked address'))
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.get(u, { lookup, headers: { 'user-agent': 'iDra feed proxy (+https://github.com/thepelkus-too/iDra)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9' }, timeout: LIMITS.timeoutMs }, (res) => {
      const code = res.statusCode ?? 0
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume()
        if (redirects >= LIMITS.maxRedirects) return reject(new ProxyError(508, 'too many redirects'))
        return resolve(get(new URL(res.headers.location, u).href, lookup, isPrivate, redirects + 1))
      }
      resolve({ res, finalUrl: u.href })
    })
    req.on('timeout', () => req.destroy(new ProxyError(504, 'timed out')))
    req.on('error', (e) => reject(e instanceof ProxyError ? e : new ProxyError(e.code === 'EBLOCKED' ? 403 : 502, e.code === 'EBLOCKED' ? 'blocked address' : `unreachable${e.code ? ` (${e.code})` : ''}`)))
  })
}

/** Vercel Node function (also usable with a plain node:http server). `opts.lookup` / `opts.isPrivate` are for tests. */
export default async function handler(req, res, opts = {}) {
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
    res.end(body)
  }
  if (req.method !== 'GET') return send(405, 'GET only', { allow: 'GET' })
  // same-origin only: browsers send Sec-Fetch-Site; refuse other sites' pages outright
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return send(403, 'same-origin only')
  const target = new URL(req.url ?? '/', 'http://x').searchParams.get('url')
  if (!target) return send(400, 'missing ?url=')
  let upstream
  try {
    upstream = await get(target, opts.lookup ?? publicLookup, opts.isPrivate ?? isPrivateAddress)
  } catch (e) {
    return send(e.status ?? 502, e.message ?? 'failed')
  }
  const { res: up } = upstream
  const status = up.statusCode ?? 502
  const type = String(up.headers['content-type'] ?? '')
  if (status < 200 || status >= 300) {
    up.resume()
    return send(status === 404 ? 404 : 502, `upstream answered ${status}`)
  }
  if (!TYPES.test(type)) {
    up.resume()
    return send(415, 'not a feed (only RSS/Atom/XML is proxied)')
  }
  const len = Number(up.headers['content-length'])
  if (len > LIMITS.maxBytes) {
    up.resume()
    return send(413, 'feed too large')
  }
  const chunks = []
  let n = 0
  try {
    for await (const c of up) {
      n += c.length
      if (n > LIMITS.maxBytes) {
        up.destroy()
        return send(413, 'feed too large')
      }
      chunks.push(c)
    }
  } catch (e) {
    return send(502, `upstream failed${e?.code ? ` (${e.code})` : ''}`)
  }
  // no Access-Control-Allow-Origin: only iDra's own pages (same origin) can read this
  res.writeHead(200, { 'content-type': type, 'cache-control': 'public, s-maxage=300, max-age=0', 'x-content-type-options': 'nosniff', 'x-feed-url': upstream.finalUrl })
  res.end(Buffer.concat(chunks))
}
