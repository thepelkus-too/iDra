// End-to-end check in real Chromium at an iPad viewport (software WebGL: SwiftShader — timings are NOT device performance).
//   node scripts/e2e.mjs [--skip-build]
// Covers the flow from the brief: paste a corpus sketch with variables, comments and a raw `update` function into the shell,
// open it in the harness, edit a number, go back to the library, reopen it, export; the export must differ from the input only
// on the edited line and a dummy meta.graph value added beforehand must still be there. Plus: sandbox isolation, camera/mic probes,
// offline reload through the service worker, and the update toast.
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, SOFTWARE_GL_ARGS, FAKE_MEDIA_ARGS } from './lib/browser.mjs'
import { serve } from './serve.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!process.argv.includes('--skip-build')) execFileSync('npm', ['run', 'build:all'], { cwd: root, stdio: 'inherit' })

// serve a throwaway copy so the update test can rewrite sw.js
const tmp = mkdtempSync(join(tmpdir(), 'hydra-e2e-'))
cpSync(join(root, 'dist'), join(tmp, 'dist'), { recursive: true })
const { server, port } = await serve(join(tmp, 'dist'), 0)
const base = `http://localhost:${port}/`

const results = []
const t0 = Date.now()
async function step(name, fn) {
  const s = Date.now()
  try {
    const note = await fn()
    results.push({ name, ok: true, ms: Date.now() - s, note })
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''}`)
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - s, note: e.message })
    console.log(`  ✗ ${name}\n      ${String(e.stack || e).split('\n').slice(0, 6).join('\n      ')}`)
  }
}

const browser = await launch({ args: [...SOFTWARE_GL_ARGS, ...FAKE_MEDIA_ARGS] })
const context = await browser.newContext({ viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true })
await context.grantPermissions(['camera', 'microphone'], { origin: base.slice(0, -1) })
const page = await context.newPage()
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && consoleErrors.push('console.error: ' + m.text().slice(0, 200)))

const INPUT = readFileSync(join(root, 'packages/core/corpus/16-update.js'), 'utf8')
let sketchId

console.log(`\nHydra iPad e2e · ${base} · viewport 834×1194 · SOFTWARE WebGL (SwiftShader)\n`)

await step('shell loads, seeds 3 starter sketches, lists editors from apps.json', async () => {
  await page.goto(base)
  // the starters are written one by one and the grid redraws after each: wait for all three
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 3, null, { timeout: 15000 })
  assert.equal(await page.locator('.card').count(), 3)
  const apps = await (await page.request.get(base + 'apps.json')).json()
  assert.deepEqual(apps.apps.map((a) => a.name), ['harness'])
  assert.match(await page.textContent('footer'), /About \/ Source.*AGPL-3\.0/s)
  assert.equal(await page.getAttribute('footer a', 'href'), 'https://github.com/thepelkus-too/iDra')
})

await step('the shell is the only PWA: one root-scope service worker, manifest only on the shell', async () => {
  await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r && !!r.active))
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope))
  assert.deepEqual(regs, [base])
  assert.ok(await page.locator('link[rel=manifest]').count())
  assert.ok(await page.locator('link[rel=apple-touch-icon]').count())
  const manifest = await (await page.request.get(base + 'manifest.webmanifest')).json()
  assert.equal(manifest.scope, './')
  assert.equal(manifest.start_url, './')
  assert.equal(manifest.display, 'standalone')
})

await step('paste a corpus sketch (variable + comments + raw update) into Import…', async () => {
  await page.getByRole('button', { name: 'Import…' }).click()
  await page.fill('.modal textarea', INPUT)
  await page.fill('.modal input[type=text]', 'E2E sketch')
  await page.locator('.modal').getByRole('button', { name: 'Import' }).click()
  await page.waitForSelector('.card:has-text("E2E sketch")')
  assert.match(await page.textContent('.card:has-text("E2E sketch")'), /runs code/)
})

await step('a dummy meta.graph value is added beforehand', async () => {
  sketchId = await page.evaluate(async () => {
    const lib = window.__hydra.lib
    const e = (await lib.list()).find((x) => x.name === 'E2E sketch')
    const s = await lib.get(e.id)
    await lib.put({ ...s, meta: { ...(s.meta || {}), graph: { zoom: 3, marker: 'e2e' } } }, { touch: false })
    return e.id
  })
  assert.ok(sketchId)
})

await step('open it in the harness via “Open in…”; trust prompt gates the raw code', async () => {
  await page.locator(`.card[data-id="${sketchId}"]`).getByRole('button', { name: 'Open in…' }).click()
  await page.locator(`.card[data-id="${sketchId}"] .menu a`, { hasText: 'Harness' }).click()
  await page.waitForFunction(() => window.__harness && window.__harness.rt && document.querySelector('#sketch-name')?.value === 'E2E sketch')
  await page.waitForFunction(() => /ran|failed/.test(document.querySelector('#status').textContent))
  assert.ok(await page.isVisible('#trust-banner'), 'banner should be visible for a sketch with raw code')
  assert.match(await page.textContent('#status'), /skipped/) // safe mode until accepted
  assert.equal(await page.inputValue('#code'), INPUT)
  await page.click('#trust-once')
  await page.waitForFunction(() => !/skipped/.test(document.querySelector('#status').textContent) && /ran/.test(document.querySelector('#status').textContent))
})

await step('Hydra renders inside the sandboxed iframe (real WebGL, software)', async () => {
  const info = await page.evaluate(async () => {
    const rt = window.__harness.rt
    const el = rt.element
    await new Promise((r) => setTimeout(r, 1200))
    const url = await rt.screenshot()
    const img = new Image()
    await new Promise((res) => ((img.onload = res), (img.src = url)))
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 36
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, 64, 36)
    const px = ctx.getImageData(0, 0, 64, 36).data
    let lit = 0
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++
    return { tag: el.tagName, sandbox: el.getAttribute('sandbox'), allow: el.getAttribute('allow'), lit, isolation: rt.isolation }
  })
  assert.equal(info.tag, 'IFRAME')
  assert.equal(info.sandbox, 'allow-scripts')
  assert.doesNotMatch(info.allow, /microphone/)
  assert.ok(info.lit > 100, `canvas looks black (${info.lit} lit pixels)`)
})

await step('numbers edit live: slider/number input updates the shader without recompiling', async () => {
  await page.click('#tabbtn-knobs')
  const before = await page.evaluate(() => ({ ...window.__harness.rt.stats }))
  const box = page.locator('input[type=number][aria-label="osc sync value"]')
  await box.fill('0.35')
  await page.waitForFunction((n) => window.__harness.rt.stats.liveMessages > n, before.liveMessages)
  const after = await page.evaluate(() => ({ ...window.__harness.rt.stats }))
  assert.equal(after.recompiles, before.recompiles, 'a numeric drag must not recompile')
  await page.waitForFunction(() => document.querySelector('#code').value.includes('0.35'))
  await page.evaluate(() => window.__harness.lib.flush())
})

await step('go back to the library, reopen the sketch', async () => {
  await page.click('.hi-switch > button')
  await page.locator('.hi-switch .menu a', { hasText: 'Library' }).click()
  await page.waitForSelector(`.card[data-id="${sketchId}"]`)
  assert.ok(await page.locator(`.card[data-id="${sketchId}"].hl`).count(), 'the sketch we came from is highlighted')
  await page.locator(`.card[data-id="${sketchId}"] .open`).click()
  await page.waitForFunction(() => window.__harness && document.querySelector('#sketch-name')?.value === 'E2E sketch')
  assert.ok((await page.inputValue('#code')).includes('osc(() => 10 + n, 0.35, 1)'))
})

await step('export differs from the input only on the edited line; meta.graph survived', async () => {
  await page.evaluate(() => window.__harness.lib.flush())
  await page.goto(base + `#/s/${sketchId}`)
  await page.waitForSelector(`.card[data-id="${sketchId}"]`)
  await page.locator(`.card[data-id="${sketchId}"]`).getByRole('button', { name: /More actions/ }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(`.card[data-id="${sketchId}"] .menu button`, { hasText: /^Export \.js$/ }).click()])
  const exported = readFileSync(await dl.path(), 'utf8')
  const a = INPUT.split('\n')
  const b = exported.split('\n')
  assert.equal(b.length, a.length, 'same number of lines')
  const diff = a.map((l, i) => [i + 1, l, b[i]]).filter(([, x, y]) => x !== y)
  assert.equal(diff.length, 1, `expected one changed line, got ${JSON.stringify(diff)}`)
  assert.equal(diff[0][1], 'osc(() => 10 + n, 0.1, 1).out()')
  assert.equal(diff[0][2], 'osc(() => 10 + n, 0.35, 1).out()')
  const sketch = await page.evaluate(async (id) => window.__hydra.lib.get(id), sketchId)
  assert.deepEqual(sketch.meta.graph, { zoom: 3, marker: 'e2e' })
  assert.ok(sketch.meta.harness, 'the harness wrote its own meta key')
  return `1 line changed (${diff[0][0]})`
})

await step('backup JSON round-trips through the file UI and keeps meta', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Backup everything' }).click()])
  const bundle = JSON.parse(readFileSync(await dl.path(), 'utf8'))
  assert.equal(bundle.app, 'hydra-ipad')
  const mine = bundle.sketches.find((s) => s.id === sketchId)
  assert.equal(mine.meta.graph.marker, 'e2e')
  assert.ok(bundle.sketches.length >= 4)
})

await step('library management: duplicate, rename, delete (UI)', async () => {
  const count = () => page.locator('.card').count()
  const before = await count()
  const card = page.locator(`.card[data-id="${sketchId}"]`)
  await card.getByRole('button', { name: /More actions/ }).click()
  await card.locator('.menu button', { hasText: 'Duplicate' }).click()
  await page.waitForSelector('.card:has-text("E2E sketch copy")')
  assert.equal(await count(), before + 1)
  const copy = page.locator('.card:has-text("E2E sketch copy")')
  await copy.getByRole('button', { name: /More actions/ }).click()
  await copy.locator('.menu button', { hasText: 'Rename' }).click()
  await page.fill('.modal input[type=text]', 'Renamed copy')
  await page.locator('.modal').getByRole('button', { name: 'Rename' }).click()
  await page.waitForSelector('.card:has-text("Renamed copy")')
  const renamed = page.locator('.card:has-text("Renamed copy")')
  await renamed.getByRole('button', { name: /More actions/ }).click()
  await renamed.locator('.menu button', { hasText: 'Delete' }).click()
  await page.locator('.modal').getByRole('button', { name: 'Delete' }).click()
  await page.waitForFunction((n) => document.querySelectorAll('.card').length === n, before)
  // the original is untouched
  assert.ok(await page.locator(`.card[data-id="${sketchId}"]`).count())
})

await step('Restore… merges a backup file (and keeps newer local sketches)', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Backup everything' }).click()])
  const path = await dl.path()
  const before = await page.locator('.card').count()
  await page.getByRole('button', { name: 'Restore…' }).click()
  await page.setInputFiles('.modal input[type=file]', path)
  await page.locator('.modal').getByRole('button', { name: 'Restore' }).click()
  await page.waitForSelector('.note-toast')
  assert.match(await page.textContent('.note-toast'), /0 new, 0 replaced, \d+ skipped/)
  assert.equal(await page.locator('.card').count(), before)
})

// ------------------------------------------------------------------ harness checks
await page.goto(base + `harness/#/s/${sketchId}`)
await page.waitForFunction(() => window.__harness && window.__harness.rt)
await page.evaluate(() => window.__harness.lib.approve(window.__harness.sketch).then(() => window.__harness.runNow(true)))

await step('thumbnail: after an edit the harness captures a frame and the library stores it for the shell', async () => {
  await page.click('#tabbtn-knobs')
  await page.locator('input[type=number][aria-label="osc offset value"]').fill('1.25')
  let thumb
  for (let i = 0; i < 40 && !thumb; i++) {
    await page.waitForTimeout(500)
    thumb = await page.evaluate(async (id) => (await window.__harness.lib.list()).find((e) => e.id === id)?.thumbnail, sketchId)
  }
  assert.ok(thumb, 'no thumbnail stored within 20 s')
  assert.equal(thumb.slice(0, 23), 'data:image/jpeg;base64,')
  return `${(thumb.length / 1024).toFixed(1)} KB data URL`
})

await step('iframe isolation: a sketch cannot reach the parent page; inline mode can', async () => {
  const PROBE = "throw new Error('probe:' + (() => { try { return 'reached ' + parent.document.title } catch (e) { return 'blocked ' + e.name } })())"
  const run = (isolation) =>
    page.evaluate(async (src) => {
      const h = window.__harness
      const errs = []
      h.rt.onError((e) => errs.push(e.message))
      const r = await h.rt.run(src, { force: true })
      await new Promise((res) => setTimeout(res, 200))
      return { errs, ok: r.ok, isolation: h.rt.isolation }
    }, PROBE)
  await page.waitForFunction(() => /· iframe/.test(document.querySelector('#status').textContent))
  const framed = await run()
  assert.equal(framed.isolation, 'iframe')
  assert.ok(framed.errs.some((m) => /probe:blocked SecurityError/.test(m)), JSON.stringify(framed))
  await page.selectOption('#isolation', 'inline')
  await page.waitForFunction(() => window.__harness.rt.isolation === 'inline' && /· inline/.test(document.querySelector('#status').textContent))
  const inline = await run()
  assert.ok(inline.errs.some((m) => /probe:reached Hydra Harness/.test(m)), JSON.stringify(inline))
  await page.selectOption('#isolation', 'iframe')
  await page.waitForFunction(() => window.__harness.rt.isolation === 'iframe' && /· iframe/.test(document.querySelector('#status').textContent))
})

await step('live closures render the same pixels as baked numbers (10 random sketches, speed = 0)', async () => {
  const r = await page.evaluate(async () => {
    const { rt, core } = window.__harness
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
    const shot = async () => {
      const url = await rt.screenshot()
      const img = new Image()
      await new Promise((res) => ((img.onload = res), (img.src = url)))
      const c = document.createElement('canvas')
      c.width = 96
      c.height = 54
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0, 96, 54)
      return ctx.getImageData(0, 0, 96, 54).data
    }
    const out = []
    for (let seed = 1; seed <= 10; seed++) {
      const sk = core.randomSketch(seed, { fnP: 0, arrP: 0, nestedP: 1 })
      const baked = 'speed = 0\n' + core.toCode(sk, { fresh: true })
      await rt.run(baked, { force: true })
      await sleep(350)
      const a = await shot()
      const withSpeed = { ...sk, stmts: [{ id: 'sp', k: 'setting', name: 'speed', v: 0 }, ...sk.stmts] }
      const res = await rt.run(withSpeed, { force: true })
      await sleep(350)
      const b = await shot()
      let bad = 0, max = 0, lit = 0
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]))
        if (d > 3) bad++
        max = Math.max(max, d)
        if (a[i] + a[i + 1] + a[i + 2] > 20) lit++
      }
      out.push({ seed, ok: res.ok, bad, max, lit })
    }
    return out
  })
  const worst = r.reduce((m, x) => Math.max(m, x.bad), 0)
  assert.ok(r.every((x) => x.ok), JSON.stringify(r))
  assert.ok(worst <= 5, 'live vs baked differ: ' + JSON.stringify(r.filter((x) => x.bad > 5)))
  return `max differing pixels of 5184: ${worst}; sketches with visible content: ${r.filter((x) => x.lit > 50).length}/10`
})

await step('diagnostics page computes live results and a copyable report', async () => {
  await page.click('#tabbtn-diag')
  await page.click('#diag-run')
  await page.waitForSelector('table.caps tr')
  const text = await page.textContent('table.caps')
  for (const label of ['HTTPS', 'Service worker', 'WebGL', 'getUserMedia', 'AudioContext', 'Web MIDI', 'BroadcastChannel', 'IndexedDB', 'Sandboxed frame is isolated', 'Mic/camera inside the sandboxed frame']) assert.ok(text.includes(label), `missing row ${label}`)
  const rows = await page.$$eval('table.caps tr', (trs) => Object.fromEntries(trs.map((t) => [t.children[0].textContent, [t.children[1].textContent, t.children[2].textContent]])))
  assert.equal(rows['Sandboxed frame is isolated'][0], 'yes', rows['Sandboxed frame is isolated'][1])
  assert.match(rows['Web MIDI'][1], /MIDI/)
  assert.match(rows['WebGL 1 / 2'][1], /SOFTWARE|swiftshader/i)
  assert.match(await page.textContent('pre.report'), /Hydra iPad diagnostics/)
  return `webgl: ${rows['WebGL 1 / 2'][1].slice(0, 70)}`
})

await step('camera inside the opaque-origin sandboxed frame (fake device)', async () => {
  await page.click('#diag-camera')
  await page.waitForFunction(() => document.body.textContent.includes('camera:'), null, { timeout: 15000 })
  const row = await page.$$eval('table.caps tr', (trs) => trs.map((t) => t.textContent).find((t) => t.includes('Mic/camera inside')))
  const granted = /camera: granted/.test(row)
  return `${granted ? 'WORKS' : 'DOES NOT WORK'} in Chromium with allow="camera *": ${row.slice(row.indexOf('mediaDevices')).slice(0, 120)}`
})

await step('audio: mic (fake device) → engine → frame; sketch-side `a` follows Hydra semantics', async () => {
  await page.selectOption('#isolation', 'inline')
  await page.waitForFunction(() => window.__harness.rt.isolation === 'inline' && /· inline/.test(document.querySelector('#status').textContent))
  await page.click('#tabbtn-audio')
  await page.evaluate(() => window.__harness.rt.run('a.show()\nosc(() => a.fft[0] * 20, 0.1, 1).out()', { force: true }))
  await page.click('#audio-panel-host button.primary') // Start (mic by default)
  await page.waitForFunction(() => window.__harness.audio.state === 'running', null, { timeout: 15000 })
  await page.waitForFunction(() => window.a && window.a.bins.some((x) => x > 0), null, { timeout: 15000 })
  const r = await page.evaluate(() => ({ vol: window.__harness.audio.getFrame().vol, specific: window.__harness.audio.getFrame().specific.length, bins: window.a.bins.length, fft: Array.from(window.a.fft), a0: typeof window.a0, ctx: window.__harness.audio.contextState }))
  assert.equal(r.specific, 24)
  assert.equal(r.bins, 4)
  assert.equal(r.a0, 'function')
  assert.ok(r.fft.every((x) => x >= 0))
  await page.evaluate(() => window.__harness.audio.stop())
  await page.selectOption('#isolation', 'iframe')
  await page.waitForFunction(() => window.__harness.rt.isolation === 'iframe' && /· iframe/.test(document.querySelector('#status').textContent))
  return `vol=${r.vol.toFixed(2)} bins=${r.bins} ctx=${r.ctx} (the fake mic is a periodic beep)`
})

await step('offline: reload the shell and the harness from the service-worker cache and still run Hydra', async () => {
  await page.goto(base)
  await page.waitForFunction(() => navigator.serviceWorker.controller)
  await context.setOffline(true)
  await page.goto(base)
  await page.waitForSelector('.card')
  await page.goto(base + `harness/#/s/${sketchId}`)
  await page.waitForFunction(() => window.__harness && /ran/.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 20000 })
  const lit = await page.evaluate(async () => (await window.__harness.rt.screenshot()).length > 1000)
  assert.ok(lit)
  await context.setOffline(false)
})

await step('update: a new service worker installs in the background; toast appears; nothing reloads until tapped', async () => {
  await page.goto(base)
  await page.waitForFunction(() => navigator.serviceWorker.controller)
  await page.evaluate(() => (window.__marker = 'still here'))
  const swPath = join(tmp, 'dist', 'sw.js')
  writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(/const VERSION = "[^"]+"/, 'const VERSION = "e2e-next-version"'))
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))
  await page.waitForSelector('.hi-toast', { timeout: 15000 })
  assert.equal(await page.evaluate(() => window.__marker), 'still here', 'no forced reload')
  await page.getByRole('button', { name: 'Reload' }).click()
  await page.waitForFunction(() => window.__marker === undefined, null, { timeout: 15000 })
  const v = await page.evaluate(() => new Promise((res) => { navigator.serviceWorker.addEventListener('message', (e) => res(e.data.version)); navigator.serviceWorker.controller.postMessage('version') }))
  assert.equal(v, 'e2e-next-version')
})

await step('no unexpected console errors', async () => {
  const bad = consoleErrors.filter((e) => !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED|sandbox|SecurityError|Blocked a frame/.test(e))
  assert.deepEqual(bad, [])
})

await browser.close()
server.close()
rmSync(tmp, { recursive: true, force: true })
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} steps passed in ${((Date.now() - t0) / 1000).toFixed(1)} s (software WebGL; not device performance)`)
process.exit(failed.length ? 1 : 0)
