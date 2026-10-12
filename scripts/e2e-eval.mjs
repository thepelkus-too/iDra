// The evaluation model end to end in the harness's Eval tab (real hydra-synth in the sandboxed frame, software WebGL).
//   node scripts/e2e-eval.mjs [--skip-build]
// Checks:
//   1. vanilla Run all leaves a chain the code no longer mentions playing, and says "out of sync"; clean slate clears it
//   2. a held chain: ▶ on one pending change edits the playing line and re-runs only that chain (o1 untouched); the last
//      change removes the draft
//   3. ▶ Run swaps the draft in and keeps the old version as a draft (A/B); running that draft switches back
//   4. "Run on every edit" off: an edit changes the code, not the screen, until Run all
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
const tmp = mkdtempSync(join(tmpdir(), 'hydra-e2e-eval-'))
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

const browser = await launch({ args: SOFTWARE_GL_ARGS })
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(base + 'harness/')
await page.waitForFunction(() => window.__harness?.rt)
await page.evaluate(() => window.__harness.rt.ready)

const code = () => page.evaluate(() => window.__harness.core.toCode(window.__harness.sketch))
async function setCode(text) {
  await page.click('#tabbtn-code')
  await page.fill('#code', text)
  await page.waitForFunction((c) => window.__harness.core.toCode(window.__harness.sketch) === c, text, { timeout: 5000 }).catch(() => {})
  await sleep(700)
  await page.click('#tabbtn-eval')
}
/** the centre pixel of output `of`, as [r, g, b] rounded to 0/1 */
const color = (of) =>
  page.evaluate(async (of) => {
    const bmp = await window.__harness.rt.snapshot(of, 16, 9)
    const c = document.createElement('canvas')
    c.width = 16
    c.height = 9
    const x = c.getContext('2d')
    x.drawImage(bmp, 0, 0)
    bmp.close()
    const d = x.getImageData(8, 4, 1, 1).data
    return [d[0], d[1], d[2]].map((v) => (v > 127 ? 1 : 0))
  }, of)
const syncState = () => page.getAttribute('#ev-sync', 'data-sync')
const pick = async (sel) => {
  await page.click(sel)
  await sleep(500)
}

await page.click('#tabbtn-eval')
await page.selectOption('#ev-mode', 'vanilla')
if (!(await page.isChecked('#ev-auto'))) await page.check('#ev-auto')

await step('vanilla leaves a deleted chain playing and says out of sync; clean slate clears it', async () => {
  await page.click('#btn-run') // a clean start
  await setCode('solid(1, 0, 0).out()\nsolid(0, 1, 0).out(o1)\n')
  await sleep(300)
  assert.deepEqual(await color('o1'), [0, 1, 0])
  await setCode('solid(1, 0, 0).out()\n')
  assert.deepEqual(await color('o1'), [0, 1, 0], 'vanilla: o1 keeps playing')
  assert.equal(await syncState(), 'out')
  assert.match(await page.textContent('#ev-sync'), /o1/)
  await page.selectOption('#ev-mode', 'clean')
  await pick('#ev-run-all')
  assert.deepEqual(await color('o1'), [0, 0, 0], 'clean slate: o1 black')
  assert.equal(await syncState(), 'in')
  await page.selectOption('#ev-mode', 'vanilla')
})

await step('a held chain runs one change at a time; the other output is untouched; the last change removes the draft', async () => {
  await setCode('solid(1, 0, 0).out()\n// solid(0, 0, 1).out()\nsolid(0, 1, 0).out(o1)\n')
  await page.click('#btn-run')
  await sleep(500)
  assert.deepEqual(await color('o0'), [1, 0, 0])
  const labels = await page.$$eval('[data-out=o0] .ev-changes li span', (xs) => xs.map((x) => x.textContent))
  assert.deepEqual(labels, ['solid: 1 → 0', 'solid: 0 → 1'])
  await pick('[data-out=o0] .ev-changes li:nth-child(2) [data-act=run-change]')
  assert.deepEqual(await color('o0'), [1, 0, 1], 'only the blue change ran')
  assert.deepEqual(await color('o1'), [0, 1, 0])
  assert.equal(await code(), 'solid(1, 0, 1).out()\n// solid(0, 0, 1).out()\nsolid(0, 1, 0).out(o1)\n')
  await pick('[data-out=o0] .ev-changes li [data-act=run-change]')
  assert.deepEqual(await color('o0'), [0, 0, 1])
  assert.equal(await code(), 'solid(0, 0, 1).out()\nsolid(0, 1, 0).out(o1)\n')
  assert.equal(await syncState(), 'in')
})

await step('Run swaps the draft in and keeps the old version as a draft (A/B)', async () => {
  await setCode('solid(1, 0, 0).out()\n// solid(0, 1, 0).out()\n')
  await page.click('#btn-run')
  await sleep(500)
  await pick('[data-out=o0] [data-act=run]')
  assert.deepEqual(await color('o0'), [0, 1, 0])
  assert.equal(await code(), '// solid(1, 0, 0).out()\nsolid(0, 1, 0).out()\n')
  await pick('[data-out=o0] [data-act=run]')
  assert.deepEqual(await color('o0'), [1, 0, 0])
  assert.equal(await code(), 'solid(1, 0, 0).out()\n// solid(0, 1, 0).out()\n')
})

await step('with "Run on every edit" off, an edit waits for Run all', async () => {
  await setCode('solid(1, 0, 0).out()\n')
  await page.click('#btn-run')
  await sleep(400)
  await page.uncheck('#ev-auto')
  await setCode('solid(0, 0, 1).out()\n')
  assert.deepEqual(await color('o0'), [1, 0, 0], 'the edit did not run')
  assert.equal(await syncState(), 'out')
  await pick('#ev-run-all')
  assert.deepEqual(await color('o0'), [0, 0, 1])
  assert.equal(await syncState(), 'in')
  await page.check('#ev-auto')
})

await step('no page errors', async () => assert.deepEqual(errors, []))
await browser.close()
app.close?.()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
