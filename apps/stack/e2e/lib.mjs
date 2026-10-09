// Shared helpers for the Chain Stack e2e run: static server over dist/, Chromium with software WebGL, and real touch input
// through the DevTools protocol (Input.dispatchTouchEvent), so the same pointer-event path an iPad uses is exercised.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, SOFTWARE_GL_ARGS } from '../../../scripts/lib/browser.mjs'
import { serve } from '../../../scripts/serve.mjs'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export async function start({ viewport = { width: 1180, height: 820 }, dist = join(root, 'dist'), deviceScaleFactor = 1 } = {}) {
  const { server, port } = await serve(dist, 0)
  const base = `http://localhost:${port}/`
  const browser = await launch({ args: SOFTWARE_GL_ARGS })
  const context = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, isMobile: true, acceptDownloads: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('console.error: ' + m.text().slice(0, 240)))
  const cdp = await context.newCDPSession(page)
  return { server, port, base, browser, context, page, cdp, errors, touch: touchApi(page, cdp), close: async () => (await browser.close(), server.close()) }
}

const center = async (page, target) => {
  const loc = typeof target === 'string' ? page.locator(target).first() : target
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  if (!b) throw new Error(`no box for ${target}`)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function touchApi(page, cdp) {
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 10, radiusY: 10, force: 0.5 })) })
  const api = {
    center: (t) => center(page, t),
    /** a quick tap with one finger on a locator or a point */
    async tap(target) {
      const p = target && typeof target.x === 'number' ? target : await center(page, target)
      await send('touchStart', [p])
      await sleep(40)
      await send('touchEnd', [])
      await sleep(60)
    },
    async hold(target, ms = 650) {
      const p = target && typeof target.x === 'number' ? target : await center(page, target)
      await send('touchStart', [p])
      await sleep(ms)
      await send('touchEnd', [])
      await sleep(80)
    },
    /** drag from a point/locator by (dx, dy), in steps; keeps the finger down for `settle` ms at the end when asked */
    async drag(target, dx, dy, { steps = 12, stepMs = 16, hold = 0, preHold = 0, release = true, path } = {}) {
      const p = target && typeof target.x === 'number' ? target : await center(page, target)
      await send('touchStart', [p])
      if (preHold) await sleep(preHold)
      const pts = path ?? Array.from({ length: steps }, (_, i) => ({ x: p.x + (dx * (i + 1)) / steps, y: p.y + (dy * (i + 1)) / steps }))
      for (const q of pts) {
        await send('touchMove', [q])
        await sleep(stepMs)
      }
      if (hold) await sleep(hold)
      const last = pts[pts.length - 1] ?? p
      if (release) await send('touchEnd', [])
      await sleep(60)
      return { start: p, end: last }
    },
    /** multi-finger tap (2 = undo, 3 = redo) */
    async multiTap(n, at = { x: 600, y: 400 }) {
      const pts = Array.from({ length: n }, (_, i) => ({ x: at.x + i * 60, y: at.y }))
      await send('touchStart', pts)
      await sleep(50)
      await send('touchEnd', [])
      await sleep(120)
    },
    raw: send,
  }
  return api
}

/** wait until the Hydra frame has produced a non-black picture (software WebGL is slow to warm up) */
export async function waitForPicture(page, timeout = 15000) {
  await page.waitForFunction(() => window.__stack?.runner?.status?.phase === 'ok', null, { timeout })
}

export async function importAndOpen(page, base, code, name = 'E2E sketch') {
  // use the shared library directly (same origin, same IndexedDB) instead of driving the shell's dialog
  await page.goto(base + 'stack/')
  await page.waitForFunction(() => !!window.__stack?.lib, null, { timeout: 15000 })
  const id = await page.evaluate(async ({ code, name }) => {
    const s = await window.__stack.lib.create(name, code)
    return s.id
  }, { code, name })
  await page.goto(base + 'stack/#/s/' + id)
  await page.reload()
  await page.waitForFunction((id) => window.__stack?.store?.sketch?.id === id, id, { timeout: 15000 })
  return id
}

/** the code the sketch exports right now (what Code mode shows) */
export const codeOf = (page) => page.evaluate(() => window.__stack.core.toCode(window.__stack.store.sketch))
export { sleep }
