// Chunk previews and disabling end to end in the harness's Previews lab (real hydra-synth in sandboxed frames, software WebGL).
//   node scripts/e2e-previews.mjs [--skip-build]
// Checks:
//   1. prev() (on a fresh page): a feedback chain is approximated from copies of its own output, and no copy fails
//   2. "everything up to here" thumbnails show the right picture per call, including a chain with a nested texture argument
//   3. the pool never runs more than its size (2) of preview runtimes, counted from its stats and from the page's iframes
//   4. a chunk reading another output is previewed approximately (≈) from a copied main picture, the right way up
//   5. the before/after pair of a modifier shows two different pictures
//   6. live mode animates every visible thumbnail, and the main output stays pixel-identical before, during and after;
//      the frame rate here is measured and reported (not an iPad number)
//   7. trust gate: a sketch that needs trust gets no preview runtime until it is trusted
//   8. disabling a modifier changes the compiled output and the main picture, not the IR order; re-enabling restores both
// Software WebGL: frame rates and copy times are not device performance.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, SOFTWARE_GL_ARGS } from './lib/browser.mjs'
import { serve } from './serve.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!process.argv.includes('--skip-build')) execFileSync('npm', ['run', 'build:all'], { cwd: root, stdio: 'inherit' })
const tmp = mkdtempSync(join(tmpdir(), 'hydra-e2e-previews-'))
cpSync(join(root, 'dist'), join(tmp, 'dist'), { recursive: true })
const app = await serve(join(tmp, 'dist'), 0)
const base = `http://localhost:${app.port}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
async function step(name, fn) {
  const t = Date.now()
  try {
    const note = await fn()
    results.push({ name, ok: true })
    console.log(`✓ ${name} (${Date.now() - t} ms)${note ? `\n    ${note}` : ''}`)
  } catch (e) {
    results.push({ name, ok: false })
    console.log(`✗ ${name}\n    ${String(e?.stack ?? e).split('\n').slice(0, 6).join('\n    ')}`)
  }
}

// static pictures (no time in them), so any pixel change in the main output is a real change
const SKETCH = [
  'solid(0, 0, 1).out()',
  'gradient(0).out(o1)',
  'osc(20, 0, 1).modulate(noise(3, 0).scale(2), 0.5).out(o2)',
  'src(o1).out(o3)',
  '',
].join('\n')

const browser = await launch({ args: SOFTWARE_GL_ARGS })
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.addInitScript(() => {
  try {
    localStorage.setItem('idra.previews', 'demand')
  } catch {} // the sandboxed frames have no storage
})
await page.goto(base + 'harness/')
await page.waitForFunction(() => window.__harness?.rt)
await page.evaluate(() => window.__harness.rt.ready)

async function setCode(code) {
  await page.click('#tabbtn-code')
  await page.fill('#code', code)
  await page.waitForFunction((c) => window.__harness.core.toCode(window.__harness.sketch) === c, code, { timeout: 5000 }).catch(() => {})
  await sleep(900)
}
/** main output (o0) as 64×36 RGBA */
const mainShot = () =>
  page.evaluate(async () => {
    const url = await window.__harness.rt.screenshot()
    const img = new Image()
    await new Promise((res) => ((img.onload = res), (img.src = url)))
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 36
    const x = c.getContext('2d')
    x.drawImage(img, 0, 0, 64, 36)
    return [...x.getImageData(0, 0, 64, 36).data]
  })
/** each thumbnail sampled at a 4×3 grid of points (row-major, top-left first) */
const thumbs = () =>
  page.$$eval('.pv-thumb:not(.big)', (cs) =>
    cs.map((c) => {
      const x = c.getContext('2d')
      const pts = []
      for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) pts.push([...x.getImageData(Math.floor(((i + 0.5) * c.width) / 4), Math.floor(((j + 0.5) * c.height) / 3), 1, 1).data])
      return { call: c.dataset.call, pts }
    }),
  )
const states = () => page.evaluate(() => window.__harness.previews.handles().map((x) => x.handle.state))
const poolStats = () => page.evaluate(() => ({ ...window.__harness.previews.pool.stats, iframes: document.querySelectorAll('[data-preview-pool] iframe').length }))
const lit = (p) => p[0] + p[1] + p[2] > 40
const near = (a, b, tol = 24) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
const meanDiff = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
  return s / ((a.length / 4) * 3)
}
/** wait until every thumbnail has settled (still taken and paused, or refused/failed) */
async function settle(scroll = true) {
  await page.waitForFunction(() => window.__harness.previews.handles().length > 0, null, { timeout: 10000 })
  const n = (await states()).length
  for (let k = 0; k < n && scroll; k++) {
    await page.evaluate((i) => document.querySelectorAll('.pv-thumb:not(.big)')[i]?.scrollIntoView({ block: 'center' }), k)
    await sleep(150)
  }
  await page.waitForFunction(() => window.__harness.previews.handles().every((x) => !/^(waiting|starting|running)$/.test(x.handle.state)), null, { timeout: 30000 })
}

// first, on a fresh page: the first copy of an output is where creating the copy's framebuffer used to fail
await step('prev(): a feedback chain previews from copies of its own output, without failed copies', async () => {
  await setCode('osc(10, 0, 1).out()\nprev().out(o1)\n')
  await page.click('#tabbtn-previews')
  await settle()
  const before = await poolStats()
  const cells = await page.$$('.pv-cell')
  await cells[cells.length - 1].click() // prev(): animate it and open its before/after
  await sleep(3000)
  const s = await poolStats()
  const st = await states()
  const diffState = await page.textContent('#pv-diff-state')
  assert.equal(s.feedFailures, 0, 'copies of the main output failed: ' + JSON.stringify(s))
  assert.ok(s.feeds > before.feeds, 'the prev() preview was fed: ' + JSON.stringify(s))
  assert.ok(!st.includes('error') && !/error/.test(diffState), `${st.join(' ')} | ${diffState}`)
  const app = await page.evaluate(() => window.__harness.previews.handles().at(-1).handle.approximate)
  assert.equal(app, true, 'prev() is approximate')
  await page.click('#tabbtn-code')
  return `copied pictures ${s.feeds - before.feeds} in 3 s, none failed`
})

await setCode(SKETCH)
const mainBefore = await mainShot()
let maxSeen = { runtimes: 0, iframes: 0 }
const watchPool = async () => {
  const s = await poolStats()
  maxSeen = { runtimes: Math.max(maxSeen.runtimes, s.runtimes), iframes: Math.max(maxSeen.iframes, s.iframes) }
  return s
}
const sampler = setInterval(() => void watchPool().catch(() => {}), 100)
await page.click('#tabbtn-previews')

let shots
await step('thumbnails show everything up to each call, nested texture argument included', async () => {
  await settle()
  shots = await thumbs()
  const st = await states()
  assert.equal(shots.length, 5, `one thumbnail per call: ${shots.map((s) => s.call).join(' ')}`)
  const [solid, grad, osc, mod] = shots
  assert.ok(solid.pts.every((p) => near(p, [0, 0, 255, 255])), 'solid(0,0,1) is blue: ' + JSON.stringify(solid.pts[5]))
  assert.ok(lit(grad.pts[11]), 'gradient is lit')
  assert.ok(osc.pts.some(lit) && mod.pts.some(lit), 'osc and osc.modulate(noise().scale()) are lit')
  const d = osc.pts.reduce((s, p, i) => s + Math.abs(p[0] - mod.pts[i][0]) + Math.abs(p[1] - mod.pts[i][1]) + Math.abs(p[2] - mod.pts[i][2]), 0) / 36
  assert.ok(d > 8, `modulate by the nested noise changes the picture (mean diff ${d.toFixed(1)})`)
  assert.ok(!st.some((s) => s === 'error'), 'no preview failed: ' + st.join(' '))
  return `states: ${st.join(' ')}`
})

await step('the pool never exceeds its size', async () => {
  const s = await watchPool()
  assert.equal(s.maxRuntimes, 2)
  assert.ok(maxSeen.runtimes <= 2 && maxSeen.iframes <= 2, JSON.stringify(maxSeen))
  return `max runtimes ${s.maxRuntimes}, max preview iframes seen ${maxSeen.iframes}, runs ${s.runs}, frames ${s.frames}`
})

await step('a chunk reading another output is approximated (≈) from a copy of the main picture, the right way up', async () => {
  const [, grad, , , srcO1] = shots
  const app = await page.evaluate(() => window.__harness.previews.handles().map((x) => x.handle.approximate))
  assert.deepEqual(app.map(Boolean), [false, false, false, false, true], 'only src(o1) is approximate: ' + app)
  // gradient(0): red grows left→right, green grows top→bottom in Hydra's picture; the copy must match the direct preview
  const bad = srcO1.pts.map((p, i) => (near(p, grad.pts[i], 40) ? null : { i, copy: p, direct: grad.pts[i] })).filter(Boolean)
  assert.ok(bad.length === 0, 'approximate copy differs from the direct gradient: ' + JSON.stringify(bad))
  assert.ok(grad.pts[3][0] > grad.pts[0][0] + 60, 'gradient red grows to the right (sanity)')
  const s = await poolStats()
  assert.ok(s.feeds >= 1 && s.feedFailures === 0, JSON.stringify(s))
  return `copied pictures ${s.feeds}, ${s.feedMs.toFixed(0)} ms each (software)`
})

await step('before/after of a modifier shows two different pictures', async () => {
  const cells = await page.$$('.pv-cell')
  await cells[3].scrollIntoViewIfNeeded()
  await cells[3].click() // osc(...).modulate(...)
  await page.waitForFunction(() => /running|paused/.test(document.querySelector('#pv-diff-state')?.textContent ?? ''), null, { timeout: 15000 })
  await sleep(800)
  const d = await page.evaluate(() => {
    const g = (id) => [...document.getElementById(id).getContext('2d').getImageData(0, 0, 256, 144).data]
    const a = g('pv-a')
    const b = g('pv-b')
    let s = 0
    for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
    return { diff: s / ((a.length / 4) * 3), litA: a.some((v, i) => i % 4 !== 3 && v > 40) }
  })
  assert.ok(d.litA && d.diff > 5, JSON.stringify(d))
  return `mean difference ${d.diff.toFixed(1)}/255`
})

await step('live mode animates visible thumbnails; the main output stays pixel-identical throughout', async () => {
  await page.selectOption('#pv-mode', 'live')
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(1500)
  const f0 = await page.evaluate(() => {
    window.__pvCount = 0
    for (const { handle } of window.__harness.previews.handles()) handle.onFrame(() => window.__pvCount++)
    return performance.now()
  })
  const during = []
  for (let i = 0; i < 4; i++) {
    await sleep(500)
    during.push(await mainShot())
    await watchPool()
  }
  const { n, ms, running } = await page.evaluate((t0) => ({ n: window.__pvCount, ms: performance.now() - t0, running: window.__harness.previews.handles().filter((x) => x.handle.state === 'running').length }), f0)
  for (const shot of during) assert.equal(meanDiff(mainBefore, shot), 0, 'main output changed while previews ran')
  assert.ok(running >= 1 && running <= 2, `running thumbnails ${running}`)
  assert.ok(n > 0, 'live thumbnails got frames')
  await page.selectOption('#pv-mode', 'demand')
  await sleep(600)
  assert.equal(meanDiff(mainBefore, await mainShot()), 0, 'main output changed after previews')
  assert.ok(maxSeen.runtimes <= 2 && maxSeen.iframes <= 2, JSON.stringify(maxSeen))
  return `${running} running at once (pool size 2); ${((n / ms) * 1000).toFixed(1)} preview frames/s in total across them (software WebGL)`
})

await step('trust gate: a sketch that runs code gets no preview runtime until trusted', async () => {
  const runsBefore = (await poolStats()).runs
  await setCode('window.__x = 1\nsolid(1, 0, 0).out()\n')
  await page.click('#tabbtn-previews')
  await page.waitForFunction(() => window.__harness.previews.handles().length > 0)
  await sleep(800)
  const st = await states()
  const s = await poolStats()
  assert.ok(st.length >= 1 && st.every((x) => x === 'untrusted'), st.join(' '))
  assert.equal(s.runs, runsBefore, 'nothing of the untrusted sketch ran in a preview runtime')
  await page.click('#tabbtn-code')
  await page.click('#trust-once')
  await page.click('#tabbtn-previews')
  await page.evaluate(() => window.__harness.previews.refresh())
  await sleep(300)
  await settle(false)
  const after = await states()
  assert.ok(after.every((x) => x === 'paused'), after.join(' '))
  return `untrusted → ${after.join(' ')} after "Run it once"`
})

await step('disabling a modifier changes the compiled output and the picture, not the IR order', async () => {
  await setCode('osc(20, 0, 1).kaleid(5).color(1, 0.2, 0.2).out()\n')
  const r = await page.evaluate(async () => {
    const { core, rt, sketch } = window.__harness
    const chain = sketch.stmts[0].chain
    const id = chain.mods[0].id
    const check = core.canDisable(sketch, id)
    const off = core.setDisabled(sketch, id, true)
    const order = (s) => JSON.stringify(s.stmts[0].chain.mods.map((m) => m.id))
    const text = core.toCode(off)
    const run = (s) => core.toRunnable(s).code
    const back = core.importText(text).sketch
    return { ok: check.ok, sameOrder: order(off) === order(sketch), text, runOn: run(sketch), runOff: run(off), revived: core.isDisabled(back, back.stmts[0].chain.mods[0].id), backOrder: back.stmts[0].chain.mods.map((m) => m.fn).join(',') }
  })
  assert.ok(r.ok && r.sameOrder, JSON.stringify(r))
  assert.match(r.text, /^osc\(20, 0, 1\)\n\s*\/\/ \.kaleid\(5\)\n\s*\.color\(1, 0\.2, 0\.2\)\.out\(\)/m)
  assert.notEqual(r.runOn, r.runOff)
  assert.doesNotMatch(r.runOff, /kaleid/)
  assert.ok(r.revived && r.backOrder === 'kaleid,color', JSON.stringify(r))
  const on = await mainShot()
  await setCode(r.text)
  const off = await mainShot()
  assert.ok(meanDiff(on, off) > 5, `picture changed (${meanDiff(on, off).toFixed(1)})`)
  await setCode('osc(20, 0, 1).kaleid(5).color(1, 0.2, 0.2).out()\n')
  const again = await mainShot()
  assert.ok(meanDiff(on, again) < 2, `re-enabled picture matches (${meanDiff(on, again).toFixed(1)})`)
  return r.text.trim().replace(/\n/g, ' ⏎ ')
})

clearInterval(sampler)
await step('no page errors', async () => assert.deepEqual(errors, []))
await browser.close()
app.close?.()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
