// The shared number editor (packages/kit) end to end, in every editor, at both iPad orientations (1180×820 and 820×1180),
// driven with real timed touches through the DevTools protocol (Input.dispatchTouchEvent), the path an iPad's fingers take.
//   node scripts/e2e-numbers.mjs [--skip-build] [--only stack,graph] [--shots <dir>]
// Per editor and orientation:
//   1. tap a number: the tabbed editor opens (Keypad / Ladder / Pad); the last tab is remembered
//   2. long-press a number, then slide: the ladder steps by its rung, a slide down changes the rung, the rung stays locked
//      while the value has moved, release = one undo step
//   3. the Ladder tab with a keyboard: arrows step, Enter commits one undo step, Esc cancels
//   4. Glide: a typed target glides there frame by frame and lands as one undo step; Return glides back
//   5. Pad: "Bind to a pad" writes a knob def and a reference; holding the pad changes the picture, letting go restores it
//   6. (landscape) the export, self-contained, runs in a plain hydra-synth page and its knob still plays
//   7. (landscape) the next editor opens the same sketch with the binding and the pad config intact
// Software WebGL: timings are not device performance.
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, SOFTWARE_GL_ARGS } from './lib/browser.mjs'
import { serve } from './serve.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv
if (!argv.includes('--skip-build')) execFileSync('npm', ['run', 'build:all'], { cwd: root, stdio: 'inherit' })
const arg = (k) => (argv.indexOf(k) > 0 ? argv[argv.indexOf(k) + 1] : undefined)
const shots = resolve(arg('--shots') ?? join(root, 'test-results', 'numbers'))
mkdirSync(shots, { recursive: true })
const APPS = ['stack', 'graph', 'blocks', 'rack']
const only = arg('--only')?.split(',') ?? APPS
const VIEWPORTS = [
  { name: 'landscape', width: 1180, height: 820 },
  { name: 'portrait', width: 820, height: 1180 },
]

// the app under test is served from a copy (the build may be rerun while this runs); a plain Hydra page on another origin
const tmp = mkdtempSync(join(tmpdir(), 'hydra-e2e-numbers-'))
cpSync(join(root, 'dist'), join(tmp, 'dist'), { recursive: true })
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
window.grab = () => new Promise((res) => hydra.getScreenImage(async (blob) => {
  const bmp = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = 32; c.height = 18
  const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, 32, 18); res([...x.getImageData(0, 0, 32, 18).data])
}))
</script>`,
)
const app = await serve(join(tmp, 'dist'), 0)
const vanilla = await serve(vanillaDir, 0)
const base = `http://localhost:${app.port}/`
const vanillaBase = `http://127.0.0.1:${vanilla.port}/`

// a static picture (sync 0), so any change in it comes from the number under test
const SKETCH = 'osc(20, 0, 0.8).rotate(0.8).out()'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const t0 = Date.now()

/** mean absolute difference of two 32×18 RGBA captures (0..255) */
const diff = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
  return s / ((a.length / 4) * 3)
}

async function session(appName, vp) {
  const browser = await launch({ args: SOFTWARE_GL_ARGS })
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  const cdp = await context.newCDPSession(page)
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1, radiusX: 8, radiusY: 8, force: 0.5 })) })
  const S = { appName, vp, browser, context, page, cdp, errors, send, h: `__${appName}` }
  S.close = async () => {
    await Promise.race([browser.close().catch(() => {}), sleep(8000)])
    try {
      browser.process()?.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
  return S
}

const handle = (S) => S.h
const evalApp = (S, fn, a) => S.page.evaluate(({ h, src, a }) => new Function('A', 'a', `return (${src})(A, a)`)(window[h], a), { h: handle(S), src: fn.toString(), a })

async function open(S, appName, id) {
  S.appName = appName
  S.h = `__${appName}`
  await S.page.goto(base + appName + '/')
  await S.page.waitForFunction((h) => !!window[h]?.lib, S.h, { timeout: 20000 })
  if (!id) id = await evalApp(S, async (A, code) => (await A.lib.create('Numbers e2e', code)).id, SKETCH)
  await S.page.goto(base + appName + '/#/s/' + id)
  await S.page.reload()
  await S.page.waitForFunction(({ h, id }) => window[h]?.store?.sketch?.id === id, { h: S.h, id }, { timeout: 20000 })
  await waitRun(S)
  return id
}

async function waitRun(S, timeout = 30000) {
  await S.page.waitForFunction((h) => window[h]?.runner?.status?.phase === 'ok', S.h, { timeout })
  await sleep(400)
}

const code = (S) => evalApp(S, (A) => A.core.toCode(A.store.sketch))
const history = (S) => evalApp(S, (A) => A.store.past.length)
const undo = (S) => evalApp(S, (A) => A.store.undo())
/** the arguments of the first `fn(…)` call in the exported code, as text */
async function args(S, fn) {
  const c = await code(S)
  const m = c.match(new RegExp(`${fn}\\(([^()]*)\\)`))
  return m ? m[1].split(',').map((x) => x.trim()) : []
}
const numArg = async (S, fn, i) => Number((await args(S, fn))[i])

/** mark the control of argument `i` of the first `fn` call in this editor; returns a selector for it */
async function mark(S, fn, i) {
  const ok = await S.page.evaluate(
    ({ app, fn, i }) => {
      document.querySelectorAll('[data-e2e-num]').forEach((e) => e.removeAttribute('data-e2e-num'))
      let el = null
      if (app === 'stack') el = document.querySelectorAll(`[data-fn=${fn}] [role=spinbutton]`)[i]
      else if (app === 'graph') el = document.querySelector(`[data-testid="num-${fn}-${i}"]`)
      else {
        const sel = app === 'blocks' ? `.workspace [data-call][data-fn="${fn}"]` : `[data-testid=module][data-fn="${fn}"]`
        const id = document.querySelector(sel)?.dataset.call
        el = id && document.querySelector(app === 'blocks' ? `[data-testid="num-${id}:${i}"]` : `[data-testid="knob-${id}:${i}"]`)
      }
      if (!el) return false
      el.setAttribute('data-e2e-num', '')
      return true
    },
    { app: S.appName, fn, i },
  )
  assert.ok(ok, `no control for ${fn} argument ${i}`)
  return '[data-e2e-num]'
}

/** scroll the control into view, out from under floating bars and the preview; returns its centre */
async function reach(S, sel) {
  const loc = S.page.locator(sel).first()
  await loc.waitFor({ timeout: 8000 })
  for (const block of ['center', 'start', 'end', 'nearest']) {
    await loc.evaluate((el, block) => el.scrollIntoView({ block, inline: 'center' }), block)
    await sleep(80)
    const p = await loc.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const x = r.x + r.width / 2
      const y = r.y + r.height / 2
      const t = document.elementFromPoint(x, y)
      return t && (el === t || el.contains(t)) ? { x, y } : null
    })
    if (p) return p
  }
  // a canvas editor (Blocks) can have the floating preview over the number: pan the workspace left once and look again
  if (S.appName === 'blocks' && !S.panned) {
    S.panned = true
    const from = { x: Math.round(S.vp.width * 0.62), y: Math.round(S.vp.height * 0.85) }
    await S.send('touchStart', [from])
    for (let i = 1; i <= 10; i++) {
      await S.send('touchMove', [{ x: from.x - i * 30, y: from.y }])
      await sleep(20)
    }
    await S.send('touchEnd', [])
    await sleep(300)
    return reach(S, sel)
  }
  throw new Error(`${sel} is covered or off screen`)
}

async function tap(S, target) {
  const p = typeof target === 'string' ? await reach(S, target) : target
  await S.send('touchStart', [p])
  await sleep(40)
  await S.send('touchEnd', [])
  await sleep(120)
}

async function closePopovers(S) {
  for (let i = 0; i < 3 && (await S.page.locator('[data-testid=popover-scrim]').count()); i++) {
    await S.page.locator('[data-testid=popover-scrim]').last().dispatchEvent('pointerdown')
    await sleep(150)
  }
}

/** the running preview, 32×18 RGBA */
const grab = (S) =>
  S.page.evaluate(async (h) => {
    const url = await window[h].runner.rt.screenshot()
    const img = new Image()
    await new Promise((res) => ((img.onload = res), (img.src = url)))
    const c = document.createElement('canvas')
    c.width = 32
    c.height = 18
    const x = c.getContext('2d')
    x.drawImage(img, 0, 0, 32, 18)
    return [...x.getImageData(0, 0, 32, 18).data]
  }, S.h)
async function grabRetry(S, tries = 3) {
  try {
    return await grab(S)
  } catch (e) {
    if (tries > 1) return (await sleep(300), grabRetry(S, tries - 1))
    throw e
  }
}

let current = null
async function step(name, fn) {
  const s = Date.now()
  // a failed step must not leave its popover over the next one
  if (current) await closePopovers(current).catch(() => {})
  try {
    const note = await fn()
    results.push({ name, ok: true, ms: Date.now() - s, note })
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''}`)
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - s, note: e.message })
    console.log(`  ✗ ${name}\n      ${String(e.stack || e).split('\n').slice(0, 6).join('\n      ')}`)
  }
}

console.log(`\nnumber editor e2e · ${base} · ${only.join(', ')} · SOFTWARE WebGL\n`)

let exported = null
for (const vp of VIEWPORTS) {
  for (const [ai, appName] of only.entries()) {
    const tag = `${appName} ${vp.name} ${vp.width}×${vp.height}`
    console.log(`${tag}`)
    const S = await session(appName, vp)
    current = S
    let id
    let knob
    try {
      await step(`${tag}: open a sketch`, async () => {
        id = await open(S, appName)
      })
      if (!id) continue

      await step(`${tag}: tap a number opens the tabbed editor; the last tab is remembered`, async () => {
        const sel = await mark(S, 'osc', 0)
        await tap(S, sel)
        await S.page.waitForSelector('[data-testid=number-editor]', { timeout: 4000 })
        const tabs = await S.page.locator('[data-testid^=numed-tab-]').evaluateAll((els) => els.map((e) => e.textContent))
        assert.deepEqual(tabs, ['Keypad', 'Ladder', 'Pad'])
        assert.equal(await S.page.getAttribute('[data-testid=number-editor]', 'data-tab'), 'keypad')
        await tap(S, '[data-testid=numed-tab-ladder]')
        await S.page.waitForSelector('[data-testid=ladder-panel]')
        await S.page.screenshot({ path: join(shots, `${appName}-${vp.name}-1-editor.png`) })
        await closePopovers(S)
        await tap(S, await mark(S, 'osc', 0))
        await S.page.waitForSelector('[data-testid=number-editor]')
        const remembered = await S.page.getAttribute('[data-testid=number-editor]', 'data-tab')
        await tap(S, '[data-testid=numed-tab-keypad]')
        await closePopovers(S)
        assert.equal(remembered, 'ladder')
      })

      await step(`${tag}: long-press opens the ladder under the finger; steps of 0.1, the rung locks until the value is back, then steps of 10; release is one undo step`, async () => {
        const sel = await mark(S, 'osc', 0)
        const p = await reach(S, sel)
        const v0 = await numArg(S, 'osc', 0)
        const h0 = await history(S)
        await S.send('touchStart', [p])
        await sleep(450)
        await S.page.waitForSelector('[data-testid=ladder]', { timeout: 1500 })
        const rungs = await S.page.locator('.ladder .rung').evaluateAll((els) => els.map((e) => e.dataset.rung))
        const r0 = await S.page.locator('.ladder .rung').evaluateAll((els) => els.findIndex((e) => e.classList.contains('on')))
        // the acceptance path: steps of 0.1, then steps of 10 (osc's frequency: rungs 100 … 0.1, starting on 10)
        const iFine = rungs.indexOf('0.1')
        const iCoarse = rungs.indexOf('10')
        assert.ok(iFine > r0 && iCoarse >= 0, `rungs ${rungs.join(' ')} from ${rungs[r0]}`)
        const m1 = 0.1
        const m2 = 10
        const yFine = p.y + (iFine - r0) * 40
        const yCoarse = p.y + (iCoarse - r0) * 40
        // slide down to the 0.1 rung, then two steps right
        for (let y = p.y + 6; y < yFine; y += 10) {
          await S.send('touchMove', [{ x: p.x, y }])
          await sleep(30)
        }
        await S.send('touchMove', [{ x: p.x, y: yFine }])
        await sleep(30)
        const onFine = await S.page.getAttribute('.ladder .rung.on', 'data-rung')
        for (const dx of [8, 16, 24, 34, 44, 54]) {
          await S.send('touchMove', [{ x: p.x + dx, y: yFine }])
          await sleep(30)
        }
        const v1 = Number(await S.page.textContent('[data-testid=ladder-value]'))
        // slide up while the value has moved: the rung stays locked on 0.1
        for (let y = yFine - 10; y > yCoarse; y -= 10) {
          await S.send('touchMove', [{ x: p.x + 54, y }])
          await sleep(30)
        }
        await S.send('touchMove', [{ x: p.x + 54, y: yCoarse }])
        await sleep(30)
        const locked = await S.page.getAttribute('.ladder .rung.on', 'data-rung')
        const vLocked = Number(await S.page.textContent('[data-testid=ladder-value]'))
        // slide back to the start: the value returns, the rung unlocks and follows the finger up to 10
        for (const dx of [46, 38, 30, 22, 14, 6]) {
          await S.send('touchMove', [{ x: p.x + dx, y: yCoarse }])
          await sleep(30)
        }
        const vBack = Number(await S.page.textContent('[data-testid=ladder-value]'))
        const onCoarse = await S.page.getAttribute('.ladder .rung.on', 'data-rung')
        // one step right on 10
        for (const dx of [20, 30, 40, 52]) {
          await S.send('touchMove', [{ x: p.x + dx, y: yCoarse }])
          await sleep(30)
        }
        const v2 = Number(await S.page.textContent('[data-testid=ladder-value]'))
        await S.page.screenshot({ path: join(shots, `${appName}-${vp.name}-2-ladder.png`) })
        await S.send('touchEnd', [])
        await sleep(400)
        assert.equal(await S.page.locator('[data-testid=ladder]').count(), 0, 'ladder closes on release')
        assert.equal(onFine, '0.1', 'a slide down picks the finer rung')
        assert.ok(Math.abs(v1 - (v0 + 2 * m1)) < 1e-9, `two steps of ${m1} from ${v0}: ${v1}`)
        assert.equal(locked, '0.1', 'the rung stays locked once the value has moved')
        assert.equal(vLocked, v1, 'and the value with it')
        assert.equal(vBack, v0, 'sliding back to the start returns the value')
        assert.equal(onCoarse, '10', 'back at the start, a slide up picks the coarser rung')
        assert.ok(Math.abs(v2 - (Math.floor(v0 / m2 + 1e-9) + 1) * m2) < 1e-9, `then one step of ${m2}, onto its grid: ${v2}`)
        assert.equal(await numArg(S, 'osc', 0), v2, 'the release commits')
        assert.equal(await history(S), h0 + 1, 'one undo step')
        assert.equal(await S.page.locator('[data-testid=number-editor]').count(), 0, 'a ladder gesture is not a tap')
        await undo(S)
        assert.equal(await numArg(S, 'osc', 0), v0, 'undo restores')
        return `${v0} → ${v1} (±${m1}, rung locked) → back to ${vBack} → ${v2} (±${m2}), one undo step`
      })

      await step(`${tag}: Ladder tab with a keyboard: arrows step, Esc cancels, Enter commits one undo step`, async () => {
        const v0 = await numArg(S, 'osc', 0)
        const h0 = await history(S)
        await tap(S, await mark(S, 'osc', 0))
        await tap(S, '[data-testid=numed-tab-ladder]')
        await S.page.focus('[data-testid=lp-body]')
        await S.page.keyboard.press('ArrowRight')
        await S.page.keyboard.press('Escape')
        await sleep(100)
        const afterEsc = await S.page.textContent('[data-testid=lp-value]')
        await S.page.keyboard.press('ArrowDown')
        const mag = Number((await S.page.textContent('.ladder-panel .lp-value small')).match(/([\d.e+-]+)\s*$/)?.[1])
        await S.page.keyboard.press('ArrowRight')
        await S.page.keyboard.press('ArrowRight')
        await S.page.keyboard.press('Enter')
        await sleep(200)
        const v = await numArg(S, 'osc', 0)
        await closePopovers(S)
        await sleep(200)
        assert.equal(Number(afterEsc), v0, 'Esc went back')
        assert.ok(Math.abs(v - (v0 + 2 * mag)) < 1e-9, `two steps of ${mag}: ${v0} → ${v}`)
        assert.equal(await history(S), h0 + 1, 'one undo step')
        await undo(S)
        await tap(S, await mark(S, 'osc', 0))
        await tap(S, '[data-testid=numed-tab-keypad]')
        await closePopovers(S)
        return `${v0} → ${v}`
      })

      await step(`${tag}: Glide: a typed target glides there and lands as one undo step; Return glides back`, async () => {
        await waitRun(S)
        const v0 = await numArg(S, 'rotate', 0)
        const h0 = await history(S)
        await tap(S, await mark(S, 'rotate', 0))
        await S.page.waitForSelector('[data-testid=keypad]')
        if (!(await S.page.isChecked('[data-testid=glide-toggle]'))) await tap(S, '.glide .switch')
        await S.page.waitForSelector('[data-testid=glide-dur]')
        await tap(S, '.glide-durs [data-dur="0.5"]')
        await tap(S, '.curves [data-ease="easeInOutCubic"]')
        const before = await grabRetry(S)
        await tap(S, '.keypad [data-key="2"]')
        await tap(S, '[data-testid=kp-go]')
        const status = await S.page.textContent('[data-testid=glide-status]')
        await sleep(120)
        const mid = await grabRetry(S)
        await S.page.screenshot({ path: join(shots, `${appName}-${vp.name}-3-glide.png`) })
        await S.page.waitForFunction(() => !/gliding/.test(document.querySelector('[data-testid=glide-status]')?.textContent ?? ''), null, { timeout: 4000 })
        await sleep(300)
        const landed = await numArg(S, 'rotate', 0)
        const steps = (await history(S)) - h0
        const ret = await S.page.textContent('[data-testid=glide-return]')
        await tap(S, '[data-testid=glide-return]')
        await sleep(900)
        const back = await numArg(S, 'rotate', 0)
        // leave glide off for the rest of the run (the choice is remembered)
        await tap(S, '.glide .switch')
        await closePopovers(S)
        assert.match(status, /gliding/)
        assert.ok(diff(before, mid) > 1, `the picture moves during the glide (${diff(before, mid).toFixed(2)})`)
        assert.equal(landed, 2)
        assert.equal(steps, 1, 'the glide is one undo step')
        assert.match(ret, new RegExp(String(v0)))
        assert.equal(back, v0, 'Return glides back')
        await undo(S)
        await undo(S)
        assert.equal(await numArg(S, 'rotate', 0), v0)
        return `${v0} → 2 in 0.5 s (${status.trim()}), one step; back to ${back}`
      })

      await step(`${tag}: Pad: bind writes a knob; holding the pad changes the picture, letting go restores it`, async () => {
        await tap(S, await mark(S, 'osc', 2))
        await tap(S, '[data-testid=numed-tab-pad]')
        await tap(S, '[data-testid=pad-bind]')
        await S.page.waitForSelector('[data-testid=pad-editor]')
        await closePopovers(S)
        knob = await evalApp(S, (A) => A.store.sketch.meta.kit.pads[0].knob)
        const c = await code(S)
        assert.match(c, new RegExp(`^${knob} = knob\\(0\\.8\\)`, 'm'), c)
        assert.match(c, new RegExp(`osc\\(20, 0, ${knob}\\)`), c)
        await waitRun(S)
        await sleep(600)
        const pad = await reach(S, `[data-testid="pad-${knob}"]`)
        const trust = await evalApp(S, (A) => ({ pending: A.runner.trust.pending, parts: A.runner.trust.parts.length, phase: A.runner.status.phase }))
        assert.equal(await S.page.locator(`[data-testid="pad-${knob}"].inert`).count(), 0, `pad live (the sketch ran its code): ${JSON.stringify(trust)}`)
        const before = await grabRetry(S)
        await S.send('touchStart', [pad])
        await sleep(500)
        const held = await grabRetry(S)
        await S.page.screenshot({ path: join(shots, `${appName}-${vp.name}-4-pad.png`) })
        await S.send('touchEnd', [])
        await sleep(900)
        const after = await grabRetry(S)
        assert.ok(diff(before, held) > 4, `holding the pad changes the picture (${diff(before, held).toFixed(2)})`)
        assert.ok(diff(before, after) < 2, `letting go restores it (${diff(before, after).toFixed(2)})`)
        return `${knob}: Δ held ${diff(before, held).toFixed(1)}, Δ released ${diff(before, after).toFixed(1)}`
      })

      if (vp.name === 'landscape') {
        await step(`${tag}: export self-contained runs in a plain hydra-synth page; the knob still plays`, async () => {
          exported = await evalApp(S, (A) => A.core.exportWithPrelude(A.store.sketch))
          assert.doesNotMatch(exported, /loadScript/)
          const v = await S.context.newPage()
          const errs = []
          v.on('pageerror', (e) => errs.push(e.message))
          await v.goto(vanillaBase)
          await v.waitForFunction(() => !!window.hydra)
          await v.evaluate((c) => window.hydra.eval(c), exported)
          await sleep(800)
          const a = await v.evaluate(() => window.grab())
          await v.evaluate((k) => window[k].hold(2.5), knob)
          await sleep(500)
          const b = await v.evaluate(() => window.grab())
          await v.evaluate((k) => window[k].release(0), knob)
          await sleep(500)
          const c = await v.evaluate(() => window.grab())
          await v.close()
          assert.deepEqual(errs, [])
          assert.ok(diff(a, b) > 4, `hold changes the plain page's picture (${diff(a, b).toFixed(2)})`)
          assert.ok(diff(a, c) < 2, `release restores it (${diff(a, c).toFixed(2)})`)
          return `${exported.length} chars; Δ ${diff(a, b).toFixed(1)} / ${diff(a, c).toFixed(1)}`
        })

        const nextApp = APPS[(APPS.indexOf(appName) + 1) % APPS.length]
        await step(`${tag}: ${nextApp} opens the same sketch with the binding and the pads`, async () => {
          const before = await evalApp(S, (A) => ({ pads: A.store.sketch.meta.kit.pads, dock: A.store.sketch.meta.kit.dock }))
          await evalApp(S, async (A) => A.lib.flush())
          await sleep(200)
          const prev = S.appName
          await S.page.goto(base + nextApp + '/')
          await S.page.waitForFunction((h) => !!window[h]?.lib, `__${nextApp}`, { timeout: 20000 })
          S.appName = nextApp
          S.h = `__${nextApp}`
          await S.page.goto(base + nextApp + '/#/s/' + id)
          await S.page.reload()
          await S.page.waitForFunction(({ h, id }) => window[h]?.store?.sketch?.id === id, { h: S.h, id }, { timeout: 20000 })
          const after = await evalApp(S, (A) => ({ pads: A.store.sketch.meta.kit?.pads, dock: A.store.sketch.meta.kit?.dock }))
          const c = await code(S)
          await S.page.waitForSelector(`[data-testid="pad-${knob}"]`, { timeout: 8000 })
          await S.page.screenshot({ path: join(shots, `${prev}-to-${nextApp}.png`) })
          assert.deepEqual(after, before)
          assert.match(c, new RegExp(`osc\\(20, 0, ${knob}\\)`))
          return `${before.pads.length} pad(s), dock ${before.dock ? 'open' : 'closed'}`
        })
      }

      await step(`${tag}: no page errors`, async () => {
        assert.deepEqual(S.errors, [])
      })
    } finally {
      await S.close()
    }
    void ai
  }
}

app.server.close()
vanilla.server.close()
const failed = results.filter((r) => !r.ok)
writeFileSync(join(shots, 'numbers-results.json'), JSON.stringify({ when: new Date().toISOString(), software: true, results }, null, 2))
console.log(`\n${results.length - failed.length}/${results.length} steps passed in ${((Date.now() - t0) / 1000).toFixed(1)} s · screenshots in ${shots}`)
process.exit(failed.length ? 1 : 0)
