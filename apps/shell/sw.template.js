/* Hydra iPad service worker: ONE root-scope worker for the shell and every editor.
 * The VERSION and PRECACHE constants below are filled in by scripts/build-all.mjs from the final dist/ contents.
 * A new version installs in the background and WAITS: it only takes over when a page asks (skipWaiting message),
 * so an update never reloads anything mid-edit. */
const VERSION = '__VERSION__'
const CACHE = 'hydra-ipad-' + VERSION
const PRECACHE = __PRECACHE__

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // one by one so a single failed file names itself instead of aborting with a generic error
      for (const url of PRECACHE) {
        try {
          const res = await fetch(url, { cache: 'reload' })
          if (!res.ok) throw new Error(res.status)
          await cache.put(url, res)
        } catch (e) {
          throw new Error('precache failed for ' + url + ': ' + e.message)
        }
      }
    }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hydra-ipad-') && !k.startsWith('hydra-ipad-scripts-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting()
  if (event.data === 'version' && event.source) event.source.postMessage({ type: 'version', version: VERSION })
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.endsWith('/sw.js')) return
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      let hit = await cache.match(req, { ignoreSearch: true })
      if (!hit && url.pathname.endsWith('/')) hit = await cache.match(new URL('index.html', url).href)
      if (hit) return hit
      try {
        return await fetch(req)
      } catch (e) {
        if (req.mode === 'navigate') {
          const shell = await cache.match(new URL('./', self.registration.scope).href + 'index.html')
          if (shell) return shell
        }
        throw e
      }
    })(),
  )
})
