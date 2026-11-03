// Re-record the README GIFs (docs/media/*.gif) from the built dist/:  npm run build:all && node scripts/record-readme-media.mjs
// Chromium only (frames come from the DevTools screencast) and needs ffmpeg on PATH. Software WebGL, so motion is smooth only
// because frames are resampled to a constant rate; this is a picture of the UI, not of device performance.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, SOFTWARE_GL_ARGS } from './lib/browser.mjs'
import { serve } from './serve.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const media = join(root, 'docs/media')
const tmp = mkdtempSync(join(tmpdir(), 'idra-media-'))
const { server, port } = await serve(join(root, 'dist'), 0)
const base = `http://localhost:${port}/`
const browser = await launch({ args: SOFTWARE_GL_ARGS })
const size = { width: 1180, height: 820 } // iPad landscape
const FPS = 12

/** record `fn(page, idOf)` into docs/media/<name>.gif at `width` px wide */
async function record(name, width, fn) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(base)
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 3, null, { timeout: 15000 })
  const cards = await page.$$eval('.card', (els) => els.map((e) => [e.getAttribute('data-id'), e.textContent]))
  const idOf = (title) => cards.find(([, t]) => t.includes(title))[0]
  const cdp = await ctx.newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ t: f.metadata.timestamp, data: f.data })
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: size.width, maxHeight: size.height })
  await fn(page, idOf)
  await cdp.send('Page.stopScreencast')
  await ctx.close()
  // the screencast only sends a frame when something changed: resample to a constant rate
  const dir = join(tmp, name)
  mkdirSync(dir)
  let k = 0, n = 0
  for (let t = frames[0].t; t <= frames.at(-1).t; t += 1 / FPS) {
    while (k + 1 < frames.length && frames[k + 1].t <= t) k++
    writeFileSync(join(dir, `${String(n++).padStart(5, '0')}.png`), Buffer.from(frames[k].data, 'base64'))
  }
  const filter = `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, '%05d.png'), '-vf', filter, join(media, `${name}.gif`)])
  console.log(`✓ docs/media/${name}.gif (${n} frames)`)
}

// one sketch, the four editors in turn
await record('four-editors', 800, async (page, idOf) => {
  const id = idOf('Feedback bloom')
  for (const app of ['stack', 'graph', 'blocks', 'rack']) {
    await page.goto(`${base}${app}/#/s/${id}`)
    await page.waitForTimeout(3500)
  }
})

// scrub osc's frequency in the Stack editor: the picture follows without a recompile
await record('scrub', 640, async (page, idOf) => {
  await page.goto(`${base}stack/#/s/${idOf('Oscillator spin')}`)
  await page.waitForTimeout(2000)
  const box = await page.locator('[data-scrub]').first().boundingBox()
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 40; i++) (await page.mouse.move(x + i * 6, y - i)), await page.waitForTimeout(40)
  for (let i = 40; i >= -20; i--) (await page.mouse.move(x + i * 6, y)), await page.waitForTimeout(40)
  await page.mouse.up()
  await page.waitForTimeout(1200)
})

await browser.close()
server.close()
rmSync(tmp, { recursive: true, force: true })
