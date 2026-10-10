// hydra-motion end to end, in Chromium at an iPad viewport (834×1194, touch, software WebGL: timings are NOT device performance).
//   node scripts/e2e-motion.mjs [--skip-build] [--shots <dir>]
// 1. The Motion lab in the harness (iframe runtime): two fingers on two pads, glides, the slider, pausing Hydra's clock.
// 2. The vanilla compatibility test: the lab sketch exported self-contained is pasted into a plain hydra-synth page with no
//    iDra code at all (another origin), driven with k.hold / k.release, and the rendered output changes and comes back.
// 3. Offline: the harness reloads without network and the plugin still loads (service worker + script cache).
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, SOFTWARE_GL_ARGS } from './lib/browser.mjs'
import { serve } from './serve.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!process.argv.includes('--skip-build')) execFileSync('npm', ['run', 'build:all'], { cwd: root, stdio: 'inherit' })
const shotsArg = process.argv.indexOf('--shots')
const shots = shotsArg > 0 ? resolve(process.argv[shotsArg + 1]) : join(root, 'test-results', 'ipad')
mkdirSync(shots, { recursive: true })

const tmp = mkdtempSync(join(tmpdir(), 'hydra-e2e-motion-'))
cpSync(join(root, 'dist'), join(tmp, 'dist'), { recursive: true })
// a plain Hydra page: hydra-synth's own browser build and nothing from this repository
const vanillaDir = join(tmp, 'vanilla')
mkdirSync(vanillaDir)
const req = createRequire(join(root, 'packages/core/package.json'))
cpSync(join(dirname(req.resolve('hydra-synth')), 'hydra-synth.js'), join(vanillaDir, 'hydra-synth.js'))
writeFileSync(
  join(vanillaDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>plain hydra-synth</title><body style="margin:0;background:#000">
<canvas id="c" width="320" height="180" style="width:100%"></canvas>
<script src="hydra-synth.js"></script>
<script>
window.hydra = new Hydra({ canvas: document.getElementById('c'), detectAudio: false, makeGlobal: true, width: 320, height: 180 })
window.measure = () => new Promise((res) => hydra.getScreenImage(async (blob) => {
  const bmp = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = 64; c.height = 36
  const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data
  let r = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; b += d[i + 2] } const n = d.length / 4; res({ r: r / n, b: b / n, m: (r - b) / n })
}))
</script>`,
)
// hydra-synth's dist build reaches for `global`; give the page a hint-free stand-in as the hydra editor does
const app = await serve(join(tmp, 'dist'), 0)
const vanilla = await serve(vanillaDir, 0)
const base = `http://localhost:${app.port}/`
const vanillaBase = `http://127.0.0.1:${vanilla.port}/`

const results = []
const t0 = Date.now()
let liftAll = async () => {}
async function step(name, fn) {
  const s = Date.now()
  try {
    const note = await fn()
    results.push({ name, ok: true, ms: Date.now() - s, note })
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''}`)
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - s, note: e.message })
    console.log(`  ✗ ${name}\n      ${String(e.stack || e).split('\n').slice(0, 6).join('\n      ')}`)
    await liftAll().catch(() => {})
  }
}
const shot = (p, name) => p.screenshot({ path: join(shots, `${name}.png`) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await launch({ args: SOFTWARE_GL_ARGS })
const context = await browser.newContext({ viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
const cdp = await context.newCDPSession(page)

/** mean red minus mean blue of the preview (the lab sketch: red follows k, blue follows 1 - k) */
const measure = async (tries = 3) => {
  try {
    return await measureOnce()
  } catch (e) {
    // software GL occasionally misses a frame capture under load; try again rather than fail the step on it
    if (tries > 1 && /timed out/.test(e.message)) return measure(tries - 1)
    throw e
  }
}
const measureOnce = () =>
  page.evaluate(async () => {
    const url = await window.__harness.rt.screenshot()
    const img = new Image()
    await new Promise((res) => ((img.onload = res), (img.src = url)))
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 36
    const x = c.getContext('2d')
    x.drawImage(img, 0, 0, 64, 36)
    const d = x.getImageData(0, 0, 64, 36).data
    let r = 0
    let b = 0
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]
      b += d[i + 2]
    }
    return (r - b) / (d.length / 4)
  })
const settle = (ms = 500) => sleep(ms)
/** poll the preview until pred(value) holds (software GL frames are slow and uneven), returning the last value */
async function until(pred, timeout = 4000) {
  const end = Date.now() + timeout
  let v = await measure()
  while (!pred(v) && Date.now() < end) {
    await sleep(150)
    v = await measure()
  }
  return v
}
const center = async (sel) => {
  const box = await page.locator(sel).boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
/** real touch points (CDP): each call gives the full list of fingers still down */
liftAll = () => touch('touchEnd', [])
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1, radiusX: 8, radiusY: 8, force: 1 })) })

console.log(`\nhydra-motion e2e · ${base} · plain Hydra at ${vanillaBase} · iPad viewport · SOFTWARE WebGL\n`)

let m0 = 0
let exported = ''

await step('shell registers the service worker; the plugin is served at its pinned path with the registry SRI', async () => {
  await page.goto(base)
  await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r && !!r.active), null, { timeout: 20000 })
  const reg = (await (await page.request.get(base + 'plugins/hydra-motion.js')).text()).slice(0, 40)
  assert.match(reg, /^\/\*! hydra-motion v/)
  const sw = await (await page.request.get(base + 'sw.js')).text()
  assert.match(sw, /plugins\/hydra-motion@[\d.]+\/hydra-motion\.js/, 'precached for offline use')
})

await step('Motion lab: load the lab sketch (iframe runtime, plugin from the registry URL)', async () => {
  await page.goto(base + 'harness/?tab=motion')
  await page.waitForFunction(() => !!window.__harness?.rt)
  await page.click('#tabbtn-motion')
  await page.click('#lab-load')
  await page.waitForFunction(() => /Lab sketch running/.test(document.querySelector('#motion-status').textContent), null, { timeout: 20000 })
  await page.waitForFunction(() => /^ran/.test(document.querySelector('#status').textContent), null, { timeout: 20000 })
  const info = await page.evaluate(() => ({ iso: window.__harness.rt.isolation, plugins: window.__harness.sketch.plugins, compat: document.querySelector('#compat-host').textContent }))
  assert.equal(info.iso, 'iframe')
  assert.equal(info.plugins[0].id, 'hydra-motion')
  assert.match(info.plugins[0].integrity, /^sha256-/)
  assert.match(info.compat, /Hydra \+ plugin/)
  await settle(900)
  m0 = await measure()
  await shot(page, 'motion-lab-loaded')
  return `baseline r−b ${m0.toFixed(1)}`
})

await step('two fingers on two pads: the most recent wins; lifting it returns to the one still held, then to the base', async () => {
  const A = await center('#A')
  const B = await center('#B')
  await touch('touchStart', [{ ...A, id: 1 }])
  await settle()
  const a = await measure()
  await touch('touchStart', [{ ...A, id: 1 }, { ...B, id: 2 }])
  await settle()
  const ab = await measure()
  await shot(page, 'motion-lab-two-pads')
  await touch('touchEnd', [{ ...B, id: 2 }])
  await settle()
  const pads = await page.evaluate(() => ['A', 'B'].map((id) => document.getElementById(id).classList.contains('on')))
  assert.deepEqual(pads, [true, false], 'finger on A still down, B lifted')
  const aOnly = await measure()
  await touch('touchEnd', [])
  const back = await until((v) => Math.abs(v - m0) < 12)
  assert.ok(a > m0 + 30, `pad A (hold 1) should redden: ${a} vs ${m0}`)
  assert.ok(ab < m0 - 30, `pad B (hold 0, most recent) should win: ${ab}`)
  assert.ok(aOnly > m0 + 30, `lifting B returns to A's value: ${aOnly}`)
  assert.ok(Math.abs(back - m0) < 12, `lifting A returns to the base: ${back} vs ${m0}`)
  return `A ${a.toFixed(0)}, A+B ${ab.toFixed(0)}, A ${aOnly.toFixed(0)}, released ${back.toFixed(0)}`
})

await step('slider (k.set) and glide buttons (k.to with a curve)', async () => {
  await page.locator('#lab-slider').fill('1')
  await settle()
  const one = await measure()
  await page.selectOption('#lab-dur', '0.25')
  await page.selectOption('#lab-ease', 'easeOutQuad')
  await page.locator('#lab-glides button[data-to="0"]').tap()
  await settle(900)
  const zero = await measure()
  await page.locator('#lab-glides button[data-to="0.5"]').tap()
  await settle(900)
  const half = await measure()
  assert.ok(one > m0 + 30 && zero < m0 - 30 && Math.abs(half - m0) < 12, `${one} / ${zero} / ${half}`)
  return `set 1 → ${one.toFixed(0)}, to 0 → ${zero.toFixed(0)}, to 0.5 → ${half.toFixed(0)}`
})

await step('paused (speed = 0): a hold with no attack shows at once; on the Hydra clock the release waits for the clock', async () => {
  await page.locator('#lab-pause').tap()
  await settle()
  const t1 = await page.evaluate(() => window.__harness.rt.time())
  await settle(300)
  const t2 = await page.evaluate(() => window.__harness.rt.time())
  assert.equal(t1, t2, 'Hydra time stopped')
  const A = await center('#A')
  await touch('touchStart', [{ ...A, id: 1 }])
  await settle()
  const held = await measure()
  await touch('touchEnd', [])
  await settle(700)
  const frozen = await measure()
  await shot(page, 'motion-lab-paused-hold')
  await page.locator('#lab-pause').tap()
  await page.waitForFunction(async () => {
    const a = await window.__harness.rt.time()
    await new Promise((r) => setTimeout(r, 100))
    return (await window.__harness.rt.time()) > a
  }, null, { timeout: 5000 })
  const resumed = await until((v) => Math.abs(v - m0) < 12)
  assert.ok(held > m0 + 30, `hold shows while paused: ${held}`)
  assert.ok(frozen > m0 + 30, `release glide (0.15 s of Hydra time) waits while paused: ${frozen}`)
  assert.ok(Math.abs(resumed - m0) < 12, `and finishes once resumed: ${resumed}`)
  return `held ${held.toFixed(0)}, after release while paused ${frozen.toFixed(0)}, resumed ${resumed.toFixed(0)}`
})

await step('export self-contained: the plugin is inlined; re-import is idempotent and byte-identical', async () => {
  const r = await page.evaluate(async () => {
    const { core, sketch } = window.__harness
    const text = await core.exportWithPrelude(sketch)
    const imp = core.importText(text).sketch
    return { text, back: core.toCode(imp), again: await core.exportWithPrelude(imp), raws: imp.stmts.filter((s) => s.k === 'raw').map((s) => s.code.slice(0, 40)), plugins: imp.plugins, compat: core.compat(imp).vanilla }
  })
  exported = r.text
  assert.match(exported, /^\/\/ ---- hydra-motion [\d.]+ · sha256-\S+ · MIT · inlined plugin, do not edit ----\n\/\*! hydra-motion v/)
  assert.doesNotMatch(exported, /loadScript/)
  assert.equal(r.back, exported)
  assert.equal(r.again, exported)
  assert.equal(r.plugins.length, 1)
  assert.equal(r.compat, 'yes')
  assert.ok(!r.raws.some((x) => /hydra-motion|!function|\(\(\)=>/.test(x)), 'the block did not come back as raw code')
  return `${exported.length} chars`
})

await step('VANILLA: the exported sketch runs in a plain hydra-synth page; k.hold / k.release change the output and it comes back', async () => {
  const v = await context.newPage()
  const errs = []
  v.on('pageerror', (e) => errs.push(e.message))
  await v.goto(vanillaBase)
  await v.waitForFunction(() => !!window.hydra)
  const noIdra = await v.evaluate(() => ({ scripts: [...document.scripts].map((s) => s.src).filter(Boolean), idra: Object.keys(window).filter((k) => /hydraIpad|__harness|__hl/.test(k)) }))
  assert.deepEqual(noIdra.idra, [])
  assert.equal(noIdra.scripts.length, 1)
  await v.evaluate((code) => window.hydra.eval(code), exported)
  await sleep(800)
  const before = (await v.evaluate(() => window.measure())).m
  await v.evaluate(() => window.k.hold(1))
  await sleep(500)
  const held = (await v.evaluate(() => window.measure())).m
  await v.evaluate(() => window.k.release(0.2, 'easeOutQuad'))
  await sleep(900)
  const after = (await v.evaluate(() => window.measure())).m
  await v.screenshot({ path: join(shots, 'motion-vanilla.png') })
  const g = await v.evaluate(() => ({ version: window.hydraMotion.version, globals: ['knob', 'gate'].map((n) => typeof window[n]) }))
  await v.close()
  assert.deepEqual(errs, [])
  assert.deepEqual(g.globals, ['function', 'function'])
  assert.ok(held > before + 30, `hold should change the output: ${before} → ${held}`)
  assert.ok(Math.abs(after - before) < 12, `release should bring it back: ${after} vs ${before}`)
  return `hydra-motion ${g.version}: ${before.toFixed(0)} → held ${held.toFixed(0)} → released ${after.toFixed(0)}`
})

await step('offline: the harness reloads without network and the plugin still loads', async () => {
  await context.setOffline(true)
  try {
    await page.reload()
    await page.waitForFunction(() => !!window.__harness?.rt)
    await page.waitForFunction(() => /^ran/.test(document.querySelector('#status').textContent), null, { timeout: 20000 })
    // the reloaded sketch is the lab sketch from the library; trust it again (a fresh page load asks again)
    const asked = await page.evaluate(() => !document.querySelector('#trust-banner').hidden)
    if (asked) {
      await page.click('#tabbtn-code')
      await page.click('#trust-once')
    }
    await page.click('#tabbtn-motion')
    await page.waitForFunction(() => /^ran/.test(document.querySelector('#status').textContent) && !/skipped/.test(document.querySelector('#status').textContent), null, { timeout: 20000 })
    await settle(800)
    const A = await center('#A')
    await touch('touchStart', [{ ...A, id: 1 }])
    await settle()
    const held = await measure()
    await touch('touchEnd', [])
    const errs = await page.evaluate(() => [...document.querySelectorAll('#errors .err')].map((e) => e.textContent))
    assert.ok(!errs.some((e) => /did not load|could not load/.test(e)), errs.join('\n'))
    const dbg = await page.evaluate(() => ({ st: document.querySelector('#status').textContent, ms: document.querySelector('#motion-status').textContent }))
    assert.ok(held > m0 + 30, `pad works offline: ${held} ${JSON.stringify(dbg)} ${errs.join(' | ')}`)
    await shot(page, 'motion-lab-offline')
    return `held ${held.toFixed(0)} offline`
  } finally {
    await context.setOffline(false)
  }
})

await step('no page errors', async () => {
  assert.deepEqual(pageErrors, [])
})

await browser.close()
app.server.close()
vanilla.server.close()
const failed = results.filter((r) => !r.ok)
writeFileSync(join(shots, 'motion-results.json'), JSON.stringify({ when: new Date().toISOString(), software: true, results }, null, 2))
console.log(`\n${results.length - failed.length}/${results.length} steps passed in ${((Date.now() - t0) / 1000).toFixed(1)} s · screenshots in ${shots}`)
process.exit(failed.length ? 1 : 0)
