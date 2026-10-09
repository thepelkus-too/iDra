// Acceptance run for Blocks: real Chromium at iPad viewports, software WebGL (SwiftShader), real touch input via CDP.
//   npm run build:all && node apps/blocks/e2e/acceptance.mjs [--skip-build] [--only=1,2]
// Writes screenshots to apps/blocks/shots/ and a results table to apps/blocks/shots/RESULTS.md.
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
  // text edits on blocks use the system prompt (works with the iPad keyboard and Scribble); answer it from the queue
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
    const note = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 180 s')), 180000))])
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
  const { importText, canonicalSketch } = window.__blocks.core
  return JSON.stringify(canonicalSketch(importText(code).sketch))
}, code)
const canonCurrent = (S) => S.page.evaluate(() => {
  const { canonicalSketch } = window.__blocks.core
  return JSON.stringify(canonicalSketch(window.__blocks.store.sketch))
})

async function blank(S, name = 'Scratch', code = '') {
  await S.page.goto(S.base + 'blocks/')
  await S.page.waitForFunction(() => !!window.__blocks?.lib, null, { timeout: 15000 })
  const id = await S.page.evaluate(async ({ name, code }) => (await window.__blocks.lib.create(name, code)).id, { name, code })
  await S.page.goto(S.base + 'blocks/#/s/' + id)
  await S.page.reload()
  await S.page.waitForFunction((id) => window.__blocks?.store?.sketch?.id === id, id, { timeout: 15000 })
  await sleep(600)
  return id
}

/** the part of the workspace not covered by the palette, the PiP or the bars */
async function freeArea(S) {
  return S.page.evaluate(() => {
    const c = document.querySelector('[data-testid=workspace]').getBoundingClientRect()
    const pal = document.querySelector('[data-testid=palette]')?.getBoundingClientRect()
    const pip = document.querySelector('[data-testid=pip]')?.getBoundingClientRect()
    const land = pal && pal.height > c.height * 0.6
    return {
      left: (land ? pal.right : c.left) + 30,
      top: c.top + 20,
      right: c.right - 30,
      bottom: (pal && !land ? pal.top : c.bottom) - 20,
      pipBottom: pip ? pip.bottom : c.top,
    }
  })
}

async function openPalette(S, tab) {
  if (!(await S.page.locator('[data-testid=palette]').count())) await S.touch.tap('[data-testid=palette-toggle]')
  await S.page.waitForSelector('[data-testid=palette]')
  for (let k = 0; k < 3; k++) {
    await S.touch.tap(`[data-testid="pal-tab-${tab}"]`)
    await sleep(150)
    if ((await S.page.getAttribute(`[data-testid="pal-tab-${tab}"]`, 'aria-selected')) === 'true') return
  }
  throw new Error(`palette tab ${tab} did not open`)
}

const line = (a, b, steps = 16) => Array.from({ length: steps }, (_, i) => ({ x: a.x + ((b.x - a.x) * (i + 1)) / steps, y: a.y + ((b.y - a.y) * (i + 1)) / steps }))

/** press something and drag it to a point or onto another element (where its grab point lands on the target's centre) */
async function dragTo(S, from, to, { stepMs = 18, at } = {}) {
  const a = from && typeof from.x === 'number' ? from : await S.touch.center(from)
  let b = to && typeof to.x === 'number' ? to : (await S.touch.center(to))
  if (at && to && typeof to.x !== 'number') {
    const c = await S.touch.center(to)
    b = { x: c.box.x + at.x, y: c.box.y + at.y }
  }
  await S.touch.drag(a, 0, 0, { path: line(a, b), stepMs })
  await sleep(250)
}

/** drag a palette block to a point or an element */
async function dragFromPalette(S, tab, key, to, opts) {
  await openPalette(S, tab)
  const item = S.page.locator(`[data-item="${key}"]`).first()
  await item.scrollIntoViewIfNeeded()
  const p = await S.touch.center(item)
  // grab near the block's left edge, as a finger would
  await dragTo(S, { x: p.box.x + 20, y: p.y }, to, opts)
}

/** enter a number with the keypad, by tapping keys */
async function keypad(S, locator, text) {
  await S.touch.tap(locator)
  await S.page.waitForSelector('[data-testid=keypad]')
  for (const ch of text) await S.touch.tap(`.keypad [data-key="${ch === '-' ? '±' : ch}"]`)
  await S.touch.tap('[data-testid=kp-ok]')
  await sleep(200)
}

/** id of the nth call of `fn` in the sketch */
const callId = (S, fn, nth = 0) => S.page.evaluate(({ fn, nth }) => [...document.querySelectorAll(`.workspace [data-call][data-fn="${fn}"]`)][nth]?.dataset.call, { fn, nth })
const numSel = (id, i) => `[data-testid="num-${id}:${i}"]`
const blockSel = (fn, nth = 0) => `.workspace .block[data-fn="${fn}"] >> nth=${nth}`
/** a block's name: where a finger grabs it (its middle is often a number slot) */
const grab = (fn, nth = 0) => `.workspace .block[data-fn="${fn}"] > .fname >> nth=${nth}`

const overlaps = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll('.workspace .world > .script')]
  const rs = els.map((e) => ({ id: e.dataset.stmt || e.dataset.loose, r: e.getBoundingClientRect() }))
  const bad = []
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i].r, b = rs[j].r
    if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) bad.push(`${rs[i].id} × ${rs[j].id}`)
  }
  return bad
})
const focus = (S, id) => S.page.evaluate((id) => window.__blocks.wsApi.focus(id), id).then(() => sleep(150))

/** a spot of empty workspace near (fx, fy) as fractions of the free area */
async function emptySpot(S, fx = 0.3, fy = 0.5) {
  const a = await freeArea(S)
  return S.page.evaluate(({ a, fx, fy }) => {
    const x0 = a.left + (a.right - a.left) * fx
    const y0 = Math.max(a.pipBottom + 20, a.top + (a.bottom - a.top) * fy)
    for (let r = 0; r < 400; r += 17) for (let k = 0; k < 8; k++) {
      const x = x0 + Math.cos(k) * r, y = y0 + Math.sin(k) * r
      if (x < a.left || x > a.right || y < a.top || y > a.bottom) continue
      const el = document.elementFromPoint(x, y)
      if (el && (el.matches('[data-testid=workspace]') || el.matches('.world'))) return { x, y }
    }
    return null
  }, { a, fx, fy })
}

const TARGET = 'osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out()'

// ============================================================================================================ 1. build by touch
for (const [label, vp] of want('1') ? [['landscape', { width: 1180, height: 820 }], ['portrait', { width: 820, height: 1180 }]] : []) await block('1', async () => {
  const S = await startS({ viewport: vp })
  await check('1', `build ${TARGET} with touch only (${label} ${vp.width}×${vp.height})`, async () => {
    await blank(S, `Touch build ${label}`)
    await waitForPicture(S.page).catch(() => {})
    const spot = await emptySpot(S, 0.25, 0.25)
    await dragFromPalette(S, 'Sources', 'fn:osc', spot)
    await S.page.waitForSelector('.workspace .block.hat[data-fn=osc]')
    assert.equal(await S.page.getAttribute('[data-testid=cap]', 'data-out'), 'none', 'a new script is not rendered yet')
    await dragFromPalette(S, 'Geometry', 'fn:rotate', blockSel('osc'))
    await S.page.waitForSelector('.workspace .block[data-fn=rotate]')
    await dragFromPalette(S, 'Modulate', 'fn:modulate', blockSel('rotate'))
    await S.page.waitForSelector('.workspace .block[data-fn=modulate]')
    if (label === 'portrait') await S.touch.tap('[data-testid=pal-close]')
    await S.touch.tap('[data-testid=show-o0]')
    const osc = await callId(S, 'osc')
    const rot = await callId(S, 'rotate')
    await keypad(S, numSel(osc, 0), '20')
    await keypad(S, numSel(osc, 2), '0.8')
    await keypad(S, numSel(rot, 0), '0.8')
    await sleep(300)
    assert.equal(await canonCurrent(S), await canon(S, TARGET), `built: ${await codeOf(S.page)}`)
    await waitForPicture(S.page)
    await shot(S.page, `01-built-${label}.png`)
    return (await codeOf(S.page)).trim()
  })
  assert.deepEqual(S.errors.filter((e) => !/Permissions policy/.test(e)), [], '1: no page errors')
})

// ============================================================================================================ 2. reporters
if (want('2')) await block('2', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  await check('2', 'a sine wave reporter in rotate.angle becomes an arrow function; a pattern in shape.sides becomes an array with modifiers', async () => {
    await importAndOpen(S.page, S.base, 'osc(20, 0.1, 0.8).rotate(0.8).out()\nshape(3).out(o1)\n', 'Reporters')
    await waitForPicture(S.page)
    await dragFromPalette(S, 'Reporters', 'mod:sine', '.workspace .block[data-fn=rotate] [data-testid=slot] >> nth=0')
    const c1 = await codeOf(S.page)
    assert.match(c1, /rotate\(\(\) => Math\.sin\(time \* 1\) \* [\d.]+ \+ 0\.8\)/, c1)
    await dragFromPalette(S, 'Reporters', 'mod:steps', '.workspace .block[data-fn=shape] [data-testid=slot] >> nth=0')
    assert.match(await codeOf(S.page), /shape\(\[[\d., ]+\]\)/)
    // the step sequencer: add a step, drag one up, turn on smooth
    await S.touch.tap('[data-testid=step-add]')
    const bar = await S.touch.center('[data-testid=step] >> nth=0')
    await S.touch.drag(bar, 0, -40, { steps: 8 })
    await S.touch.tap('[data-testid=step-smooth]')
    const c2 = await codeOf(S.page)
    assert.match(c2, /shape\(\[[\d., ]+\]\.smooth\(1\)\)/, c2)
    assert.equal((c2.match(/shape\(\[([^\]]*)\]/)[1].split(',')).length, 4, 'four steps')
    await waitForPicture(S.page)
    // the sine's own number slots drive the picture live
    await shot(S.page, '02-reporters.png')
    // math reporters nest: ( time × 0.5 ) dropped on the sine, then sin( ) into its first hole
    await dragFromPalette(S, 'Math', 'math:op:*', '.workspace .block[data-fn=rotate] [data-testid=slot] >> nth=0')
    await dragFromPalette(S, 'Math', 'math:fn:sin', '.workspace .block[data-fn=rotate] .mhole[data-path="a"]')
    const c3 = await codeOf(S.page)
    assert.match(c3, /rotate\(\(\) => Math\.sin\(time\) \* 0\.5\)/, c3)
    await shot(S.page, '02-math.png')
    return `${c2.split('\n')[0]} · ${c3.split('\n')[0]}`
  })
  assert.deepEqual(S.errors.filter((e) => !/Permissions policy/.test(e)), [], '2: no page errors')
})

// ============================================================================================================ 3. feedback
if (want('3')) await block('3', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  await check('3', 'drop o0 into modulate\'s texture socket of a script that shows on o0: feedback runs', async () => {
    await importAndOpen(S.page, S.base, 'osc(10, 0.1, 0.8)\n  .modulate(noise(3), 0.2)\n  .out(o0)\n', 'Feedback')
    await waitForPicture(S.page)
    await dragFromPalette(S, 'Reporters', 'ref:o0', '.workspace .block[data-fn=modulate] [data-testid=socket] >> nth=0')
    const c = await codeOf(S.page)
    assert.match(c, /\.modulate\(o0, 0\.2\)/, c)
    await S.page.waitForFunction(() => window.__blocks.runner.status.phase === 'ok', null, { timeout: 15000 })
    await sleep(1500)
    assert.equal(await S.page.evaluate(() => window.__blocks.runner.currentErrors().length), 0)
    // the nested noise stack is now its own script? no: it was replaced, and undo brings it back
    await S.touch.tap('[data-testid=undo]')
    assert.match(await codeOf(S.page), /modulate\(noise\(3\), 0\.2\)/)
    await S.touch.tap('[data-testid=redo]')
    await shot(S.page, '03-feedback.png')
    return c.replace(/\n\s*/g, '')
  })
})

// ============================================================================================================ 4. import
if (want('4')) await block('4', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  await check('4', 'import a multi-script example: every statement becomes blocks, laid out without overlap; tidy gives the same; export identical (corpus 03-blending.js and 17-for-loop.js; hydra-examples has no license to copy)', async () => {
    const out = []
    for (const f of ['03-blending.js', '17-for-loop.js']) {
      const path = join(root, 'packages/core/corpus', f)
      let code
      try { code = readFileSync(path, 'utf8') } catch { continue }
      await importAndOpen(S.page, S.base, code, f)
      await S.page.waitForFunction(() => ['ok', 'error'].includes(window.__blocks.runner.status.phase), null, { timeout: 20000 })
      await sleep(500)
      const facts = await S.page.evaluate(() => {
        const sk = window.__blocks.store.sketch
        return { stmts: sk.stmts.length, shown: sk.stmts.filter((s) => document.querySelector(`.workspace .script[data-stmt="${s.id}"]`)).length, raw: sk.stmts.filter((s) => s.k === 'raw').length }
      })
      assert.equal(facts.shown, facts.stmts, `${f}: every statement shown`)
      assert.deepEqual(await overlaps(S.page), [], `${f}: overlaps`)
      await shot(S.page, `04-${f.replace('.js', '')}.png`)
      await S.touch.tap('[data-testid=more]')
      await S.touch.tap('[data-testid=menu-tidy]')
      await sleep(300)
      assert.deepEqual(await overlaps(S.page), [])
      assert.equal(await codeOf(S.page), code, `${f}: export identical`)
      out.push(`${f}: ${facts.stmts} statements (${facts.raw} raw)`)
    }
    return out.join('; ')
  })
})

// ============================================================================================================ 5. catalog coverage
if (want('5')) await block('5', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  await check('5', 'every catalog function has a palette block, a category and a help line; hold a block for its help card', async () => {
    await blank(S, 'Catalog')
    const groups = ['Sources', 'Geometry', 'Color', 'Blend', 'Modulate']
    const seen = new Map()
    for (const g of groups) {
      await openPalette(S, g)
      for (const k of await S.page.$$eval('[data-item^="fn:"]', (els) => els.map((e) => e.dataset.item.slice(3)))) seen.set(k, g)
    }
    const facts = await S.page.evaluate(() => {
      const { catalog } = window.__blocks.core
      const { HELP } = window.__blocks.help
      const names = catalog.list().filter((f) => f.origin === 'builtin').map((f) => f.name)
      return { names, noHelp: names.filter((n) => !HELP[n]), todo: names.filter((n) => /TODO review/.test(HELP[n] ?? '')), long: names.filter((n) => HELP[n] && HELP[n].replace(/\s*TODO review$/, '').split(/\s+/).length > 12) }
    })
    const missing = facts.names.filter((n) => !seen.has(n))
    assert.deepEqual(missing, [], 'functions without a block')
    assert.deepEqual(facts.noHelp, [])
    assert.deepEqual(facts.long, [])
    await openPalette(S, 'Geometry')
    await S.touch.hold('[data-item="fn:kaleid"]', 800)
    await S.page.waitForSelector('[data-testid=help-card]')
    const help = await S.page.textContent('[data-testid=help-card] p')
    assert.ok(help && help.length > 5)
    await shot(S.page, '05-help.png')
    return `${facts.names.length} functions in ${groups.length} categories, all with help (${facts.todo.length} marked TODO review: ${facts.todo.join(', ')}); kaleid: “${help}”`
  })
})

// ============================================================================================================ 6. offline
if (want('6')) await block('6', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  const { page, context } = S
  await check('6', 'offline: after the shell has loaded once, an airplane-mode reload works and the edited sketch persists', async () => {
    await page.goto(S.base)
    await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r && !!r.active), null, { timeout: 20000 })
    await page.waitForFunction(() => caches.keys().then((k) => k.some((n) => n.startsWith('hydra-ipad-'))), null, { timeout: 20000 })
    await sleep(1500)
    const id = await importAndOpen(page, S.base, 'osc(20, 0.1, 0.8).rotate(0.8).out()\n', 'Offline sketch')
    await waitForPicture(page)
    await keypad(S, numSel(await callId(S, 'rotate'), 0), '2')
    await page.evaluate(() => window.__blocks.lib.flush())
    assert.match(await codeOf(page), /rotate\(2\)/)
    await context.setOffline(true)
    await page.reload()
    await page.waitForFunction((id) => window.__blocks?.store?.sketch?.id === id, id, { timeout: 20000 })
    await waitForPicture(page, 20000)
    assert.match(await codeOf(page), /rotate\(2\)/, 'the edit survived the reload')
    assert.ok(await page.evaluate(() => !!window.__blocks.store.sketch.meta.blocks.pos), 'layout persisted')
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
  await page.goto(S.base + 'blocks/')
  await page.waitForFunction(() => !!window.__blocks?.lib, null, { timeout: 15000 })
  await check('7', `corpus: all ${files.length} sketches open with no overlaps; every statement and call is a visible block; untouched export identical; one number edit changes one line`, async () => {
    const problems = []
    let edited = 0
    for (const f of files) {
      const code = readFileSync(join(dir, f), 'utf8')
      const name = f.replace(/\.js$/, '')
      const id = await page.evaluate(async ({ code, name }) => (await window.__blocks.lib.create(name, code)).id, { code, name })
      await page.evaluate((id) => (location.hash = '#/s/' + id), id)
      try {
        await page.waitForFunction((id) => window.__blocks?.store?.sketch?.id === id, id, { timeout: 15000 })
        await page.waitForFunction(() => ['ok', 'error'].includes(window.__blocks.runner.status.phase), null, { timeout: 15000 })
        await sleep(200)
        const missing = await page.evaluate(() => {
          const sk = window.__blocks.store.sketch
          const has = (sel) => !!document.querySelector(sel)
          const out = []
          const calls = (c) => [c.gen, ...c.mods].flatMap((x) => [x, ...x.args.flatMap((a) => (a.k === 'tex' ? calls(a.chain) : []))])
          for (const s of sk.stmts) {
            if (!has(`.workspace .script[data-stmt="${s.id}"]`)) out.push(`${s.k} ${s.id}`)
            const chain = s.k === 'chain' ? s.chain : s.k === 'def' && s.value.k === 'tex' ? s.value.chain : undefined
            if (chain) for (const c of calls(chain)) if (!has(`.workspace [data-call="${c.id}"]`)) out.push(`call ${c.fn}`)
          }
          if (!sk.meta?.blocks?.pos) out.push('meta.blocks missing')
          return out
        })
        const bad = [...missing]
        const ov = await overlaps(page)
        if (ov.length) bad.push(`overlaps: ${ov.slice(0, 3).join(', ')}`)
        if ((await codeOf(page)) !== code) bad.push('export differs from input')
        // one number on a single-line top-level call
        const target = await page.evaluate(() => {
          const { catalog } = window.__blocks.core
          const sk = window.__blocks.store.sketch
          for (const st of sk.stmts) {
            if (st.k !== 'chain') continue
            for (const call of [st.chain.gen, ...st.chain.mods]) {
              if (call.src?.text.includes('\n')) continue
              const inputs = catalog.inputs(call.fn)
              const i = call.args.findIndex((a, k) => a.k === 'num' && inputs[k]?.type === 'float')
              if (i >= 0) return { call: call.id, stmt: st.id, i }
            }
          }
          return null
        })
        if (target) {
          await focus(S, target.stmt)
          await keypad(S, numSel(target.call, target.i), '7.5')
          const after = await codeOf(page)
          const a = code.split('\n'), b = after.split('\n')
          const diff = a.filter((l, k) => l !== b[k]).length
          if (b.length !== a.length || diff !== 1) bad.push(`numeric edit changed ${diff} lines (${a.length}→${b.length})`)
          edited++
          await page.waitForFunction(() => !document.querySelector('[data-testid=keypad]'), null, { timeout: 2000 }).catch(() => {})
          await touch.tap('[data-testid=undo]')
          const back = await page.waitForFunction((code) => window.__blocks.core.toCode(window.__blocks.store.sketch) === code, code, { timeout: 2500 }).then(() => true, () => false)
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
    return `${files.length} sketches; ${edited} numeric edits (one line each)`
  })
  await shot(page, '07-corpus-last.png')
})

// ============================================================================================================ 8. switch editors and back
if (want('8')) await block('8', async () => {
  const S = await startS()
  const { page, touch } = S
  await check('8', 'switch to the harness and back: same sketch, same code, meta.blocks intact, other apps\' meta untouched', async () => {
    await page.goto(S.base + 'blocks/')
    await page.waitForFunction(() => !!window.__blocks?.lib, null, { timeout: 15000 })
    const code = '// a sketch with a neighbour\nconst amt = 0.3\nosc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .modulate(noise(3), amt)\n  .out()\n'
    const id = await page.evaluate(async ({ code }) => {
      const lib = window.__blocks.lib
      const s = await lib.create('Switch test', code)
      await lib.put({ ...s, meta: { stack: { v: 1, mode: 'code' }, graph: { v: 1, pos: { x: { x: 1, y: 2 } } } } }, { touch: false })
      return s.id
    }, { code })
    await page.goto(S.base + 'blocks/#/s/' + id)
    await page.reload()
    await page.waitForFunction((id) => window.__blocks?.store?.sketch?.id === id, id, { timeout: 15000 })
    await waitForPicture(page)
    // move the script by its hat, so meta.blocks carries an edit (the def stays above it in reading order)
    const h = await touch.center('.workspace .block.hat[data-fn=osc]')
    await touch.drag({ x: h.box.x + 30, y: h.y }, 60, 40)
    await sleep(900)
    await page.evaluate(() => window.__blocks.lib.flush())
    const read = () => page.evaluate(async (id) => JSON.parse(JSON.stringify(await window.__blocks.lib.get(id))), id)
    const before = await read()
    assert.ok(before.meta.blocks?.pos, 'meta.blocks written')
    assert.equal(await codeOf(page), code, 'moving a script does not change the code')
    await touch.tap('.hi-switch > button')
    await shot(page, '08-switcher.png')
    await touch.tap('.hi-switch a:has-text("Harness")')
    await page.waitForURL(/\/harness\//, { timeout: 15000 })
    await page.waitForSelector('#code', { timeout: 15000 })
    assert.equal(await page.inputValue('#code'), code, 'the harness shows the same code')
    await sleep(800)
    await page.click('.hi-switch > button')
    await page.click('.hi-switch a:has-text("Blocks")')
    await page.waitForURL(/\/blocks\//, { timeout: 15000 })
    await page.waitForFunction((id) => window.__blocks?.store?.sketch?.id === id, id, { timeout: 15000 })
    const after = await read()
    assert.equal(await codeOf(page), code)
    assert.deepEqual(after.meta.blocks, before.meta.blocks, 'meta.blocks intact')
    assert.deepEqual(after.meta.stack, { v: 1, mode: 'code' }, 'meta.stack untouched')
    assert.deepEqual(after.meta.graph, { v: 1, pos: { x: { x: 1, y: 2 } } }, 'meta.graph untouched')
    return `meta keys: ${Object.keys(after.meta).sort().join(', ')}`
  })
  assert.deepEqual(S.errors, [], '8: no page errors')
})

// ============================================================================================================ 9. the rest of the brief
if (want('9')) await block('9', async () => {
  const S = await startS({ viewport: { width: 1180, height: 820 } })
  const { page, touch } = S
  await check('9a', 'blocks come off with everything under them, wait loose on the workspace (not in the code), snap back; dropped on the palette they are deleted', async () => {
    await importAndOpen(page, S.base, 'osc(10).rotate(1).kaleid(4).out()\nnoise(3).out(o1)\n', 'Stacks')
    await waitForPicture(page)
    const spot = await emptySpot(S, 0.6, 0.85)
    await dragTo(S, grab('rotate'), spot)
    let c = await codeOf(page)
    assert.equal(c, 'osc(10).out()\nnoise(3).out(o1)\n', c)
    await page.waitForSelector('[data-testid=loose]')
    await shot(page, '09-loose.png')
    // snap the loose pair under noise
    await dragTo(S, '[data-testid=loose] .block .fname >> nth=0', grab('noise'))
    c = await codeOf(page)
    assert.match(c, /noise\(3\)\.rotate\(1\)\.kaleid\(4\)\.out\(o1\)/, c)
    assert.equal(await page.locator('[data-testid=loose]').count(), 0)
    // kaleid onto the palette: deleted
    await dragTo(S, grab('kaleid'), '[data-testid=palette]')
    assert.doesNotMatch(await codeOf(page), /kaleid/)
    return (await codeOf(page)).replace(/\n/g, ' ')
  })
  await check('9b', 'a script dropped into a socket moves inside it (its cap goes); dragged back out it is its own script, not rendered', async () => {
    await importAndOpen(page, S.base, 'osc(10).blend(o1).out()\nnoise(3).out(o1)\n', 'Sockets')
    await waitForPicture(page)
    await dragTo(S, grab('noise'), '.workspace .block[data-fn=blend] [data-testid=socket] >> nth=0', { at: { x: 30, y: 20 } })
    let c = await codeOf(page)
    assert.match(c, /^osc\(10\)\.blend\(noise\(3\)\)\.out\(\)\n$/, c)
    const spot = await emptySpot(S, 0.7, 0.8)
    await dragTo(S, '.workspace .socket .block.hat[data-fn=noise] > .fname', spot)
    c = await codeOf(page)
    assert.match(c, /noise\(3\)\.out\(\)|noise\(3\)\n?$/m, c)
    assert.equal(await page.locator('[data-testid=cap][data-out=none]').count(), 1, 'the pulled-out stack is not rendered')
    await touch.tap('[data-testid=show-o0] >> nth=0')
    await shot(page, '09-sockets.png')
    return c.replace(/\n/g, ' ')
  })
  await check('9c', 'dice drops a random valid script; mutate nudges every number; the ↶ scrubber slides back through the script\'s states; fold hides blocks but not code', async () => {
    await blank(S, 'Play')
    await touch.tap('[data-testid=dice]')
    await page.waitForSelector('.workspace .script[data-kind=chain]')
    const c0 = await codeOf(page)
    assert.ok(c0.length > 10)
    assert.deepEqual(await page.evaluate(() => window.__blocks.core.validate(window.__blocks.store.sketch).filter((p) => p.severity === 'error')), [])
    // select the hat, mutate twice
    await touch.tap('.workspace .block.hat > .fname >> nth=0')
    await page.waitForSelector('[data-testid=selbar]')
    await touch.tap('[data-testid=sel-mutate]')
    await touch.tap('[data-testid=sel-mutate]')
    const c2 = await codeOf(page)
    assert.notEqual(c2, c0)
    // only numbers changed (a nudged number that lands on its default is left out of the code, as core's codegen does)
    const shape = (c) => {
      let t = c.replace(/-?\d+(\.\d+)?/g, '#')
      while (/, #\)/.test(t)) t = t.replace(/, #\)/g, ')')
      return t
    }
    assert.equal(shape(c2), shape(c0), 'only numbers changed')
    // scrub back to the first state, then to now
    const range = page.locator('[data-testid=sel-history]')
    await range.evaluate((el) => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })) })
    await sleep(200)
    assert.equal(await codeOf(page), c0, 'scrubbed back to the dice roll')
    await range.evaluate((el) => { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })) })
    await sleep(200)
    assert.equal(await codeOf(page), c2, 'and forward to now')
    await shot(page, '09-play.png')
    await touch.tap('[data-testid=sel-fold]')
    await page.waitForSelector('.script.folded')
    assert.equal(await codeOf(page), c2)
    await touch.tap('[data-testid=unfold]')
    return c0.split('\n').filter(Boolean)[0]
  })
  await check('9d', 'unknown call renders as a grey block with an editable name; it upgrades in place when a plugin registers it, under a Plugins tab', async () => {
    await importAndOpen(page, S.base, 'osc(10).myPluginFx(0.3, 2).out()\n', 'Unknown')
    await page.waitForSelector('.workspace .block.unknown[data-fn=myPluginFx]')
    assert.equal(await page.locator('.workspace .block[data-fn=myPluginFx] [data-testid=slot]').count(), 2)
    await shot(page, '09-unknown.png')
    await page.evaluate(() => window.__blocks.ctx.catalog.refresh([{ name: 'myPluginFx', type: 'color', origin: 'plugin:test', inputs: [{ name: 'amount', type: 'float', default: 0.5 }, { name: 'steps', type: 'float', default: 1 }], glsl: 'return _c0;' }]))
    await page.waitForSelector('.workspace .block.t-plugin[data-fn=myPluginFx]:not(.unknown)')
    await openPalette(S, 'Plugins')
    assert.equal(await page.locator('[data-item="fn:myPluginFx"]').count(), 1)
    assert.equal(await codeOf(page), 'osc(10).myPluginFx(0.3, 2).out()\n')
    return 'grey → plugin block, same code'
  })
  await check('9e', 'two-finger tap undoes, three-finger tap redoes; pinch zooms the workspace; code view shows the selected block', async () => {
    await importAndOpen(page, S.base, 'osc(20, 0.1, 0.8).rotate(0.8).out()\n', 'Gestures')
    await waitForPicture(page)
    await keypad(S, numSel(await callId(S, 'rotate'), 0), '2')
    assert.match(await codeOf(page), /rotate\(2\)/)
    const spot = await emptySpot(S, 0.5, 0.7)
    await touch.multiTap(2, spot)
    await page.waitForFunction(() => /rotate\(0\.8\)/.test(window.__blocks.core.toCode(window.__blocks.store.sketch)), null, { timeout: 3000 })
    await touch.multiTap(3, spot)
    await page.waitForFunction(() => /rotate\(2\)/.test(window.__blocks.core.toCode(window.__blocks.store.sketch)), null, { timeout: 3000 })
    const k0 = await page.evaluate(() => getComputedStyle(document.querySelector('.world')).transform)
    const send = (type, pts) => S.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) })
    await send('touchStart', [{ x: spot.x - 40, y: spot.y }, { x: spot.x + 40, y: spot.y }])
    for (let i = 1; i <= 10; i++) {
      await send('touchMove', [{ x: spot.x - 40 - i * 8, y: spot.y }, { x: spot.x + 40 + i * 8, y: spot.y }])
      await sleep(16)
    }
    await send('touchEnd', [])
    await sleep(200)
    const k1 = await page.evaluate(() => getComputedStyle(document.querySelector('.world')).transform)
    assert.notEqual(k1, k0, 'pinch changed the zoom')
    await touch.tap(grab('rotate'))
    await touch.tap('[data-testid=code-toggle]')
    await page.waitForSelector('.codepane .cm-editor')
    await sleep(300)
    await shot(page, '09-code.png')
    return 'undo/redo by finger taps; zoom changed'
  })
  await check('9f', 'full-screen output, and back', async () => {
    await touch.tap('[data-testid=pip-full]')
    await page.waitForSelector('.pip.perform')
    await shot(page, '09-fullscreen.png')
    await touch.tap('[data-testid=perform-exit]')
    await page.waitForSelector('.pip:not(.perform)')
  })
  await check('9g', 'a starter opens as a new sketch', async () => {
    await touch.tap('[data-testid=more]')
    await touch.tap('[data-testid=menu-starters]')
    await page.waitForSelector('[data-testid=starters]')
    await shot(page, '09-starters.png')
    await touch.tap('[data-starter="Feedback trails"]')
    await page.waitForFunction(() => window.__blocks.store.sketch.name === 'Feedback trails', null, { timeout: 10000 })
    await waitForPicture(page)
    await sleep(800)
    await shot(page, '09-starter-open.png')
    return await page.evaluate(() => window.__blocks.store.sketch.stmts.length + ' statement(s)')
  })
  assert.deepEqual(S.errors.filter((e) => !/Permissions policy/.test(e)), [], '9: no page errors')
})

// ============================================================================================================ summary
const md = ['# Acceptance run', '', `Chromium (software WebGL / SwiftShader), touch emulation via CDP. Generated ${new Date().toISOString().slice(0, 10)}.`, '', '| # | check | result | note |', '|---|---|---|---|']
for (const r of results) md.push(`| ${r.id} | ${r.title} | ${r.ok ? 'pass' : '**FAIL**'} | ${String(r.note ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300)} |`)
if (notes.length) md.push('', '## Notes', '', ...notes.map((n) => `* ${n}`), '')
if (!only) writeFileSync(join(shots, 'RESULTS.md'), md.join('\n') + '\n')
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
