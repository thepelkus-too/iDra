// Measures what a numeric edit costs, three ways (real Hydra in Chromium with SOFTWARE WebGL; the shader-link COUNTS are
// meaningful on any GPU, the milliseconds are not device performance).
//   A  baked      — edit the number in the text and re-run:           the number is part of the GLSL → new shader every time
//   B  live       — runtime.run(sketch) with only a number changed:    same code string → only the live table is updated
//   C  live drag  — runtime.setLive(id, v) 200× per frame-burst:       coalesced to one message per animation frame
// usage: node scripts/live-edit-bench.mjs [--skip-build]
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, SOFTWARE_GL_ARGS } from './lib/browser.mjs'
import { serve } from './serve.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!process.argv.includes('--skip-build')) execFileSync('npm', ['run', 'build:all'], { cwd: root, stdio: 'ignore' })
const { server, port } = await serve(resolve(root, 'dist'), 0)
const browser = await launch({ args: SOFTWARE_GL_ARGS })
const page = await (await browser.newContext({ viewport: { width: 834, height: 1194 } })).newPage()
await page.addInitScript(() => {
  const c = (window.__gl = { link: 0, compile: 0 })
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    const l = P.prototype.linkProgram
    P.prototype.linkProgram = function (...a) { c.link++; return l.apply(this, a) }
    const s = P.prototype.compileShader
    P.prototype.compileShader = function (...a) { c.compile++; return s.apply(this, a) }
  }
})
await page.goto(`http://localhost:${port}/harness/`)
await page.waitForFunction(() => window.__harness?.rt)
await page.selectOption('#isolation', 'inline')
await page.waitForFunction(() => window.__harness.rt.isolation === 'inline' && /· inline/.test(document.querySelector('#status').textContent))

const result = await page.evaluate(async () => {
  const h = window.__harness
  const rt = h.rt
  const N = 40
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
  const gl = () => ({ link: window.__gl.link, compile: window.__gl.compile })
  const delta = (a, b) => ({ links: b.link - a.link, compiles: b.compile - a.compile })

  // A. baked: the number lives in the text → a different GLSL string every edit
  await rt.run('osc(10, 0.1).rotate(0.5).out()', { force: true })
  await sleep(400)
  let g0 = gl(), t0 = performance.now()
  for (let i = 0; i < N; i++) {
    await rt.run(`osc(${11 + i}, 0.1).rotate(0.5).out()`, { force: true })
    await frame()
  }
  const baked = { edits: N, ...delta(g0, gl()), wallMsPerEdit: (performance.now() - t0) / N }

  // B. live: the IR is re-run with one number changed; the generated code is identical, so only the live table changes
  const sk0 = h.sketch
  const firstNum = (x) => { if (x && typeof x === 'object') { if (!Array.isArray(x) && x.k === 'num') return x; for (const v of Object.values(x)) { const r = firstNum(v); if (r) return r } } }
  await rt.run(sk0, { force: true })
  await sleep(400)
  g0 = gl()
  const rc0 = rt.stats.recompiles
  t0 = performance.now()
  for (let i = 0; i < N; i++) {
    const sk = JSON.parse(JSON.stringify(sk0))
    firstNum(sk.stmts).v = 5 + i
    await rt.run(sk)
    await frame()
  }
  const viaRun = { edits: N, ...delta(g0, gl()), recompiles: rt.stats.recompiles - rc0, wallMsPerEdit: (performance.now() - t0) / N }

  // C. setLive: what a knob drag calls on every pointer move
  const id = Object.keys(window.__hl).find((k) => typeof window.__hl[k] === 'number')
  g0 = gl()
  const m0 = rt.stats.liveMessages
  let cpu = 0
  const calls = 2000
  for (let burst = 0; burst < calls / 200; burst++) {
    const a = performance.now()
    for (let i = 0; i < 200; i++) rt.setLive(id, burst + i / 200)
    cpu += performance.now() - a
    await frame()
  }
  await sleep(200)
  const drag = { calls, messages: rt.stats.liveMessages - m0, ...delta(g0, gl()), cpuUsPerCall: (cpu * 1000) / calls, lastValueSeenInFrameTable: window.__hl[id] }
  return { baked, viaRun, drag }
})
console.log(JSON.stringify(result, null, 2))
await browser.close()
server.close()
