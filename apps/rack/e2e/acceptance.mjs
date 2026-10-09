// Acceptance run for Rack: real Chromium at iPad viewports, software WebGL (SwiftShader), real touch input via CDP.
//   npm run build:all && node apps/rack/e2e/acceptance.mjs [--skip-build] [--only=1,2]
// Writes screenshots to apps/rack/shots/ and a results table to apps/rack/shots/RESULTS.md.
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
    const note = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 240 s')), 240000))])
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

const TARGET = 'osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out()'
const canon = (S, code) => S.page.evaluate((code) => {
  const { importText, canonicalSketch } = window.__rack.core
  return JSON.stringify(canonicalSketch(importText(code).sketch))
}, code)
const canonCurrent = (S) => S.page.evaluate(() => JSON.stringify(window.__rack.core.canonicalSketch(window.__rack.store.sketch)))

async function blank(S, name = 'Scratch', code = '') {
  await S.page.goto(S.base + 'rack/')
  await S.page.waitForFunction(() => !!window.__rack?.lib, null, { timeout: 15000 })
  const id = await S.page.evaluate(async ({ name, code }) => (await window.__rack.lib.create(name, code)).id, { name, code })
  await S.page.goto(S.base + 'rack/#/s/' + id)
  await S.page.reload()
  await S.page.waitForFunction((id) => window.__rack?.store?.sketch?.id === id, id, { timeout: 15000 })
  await sleep(500)
  return id
}

/** Bring an element where a finger can reach it: scrolled into view and not under the floating output or a bar. */
async function reach(S, sel) {
  const loc = typeof sel === 'string' ? S.page.locator(sel).first() : sel
  await loc.waitFor({ timeout: 8000 })
  for (const block of ['center', 'start', 'end', 'nearest']) {
    await loc.evaluate((el, block) => el.scrollIntoView({ block, inline: 'center' }), block)
    await sleep(60)
    const ok = await loc.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return !!t && (el === t || el.contains(t))
    })
    if (ok) return loc
  }
  throw new Error(`${sel} is covered or off screen`)
}
const tap = async (S, sel) => S.touch.tap(await reach(S, sel))
const hold = async (S, sel, ms = 750) => S.touch.hold(await reach(S, sel), ms)

/** enter a number with the keypad, by tapping keys */
async function keypad(S, sel, text) {
  await tap(S, sel)
  await S.page.waitForSelector('[data-testid=keypad]')
  for (const ch of text) await S.touch.tap(`.keypad [data-key="${ch === '-' ? '±' : ch}"]`)
  await S.touch.tap('[data-testid=kp-ok]')
  await S.page.waitForFunction(() => !document.querySelector('[data-testid=keypad]'), null, { timeout: 3000 })
  await sleep(150)
}

const callId = (S, fn, nth = 0) => S.page.evaluate(({ fn, nth }) => [...document.querySelectorAll(`[data-testid=module][data-fn="${fn}"]`)][nth]?.dataset.call, { fn, nth })
const chainOf = (S, callIdV) => S.page.evaluate((id) => document.querySelector(`[data-testid=module][data-call="${id}"]`)?.closest('.chainrow')?.dataset.chain, callIdV)
const knob = (id, i) => `[data-testid="knob-${id}:${i}"]`
const line = (a, b, steps = 16) => Array.from({ length: steps }, (_, i) => ({ x: a.x + ((b.x - a.x) * (i + 1)) / steps, y: a.y + ((b.y - a.y) * (i + 1)) / steps }))

/** press something and drag it onto another element */
async function dragTo(S, from, to, { stepMs = 18 } = {}) {
  const a = await S.touch.center(await reach(S, from))
  const b = await S.touch.center(await reach(S, to))
  // the source may have scrolled away while bringing the target in: measure it again
  const a2 = await S.touch.center(typeof from === 'string' ? S.page.locator(from).first() : from)
  await S.touch.drag(a2, 0, 0, { path: line(a2, b), stepMs })
  await sleep(250)
  void a
}

const valueOf = (S, ref) => S.page.evaluate(({ call, i }) => {
  const find = (c) => {
    for (const x of [c.gen, ...c.mods]) {
      if (x.id === call) return x
      for (const a of x.args) if (a.k === 'tex') { const r = find(a.chain); if (r) return r }
    }
  }
  for (const s of window.__rack.store.sketch.stmts) if (s.k === 'chain') { const c = find(s.chain); if (c) return c.args[i] }
}, ref)

// ============================================================================================================ 1. build by touch
for (const [label, vp] of [['landscape', { width: 1180, height: 820 }], ['portrait', { width: 820, height: 1180 }]]) {
  if (!want('1')) break
  await block(`1-${label}`, async () => {
    const S = await startS({ viewport: vp })
    const { page } = S
    await check('1', `build ${TARGET} with touch only, using knobs and module pickers (${label} ${vp.width}×${vp.height})`, async () => {
      await blank(S, `Built by touch (${label})`)
      await tap(S, '[data-testid=add-gen-o0]')
      await tap(S, '[data-testid=pick-osc]')
      const osc = await callId(S, 'osc')
      assert.ok(osc, 'osc module')
      await keypad(S, knob(osc, 0), '20')
      await keypad(S, knob(osc, 1), '0.1')
      await keypad(S, knob(osc, 2), '0.8')
      const chain = await chainOf(S, osc)
      await tap(S, `[data-testid="add-mod-${chain}"]`)
      await tap(S, '[data-testid=pick-rotate]')
      await keypad(S, knob(await callId(S, 'rotate'), 0), '0.8')
      await tap(S, `[data-testid="add-mod-${chain}"]`)
      await tap(S, '[data-testid=pick-modulate]')
      const mod = await callId(S, 'modulate')
      // patch a fresh noise mini-module into the jack, then set its knob
      await tap(S, `[data-testid="jack-${mod}:0"]`)
      await tap(S, '[data-testid=jack-new-noise]')
      await page.waitForSelector(`[data-testid="mini-${mod}:0"][aria-expanded=true]`)
      await keypad(S, knob(await callId(S, 'noise'), 0), '3')
      await keypad(S, knob(mod, 1), '0.1')
      await waitForPicture(page)
      assert.equal(await canonCurrent(S), await canon(S, TARGET), `built: ${await codeOf(page)}`)
      await page.evaluate(() => document.querySelector('.rack').scrollTo(0, 0))
      await sleep(300)
      await shot(page, `01-built-${label}.png`)
      return (await codeOf(page)).trim()
    })
    assert.deepEqual(S.errors, [], '1: no page errors')
  })
}

// ============================================================================================================ 2–5, 9: the rack
if (want('2') || want('3') || want('4') || want('5') || want('10') || want('11') || want('12')) await block('rack', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  const { page, touch } = S

  if (want('2')) await check('2', 'drag an LFO onto rotate.angle: the code drawer shows an arrow function; the ring sets the depth; remove it again', async () => {
    await importAndOpen(page, S.base, 'osc(20, 0.1, 0.8).rotate(0.8).out()\n', 'LFO')
    await waitForPicture(page)
    const rot = await callId(S, 'rotate')
    await dragTo(S, '[data-testid=tile-sine]', knob(rot, 0))
    await page.waitForFunction(() => /rotate\(\(\) => Math\.sin\(time/.test(window.__rack.core.toCode(window.__rack.store.sketch)), null, { timeout: 3000 })
    const v0 = await valueOf(S, { call: rot, i: 0 })
    // drag on the outer ring: deeper swing
    const k = await touch.center(await reach(S, knob(rot, 0)))
    const top = { x: k.box.x + k.box.width / 2, y: k.box.y + 4 }
    await touch.drag(top, 0, -60, { steps: 10 })
    await sleep(300)
    const v1 = await valueOf(S, { call: rot, i: 0 })
    assert.notEqual(v1.src, v0.src, 'the ring drag changed the depth')
    assert.match(v1.src, /\+ 0\.8$/, 'still centred on 0.8')
    await tap(S, '[data-testid=code-toggle]')
    await page.waitForSelector('.codepane .cm-editor')
    await sleep(300)
    const shown = await page.textContent('.codepane .cm-content')
    assert.match(shown, /rotate\(\(\) => Math\.sin\(time/)
    await shot(page, '02-lfo.png')
    // long-press the knob: remove the modulation
    await hold(S, knob(rot, 0))
    await tap(S, '[data-testid=menu-unmod]')
    await page.waitForFunction(() => /rotate\(0\.8\)/.test(window.__rack.core.toCode(window.__rack.store.sketch)), null, { timeout: 3000 })
    await tap(S, '[data-testid=code-toggle]')
    return `${v0.src} → ring → ${v1.src} → removed: rotate(0.8)`
  })

  if (want('3')) await check('3', 'patch lane o1 into lane o0\'s modulate texture jack; route o0 into itself (feedback) from the matrix', async () => {
    await importAndOpen(page, S.base, 'osc(20, 0.1, 0.8).rotate(0.8).modulate(noise(3), 0.1).out()\n\nnoise(4).color(0.3, 0.6, 1).out(o1)\n', 'Patching')
    await waitForPicture(page)
    const mod = await callId(S, 'modulate')
    await dragTo(S, '[data-testid=chip-o1]', `[data-drop=jack][data-ref="${mod}:0"]`)
    await page.waitForFunction(() => /modulate\(o1/.test(window.__rack.core.toCode(window.__rack.store.sketch)), null, { timeout: 3000 })
    await tap(S, '[data-testid=route-o0-o0]')
    await page.waitForFunction(() => /blend\(src\(o0\)\)\.out\(\)/.test(window.__rack.core.toCode(window.__rack.store.sketch)), null, { timeout: 3000 })
    assert.equal(await page.getAttribute('[data-testid=route-o0-o1]', 'aria-pressed'), 'true', 'the matrix shows o0 reads o1')
    await page.waitForFunction(() => window.__rack.runner.status.phase === 'ok', null, { timeout: 15000 })
    await sleep(800)
    await page.evaluate(() => document.querySelector('.rack').scrollTo(0, 0))
    await shot(page, '03-patched-feedback.png')
    return (await codeOf(page)).split('\n')[0]
  })

  if (want('4')) await check('4', 'store two scenes with different knob values; recall with a 4-beat crossfade; numbers-only differences never recompile', async () => {
    await importAndOpen(page, S.base, 'bpm = 120\nosc(20, 0.1, 0.8).rotate(0.8).out()\n', 'Scenes')
    await waitForPicture(page)
    const osc = await callId(S, 'osc')
    const rot = await callId(S, 'rotate')
    await hold(S, '[data-testid=scene-1]', 900)
    await keypad(S, knob(osc, 0), '40')
    await keypad(S, knob(rot, 0), '1.5')
    await hold(S, '[data-testid=scene-2]', 900)
    const scene2 = await codeOf(page)
    assert.match(scene2, /osc\(40, 0\.1, 0\.8\)\.rotate\(1\.5\)/)
    assert.equal(await page.textContent('[data-testid=scene-fade]'), '4♩')
    await page.waitForFunction(() => window.__rack.runner.status.phase === 'ok', null, { timeout: 10000 })
    const s0 = await page.evaluate(() => ({ ...window.__rack.runner.rt.stats }))
    const t0 = Date.now()
    await tap(S, '[data-testid=scene-1]')
    await sleep(900)
    const mid = await page.evaluate(() => ({ fading: window.__rack.ui.state.fading, code: window.__rack.core.toCode(window.__rack.store.sketch) }))
    assert.equal(mid.fading, '1', 'still fading after 0.9 s')
    assert.equal(mid.code, scene2, 'the code stays put during the fade (numbers ride the live table)')
    await shot(page, '04-scene-fade.png')
    await page.waitForFunction(() => !window.__rack.ui.state.fading, null, { timeout: 6000 })
    const ms = Date.now() - t0
    await page.waitForFunction(() => window.__rack.runner.status.phase === 'ok', null, { timeout: 10000 })
    await sleep(300)
    const s1 = await page.evaluate(() => ({ ...window.__rack.runner.rt.stats }))
    assert.match(await codeOf(page), /osc\(20, 0\.1, 0\.8\)\.rotate\(0\.8\)/, 'landed on scene 1')
    assert.equal(s1.recompiles, s0.recompiles, 'no recompile during or after the fade')
    assert.ok(s1.liveMessages - s0.liveMessages >= 20, `live messages during the fade: ${s1.liveMessages - s0.liveMessages}`)
    assert.ok(ms >= 1800 && ms < 4500, `fade took ${ms} ms (4 beats at 120 bpm = 2 s)`)
    // undo takes the recall back; the scenes stay stored
    await tap(S, '[data-testid=undo]')
    await page.waitForFunction((c) => window.__rack.core.toCode(window.__rack.store.sketch) === c, scene2, { timeout: 3000 })
    assert.deepEqual(await page.evaluate(() => Object.keys(window.__rack.store.sketch.meta.rack.scenes).sort()), ['1', '2'])
    return `fade ${ms} ms, ${s1.liveMessages - s0.liveMessages} live messages, ${s1.recompiles - s0.recompiles} recompiles; undo restored scene 2's values`
  })

  if (want('5')) await check('5', 'performance mode with 4 pinned controls, full screen; a pinned knob plays; exit restores the rack', async () => {
    await importAndOpen(page, S.base, 'osc(20, 0.1, 0.8).rotate(0.8).kaleid(4).out()\n', 'Perform')
    await waitForPicture(page)
    const osc = await callId(S, 'osc')
    const rot = await callId(S, 'rotate')
    const kal = await callId(S, 'kaleid')
    for (const sel of [knob(osc, 0), knob(osc, 2), knob(rot, 0), knob(kal, 0)]) {
      await hold(S, sel)
      await tap(S, '[data-testid=menu-pin]')
      await sleep(150)
    }
    assert.equal(await page.evaluate(() => window.__rack.store.sketch.meta.rack.pins.length), 4)
    await tap(S, '[data-testid=perform]')
    await page.waitForSelector('.pip.perform')
    await sleep(400)
    assert.equal(await page.locator('.pins [data-drop=knob]').count(), 4)
    const box = await page.locator('[data-testid=pip]').boundingBox()
    assert.ok(box.width >= 1180 && box.height >= 820, 'output fills the screen')
    const before = await codeOf(page)
    const k = await touch.center(page.locator(`.pins ${knob(rot, 0)}`))
    await touch.drag(k, 0, -50, { steps: 10 })
    await sleep(300)
    assert.notEqual(await codeOf(page), before, 'the pinned knob changed the sketch')
    await shot(page, '05-perform.png')
    await touch.tap('[data-testid=perform-exit]')
    await page.waitForSelector('.pip:not(.perform)')
    assert.ok(await page.isVisible('[data-testid=rack]'))
    return 'four pinned knobs over the full-screen output; exit back to the rack'
  })

  if (want('10')) await check('10', 'two knobs turned at once at 60 Hz: each keeps its own finger, no recompile, one undo step, frame time flat (software GL)', async () => {
    await importAndOpen(page, S.base, 'osc(20, 0.1, 0.8).rotate(0.8).out()\n', 'Two knobs')
    await waitForPicture(page)
    await sleep(1500)
    const osc = await callId(S, 'osc')
    const rot = await callId(S, 'rotate')
    await reach(S, knob(osc, 0))
    await reach(S, knob(rot, 0))
    // measure both once both are in view (bringing one in can scroll the other)
    const a = await touch.center(page.locator(knob(osc, 0)))
    const b = await touch.center(page.locator(knob(rot, 0)))
    const record = (ms) => page.evaluate((ms) => new Promise((res) => {
      const d = []
      let last = performance.now()
      const t0 = last
      const f = (t) => {
        d.push(t - last)
        last = t
        if (t - t0 < ms) requestAnimationFrame(f)
        else res(d)
      }
      requestAnimationFrame(f)
    }), ms)
    const stats = (d) => {
      const s = d.slice(1).sort((x, y) => x - y)
      return { median: +s[Math.floor(s.length / 2)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), n: s.length }
    }
    const base = stats(await record(2000))
    const s0 = await page.evaluate(() => ({ ...window.__rack.runner.rt.stats, undo: window.__rack.store.past.length }))
    const v0 = [await valueOf(S, { call: osc, i: 0 }), await valueOf(S, { call: rot, i: 0 })]
    const rec = record(2200)
    const send = (type, pts) => S.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 8, radiusY: 8, force: 0.5 })) })
    await send('touchStart', [a, b])
    for (let i = 1; i <= 120; i++) {
      await send('touchMove', [{ x: a.x, y: a.y - i * 1.2 }, { x: b.x, y: b.y + i * 0.8 }])
      await sleep(16)
    }
    await send('touchEnd', [])
    const during = stats(await rec)
    await sleep(500)
    const s1 = await page.evaluate(() => ({ ...window.__rack.runner.rt.stats, undo: window.__rack.store.past.length }))
    const v1 = [await valueOf(S, { call: osc, i: 0 }), await valueOf(S, { call: rot, i: 0 })]
    assert.ok(v1[0].v > v0[0].v, `osc frequency went up (${v0[0].v} → ${v1[0].v})`)
    assert.ok(v1[1].v < v0[1].v, `rotate angle went down (${v0[1].v} → ${v1[1].v})`)
    assert.equal(s1.recompiles, s0.recompiles, 'no recompile while dragging numbers')
    assert.equal(s1.undo - s0.undo, 1, 'both knobs together are one undo step')
    assert.ok(during.median <= base.median * 1.5 + 4, `frame time stayed flat: ${JSON.stringify({ base, during })}`)
    notes.push(`Check 10 frame times (software WebGL in a container, not an iPad): idle median ${base.median} ms / p95 ${base.p95} ms; two knobs dragged at 60 Hz median ${during.median} ms / p95 ${during.p95} ms; ${s1.liveMessages - s0.liveMessages} live messages, ${s1.recompiles - s0.recompiles} recompiles.`)
    return `idle ${base.median}/${base.p95} ms, dragging ${during.median}/${during.p95} ms (median/p95); ${s1.liveMessages - s0.liveMessages} live messages, 0 recompiles`
  })

  if (want('11')) await check('11', 'full-background mode: the output fills the screen behind the rack; knobs still work on the veil; the switcher menu takes taps', async () => {
    await importAndOpen(page, S.base, 'osc(20, 0.1, 0.8).rotate(0.8).modulate(noise(3), 0.1).out()\n\nnoise(4).color(0.3, 0.6, 1).out(o1)\n', 'Backdrop')
    await waitForPicture(page)
    await tap(S, '[data-testid=backdrop-toggle]')
    await page.waitForFunction(() => document.documentElement.classList.contains('hi-backdrop'))
    await sleep(800)
    const box = await page.locator('[data-testid=pip]').boundingBox()
    assert.ok(box.width >= 1180 && box.height >= 820, 'the output fills the screen')
    const rot = await callId(S, 'rotate')
    await keypad(S, knob(rot, 0), '1.2')
    assert.match(await codeOf(page), /rotate\(1\.2\)/)
    await tap(S, '[data-testid=veil]')
    await shot(page, '11-backdrop-landscape.png')
    await touch.tap('.hi-switch > button')
    await sleep(300)
    const topmost = await page.evaluate(() => [...document.querySelectorAll('.hi-switch a')].every((it) => {
      const r = it.getBoundingClientRect()
      const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return it === t || it.contains(t)
    }))
    assert.ok(topmost, 'every switcher item is the topmost element')
    await page.keyboard.press('Escape')
    await touch.tap('.hi-switch > button')
    await page.setViewportSize({ width: 820, height: 1180 })
    await sleep(900)
    await shot(page, '11-backdrop-portrait.png')
    await page.setViewportSize({ width: 1180, height: 820 })
    await sleep(400)
    await tap(S, '[data-testid=backdrop-toggle]')
    await page.waitForFunction(() => !document.documentElement.classList.contains('hi-backdrop'))
    return 'output behind the rack in both orientations; keypad edit on the veil; switcher items on top'
  })

  if (want('12')) await check('12', 'bypass keeps a module in place out of the code; an unknown call is a grey module that upgrades when its plugin loads; the Mouse XY pad drives mouse; a locked lane ignores the dice', async () => {
    await importAndOpen(page, S.base, 'osc(10).myPluginFx(0.3, 2).kaleid(4).out()\nnoise(3).out(o1)\n', 'Extras')
    await waitForPicture(page).catch(() => {})
    const kal = await callId(S, 'kaleid')
    const card = `[data-testid=module][data-call="${kal}"]`
    await tap(S, `${card} [data-testid=bypass]`)
    await page.waitForSelector(`[data-testid=bypassed][data-call="${kal}"]`)
    assert.equal(await codeOf(page), 'osc(10).myPluginFx(0.3, 2).out()\nnoise(3).out(o1)\n')
    await tap(S, `[data-testid=bypassed][data-call="${kal}"] [data-testid=unbypass]`)
    await page.waitForFunction(() => /kaleid\(4\)/.test(window.__rack.core.toCode(window.__rack.store.sketch)))
    assert.equal(await page.locator('.module.unknown[data-fn=myPluginFx] [data-drop=knob]').count(), 2)
    await shot(page, '12-unknown.png')
    await page.evaluate(() => window.__rack.ctx.catalog.refresh([{ name: 'myPluginFx', type: 'color', origin: 'plugin:test', inputs: [{ name: 'amount', type: 'float', default: 0.5 }, { name: 'steps', type: 'float', default: 1 }], glsl: 'return _c0;' }]))
    await page.waitForSelector('.module.plugin[data-fn=myPluginFx]:not(.unknown)')
    // swap picker lists it under Plugins
    const fx = await callId(S, 'myPluginFx')
    await tap(S, `[data-testid=module][data-call="${fx}"] [data-testid=module-name]`)
    await tap(S, `[data-testid=module][data-call="${fx}"] [data-testid=module-name]`)
    assert.ok(await page.isVisible('[data-testid=fn-picker] h4:has-text("Plugins")'))
    await page.keyboard.press('Escape')
    await sleep(150)
    assert.equal(await codeOf(page), 'osc(10).myPluginFx(0.3, 2).kaleid(4).out()\nnoise(3).out(o1)\n')
    // the Mouse XY pad: Hydra's mouse follows the finger
    const pad = await touch.center(await reach(S, '[data-testid=mouse-pad]'))
    await touch.drag({ x: pad.box.x + 4, y: pad.box.y + 4 }, pad.box.width - 8, pad.box.height - 8, { steps: 8, release: false })
    const frame = page.frames().find((f) => f !== page.mainFrame())
    const mouse = await frame.evaluate(() => (window.mouse ? { x: window.mouse.x, y: window.mouse.y } : null))
    await S.touch.raw('touchEnd', [])
    assert.ok(mouse && mouse.x > 800 && mouse.y > 400, `mouse followed the pad: ${JSON.stringify(mouse)}`)
    // lock lane o1, then roll the lane dice on it: nothing changes
    await tap(S, '[data-testid=freeze-o1]')
    const c0 = await codeOf(page)
    await tap(S, '[data-testid=lane-dice-o1]')
    await sleep(200)
    assert.equal(await codeOf(page), c0, 'locked lane untouched')
    await tap(S, '[data-testid=lane-dice-o2]')
    await page.waitForFunction(() => /\.out\(o2\)/.test(window.__rack.core.toCode(window.__rack.store.sketch)), null, { timeout: 3000 })
    // (the preview reports an error here: myPluginFx was only registered in the editor's catalog, not loaded in the frame)
    await sleep(800)
    await shot(page, '12-dice.png')
    return `bypass round trip exact; grey → plugin module; mouse ${Math.round(mouse.x)},${Math.round(mouse.y)}; dice skipped the locked lane`
  })
  assert.deepEqual(S.errors.filter((e) => !/Permissions policy/.test(e)), [], 'rack block: no page errors')
})

// ============================================================================================================ 6. multi-chain import
if (want('6')) await block('6', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  const { page } = S
  await check('6', 'import multi-chain examples: every chain becomes a lane row of modules; vars, notes, raw and setup each have a place; export identical (corpus 03-blending.js and 17-for-loop.js; hydra-examples has no license to copy)', async () => {
    const out = []
    for (const f of ['03-blending.js', '17-for-loop.js']) {
      const code = readFileSync(join(root, 'packages/core/corpus', f), 'utf8')
      await importAndOpen(page, S.base, code, f)
      await page.waitForFunction(() => ['ok', 'error'].includes(window.__rack.runner.status.phase), null, { timeout: 15000 })
      const missing = await page.evaluate(() => {
        const sk = window.__rack.store.sketch
        const out = []
        for (const s of sk.stmts) {
          if (!document.querySelector(`[data-stmt="${s.id}"]`)) out.push(`${s.k} ${s.id}`)
          if (s.k === 'chain') for (const c of [s.chain.gen, ...s.chain.mods]) if (!document.querySelector(`[data-testid=module][data-call="${c.id}"]`)) out.push(`call ${c.fn}`)
        }
        return out
      })
      assert.deepEqual(missing, [], f)
      assert.equal(await codeOf(page), code, `${f} export`)
      await sleep(600)
      await shot(page, `06-${f.replace(/\.js$/, '')}.png`)
      out.push(`${f}: ${await page.evaluate(() => window.__rack.store.sketch.stmts.length)} statements, ${await page.locator('[data-testid=module]').count()} modules`)
    }
    return out.join('; ')
  })
})

// ============================================================================================================ 7. offline
if (want('7')) await block('7', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  const { page, context } = S
  await check('7', 'offline: after the shell has loaded once, an airplane-mode reload works; the edit and the stored scene persist', async () => {
    await page.goto(S.base)
    await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r && !!r.active), null, { timeout: 20000 })
    await page.waitForFunction(() => caches.keys().then((k) => k.some((n) => n.startsWith('hydra-ipad-'))), null, { timeout: 20000 })
    await sleep(1500)
    const id = await importAndOpen(page, S.base, 'osc(20, 0.1, 0.8).rotate(0.8).out()\n', 'Offline sketch')
    await waitForPicture(page)
    await keypad(S, knob(await callId(S, 'rotate'), 0), '2')
    await hold(S, '[data-testid=scene-3]', 900)
    await page.evaluate(() => window.__rack.lib.flush())
    assert.match(await codeOf(page), /rotate\(2\)/)
    await context.setOffline(true)
    await page.reload()
    await page.waitForFunction((id) => window.__rack?.store?.sketch?.id === id, id, { timeout: 20000 })
    await waitForPicture(page, 20000)
    assert.match(await codeOf(page), /rotate\(2\)/, 'the edit survived the reload')
    assert.ok(await page.evaluate(() => !!window.__rack.store.sketch.meta.rack.scenes['3']), 'scene 3 persisted')
    assert.ok(await page.isVisible('[data-testid=scene-3].full'))
    await shot(page, '07-offline.png')
    await context.setOffline(false)
    return 'reloaded with the network off; the preview ran from the cached bundle; rotate(2) and scene 3 persisted'
  })
})

// ============================================================================================================ 8. corpus
if (want('8')) await block('8', async () => {
  const dir = join(root, 'packages/core/corpus')
  const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  const { page, touch } = S
  await page.goto(S.base + 'rack/')
  await page.waitForFunction(() => !!window.__rack?.lib, null, { timeout: 15000 })
  await check('8', `corpus: all ${files.length} sketches open; every chain, call, def, comment and raw statement is visible; untouched export identical; one knob changes one line`, async () => {
    const problems = []
    let edited = 0
    for (const f of files) {
      const code = readFileSync(join(dir, f), 'utf8')
      const name = f.replace(/\.js$/, '')
      const id = await page.evaluate(async ({ code, name }) => (await window.__rack.lib.create(name, code)).id, { code, name })
      await page.evaluate((id) => (location.hash = '#/s/' + id), id)
      try {
        await page.waitForFunction((id) => window.__rack?.store?.sketch?.id === id, id, { timeout: 15000 })
        await page.waitForFunction(() => ['ok', 'error'].includes(window.__rack.runner.status.phase), null, { timeout: 15000 })
        await sleep(200)
        const missing = await page.evaluate(() => {
          const sk = window.__rack.store.sketch
          const has = (sel) => !!document.querySelector(sel)
          const out = []
          const calls = (c) => {
            for (const x of [c.gen, ...c.mods]) {
              if (!has(`[data-testid=module][data-call="${x.id}"]`)) out.push(`call ${x.fn}`)
              x.args.forEach((a, i) => a.k === 'tex' && !has(`[data-testid="mini-${x.id}:${i}"]`) && out.push(`mini ${x.fn}:${i}`))
            }
          }
          for (const s of sk.stmts) {
            if (!has(`[data-stmt="${s.id}"]`)) out.push(`${s.k} ${s.id}`)
            if (s.k === 'chain') calls(s.chain)
            if (s.k === 'def' && s.value.k === 'tex') calls(s.value.chain)
          }
          if (!sk.meta?.rack) out.push('meta.rack missing')
          return out
        })
        const bad = [...missing]
        if ((await codeOf(page)) !== code) bad.push('export differs from input')
        const target = await page.evaluate(() => {
          const { catalog } = window.__rack.core
          for (const st of window.__rack.store.sketch.stmts) {
            if (st.k !== 'chain') continue
            for (const call of [st.chain.gen, ...st.chain.mods]) {
              if (call.src?.text.includes('\n')) continue
              const i = call.args.findIndex((a, k) => a.k === 'num' && catalog.has(call.fn) && catalog.inputs(call.fn)[k]?.type === 'float')
              if (i >= 0) return { call: call.id, i, v: call.args[i].v }
            }
          }
          return null
        })
        if (target) {
          await keypad(S, knob(target.call, target.i), target.v === 7 ? '6' : '7')
          const after = await codeOf(page)
          const a = code.split('\n'), b = after.split('\n')
          const diff = a.filter((l, k) => l !== b[k]).length
          if (b.length !== a.length || diff !== 1) bad.push(`knob edit changed ${diff} lines (${a.length}→${b.length})`)
          edited++
          await touch.tap('[data-testid=undo]')
          const back = await page.waitForFunction((code) => window.__rack.core.toCode(window.__rack.store.sketch) === code, code, { timeout: 2500 }).then(() => true, () => false)
          if (!back) bad.push('undo did not restore the export')
        }
        if (bad.length) problems.push(`${name}: ${bad.join('; ')}`)
      } catch (e) {
        problems.push(`${name}: ${String(e.message).split('\n')[0]}`)
      }
      await page.keyboard.press('Escape')
    }
    assert.deepEqual(problems, [])
    assert.deepEqual(S.errors.filter((e) => !/Permissions policy violation: (display-capture|camera)/.test(e)), [], 'no page errors across the corpus')
    return `${files.length} sketches; ${edited} knob edits (one line each)`
  })
  await shot(page, '08-corpus-last.png')
})

// ============================================================================================================ 9. switch editors and back
if (want('9')) await block('9', async () => {
  const S = await startS()
  const { page, touch } = S
  await check('9', 'switch to the harness and back: same sketch, same code, meta.rack (with its scenes) intact, other apps\' meta untouched', async () => {
    await page.goto(S.base + 'rack/')
    await page.waitForFunction(() => !!window.__rack?.lib, null, { timeout: 15000 })
    const code = '// a sketch with neighbours\nconst amt = 0.3\nosc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .modulate(noise(3), amt)\n  .out()\n'
    const id = await page.evaluate(async ({ code }) => {
      const lib = window.__rack.lib
      const s = await lib.create('Switch test', code)
      await lib.put({ ...s, meta: { stack: { v: 1, mode: 'code' }, graph: { v: 1, pos: { x: { x: 1, y: 2 } } } } }, { touch: false })
      return s.id
    }, { code })
    await page.goto(S.base + 'rack/#/s/' + id)
    await page.reload()
    await page.waitForFunction((id) => window.__rack?.store?.sketch?.id === id, id, { timeout: 15000 })
    await waitForPicture(page)
    await hold(S, '[data-testid=scene-5]', 900)
    await tap(S, '[data-testid=freeze-o2]')
    await sleep(500)
    await page.evaluate(() => window.__rack.lib.flush())
    const read = () => page.evaluate(async (id) => JSON.parse(JSON.stringify(await window.__rack.lib.get(id))), id)
    const before = await read()
    assert.ok(before.meta.rack?.scenes?.['5'], 'scene stored in meta.rack')
    assert.equal(await codeOf(page), code, 'storing a scene does not change the code')
    await touch.tap('.hi-switch > button')
    await shot(page, '09-switcher.png')
    await touch.tap('.hi-switch a:has-text("Harness")')
    await page.waitForURL(/\/harness\//, { timeout: 15000 })
    await page.waitForSelector('#code', { timeout: 15000 })
    assert.equal(await page.inputValue('#code'), code, 'the harness shows the same code')
    await sleep(800)
    await page.click('.hi-switch > button')
    await page.click('.hi-switch a:has-text("Rack")')
    await page.waitForURL(/\/rack\//, { timeout: 15000 })
    await page.waitForFunction((id) => window.__rack?.store?.sketch?.id === id, id, { timeout: 15000 })
    const after = await read()
    assert.equal(await codeOf(page), code)
    assert.deepEqual(after.meta.rack, before.meta.rack, 'meta.rack intact')
    assert.deepEqual(after.meta.stack, { v: 1, mode: 'code' }, 'meta.stack untouched')
    assert.deepEqual(after.meta.graph, { v: 1, pos: { x: { x: 1, y: 2 } } }, 'meta.graph untouched')
    assert.ok(await page.isVisible('[data-testid=scene-5].full'), 'the scene is there after the round trip')
    return `meta keys: ${Object.keys(after.meta).sort().join(', ')}`
  })
  assert.deepEqual(S.errors, [], '9: no page errors')
})

// ============================================================================================================ summary
const md = ['# Acceptance run', '', `Chromium (software WebGL / SwiftShader), touch emulation via CDP. Generated ${new Date().toISOString().slice(0, 10)}.`, '', '| # | check | result | note |', '|---|---|---|---|']
for (const r of results) md.push(`| ${r.id} | ${r.title} | ${r.ok ? 'pass' : '**FAIL**'} | ${String(r.note ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300)} |`)
if (notes.length) md.push('', '## Notes', '', ...notes.map((n) => `* ${n}`), '')
if (!only) writeFileSync(join(shots, 'RESULTS.md'), md.join('\n') + '\n')
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
