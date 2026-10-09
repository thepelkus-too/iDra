// Minimal static server for dist/ (used by the e2e run and for local iPad testing over the LAN with HTTPS-less http://<ip>:PORT:
// note service workers / camera / mic need HTTPS or localhost, so use a Vercel/GitHub Pages deploy for those).
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' }

export function serve(dir, port = 0, opts = {}) {
  const base = resolve(dir)
  const server = createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0])
    if (opts.prefix && p.startsWith(opts.prefix)) p = p.slice(opts.prefix.length - 1)
    const file = normalize(join(base, p))
    if (!file.startsWith(base)) return void res.writeHead(403).end()
    let f = file
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
    if (!existsSync(f)) return void res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
    const type = MIME[extname(f)] || 'application/octet-stream'
    const noCache = /(^|\/)(sw\.js|manifest\.webmanifest|apps\.json|version\.json)$/.test(f)
    const headers = { 'content-type': type, 'cache-control': noCache ? 'no-cache' : 'public, max-age=60' }
    if (opts.cors) headers['access-control-allow-origin'] = '*'
    res.writeHead(200, headers)
    createReadStream(f).pipe(res)
  })
  return new Promise((ok) => server.listen(port, '0.0.0.0', () => ok({ server, port: server.address().port })))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
  const { port } = await serve(dir, Number(process.env.PORT || 4173))
  console.log(`serving ${dir} on http://localhost:${port}`)
}
