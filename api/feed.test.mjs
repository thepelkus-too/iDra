// node --test api/feed.test.mjs — the feeds-only proxy's safeguards, against local servers.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import dns from 'node:dns'
import handler, { LIMITS, isPrivateAddress } from './feed.mjs'

const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>T</title></channel></rss>'
let origin, proxy, base, proxyBase
// tests reach the local origin server, so the lookup lets loopback through (the real one refuses it: see the SSRF test)
const allowLocal = (h, o, cb) => dns.lookup(h, o, cb)
before(async () => {
  origin = http.createServer((req, res) => {
    if (req.url === '/feed.xml') return res.writeHead(200, { 'content-type': 'application/rss+xml', 'set-cookie': 'a=b' }).end(RSS)
    if (req.url === '/page') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html>')
    if (req.url === '/big') return res.writeHead(200, { 'content-type': 'application/xml' }).end(Buffer.alloc(LIMITS.maxBytes + 1, 32))
    if (req.url === '/hop') return res.writeHead(302, { location: '/feed.xml' }).end()
    if (req.url === '/loop') return res.writeHead(302, { location: '/loop' }).end()
    if (req.url === '/creds') return res.writeHead(200, { 'content-type': 'application/xml' }).end(JSON.stringify(req.headers))
    res.writeHead(404).end()
  })
  await new Promise((r) => origin.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${origin.address().port}`
  proxy = http.createServer((req, res) => handler(req, res, req.headers['x-test-real-lookup'] ? {} : { lookup: allowLocal, isPrivate: () => false }))
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r))
  proxyBase = `http://127.0.0.1:${proxy.address().port}/api/feed?url=`
})
after(() => {
  origin.close()
  proxy.close()
})
const via = (u, init) => fetch(proxyBase + encodeURIComponent(u), init)

test('passes an RSS feed through, with no CORS header and no cookies', async () => {
  const r = await via(base + '/feed.xml', { headers: { 'sec-fetch-site': 'same-origin' } })
  assert.equal(r.status, 200)
  assert.equal(await r.text(), RSS)
  assert.equal(r.headers.get('access-control-allow-origin'), null)
  assert.equal(r.headers.get('set-cookie'), null)
  assert.equal(r.headers.get('x-feed-url'), base + '/feed.xml')
})
test('follows redirects (re-checked), and stops redirect loops', async () => {
  const r = await via(base + '/hop')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('x-feed-url'), base + '/feed.xml')
  assert.equal((await via(base + '/loop')).status, 508)
})
test('only feeds: HTML is refused; over the size cap is refused', async () => {
  assert.equal((await via(base + '/page')).status, 415)
  assert.equal((await via(base + '/big')).status, 413)
})
test('GET only, same-origin only, http(s) only, no credentials forwarded', async () => {
  assert.equal((await fetch(proxyBase + encodeURIComponent(base + '/feed.xml'), { method: 'POST' })).status, 405)
  assert.equal((await via(base + '/feed.xml', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
  assert.equal((await via('file:///etc/passwd')).status, 400)
  assert.equal((await via(base.replace('//', '//user:pw@') + '/feed.xml')).status, 400)
  const echoed = JSON.parse(await (await via(base + '/creds', { headers: { cookie: 'session=1', authorization: 'Bearer x' } })).text())
  assert.equal(echoed.cookie, undefined)
  assert.equal(echoed.authorization, undefined)
})
test('SSRF: private, loopback and metadata addresses are refused (literal IPs and via DNS)', async () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isPrivateAddress(a), true, a)
  for (const a of ['93.184.216.34', '2606:4700::1111']) assert.equal(isPrivateAddress(a), false, a)
  assert.equal((await via('http://169.254.169.254/latest/meta-data', { headers: { 'x-test-real-lookup': '1' } })).status, 403)
  assert.equal((await via(base + '/feed.xml', { headers: { 'x-test-real-lookup': '1' } })).status, 403)
  // the real lookup refuses a name that resolves to loopback
  const r = await via(`http://localhost:${origin.address().port}/feed.xml`, { headers: { 'x-test-real-lookup': '1' } })
  assert.equal(r.status, 403)
})
