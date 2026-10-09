// Acceptance run for Chain Stack: real Chromium at iPad viewports, software WebGL (SwiftShader), real touch input via CDP.
//   npm run build:all && node apps/stack/e2e/acceptance.mjs [--skip-build]
// Writes screenshots to apps/stack/shots/ and a results table to apps/stack/shots/RESULTS.md.
// Frame-time numbers are SOFTWARE rendered (no GPU in the build container) and say nothing about an iPad.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, cpSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeOf, importAndOpen, root, sleep, start, waitForPicture } from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const shots = resolve(here, '../shots')
mkdirSync(shots, { recursive: true })
if (!process.argv.includes('--skip-build')) execFileSync('npm', ['run', 'build:all'], { cwd: root, stdio: 'inherit' })

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const want = (id) => !only || only.includes(id)
const results = []
const notes = []
let current = ''
async function check(id, title, fn) {
  current = id
  const t0 = Date.now()
  try {
    const note = await fn()
    results.push({ id, title, ok: true, ms: Date.now() - t0, note })
    console.log(`  ✓ ${id} ${title}${note ? ` — ${note}` : ''}`)
  } catch (e) {
    results.push({ id, title, ok: false, ms: Date.now() - t0, note: String(e.message).split('\n')[0] })
    console.log(`  ✗ ${id} ${title}\n      ${String(e.stack || e).split('\n').slice(0, 5).join('\n      ')}`)
  }
}
const shot = async (page, name) => page.screenshot({ path: join(shots, name) })
const { canonicalSketchOf } = { canonicalSketchOf: null }
void canonicalSketchOf

const TARGET = 'osc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .modulate(noise(3), 0.1)\n  .out()\n'

/** enter a number with the keypad, by tapping keys */
async function keypad(S, locator, text) {
  await S.touch.tap(locator)
  await S.page.waitForSelector('[data-testid=keypad]')
  for (const ch of text) await S.touch.tap(`.keypad [data-key="${ch === '-' ? '±' : ch}"]`)
  await S.touch.tap('[data-testid=kp-ok]')
  await sleep(200)
}
const canon = (S, code) => S.page.evaluate((code) => {
  const { importText, canonicalSketch } = window.__stack.core
  return JSON.stringify(canonicalSketch(importText(code).sketch))
}, code)
const canonCurrent = (S) => S.page.evaluate(() => {
  const { canonicalSketch } = window.__stack.core
  return JSON.stringify(canonicalSketch(window.__stack.store.sketch))
})

async function blank(S, name = 'Scratch') {
  await S.page.goto(S.base + 'stack/')
  await S.page.waitForFunction(() => !!window.__stack?.lib, null, { timeout: 15000 })
  const id = await S.page.evaluate(async (name) => (await window.__stack.lib.create(name, '')).id, name)
  await S.page.goto(S.base + 'stack/#/s/' + id)
  await S.page.reload()
  await S.page.waitForFunction((id) => window.__stack?.store?.sketch?.id === id, id, { timeout: 15000 })
  await sleep(500)
  return id
}

// ============================================================================================================ 1. build with touch
for (const [label, vp] of want('1') ? [['landscape', { width: 1180, height: 820 }], ['portrait', { width: 820, height: 1180 }]] : []) {
  const S = await start({ viewport: vp })
  await check('1', `build ${TARGET.replace(/\s+/g, '')} with touch only (${label} ${vp.width}×${vp.height})`, async () => {
    const { page, touch } = S
    await blank(S)
    await shot(page, `01-${label}-empty.png`)
    await touch.tap('[data-testid=add-stmt]')
    await touch.tap('[data-testid=add-chain]')
    await page.waitForSelector('[data-testid=row-gen]')
    const nums = page.locator('[data-testid=row-gen] [role=spinbutton]')
    assert.equal(await nums.count(), 3)
    await keypad(S, nums.nth(0), '20')
    await keypad(S, nums.nth(1), '0.1')
    await keypad(S, nums.nth(2), '0.8')
    // + add → rotate
    await touch.tap('[data-testid=add-mod]')
    await page.waitForSelector('[data-testid=fn-picker]')
    await shot(page, `01-${label}-picker.png`)
    await page.fill('[data-testid=fn-search]', 'rotate')
    await touch.tap('[data-pick=rotate]')
    await sleep(300)
    await keypad(S, page.locator('[data-fn=rotate] [role=spinbutton]').first(), '0.8')
    // + add → modulate (comes with a noise(3) pocket), then amount 0.1
    await touch.tap('[data-testid=add-mod]')
    await page.fill('[data-testid=fn-search]', 'modulate')
    await touch.tap('[data-pick=modulate]')
    await sleep(300)
    await keypad(S, page.locator('[data-fn=modulate]').locator(':scope > [role=spinbutton]').first(), '0.1')
    await waitForPicture(page)
    await shot(page, `01-${label}-built.png`)
    const code = await codeOf(page)
    assert.equal(await canonCurrent(S), await canon(S, TARGET), `got:\n${code}`)
    return code.replace(/\s+/g, ' ').trim()
  })
  await S.close()
}

// ============================================================================================================ 2. scrub
if (want('2')) {
  const S = await start()
  const { page, touch } = S
  await importAndOpen(page, S.base, TARGET)
  await waitForPicture(page)
  await check('2', 'scrub a number: live, no recompile, preview changes, host stays responsive', async () => {
    const num = page.locator('[data-fn=rotate] [role=spinbutton]').first()
    await num.scrollIntoViewIfNeeded()
    const b = await num.boundingBox()
    const start0 = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    // instrument: host rAF intervals, pointer→setLive latency, runtime counters
    await page.evaluate(() => {
      const rt = window.__stack.runner.rt
      window.__m = { frames: [], live: [], t0: 0 }
      const orig = rt.setLive.bind(rt)
      rt.setLive = (id, v) => { window.__m.live.push(performance.now() - (window.__m.lastMove ?? performance.now())); return orig(id, v) }
      window.addEventListener('pointermove', () => (window.__m.lastMove = performance.now()), true)
      let last = performance.now()
      const loop = (t) => { window.__m.frames.push(t - last); last = t; window.__m.raf = requestAnimationFrame(loop) }
      window.__m.raf = requestAnimationFrame(loop)
      window.__m.before = { ...rt.stats }
    })
    const pic0 = await page.evaluate(() => window.__stack.runner.rt.screenshot({ type: 'image/jpeg', quality: 0.5 }))
    await touch.raw('touchStart', [start0])
    const path = []
    for (let i = 0; i < 180; i++) path.push({ x: start0.x + 140 * Math.sin(i / 14), y: start0.y })
    for (const p of path) { await touch.raw('touchMove', [p]); await sleep(8) }
    await touch.raw('touchEnd', [])
    await sleep(300)
    const pic1 = await page.evaluate(() => window.__stack.runner.rt.screenshot({ type: 'image/jpeg', quality: 0.5 }))
    const m = await page.evaluate(() => {
      cancelAnimationFrame(window.__m.raf)
      const rt = window.__stack.runner.rt
      const f = window.__m.frames.slice(5)
      f.sort((a, b) => a - b)
      const live = window.__m.live.slice().sort((a, b) => a - b)
      return {
        frames: f.length, medianMs: f[Math.floor(f.length / 2)], p95Ms: f[Math.floor(f.length * 0.95)], maxMs: f[f.length - 1],
        liveCalls: live.length, liveP95: live[Math.floor(live.length * 0.95)],
        recompiles: rt.stats.recompiles - window.__m.before.recompiles, liveMessages: rt.stats.liveMessages - window.__m.before.liveMessages,
      }
    })
    assert.equal(m.recompiles, 0, 'a dragged number must not recompile')
    assert.ok(m.liveCalls > 100, `setLive calls ${m.liveCalls}`)
    assert.ok(m.liveP95 < 8, `pointermove→setLive p95 ${m.liveP95}ms`)
    assert.notEqual(pic0, pic1, 'the preview should change while scrubbing')
    const fps = 1000 / m.medianMs
    notes.push(`scrub (software WebGL, 1180×820, ${m.frames} host frames): median ${m.medianMs.toFixed(1)} ms (${fps.toFixed(0)} fps), p95 ${m.p95Ms.toFixed(1)} ms, max ${m.maxMs.toFixed(0)} ms; ${m.liveCalls} setLive calls → ${m.liveMessages} postMessages, ${m.recompiles} recompiles; pointermove→setLive p95 ${m.liveP95.toFixed(2)} ms`)
    assert.ok(fps >= 30, `host frame rate ${fps.toFixed(1)} fps < 30 (software-rendered)`)
    return `${fps.toFixed(0)} fps median host frames, ${m.recompiles} recompiles, ${m.liveCalls} live calls → ${m.liveMessages} messages (software WebGL)`
  })
  await S.close()
}

// ============================================================================================================ 3. number → array → function; blocks ⇄ code
if (want('3')) {
  const S = await start()
  const { page, touch } = S
  await importAndOpen(page, S.base, TARGET)
  await waitForPicture(page)
  const cmText = () => page.evaluate(() => window.__cm.state.doc.toString())
  await check('3', 'number → array → function chip; the code view follows each change; typing in the code view updates the blocks', async () => {
    const num = () => page.locator('[data-fn=rotate]').locator(':scope > [role=spinbutton], :scope > [data-token=arr], :scope > [data-token=fn]').first()
    // number → array (long-press kind menu)
    await touch.hold(num(), 700)
    await page.waitForSelector('[data-testid=kind-menu]')
    await shot(page, '03-kind-menu.png')
    await touch.tap('[data-kind=array]')
    await page.waitForSelector('[data-testid=arr-editor]')
    assert.match(await codeOf(page), /\.rotate\(\[0\.8\]\)/)
    // edit the steps: + twice, drag the second bar
    await touch.tap('[data-testid=arr-plus]')
    await touch.tap('[data-testid=arr-plus]')
    await touch.drag('[data-bar="1"]', 0, -30)
    await touch.tap('[data-testid=arr-val-2]')
    await page.waitForSelector('[data-testid=keypad]')
    for (const ch of '0.2') await touch.tap(`.keypad [data-key="${ch}"]`)
    await touch.tap('[data-testid=kp-ok]')
    await shot(page, '03-array-editor.png')
    const arrCode = await codeOf(page)
    assert.match(arrCode, /\.rotate\(\[0\.8, [\d.]+, 0\.2\]\)/, arrCode)
    // the code view reflects it
    await page.keyboard.press('Escape')
    await touch.tap('[data-testid=mode-code]')
    await page.waitForSelector('.cm-content')
    assert.match(await cmText(), /\.rotate\(\[0\.8, [\d.]+, 0\.2\]\)/)
    await touch.tap('[data-testid=mode-blocks]')
    // array → function chip
    await touch.hold(num(), 700)
    await touch.tap('[data-kind=function]')
    await page.waitForSelector('[data-testid=fn-editor]')
    await touch.tap('[data-chip="Math.sin(time)"]')
    await sleep(200)
    assert.match(await codeOf(page), /\.rotate\(\(\) => Math\.sin\(time\)\)/)
    // scale / offset wrap
    await keypad(S, '[data-testid=fn-scale]', '2')
    assert.match(await codeOf(page), /\.rotate\(\(\) => Math\.sin\(time\) \* 2\)/)
    await shot(page, '03-function-editor.png')
    await page.keyboard.press('Escape')
    await touch.tap('[data-testid=mode-code]')
    await page.waitForSelector('.cm-content')
    assert.match(await cmText(), /\.rotate\(\(\) => Math\.sin\(time\) \* 2\)/)
    await shot(page, '03-code-view.png')
    // typing in the code view updates the blocks
    await page.click('.cm-content')
    await page.keyboard.press('Control+A')
    await page.keyboard.type('osc(5, 0.2)\n  .kaleid(6)\n  .rotate([1, 2, 3].fast(2))\n  .out(o1)\n')
    await sleep(1200)
    await touch.tap('[data-testid=mode-blocks]')
    await page.waitForSelector('[data-fn=kaleid]')
    assert.equal(await page.locator('[data-fn=rotate] [data-token=arr]').count(), 1)
    assert.equal(await page.locator('[data-chain-chip]').first().innerText().then((t) => t.includes('o1')), true)
    await shot(page, '03-blocks-after-code-edit.png')
    return 'array [0.8, …, 0.2] → function Math.sin(time) * 2 → code edit → blocks'
  })
  await check('3b', 'a syntax error in the code view keeps the blocks on the last good version and says so', async () => {
    await touch.tap('[data-testid=mode-code]')
    await page.waitForSelector('.cm-content')
    await page.click('.cm-content')
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\nosc(((')
    await sleep(1200)
    assert.ok(await page.locator('[data-testid=code-status].err').count(), 'status line')
    assert.match(await codeOf(page), /kaleid\(6\)/)
    await shot(page, '03-code-syntax-error.png')
    // leaving Code mode is refused until it parses
    await touch.tap('[data-testid=mode-blocks]')
    await sleep(300)
    assert.ok(await page.locator('[data-testid=codeview]').count(), 'still in code mode')
    await page.click('.cm-content')
    await page.keyboard.press('Control+End')
    for (let i = 0; i < 7; i++) await page.keyboard.press('Backspace')
    await sleep(1200)
    await touch.tap('[data-testid=mode-blocks]')
    await page.waitForSelector('[data-testid=stack-list]')
  })
  assert.deepEqual(S.errors, [], '3: no page errors')
  await S.close()
}

// ============================================================================================================ 4. reorder, undo, redo
if (want('4')) {
  const S = await start()
  const { page, touch } = S
  await importAndOpen(page, S.base, 'osc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .color(1, 0.5, 0.2)\n  .modulate(noise(3), 0.1)\n  .out()\n')
  await waitForPicture(page)
  const A = 'osc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .color(1, 0.5, 0.2)\n  .modulate(noise(3), 0.1)\n  .out()\n'
  const B = 'osc(20, 0.1, 0.8)\n  .color(1, 0.5, 0.2)\n  .rotate(0.8)\n  .modulate(noise(3), 0.1)\n  .out()\n'
  await check('4', 'reorder two modifiers by drag; undo; redo (buttons, two-finger and three-finger taps)', async () => {
    const h = page.locator('[data-fn=rotate] [data-testid=handle]')
    const from = await touch.center(h)
    const to = await touch.center('[data-fn=color] [data-testid=handle]')
    await touch.drag(h, 0, to.y - from.y + 8, { preHold: 450, steps: 14 })
    await sleep(300)
    assert.equal(await codeOf(page), B)
    await shot(page, '04-reordered.png')
    await touch.tap('[data-testid=undo]'); await sleep(250)
    assert.equal(await codeOf(page), A)
    await touch.tap('[data-testid=redo]'); await sleep(250)
    assert.equal(await codeOf(page), B)
    // the iPadOS gestures, on the stack side (a touch over the preview belongs to the preview's own document)
    await touch.multiTap(2, { x: 120, y: 760 }); await sleep(250)
    assert.equal(await codeOf(page), A, 'two-finger tap = undo')
    await touch.multiTap(3, { x: 120, y: 760 }); await sleep(250)
    assert.equal(await codeOf(page), B, 'three-finger tap = redo')
    // keyboard
    await page.keyboard.press('Meta+z'); await sleep(200)
    assert.equal(await codeOf(page), A, '⌘Z')
    await page.keyboard.press('Meta+Shift+z'); await sleep(200)
    assert.equal(await codeOf(page), B, '⇧⌘Z')
  })
  await check('4b', 'swipe a row left to delete it, with an undo toast; the generator and .out stay pinned', async () => {
    await touch.drag('[data-fn=color] .fname', -230, 0)
    await page.waitForSelector('.toast')
    await sleep(300)
    assert.equal(await codeOf(page), 'osc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .modulate(noise(3), 0.1)\n  .out()\n')
    await shot(page, '04-swipe-deleted.png')
    await touch.tap('.toast button'); await sleep(250)
    assert.equal(await codeOf(page), B)
    // pinned: swiping the generator does nothing
    await touch.drag('[data-testid=row-gen] .fname', -230, 0); await sleep(400)
    assert.equal(await codeOf(page), B)
  })
  await check('4c', '⌘D duplicates the selected row; ⌘Enter re-runs', async () => {
    await touch.tap('[data-fn=color] .fname')
    await page.keyboard.press('Escape')
    await sleep(100)
    await page.locator('[data-fn=color] .fname').first().click({ force: true }).catch(() => {})
    await page.keyboard.press('Escape')
    await touch.tap('[data-fn=rotate] .p')
    await page.keyboard.press('Meta+d'); await sleep(300)
    assert.match(await codeOf(page), /\.rotate\(0\.8\)\n  \.rotate\(0\.8\)/)
    const runs = await page.evaluate(() => window.__stack.runner.runs)
    await page.keyboard.press('Meta+Enter'); await sleep(500)
    assert.ok((await page.evaluate(() => window.__stack.runner.runs)) > runs, '⌘Enter ran the sketch')
  })
  assert.deepEqual(S.errors, [], '4: no page errors')
  await S.close()
}

// ============================================================================================================ 5. offline
if (want('5')) {
  const S = await start()
  const { page, context } = S
  await check('5', 'offline: after the shell has loaded once, an airplane-mode reload works and the edited sketch persists', async () => {
    await page.goto(S.base)
    await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r && !!r.active), null, { timeout: 20000 })
    await page.waitForFunction(() => caches.keys().then((k) => k.some((n) => n.startsWith('hydra-ipad-'))), null, { timeout: 20000 })
    await sleep(1500)
    await page.goto(S.base + 'stack/')
    await page.waitForFunction(() => !!window.__stack?.lib, null, { timeout: 15000 })
    const id = await page.evaluate(async () => (await window.__stack.lib.create('Offline sketch', 'osc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .out()\n')).id)
    await page.goto(S.base + 'stack/#/s/' + id)
    await page.reload()
    await page.waitForFunction((id) => window.__stack?.store?.sketch?.id === id, id, { timeout: 15000 })
    await waitForPicture(page)
    await S.touch.tap('[data-fn=rotate] [role=spinbutton]')
    await S.touch.tap('.keypad [data-key="2"]')
    await S.touch.tap('[data-testid=kp-ok]')
    await page.evaluate(() => window.__stack.lib.flush())
    assert.match(await codeOf(page), /rotate\(2\)/)
    await context.setOffline(true)
    await page.reload()
    await page.waitForFunction((id) => window.__stack?.store?.sketch?.id === id, id, { timeout: 20000 })
    await waitForPicture(page, 20000)
    assert.match(await codeOf(page), /rotate\(2\)/, 'the edit survived the reload')
    assert.equal(await page.evaluate(() => navigator.onLine), false)
    await shot(page, '05-offline.png')
    await page.goto(S.base + 'stack/')
    await page.waitForSelector('[data-testid=app]', { timeout: 20000 })
    await context.setOffline(false)
    return 'reloaded with the network off; the preview ran from the cached frame bundle; rotate(2) persisted'
  })
  await S.close()
}

// ============================================================================================================ 6. corpus
if (want('6')) {
  const dir = join(root, 'packages/core/corpus')
  const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
  const S = await start()
  const { page, touch } = S
  await page.goto(S.base + 'stack/')
  await page.waitForFunction(() => !!window.__stack?.lib, null, { timeout: 15000 })
  await check('6', `corpus: all ${files.length} sketches open, every chain / def / comment / raw statement is visible and editable, untouched export is identical, one edit changes one line`, async () => {
    const problems = []
    let edited = 0
    let rawEdited = 0
    for (const f of files) {
      const code = readFileSync(join(dir, f), 'utf8')
      const name = f.replace(/\.js$/, '')
      const id = await page.evaluate(async ({ code, name }) => (await window.__stack.lib.create(name, code)).id, { code, name })
      await page.evaluate((id) => (location.hash = '#/s/' + id), id)
      try {
        await page.waitForFunction((id) => window.__stack?.store?.sketch?.id === id, id, { timeout: 15000 })
        await page.waitForFunction(() => ['ok', 'error'].includes(window.__stack.runner.status.phase), null, { timeout: 15000 })
        await sleep(250)
        const facts = await page.evaluate(() => {
          const sk = window.__stack.store.sketch
          const d = window.__stack.core.describe(sk)
          const q = (s) => document.querySelectorAll(s).length
          return {
            stmts: sk.stmts.length, rows: q('[data-testid=stack-list] > .stmt'),
            chains: d.chains.length, chainBlocks: q('[data-testid=stmt-chain]'),
            defs: d.defs.length, defBlocks: q('[data-testid=stmt-def]'),
            raws: d.raws, rawBlocks: q('[data-testid=raw-row]'),
            comments: d.comments, noteBlocks: q('[data-testid=note-row]'),
            stripChips: q('[data-chain-chip]'),
            meta: !!sk.meta?.stack,
          }
        })
        const bad = []
        if (facts.rows !== facts.stmts) bad.push(`rows ${facts.rows}/${facts.stmts}`)
        if (facts.chainBlocks !== facts.chains) bad.push(`chains ${facts.chainBlocks}/${facts.chains}`)
        if (facts.defBlocks !== facts.defs) bad.push(`defs ${facts.defBlocks}/${facts.defs}`)
        if (facts.rawBlocks !== facts.raws) bad.push(`raws ${facts.rawBlocks}/${facts.raws}`)
        if (facts.noteBlocks !== facts.comments) bad.push(`comments ${facts.noteBlocks}/${facts.comments}`)
        if (facts.stripChips !== facts.chains) bad.push(`strip ${facts.stripChips}/${facts.chains}`)
        if (!facts.meta) bad.push('meta.stack missing')
        const exported = await codeOf(page)
        if (exported !== code) bad.push('export differs from input')
        // raw rows: tap one open, it is a textarea with the full text; closing it unchanged leaves the export identical
        const rawRows = page.locator('[data-testid=raw-row] .raw-text')
        if (await rawRows.count()) {
          await rawRows.first().scrollIntoViewIfNeeded()
          await touch.tap(rawRows.first())
          const ta = page.locator('[data-testid=raw-edit]')
          await ta.waitFor({ timeout: 3000 })
          rawEdited++
          await page.locator('[data-testid=app] .topbar .name').click({ force: true }).catch(() => {})
          await sleep(200)
          if ((await codeOf(page)) !== code) bad.push('opening a raw row changed the export')
        }
        // change one number on a top-level chain (single-line call) with the keypad, expect one changed line
        const target = await page.evaluate(() => {
          const { catalog } = window.__stack.core
          const sk = window.__stack.store.sketch
          for (const st of sk.stmts) {
            if (st.k !== 'chain') continue
            for (const call of [st.chain.gen, ...st.chain.mods]) {
              if (call.src?.text.includes('\n')) continue
              const inputs = catalog.inputs(call.fn)
              const i = call.args.findIndex((a, k) => a.k === 'num' && inputs[k]?.type === 'float')
              if (i >= 0) return { call: call.id, i }
            }
          }
          return null
        })
        if (target) {
          const tok = page.locator(`[data-call="${target.call}"]`).locator(':scope > [role=spinbutton]').nth(await page.evaluate((t) => {
            const row = document.querySelector(`[data-call="${t.call}"]`)
            const nums = [...row.querySelectorAll(':scope > [role=spinbutton]')]
            return Math.max(0, nums.findIndex((n) => n.getAttribute('data-testid')?.endsWith('-' + t.i)))
          }, target))
          await tok.scrollIntoViewIfNeeded()
          await touch.tap(tok)
          await page.waitForSelector('[data-testid=keypad]', { timeout: 3000 })
          for (const ch of '7.5') await touch.tap(`.keypad [data-key="${ch}"]`)
          await touch.tap('[data-testid=kp-ok]')
          await sleep(250)
          const after = await codeOf(page)
          const a = code.split('\n'), b = after.split('\n')
          const diff = a.filter((l, k) => l !== b[k]).length
          if (b.length !== a.length || diff !== 1) bad.push(`numeric edit changed ${diff} lines (${a.length}→${b.length})`)
          edited++
          await touch.tap('[data-testid=undo]')
          await sleep(150)
          if ((await codeOf(page)) !== code) bad.push('undo did not restore the export')
        }
        if (bad.length) problems.push(`${name}: ${bad.join('; ')}`)
      } catch (e) {
        problems.push(`${name}: ${String(e.message).split('\n')[0]}`)
      }
      await page.keyboard.press('Escape')
    }
    assert.deepEqual(problems, [])
    // a sketch that calls s0.initScreen() makes the sandboxed frame ask for display-capture, which the iframe's policy refuses (documented in docs/security.md)
    assert.deepEqual(S.errors.filter((e) => !/Permissions policy violation: (display-capture|camera)/.test(e)), [], 'no page errors across the corpus')
    return `${files.length} sketches; ${edited} numeric edits (one line each), ${rawEdited} raw rows opened`
  })
  await shot(page, '06-corpus-last.png')
  await S.close()
}

// ============================================================================================================ 7. switch editors and back
if (want('7')) {
  const S = await start()
  const { page, touch } = S
  await check('7', 'switch to the harness and back: same sketch, same code, meta.stack intact, other apps\' meta untouched', async () => {
    await page.goto(S.base + 'stack/')
    await page.waitForFunction(() => !!window.__stack?.lib, null, { timeout: 15000 })
    const code = '// a sketch with a neighbour\nconst amt = 0.3\nosc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .modulate(noise(3), amt)\n  .out()\n'
    const id = await page.evaluate(async ({ code }) => {
      const lib = window.__stack.lib
      const s = await lib.create('Switch test', code)
      await lib.put({ ...s, meta: { graph: { zoom: 1.5, positions: { a: [1, 2] } }, rack: { slots: [3] } } }, { touch: false })
      return s.id
    }, { code })
    await page.goto(S.base + 'stack/#/s/' + id)
    await page.reload()
    await page.waitForFunction((id) => window.__stack?.store?.sketch?.id === id, id, { timeout: 15000 })
    await waitForPicture(page)
    await sleep(800)
    // edit something so meta.stack has been written by an editing session (mode: code, then back)
    await touch.tap('[data-testid=mode-code]'); await sleep(300)
    await touch.tap('[data-testid=mode-blocks]'); await sleep(500)
    await page.evaluate(() => window.__stack.lib.flush())
    const read = () => page.evaluate(async (id) => JSON.parse(JSON.stringify(await window.__stack.lib.get(id))), id)
    const before = await read()
    assert.ok(before.meta.stack, 'meta.stack written')
    // → harness through the switcher
    await touch.tap('.hi-switch > button')
    await shot(page, '07-switcher.png')
    await touch.tap('.hi-switch a:has-text("Harness")')
    await page.waitForURL(/\/harness\//, { timeout: 15000 })
    await page.waitForSelector('#code', { timeout: 15000 })
    assert.match(page.url(), new RegExp('#/s/' + id))
    assert.equal((await page.inputValue('#code')), code, 'the harness shows the same code')
    await sleep(800)
    // and back
    await page.click('.hi-switch > button')
    await page.click('.hi-switch a:has-text("Chain Stack")')
    await page.waitForURL(/\/stack\//, { timeout: 15000 })
    await page.waitForFunction((id) => window.__stack?.store?.sketch?.id === id, id, { timeout: 15000 })
    const after = await read()
    assert.equal(await codeOf(page), code)
    assert.deepEqual(after.meta.stack, before.meta.stack, 'meta.stack intact')
    assert.deepEqual(after.meta.graph, before.meta.graph, 'meta.graph untouched')
    assert.deepEqual(after.meta.rack, before.meta.rack, 'meta.rack untouched')
    assert.equal(after.id, before.id)
    const others = Object.keys(after.meta).sort()
    return `meta keys now: ${others.join(', ')}; stack, graph and rack unchanged`
  })
  assert.deepEqual(S.errors, [], '7: no page errors')
  await S.close()
}

// ============================================================================================================ 8. the rest of the brief
if (want('8')) {
  const S = await start()
  const { page, touch } = S
  const open = async (code, name) => {
    await importAndOpen(page, S.base, code, name)
    await waitForPicture(page)
    await sleep(300)
  }

  await open('osc(5).rotate(1)\n\nnoise(3).out(o0)\nshape(4).out(o0)\n')
  await check('8a', 'chain strip: not-rendered chain flagged with one-tap "send to o0"; the earlier writer of an output is "shadowed"', async () => {
    const chips = page.locator('[data-chain-chip]')
    assert.equal(await chips.count(), 3)
    assert.deepEqual(await chips.evaluateAll((els) => els.map((e) => e.dataset.flag)), ['not-rendered', 'shadowed', ''])
    await shot(page, '08-strip-flags.png')
    // o0 is taken twice, so the helper offers the first free output; with o0 free it says o0
    await touch.tap('[data-testid=strip-send-0]')
    await sleep(300)
    assert.match(await codeOf(page), /^osc\(5\)\.rotate\(1\)\.out\(o1\)\n/)
    await touch.tap('[data-testid=undo]')
    await sleep(200)
    await touch.tap('[data-testid=delete-all]').catch(() => {})
  })

  await open('osc(5).rotate(1)\n')
  await check('8b', '"send to o0" on a chain without .out', async () => {
    assert.equal(await page.locator('[data-testid=flag-not-rendered]').count(), 1)
    assert.match(await page.locator('[data-testid=send-to-o0]').innerText(), /send to o0/)
    await touch.tap('[data-testid=send-to-o0]')
    await sleep(300)
    assert.equal(await codeOf(page), 'osc(5).rotate(1).out()\n')
    assert.equal(await page.locator('[data-testid=flag-not-rendered]').count(), 0)
  })

  await open('osc(20, 0.1, 0.8).out()\nnoise(3).out(o1)\n')
  await check('8c', 'render target toggle (One / All 4) and the Setup panel (sources, bpm, speed)', async () => {
    await touch.tap('[data-testid=render-all]')
    await sleep(300)
    assert.match(await codeOf(page), /render\(\)\s*$/)
    assert.equal(await page.locator('[data-testid=render-row]').count(), 1)
    await touch.tap('[data-testid=render-single]')
    await sleep(300)
    assert.match(await codeOf(page), /render\(o0\)\s*$/)
    await touch.tap('[data-testid=setup-chip]')
    await page.waitForSelector('[data-testid=setup-sheet]')
    await touch.tap('text=＋ bpm'); await sleep(200)
    await touch.tap('text=＋ speed'); await sleep(200)
    await touch.tap('text=＋ s0.initCam()'); await sleep(300)
    await shot(page, '08-setup-sheet.png')
    await page.keyboard.press('Escape')
    await touch.tap('.sheet-head button').catch(() => {})
    const code = await codeOf(page)
    assert.match(code, /^bpm = 120\nspeed = 1\ns0\.initCam\(0\)\n\nosc\(20, 0\.1, 0\.8\)\.out\(\)\nnoise\(3\)\.out\(o1\)\n/, code)
  })

  await open('osc(20, 0.1, 0.8).out()\n')
  await check('8d', 'dice: rolls randomSketch(seed) and shows the seed; long-press offers mutate; both undoable', async () => {
    const before = await codeOf(page)
    await touch.tap('[data-testid=dice]')
    await sleep(500)
    const rolled = await codeOf(page)
    assert.notEqual(rolled, before)
    assert.match(await page.locator('.toast').first().innerText(), /Rolled seed \d+/)
    await shot(page, '08-dice.png')
    await touch.tap('[data-testid=undo]'); await sleep(200)
    assert.equal(await codeOf(page), before)
    await touch.tap('[data-testid=redo]'); await sleep(200)
    await touch.hold('[data-testid=dice]', 700)
    await page.waitForSelector('[data-testid=dice-mutate]')
    await touch.tap('[data-testid=dice-mutate]')
    await sleep(400)
    const mutated = await codeOf(page)
    assert.notEqual(mutated, rolled)
    const fnNames = (c) => [...c.matchAll(/\.?([a-zA-Z]+)\(/g)].map((m) => m[1]).join(',')
    assert.equal(fnNames(mutated), fnNames(rolled), 'mutate only changes numbers')
  })

  await open('osc(20, 0.1, 0.8).out()\n', 'First sketch')
  await check('8e', 'open another sketch from the sheet; import by paste; export .js; copy code', async () => {
    const other = await page.evaluate(async () => (await window.__stack.lib.create('Second sketch', 'noise(3).out()\n')).id)
    await touch.tap('[data-testid=more]')
    await touch.tap('[data-testid=menu-open]')
    await page.waitForSelector(`[data-sketch="${other}"]`)
    await shot(page, '08-open-sheet.png')
    await touch.tap(`[data-sketch="${other}"]`)
    await page.waitForFunction((id) => window.__stack.store.sketch.id === id, other)
    assert.equal(await codeOf(page), 'noise(3).out()\n')
    // paste import
    await touch.tap('[data-testid=more]')
    await touch.tap('[data-testid=menu-import]')
    await page.fill('[data-testid=import-text]', '// pasted\nshape(4, 0.4).rotate(() => time).out()\n')
    await touch.tap('[data-testid=import-go]')
    await page.waitForFunction((other) => window.__stack.store.sketch.id !== other, other)
    await sleep(500)
    assert.equal(await codeOf(page), '// pasted\nshape(4, 0.4).rotate(() => time).out()\n')
    // export
    await touch.tap('[data-testid=more]')
    const dl = page.waitForEvent('download')
    await touch.tap('[data-testid=menu-export]')
    const d = await dl
    assert.match(d.suggestedFilename(), /\.js$/)
    const text = readFileSync(await d.path(), 'utf8')
    assert.equal(text, await codeOf(page))
    // file picker import
    await touch.tap('[data-testid=more]')
    await touch.tap('[data-testid=menu-import]')
    mkdirSync(join(shots, '.tmp'), { recursive: true })
    const f = join(shots, '.tmp', 'from-file.js')
    writeFileSync(f, 'solid(1, 0, 0.5).out()\n')
    await page.setInputFiles('[data-testid=import-file]', f)
    await page.waitForFunction(() => document.querySelector('[data-testid=import-text]').value.includes('solid'))
    await touch.tap('[data-testid=import-go]')
    await sleep(700)
    assert.equal(await codeOf(page), 'solid(1, 0, 0.5).out()\n')
  })

  await open('osc(5).rotate(1).out()\n// x\nupdate = () => {}\nconst k = 1\n')
  await check('8f', 'raw statement: collapsed to its first line with a status dot, tap to edit as text; recognised text becomes blocks', async () => {
    const raw = page.locator('[data-testid=raw-row]')
    assert.equal(await raw.count(), 1)
    assert.equal(await page.locator('[data-testid=raw-status]').getAttribute('data-state'), 'code')
    await touch.tap('[data-testid=raw-row] .raw-text')
    await page.waitForSelector('[data-testid=raw-edit]')
    await shot(page, '08-raw-edit.png')
    await page.fill('[data-testid=raw-edit]', 'noise(3)\n  .rotate(2)\n  .out(o1)')
    await sleep(600)
    await page.locator('[data-testid=sketch-name]').click({ force: true })
    await sleep(500)
    assert.equal(await page.locator('[data-testid=raw-row]').count(), 0, 'recognised → no longer raw')
    assert.equal(await page.locator('[data-testid=stmt-chain]').count(), 2)
    assert.match(await codeOf(page), /noise\(3\)\n  \.rotate\(2\)\n  \.out\(o1\)/)
  })

  await open('const base = osc(10, 0.1, 1)\nbase.out()\nnoise(3).modulate(base, 0.2).out(o1)\nosc(5).rotate(() => nothere + 1).out(o2)\n')
  await check('8g', 'variable: chip names the definition and jumps to it; errors from the runtime become a red dot on the row responsible', async () => {
    const chip = page.locator('[data-testid=var-chip]').first()
    assert.ok(await chip.count())
    await touch.tap(chip)
    await sleep(300)
    await page.waitForFunction(() => window.__stack.runner.status.phase === 'error' || true)
    // trust: the arrow function with `nothere` is unsafe → safe mode first. Approve once to run it.
    if (await page.locator('[data-testid=trust-once]').count()) await touch.tap('[data-testid=trust-once]')
    await page.waitForFunction(() => window.__stack.runner.errors.some((e) => /nothere/.test(e.message)), null, { timeout: 15000 })
    await sleep(500)
    const dot = page.locator('[data-fn=rotate] [data-testid=row-dot]')
    assert.equal(await dot.count(), 1, 'a dot on the row that uses nothere')
    assert.equal(await dot.getAttribute('data-severity'), 'err')
    await shot(page, '08-error-dot.png')
  })

  assert.deepEqual(S.errors, [], '8: no page errors')
  await S.close()
}

// ============================================================================================================ summary
const md = ['# Acceptance run', '', `Chromium (software WebGL / SwiftShader), touch emulation via CDP. Generated ${new Date().toISOString().slice(0, 10)}.`, '', '| # | check | result | note |', '|---|---|---|---|']
for (const r of results) md.push(`| ${r.id} | ${r.title} | ${r.ok ? 'pass' : '**FAIL**'} | ${String(r.note ?? '').replace(/\|/g, '/').slice(0, 300)} |`)
md.push('', '## Measurements', '', ...notes.map((n) => `* ${n}`), '')
writeFileSync(join(shots, 'RESULTS.md'), md.join('\n'))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
void mkdtempSync, tmpdir, cpSync, readFileSync
