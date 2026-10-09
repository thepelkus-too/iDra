// Acceptance run for Patch Graph: real Chromium at iPad viewports, software WebGL (SwiftShader), real touch input via CDP.
//   npm run build:all && node apps/graph/e2e/acceptance.mjs [--skip-build] [--only=1,2]
// Writes screenshots to apps/graph/shots/ and a results table to apps/graph/shots/RESULTS.md.
// Frame-time numbers are SOFTWARE rendered (no GPU in the build container) and say nothing about an iPad.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeOf, importAndOpen, root, sleep, start, waitForPicture } from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const shots = resolve(here, '../shots')
mkdirSync(shots, { recursive: true })
if (!process.argv.includes('--skip-build')) execFileSync('npm', ['run', 'build:all'], { cwd: root, stdio: 'inherit' })

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const want = (id) => !only || only.includes(id)
if (!only) for (const f of readdirSync(shots)) rmSync(join(shots, f), { recursive: true, force: true })
const results = []
const notes = []
const sessions = []
let lastPage
const startS = async (o) => {
  const S = await start(o)
  sessions.push(S)
  lastPage = S.page
  // text edits on nodes use the system prompt (works with the iPad keyboard and Scribble); answer it from the queue
  S.answers = []
  S.page.on('dialog', (d) => void d.accept(S.answers.length ? S.answers.shift() : d.defaultValue()))
  return S
}
async function block(id, fn) {
  try {
    await fn()
  } catch (e) {
    results.push({ id: `${id}*`, title: `block ${id} aborted`, ok: false, ms: 0, note: String(e.message).split('\n')[0] })
    console.log(`  ✗ block ${id} aborted: ${String(e.stack || e).split('\n').slice(0, 4).join('\n      ')}`)
  } finally {
    for (const S of sessions.splice(0)) await S.close().catch(() => {})
  }
}
async function check(id, title, fn) {
  const t0 = Date.now()
  try {
    const note = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 150 s')), 150000))])
    results.push({ id, title, ok: true, ms: Date.now() - t0, note })
    console.log(`  ✓ ${id} ${title}${note ? ` — ${note}` : ''}`)
  } catch (e) {
    results.push({ id, title, ok: false, ms: Date.now() - t0, note: String(e.message).split('\n')[0] })
    mkdirSync(join(shots, '.tmp'), { recursive: true })
    await lastPage?.screenshot({ path: join(shots, '.tmp', `fail-${id}-${results.length}.jpg`), type: 'jpeg', quality: 70 }).catch(() => {})
    console.log(`  ✗ ${id} ${title}\n      ${String(e.stack || e).split('\n').slice(0, 5).join('\n      ')}`)
  }
}
const shot = async (page, name) => page.screenshot({ path: join(shots, name.replace(/\.png$/, '.jpg')), type: 'jpeg', quality: 80 })

// ---------------------------------------------------------------- helpers

const canon = (S, code) => S.page.evaluate((code) => {
  const { importText, canonicalSketch } = window.__graph.core
  return JSON.stringify(canonicalSketch(importText(code).sketch))
}, code)
const canonCurrent = (S) => S.page.evaluate(() => {
  const { canonicalSketch } = window.__graph.core
  return JSON.stringify(canonicalSketch(window.__graph.store.sketch))
})

async function blank(S, name = 'Scratch', code = '') {
  await S.page.goto(S.base + 'graph/')
  await S.page.waitForFunction(() => !!window.__graph?.lib, null, { timeout: 15000 })
  const id = await S.page.evaluate(async ({ name, code }) => (await window.__graph.lib.create(name, code)).id, { name, code })
  await S.page.goto(S.base + 'graph/#/s/' + id)
  await S.page.reload()
  await S.page.waitForFunction((id) => window.__graph?.store?.sketch?.id === id, id, { timeout: 15000 })
  await sleep(600)
  return id
}

/** the screen rectangle of the canvas that is not covered by the palette, the PiP or the bars */
async function freeArea(S) {
  return S.page.evaluate(() => {
    const c = document.querySelector('[data-testid=canvas]').getBoundingClientRect()
    const pal = document.querySelector('[data-testid=palette]')?.getBoundingClientRect()
    const pip = document.querySelector('[data-testid=pip]')?.getBoundingClientRect()
    return { left: c.left + 30, top: c.top + 20, right: (pip ? pip.left : c.right) - 30, bottom: (pal ? pal.top : c.bottom) - 20 }
  })
}

async function openPalette(S, tab) {
  if (!(await S.page.locator('[data-testid=palette]').count())) await S.touch.tap('[data-testid=add]')
  await S.page.waitForSelector('[data-testid=palette]')
  for (let k = 0; k < 3; k++) {
    await S.touch.tap(`[data-testid="pal-tab-${tab}"]`)
    await sleep(150)
    if ((await S.page.getAttribute(`[data-testid="pal-tab-${tab}"]`, 'aria-selected')) === 'true') return
  }
  throw new Error(`palette tab ${tab} did not open`)
}

/** drag a palette item to a screen point (finger up from the drawer onto the canvas) */
async function dragFromPalette(S, tab, key, to) {
  await openPalette(S, tab)
  const item = S.page.locator(`[data-item="${key}"]`).first()
  await item.scrollIntoViewIfNeeded()
  const p = await S.touch.center(item)
  const steps = 16
  const path = Array.from({ length: steps }, (_, i) => ({ x: p.x + ((to.x - p.x) * (i + 1)) / steps, y: p.y + ((to.y - p.y) * (i + 1)) / steps }))
  await S.touch.drag(p, 0, 0, { path, stepMs: 18 })
  await sleep(250)
}

const portSel = (node, p) => `.canvas .node${node} .port[data-p="${p}"]`
/** drag a cable from one port to another (or to a point) with one finger */
async function wire(S, from, to) {
  const a = await S.touch.center(from)
  const b = typeof to === 'string' ? await S.touch.center(to) : to
  const steps = 14
  const path = Array.from({ length: steps }, (_, i) => ({ x: a.x + ((b.x - a.x) * (i + 1)) / steps, y: a.y + ((b.y - a.y) * (i + 1)) / steps }))
  await S.touch.drag(a, 0, 0, { path, stepMs: 16 })
  await sleep(250)
}

/** enter a number with the keypad, by tapping keys */
async function keypad(S, locator, text) {
  await S.touch.tap(locator)
  await S.page.waitForSelector('[data-testid=keypad]')
  for (const ch of text) await S.touch.tap(`.keypad [data-key="${ch === '-' ? '±' : ch}"]`)
  await S.touch.tap('[data-testid=kp-ok]')
  await sleep(200)
}

async function closePalette(S) {
  if (await S.page.locator('[data-testid=palette]').count()) await S.touch.tap('[data-testid=pal-close]')
  await sleep(150)
}

/** one finger pans the canvas */
async function pan(S, dx, dy) {
  const a = await freeArea(S)
  // start on empty canvas: look for a spot no node covers
  const p = await S.page.evaluate((a) => {
    for (let y = a.top + 10; y < a.bottom; y += 23) for (let x = a.left + 10; x < a.right; x += 29) {
      const el = document.elementFromPoint(x, y)
      if (el && el.matches('[data-testid=canvas], .world, .cables')) return { x, y }
    }
    return null
  }, a)
  if (!p) throw new Error('no empty canvas to pan from')
  await S.touch.drag(p, dx, dy, { steps: 10 })
}

const TARGET = 'osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out()'

// ============================================================================================================ 1. build by touch
for (const [label, vp] of want('1') ? [['landscape', { width: 1180, height: 820 }], ['portrait', { width: 820, height: 1180 }]] : []) await block('1', async () => {
  const S = await startS({ viewport: vp })
  await check('1', `build ${TARGET} with touch only (${label} ${vp.width}×${vp.height})`, async () => {
    await blank(S, `Touch build ${label}`)
    await waitForPicture(S.page).catch(() => {})
    const A = await freeArea(S)
    // o0 is on the canvas from the start; put it at a known place by dragging it
    const o0 = await S.touch.center('.canvas .node[data-node="out:o0"] .nhead')
    await S.touch.drag(o0, A.right - 150 - o0.x, A.top + 120 - o0.y)
    await openPalette(S, 'Sources')
    const B = await freeArea(S)
    await dragFromPalette(S, 'Sources', 'fn:osc', { x: B.left + 60, y: B.top + 40 })
    assert.equal(await S.page.locator('.canvas .node[data-fn=osc]').count(), 1, 'osc node added')
    await closePalette(S)
    await keypad(S, '[data-testid="num-osc-0"]', '20')
    await keypad(S, '[data-testid="num-osc-2"]', '0.8')
    // osc → o0
    await wire(S, portSel('[data-fn=osc]', 'out'), portSel('[data-node="out:o0"]', 'in'))
    assert.match(await codeOf(S.page), /^osc\(20, 0\.1, 0\.8\)\s*\.out\(\)/)
    // rotate dropped on the cable splices it in
    await S.page.evaluate(() => {
      // a point on a cable that a finger can reach (not under a node, the PiP or the palette)
      window.__cablePoint = (p) => {
        const len = p.getTotalLength()
        const m = p.getScreenCTM()
        for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
          const pt = p.getPointAtLength(len * t)
          const x = pt.x * m.a + m.e, y = pt.y * m.d + m.f
          if (document.elementFromPoint(x, y) === p) return { x, y }
        }
        throw new Error('cable not reachable')
      }
    })
    const cableMid = async () => S.page.evaluate(() => window.__cablePoint([...document.querySelectorAll('.cable .hitpath')].pop()))
    let mid = await cableMid()
    await dragFromPalette(S, 'Geometry', 'fn:rotate', mid)
    assert.equal(await S.page.locator('.canvas .node[data-fn=rotate]').count(), 1, 'rotate spliced')
    await closePalette(S)
    await keypad(S, '[data-testid="num-rotate-0"]', '0.8')
    // modulate goes after rotate: drop it on the rotate → o0 cable
    mid = await S.page.evaluate(() => {
      const rot = document.querySelector('.canvas .node[data-fn=rotate]').dataset.node
      return window.__cablePoint(document.querySelector(`.cable .hitpath[data-edge^="${rot}|out:o0"]`))
    })
    await dragFromPalette(S, 'Modulate', 'fn:modulate', mid)
    assert.equal(await S.page.locator('.canvas .node[data-fn=modulate]').count(), 1, 'modulate spliced')
    // noise somewhere free, then its output into modulate's texture input
    const C = await freeArea(S)
    await dragFromPalette(S, 'Sources', 'fn:noise', { x: C.left + 40, y: C.bottom - 30 })
    await closePalette(S)
    assert.equal(await S.page.locator('.canvas .node[data-fn=noise]').count(), 1, 'noise added')
    await keypad(S, '[data-testid="num-noise-0"]', '3')
    await wire(S, portSel('[data-fn=noise]', 'out'), portSel('[data-fn=modulate]', '0'))
    await keypad(S, '[data-testid="num-modulate-1"]', '0.1')
    const code = await codeOf(S.page)
    assert.equal(await canonCurrent(S), await canon(S, TARGET), `code is ${code}`)
    await waitForPicture(S.page).catch(() => {})
    await sleep(600)
    await shot(S.page, `01-touch-build-${label}.png`)
    assert.deepEqual(S.errors, [])
    return code.replace(/\s+/g, ' ').trim()
  })
})


/** pairs of node cards whose boxes overlap on screen (cards, terminals and macros) */
const overlaps = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll('.canvas .world > .node, .canvas .world > .term')]
  const rs = els.map((e) => ({ id: e.dataset.node || e.dataset.end, r: e.getBoundingClientRect() }))
  const bad = []
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i].r, b = rs[j].r
    if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) bad.push(`${rs[i].id} × ${rs[j].id}`)
  }
  return bad
})
const focus = (S, id) => S.page.evaluate((id) => window.__graph.canvasApi.focus(id), id).then(() => sleep(120))
const nodeId = (S, sel, nth = 0) => S.page.evaluate(({ sel, nth }) => document.querySelectorAll(`.canvas .node${sel}`)[nth]?.dataset.node, { sel, nth })

// ============================================================================================================ 2. feedback + cycles
if (want('2')) await block('2', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  const FB = 'src(o0).modulateRotate(osc(3),0.5).blend(osc(20),0.1).out(o0)'
  await check('2', `build ${FB} by touch; it runs; a loop that skips the output is refused with a red cable`, async () => {
    await blank(S, 'Feedback by touch')
    const A = await freeArea(S)
    const o0 = await S.touch.center('.canvas .node[data-node="out:o0"] .nhead')
    await S.touch.drag(o0, A.right - 140 - o0.x, A.top + 60 - o0.y)
    await openPalette(S, 'Sources')
    const B = await freeArea(S)
    await dragFromPalette(S, 'Sources', 'fn:src', { x: B.left + 40, y: B.top + 30 })
    await closePalette(S)
    // the output's read port (right side) into src's texture input
    await wire(S, portSel('[data-node="out:o0"]', 'out'), portSel('[data-fn=src]', '0'))
    await dragFromPalette(S, 'Modulate', 'fn:modulateRotate', await S.touch.center('.canvas .node[data-fn=src] .nhead'))
    await dragFromPalette(S, 'Blend', 'fn:blend', await S.touch.center('.canvas .node[data-fn=modulateRotate] .nhead'))
    const C = await freeArea(S)
    await dragFromPalette(S, 'Sources', 'fn:osc', { x: C.left + 20, y: C.bottom - 40 })
    await dragFromPalette(S, 'Sources', 'fn:osc', { x: C.left + 280, y: C.bottom - 40 })
    await closePalette(S)
    assert.equal(await S.page.locator('.canvas .node[data-fn=osc]').count(), 2)
    await keypad(S, S.page.locator('[data-testid="num-osc-0"]').nth(0), '3')
    await keypad(S, S.page.locator('[data-testid="num-osc-0"]').nth(1), '20')
    await wire(S, S.page.locator(portSel('[data-fn=osc]', 'out')).nth(0), portSel('[data-fn=modulateRotate]', '0'))
    await wire(S, S.page.locator(portSel('[data-fn=osc]', 'out')).nth(1), portSel('[data-fn=blend]', '0'))
    await keypad(S, '[data-testid="num-modulateRotate-1"]', '0.5')
    await keypad(S, '[data-testid="num-blend-1"]', '0.1')
    await wire(S, portSel('[data-fn=blend]', 'out'), portSel('[data-node="out:o0"]', 'in'))
    const code = await codeOf(S.page)
    assert.equal(await canonCurrent(S), await canon(S, FB), `code is ${code}`)
    await S.page.waitForFunction(() => window.__graph.runner.status.phase === 'ok', null, { timeout: 30000 })
    // the feedback cable is drawn as a loop back from the output
    assert.ok(await S.page.locator('.cable.fb').count() >= 1, 'feedback cable marked')
    await sleep(800)
    await shot(S.page, '02-feedback.png')
    // blend → modulateRotate's main input would loop without passing an output
    await wire(S, portSel('[data-fn=blend]', 'out'), portSel('[data-fn=modulateRotate]', 'in'))
    await S.page.waitForSelector('[data-testid=cable-rejected]', { timeout: 2000 })
    const toast = await S.page.locator('.toast').last().innerText()
    assert.match(toast, /loop/i)
    await shot(S.page, '02-cycle-rejected.png')
    assert.equal(await codeOf(S.page), code, 'the refused cable changed nothing')
    assert.deepEqual(S.errors, [])
    return `${code.replace(/\s+/g, ' ').trim()}; refused: "${toast}"`
  })
})

// ============================================================================================================ 3. modulators
if (want('3')) await block('3', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  await check('3', 'an LFO wired into rotate.angle becomes an arrow function; an Array node into shape.sides becomes an array literal with .fast()', async () => {
    await importAndOpen(S.page, S.base, 'osc(20, 0.1, 0.8).rotate(0.8).out()\nshape(3).out(o1)\n', 'Modulators')
    await waitForPicture(S.page)
    await focus(S, await nodeId(S, '[data-fn=rotate]'))
    // the palette covers the bottom: drop above it
    await dragFromPalette(S, 'Modulators', 'mod:sine', await S.touch.center(portSel('[data-fn=rotate]', '0')))
    let code = await codeOf(S.page)
    assert.match(code, /rotate\(\(\) => Math\.sin\(time \* [\d.]+\) \* [\d.]+ \+ 0\.8\)/, code)
    assert.equal(await S.page.locator('.canvas .node[data-kind=mod][data-mod=sine]').count(), 1)
    await closePalette(S)
    await shot(S.page, '03-lfo.png')
    await focus(S, await nodeId(S, '[data-fn=shape]'))
    await dragFromPalette(S, 'Modulators', 'mod:steps', await S.touch.center(portSel('[data-fn=shape]', '0')))
    await closePalette(S)
    code = await codeOf(S.page)
    assert.match(code, /shape\(\[[\d., ]+\]\)/, code)
    S.answers.push('2')
    await S.touch.tap('[data-testid=step-fast]')
    await sleep(300)
    code = await codeOf(S.page)
    assert.match(code, /shape\(\[[\d., ]+\]\.fast\(2\)\)/, code)
    await shot(S.page, '03-array.png')
    // pull the LFO cable off the input: the input is a plain number again
    await focus(S, await nodeId(S, '[data-fn=rotate]'))
    const A = await freeArea(S)
    await wire(S, portSel('[data-fn=rotate]', '0'), { x: A.left + 20, y: A.bottom - 20 })
    code = await codeOf(S.page)
    assert.match(code, /rotate\(0\.8\)/, code)
    assert.equal(await S.page.locator('.canvas .node[data-mod=sine]').count(), 0)
    assert.deepEqual(S.errors, [])
    return code.replace(/\s+/g, ' ').trim()
  })
})

// ============================================================================================================ 4. blending example
if (want('4')) await block('4', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  await check('4', 'import a blending example: every chain appears, laid out without overlap (corpus 03-blending.js; hydra-examples has no license to copy)', async () => {
    const code = readFileSync(join(root, 'packages/core/corpus/03-blending.js'), 'utf8')
    await importAndOpen(S.page, S.base, code, 'Blending')
    await waitForPicture(S.page)
    await sleep(500)
    const facts = await S.page.evaluate(() => {
      const sk = window.__graph.store.sketch
      const chains = sk.stmts.filter((s) => s.k === 'chain')
      return { chains: chains.length, shown: chains.filter((s) => document.querySelector(`.canvas .node[data-node="${s.chain.gen.id}"]`)).length, nodes: document.querySelectorAll('.canvas .node').length }
    })
    assert.equal(facts.shown, facts.chains)
    assert.deepEqual(await overlaps(S.page), [])
    await shot(S.page, '04-blending.png')
    // Arrange gives the same layout again
    await S.touch.tap('[data-testid=more]')
    await S.touch.tap('[data-testid=menu-arrange]')
    await sleep(300)
    assert.deepEqual(await overlaps(S.page), [])
    assert.equal(await codeOf(S.page), code)
    return `${facts.chains} chains, ${facts.nodes} nodes, no overlaps`
  })
})

// ============================================================================================================ 5. 60-node graph
if (want('5')) await block('5', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  await check('5', '60-node graph: pan and pinch-zoom frame times (software rendering)', async () => {
    const lines = []
    for (let i = 0; i < 9; i++) lines.push(`osc(${10 + i}, 0.1, 0.8).rotate(0.${i}).scale(1.1).color(1, 0.5, 0.2).kaleid(4).modulate(noise(${i + 1})).out(o${i % 4})`)
    await importAndOpen(S.page, S.base, lines.join('\n') + '\n', 'Sixty nodes')
    await waitForPicture(S.page)
    await sleep(800)
    const n = await S.page.locator('.canvas .node').count()
    assert.ok(n >= 60, `${n} nodes`)
    const measure = async (fn) => {
      await S.page.evaluate(() => {
        window.__ft = []
        let last = performance.now()
        const loop = (t) => {
          window.__ft.push(t - last)
          last = t
          if (window.__ftOn) requestAnimationFrame(loop)
        }
        window.__ftOn = true
        requestAnimationFrame(loop)
      })
      await fn()
      return S.page.evaluate(() => {
        window.__ftOn = false
        const f = window.__ft.slice(2).sort((a, b) => a - b)
        const q = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))]
        return { frames: f.length, median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +f[f.length - 1].toFixed(1) }
      })
    }
    const panT = await measure(async () => {
      for (let k = 0; k < 3; k++) {
        await pan(S, -300, -120)
        await pan(S, 300, 120)
      }
    })
    const pinchT = await measure(async () => {
      for (let k = 0; k < 3; k++) {
        const c = { x: 500, y: 420 }
        const steps = 24
        await S.touch.raw('touchStart', [{ x: c.x - 60, y: c.y }, { x: c.x + 60, y: c.y }])
        for (let i = 1; i <= steps; i++) {
          const d = 60 + (i * 180) / steps
          await S.touch.raw('touchMove', [{ x: c.x - d, y: c.y + i }, { x: c.x + d, y: c.y + i }])
          await sleep(16)
        }
        for (let i = steps; i >= 1; i--) {
          const d = 60 + (i * 180) / steps
          await S.touch.raw('touchMove', [{ x: c.x - d, y: c.y }, { x: c.x + d, y: c.y }])
          await sleep(16)
        }
        await S.touch.raw('touchEnd', [])
        await sleep(100)
      }
    })
    // the same pan with the Hydra preview paused, to separate the canvas from the (software) WebGL frame
    await S.page.evaluate(() => window.__graph.runner.rt.hush())
    await sleep(500)
    const quiet = await measure(async () => {
      for (let k = 0; k < 3; k++) {
        await pan(S, -300, -120)
        await pan(S, 300, 120)
      }
    })
    notes.push(`same pan with the preview hushed: median ${quiet.median} ms, p95 ${quiet.p95} ms over ${quiet.frames} frames`)
    await shot(S.page, '05-sixty-nodes.png')
    const k = await S.page.evaluate(() => window.__graph.store.sketch.meta.graph.cam?.k)
    notes.push(`60-node graph (${n} cards, SOFTWARE WebGL, live preview running): pan frame time median ${panT.median} ms, p95 ${panT.p95} ms over ${panT.frames} frames; pinch median ${pinchT.median} ms, p95 ${pinchT.p95} ms over ${pinchT.frames} frames`)
    return `pan median ${panT.median} ms / p95 ${panT.p95} ms; pinch median ${pinchT.median} ms / p95 ${pinchT.p95} ms; zoom saved (k=${k})`
  })
})

// ============================================================================================================ 6. offline
if (want('6')) await block('6', async () => {
  const S = await startS()
  const { page, context } = S
  await check('6', 'offline: after the shell has loaded once, an airplane-mode reload works and the edited sketch persists', async () => {
    await page.goto(S.base)
    await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r && !!r.active), null, { timeout: 20000 })
    await page.waitForFunction(() => caches.keys().then((k) => k.some((n) => n.startsWith('hydra-ipad-'))), null, { timeout: 20000 })
    await sleep(1500)
    const id = await importAndOpen(page, S.base, 'osc(20, 0.1, 0.8).rotate(0.8).out()\n', 'Offline sketch')
    await waitForPicture(page)
    await keypad(S, '[data-testid="num-rotate-0"]', '2')
    await page.evaluate(() => window.__graph.lib.flush())
    assert.match(await codeOf(page), /rotate\(2\)/)
    await context.setOffline(true)
    await page.reload()
    await page.waitForFunction((id) => window.__graph?.store?.sketch?.id === id, id, { timeout: 20000 })
    await waitForPicture(page, 20000)
    assert.match(await codeOf(page), /rotate\(2\)/, 'the edit survived the reload')
    assert.ok(await page.evaluate(() => !!window.__graph.store.sketch.meta.graph.pos), 'layout persisted')
    await shot(page, '06-offline.png')
    await context.setOffline(false)
    return 'reloaded with the network off; the preview ran from the cached bundle; rotate(2) and the layout persisted'
  })
})

// ============================================================================================================ 7. corpus
if (want('7')) await block('7', async () => {
  const dir = join(root, 'packages/core/corpus')
  const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  const { page, touch } = S
  await page.goto(S.base + 'graph/')
  await page.waitForFunction(() => !!window.__graph?.lib, null, { timeout: 15000 })
  await check('7', `corpus: all ${files.length} sketches open with no overlaps; every chain / def / comment / raw / setup statement has a node; untouched export identical; one number edit changes one line`, async () => {
    const problems = []
    let edited = 0
    for (const f of files) {
      const code = readFileSync(join(dir, f), 'utf8')
      const name = f.replace(/\.js$/, '')
      const id = await page.evaluate(async ({ code, name }) => (await window.__graph.lib.create(name, code)).id, { code, name })
      await page.evaluate((id) => (location.hash = '#/s/' + id), id)
      try {
        await page.waitForFunction((id) => window.__graph?.store?.sketch?.id === id, id, { timeout: 15000 })
        await page.waitForFunction(() => ['ok', 'error'].includes(window.__graph.runner.status.phase), null, { timeout: 15000 })
        await sleep(200)
        const missing = await page.evaluate(() => {
          const sk = window.__graph.store.sketch
          const has = (id) => !!document.querySelector(`.canvas .node[data-node="${id}"]`)
          const out = []
          for (const s of sk.stmts) {
            if (s.k === 'chain') { if (!has(s.chain.gen.id) || s.chain.mods.some((m) => !has(m.id) && !(window.__graph.store.sketch.meta.graph.links ?? {})[m.id])) out.push(`chain ${s.id}`) }
            else if (!has(s.id)) out.push(`${s.k} ${s.id}`)
          }
          if (!sk.meta?.graph?.pos) out.push('meta.graph missing')
          return out
        })
        const bad = [...missing]
        const ov = await overlaps(page)
        if (ov.length) bad.push(`overlaps: ${ov.slice(0, 3).join(', ')}`)
        if ((await codeOf(page)) !== code) bad.push('export differs from input')
        // one number on a single-line top-level call
        const target = await page.evaluate(() => {
          const { catalog } = window.__graph.core
          const sk = window.__graph.store.sketch
          for (const st of sk.stmts) {
            if (st.k !== 'chain') continue
            for (const call of [st.chain.gen, ...st.chain.mods]) {
              if (call.src?.text.includes('\n')) continue
              const inputs = catalog.inputs(call.fn)
              const i = call.args.findIndex((a, k) => a.k === 'num' && inputs[k]?.type === 'float')
              if (i >= 0) return { call: call.id, fn: call.fn, i }
            }
          }
          return null
        })
        if (target) {
          await focus(S, target.call)
          const sl = page.locator(`.canvas .node[data-node="${target.call}"] [data-testid="num-${target.fn}-${target.i}"]`)
          await keypad(S, sl, '7.5')
          const after = await codeOf(page)
          const a = code.split('\n'), b = after.split('\n')
          const diff = a.filter((l, k) => l !== b[k]).length
          if (b.length !== a.length || diff !== 1) bad.push(`numeric edit changed ${diff} lines (${a.length}→${b.length})`)
          edited++
          await page.waitForFunction(() => !document.querySelector('[data-testid=keypad]'), null, { timeout: 2000 }).catch(() => {})
          await touch.tap('[data-testid=undo]')
          const back = await page.waitForFunction((code) => window.__graph.core.toCode(window.__graph.store.sketch) === code, code, { timeout: 2500 }).then(() => true, () => false)
          if (!back) bad.push(`undo did not restore the export (history ${await page.evaluate(() => window.__graph.store.past.length)})`)
        }
        if (bad.length) problems.push(`${name}: ${bad.join('; ')}`)
      } catch (e) {
        problems.push(`${name}: ${String(e.message).split('\n')[0]}`)
      }
      await page.keyboard.press('Escape')
    }
    assert.deepEqual(problems, [])
    assert.deepEqual(S.errors.filter((e) => !/Permissions policy violation: (display-capture|camera)/.test(e)), [], 'no page errors across the corpus')
    return `${files.length} sketches; ${edited} numeric edits (one line each)`
  })
  await shot(page, '07-corpus-last.png')
})

// ============================================================================================================ 8. switch editors and back
if (want('8')) await block('8', async () => {
  const S = await startS()
  const { page, touch } = S
  await check('8', 'switch to the harness and back: same sketch, same code, meta.graph intact, other apps\' meta untouched', async () => {
    await page.goto(S.base + 'graph/')
    await page.waitForFunction(() => !!window.__graph?.lib, null, { timeout: 15000 })
    const code = '// a sketch with a neighbour\nconst amt = 0.3\nosc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .modulate(noise(3), amt)\n  .out()\n'
    const id = await page.evaluate(async ({ code }) => {
      const lib = window.__graph.lib
      const s = await lib.create('Switch test', code)
      await lib.put({ ...s, meta: { stack: { v: 1, mode: 'code' }, rack: { slots: [3] } } }, { touch: false })
      return s.id
    }, { code })
    await page.goto(S.base + 'graph/#/s/' + id)
    await page.reload()
    await page.waitForFunction((id) => window.__graph?.store?.sketch?.id === id, id, { timeout: 15000 })
    await waitForPicture(page)
    // move a node so meta.graph carries an edit
    const h = await touch.center('.canvas .node[data-fn=rotate] .nhead')
    await touch.drag(h, 40, 60)
    await sleep(900)
    await page.evaluate(() => window.__graph.lib.flush())
    const read = () => page.evaluate(async (id) => JSON.parse(JSON.stringify(await window.__graph.lib.get(id))), id)
    const before = await read()
    assert.ok(before.meta.graph?.pos, 'meta.graph written')
    await touch.tap('.hi-switch > button')
    await shot(page, '08-switcher.png')
    await touch.tap('.hi-switch a:has-text("Harness")')
    await page.waitForURL(/\/harness\//, { timeout: 15000 })
    await page.waitForSelector('#code', { timeout: 15000 })
    assert.equal(await page.inputValue('#code'), code, 'the harness shows the same code')
    await sleep(800)
    await page.click('.hi-switch > button')
    await page.click('.hi-switch a:has-text("Patch Graph")')
    await page.waitForURL(/\/graph\//, { timeout: 15000 })
    await page.waitForFunction((id) => window.__graph?.store?.sketch?.id === id, id, { timeout: 15000 })
    const after = await read()
    assert.equal(await codeOf(page), code)
    assert.deepEqual(after.meta.graph, before.meta.graph, 'meta.graph intact')
    assert.deepEqual(after.meta.stack, { v: 1, mode: 'code' }, 'meta.stack untouched')
    assert.deepEqual(after.meta.rack, { slots: [3] }, 'meta.rack untouched')
    return `meta keys: ${Object.keys(after.meta).sort().join(', ')}`
  })
  assert.deepEqual(S.errors, [], '8: no page errors')
})

// ============================================================================================================ 9. the rest of the brief
if (want('9')) await block('9', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  const { page, touch } = S
  await importAndOpen(page, S.base, 'osc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .kaleid(4)\n  .out()\n', 'Extras')
  await waitForPicture(page)
  await check('9a', 'bypass a node: it stays on the canvas, marked, and the code omits it; bypass again restores it', async () => {
    await touch.tap('.canvas .node[data-fn=rotate] .nhead .ticon')
    await page.waitForSelector('[data-testid=selbar]')
    await touch.tap('[data-testid=sel-bypass]')
    await sleep(250)
    assert.doesNotMatch(await codeOf(page), /rotate/)
    assert.equal(await page.locator('.canvas .node.bypassed[data-fn=rotate]').count(), 1)
    await shot(page, '09-bypass.png')
    await touch.tap('[data-testid=sel-bypass]')
    await sleep(250)
    assert.match(await codeOf(page), /\.rotate\(0\.8\)\s*\.kaleid\(4\)/)
  })
  await check('9b', 'a node feeding two places is written twice (×2 badge); "bake" routes it through a free output', async () => {
    // a second chain reads kaleid's output: wire kaleid → a new blend
    await dragFromPalette(S, 'Sources', 'fn:noise', { x: 200, y: 140 })
    await closePalette(S)
    await dragFromPalette(S, 'Blend', 'fn:blend', await touch.center('.canvas .node[data-fn=noise] .nhead'))
    await closePalette(S)
    await wire(S, portSel('[data-fn=kaleid]', 'out'), portSel('[data-fn=blend]', '0'))
    const a = await codeOf(page)
    assert.equal((a.match(/kaleid/g) ?? []).length, 2, a)
    assert.ok(await page.locator('[data-testid=dup-badge]').count() >= 1)
    await touch.tap('.canvas .node[data-fn=kaleid] .nhead .ticon')
    await touch.tap('[data-testid=sel-bake]')
    await sleep(300)
    const b = await codeOf(page)
    assert.equal((b.match(/kaleid/g) ?? []).length, 1, b)
    assert.match(b, /src\(o1\)|o1\)/)
    await shot(page, '09-bake.png')
    return b.replace(/\s+/g, ' ').trim()
  })
  await check('9c', 'pin a live preview on a node (its own small runtime); the code panel highlights the selected node', async () => {
    await touch.tap('.canvas .node[data-fn=rotate] .nhead .ticon')
    await touch.tap('[data-testid=sel-preview]')
    await page.waitForSelector('[data-testid=node-preview] iframe, [data-testid=node-preview] canvas', { timeout: 10000 })
    await touch.tap('[data-testid=code-toggle]')
    await page.waitForSelector('.cm-sel-node', { timeout: 5000 })
    const hl = await page.locator('.cm-sel-node').first().innerText()
    assert.match(hl, /rotate/)
    await sleep(1500)
    await shot(page, '09-preview-code.png')
    await touch.tap('[data-testid=code-toggle]')
    return `highlighted "${hl}"`
  })
  await check('9d', 'performance mode: full-screen visuals with pinned controls that drive the sketch', async () => {
    await touch.tap('.canvas .node[data-fn=rotate] .nhead .ticon')
    await touch.tap('[data-testid=sel-pin]')
    await touch.tap('[data-testid=perform]')
    await page.waitForSelector('[data-testid=pins] .numslider')
    const sl = page.locator('[data-testid="pin-rotate-0"]')
    const c = await touch.center(sl)
    await touch.drag(c, 120, 0)
    await sleep(200)
    assert.doesNotMatch(await codeOf(page), /rotate\(0\.8\)/)
    await shot(page, '09-perform.png')
    await touch.tap('[data-testid=perform-exit]')
  })
  await check('9e', 'hold on empty canvas opens an add menu there; lasso mode selects a rectangle; two-finger tap undoes', async () => {
    const A = await freeArea(S)
    const p = await page.evaluate((a) => {
      for (let y = a.bottom - 20; y > a.top; y -= 23) for (let x = a.left + 10; x < a.right; x += 29) {
        const el = document.elementFromPoint(x, y)
        if (el && el.matches('[data-testid=canvas], .world, .cables')) return { x, y }
      }
    }, A)
    await touch.hold(p, 900)
    await page.waitForSelector('[data-testid=add-menu]')
    await touch.tap('[data-testid=add-menu] [data-pick=voronoi]')
    await sleep(300)
    assert.equal(await page.locator('.canvas .node[data-fn=voronoi]').count(), 1)
    const before = await codeOf(page)
    await touch.multiTap(2, { x: p.x, y: p.y })
    await sleep(300)
    assert.equal(await page.locator('.canvas .node[data-fn=voronoi]').count(), 0, 'two-finger tap undid the add')
    assert.notEqual(await codeOf(page), before)
    await touch.tap('[data-testid=mode-lasso]')
    const r = await page.locator('[data-testid=canvas]').boundingBox()
    await touch.drag({ x: r.x + 5, y: r.y + 5 }, r.width * 0.6, r.height * 0.6, { steps: 8 })
    const n = await page.locator('[data-testid=selbar] .count').innerText()
    await touch.tap('[data-testid=mode-lasso]')
    return `lasso: ${n}`
  })
  await check('9f', 'unknown call renders as a dashed generic node with an editable name; plugin functions are grouped under Plugins', async () => {
    await importAndOpen(page, S.base, 'osc(10).myPluginFx(0.3, 2).out()\n', 'Unknown')
    await page.waitForSelector('.canvas .node.unknown[data-fn=myPluginFx]')
    assert.equal(await page.locator('.canvas .node[data-fn=myPluginFx] [data-testid^="num-myPluginFx"]').count(), 2)
    await shot(page, '09-unknown.png')
  })
  assert.deepEqual(S.errors.filter((e) => !/Permissions policy/.test(e)), [], '9: no page errors')
})

// ============================================================================================================ 10. full-background preview
if (want('10')) await block('10', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  const { page, touch } = S
  await check('10', 'full-background preview: the output fills the screen behind the canvas; numbers still edit on the veil; the switcher menu takes taps; a panel again on toggle', async () => {
    await importAndOpen(page, S.base, 'osc(20, 0.1, 0.8).rotate(0.8).out()\n', 'Backdrop')
    await waitForPicture(page)
    await touch.tap('[data-testid=backdrop-toggle]')
    await page.waitForFunction(() => document.documentElement.classList.contains('hi-backdrop'))
    await sleep(800)
    const box = await page.locator('[data-testid=pip]').boundingBox()
    assert.ok(box.width >= 1180 && box.height >= 820, 'the output fills the screen')
    await keypad(S, '[data-testid="num-rotate-0"]', '1.2')
    assert.match(await codeOf(page), /rotate\(1\.2\)/)
    await touch.tap('[data-testid=veil]')
    await shot(page, '10-backdrop-landscape.png')
    await touch.tap('.hi-switch > button')
    await sleep(300)
    const topmost = await page.evaluate(() => [...document.querySelectorAll('.hi-switch a')].every((it) => {
      const r = it.getBoundingClientRect()
      const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return it === t || it.contains(t)
    }))
    assert.ok(topmost, 'every switcher item is the topmost element')
    await touch.tap('.hi-switch > button')
    await page.setViewportSize({ width: 820, height: 1180 })
    await sleep(900)
    await shot(page, '10-backdrop-portrait.png')
    await page.setViewportSize({ width: 1180, height: 820 })
    await sleep(400)
    await touch.tap('[data-testid=backdrop-toggle]')
    await page.waitForFunction(() => !document.documentElement.classList.contains('hi-backdrop'))
    const small = await page.locator('[data-testid=pip]').boundingBox()
    assert.ok(small.width < 700, 'back to the floating window')
    return 'output behind the canvas in both orientations; keypad edit on the veil; switcher items on top'
  })
  assert.deepEqual(S.errors.filter((e) => !/Permissions policy/.test(e)), [], '10: no page errors')
})

// ============================================================================================================ summary
const md = ['# Acceptance run', '', `Chromium (software WebGL / SwiftShader), touch emulation via CDP. Generated ${new Date().toISOString().slice(0, 10)}.`, '', '| # | check | result | note |', '|---|---|---|---|']
for (const r of results) md.push(`| ${r.id} | ${r.title} | ${r.ok ? 'pass' : '**FAIL**'} | ${String(r.note ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300)} |`)
md.push('', '## Measurements', '', ...notes.map((n) => `* ${n}`), '')
if (!only) writeFileSync(join(shots, 'RESULTS.md'), md.join('\n'))
for (const n of notes) console.log(`  · ${n}`)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
