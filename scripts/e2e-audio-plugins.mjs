// End-to-end checks for audio sources, plugins and MIDI, in Chromium at an iPad viewport (834×1194, touch).
//   node scripts/e2e-audio-plugins.mjs [--skip-build] [--shots <dir>]
// Software WebGL (SwiftShader) and Chromium's fake media devices: timings are NOT device performance, and nothing here
// proves iPadOS behaviour (silent switch, routing, interruptions); see docs/audio.md for the device checklist.
//
// Local servers only (nothing from the internet):
//   app      dist/ (the shell registers the service worker)
//   cors     fixtures with Access-Control-Allow-Origin: *  (a WAV "stream", a test plugin, hydra-midi 0.4.6 for tests)
//   nocors   the same files without CORS headers
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, SOFTWARE_GL_ARGS, FAKE_MEDIA_ARGS } from './lib/browser.mjs'
import { makeBeatsWav } from './lib/wav.mjs'
import { serve } from './serve.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!process.argv.includes('--skip-build')) execFileSync('npm', ['run', 'build:all'], { cwd: root, stdio: 'inherit' })
const shotsArg = process.argv.indexOf('--shots')
const shots = shotsArg > 0 ? resolve(process.argv[shotsArg + 1]) : join(root, 'test-results', 'ipad')
mkdirSync(shots, { recursive: true })

// ---- fixtures
const tmp = mkdtempSync(join(tmpdir(), 'hydra-e2e-ap-'))
cpSync(join(root, 'dist'), join(tmp, 'dist'), { recursive: true })
const fx = join(tmp, 'fixtures')
mkdirSync(join(fx, 'e2e-plugin@1.0.0'), { recursive: true })
mkdirSync(join(fx, 'hydra-midi@0.4.6/dist'), { recursive: true })
const micWav = join(tmp, 'mic.wav')
writeFileSync(micWav, makeBeatsWav({ sampleRate: 48000, seconds: 4, beatEvery: 0.5 }))
writeFileSync(join(fx, 'beats.wav'), makeBeatsWav({ sampleRate: 22050, seconds: 6, beatEvery: 0.5 }))
const PLUGIN = `// e2e test plugin: one source function and one helper global
setFunction({ name: 'e2eStripes', type: 'src', inputs: [{ type: 'float', name: 'n', default: 8 }],
  glsl: 'return vec4(vec3(step(0.5, fract(_st.x * n))), 1.0);' })
window.e2eHelper = (x) => x * 2
`
writeFileSync(join(fx, 'e2e-plugin@1.0.0/plugin.js'), PLUGIN)
cpSync(join(root, 'scripts/fixtures/hydra-midi/index.js'), join(fx, 'hydra-midi@0.4.6/dist/index.js'))

const app = await serve(join(tmp, 'dist'), 0)
const cors = await serve(fx, 0, { cors: true })
const nocors = await serve(fx, 0)
const base = `http://localhost:${app.port}/`
// a different host name = a different origin from the app (and from each other by port)
const corsBase = `http://127.0.0.1:${cors.port}/`
const nocorsBase = `http://127.0.0.1:${nocors.port}/`
const PLUGIN_URL = corsBase + 'e2e-plugin@1.0.0/plugin.js'
const MIDI_URL = corsBase + 'hydra-midi@0.4.6/dist/index.js'

const results = []
const metrics = {}
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
const shot = (p, name) => p.screenshot({ path: join(shots, `${name}.png`) })

const browser = await launch({ args: [...SOFTWARE_GL_ARGS, ...FAKE_MEDIA_ARGS, `--use-file-for-fake-audio-capture=${micWav}`, '--autoplay-policy=no-user-gesture-required'] })
const ipad = { viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
const context = await browser.newContext(ipad)
await context.grantPermissions(['camera', 'microphone'], { origin: base.slice(0, -1) })
// record what getUserMedia was asked for (mic processing must be off for analysis)
await context.addInitScript(() => {
  const md = navigator.mediaDevices
  if (!md?.getUserMedia) return
  const orig = md.getUserMedia.bind(md)
  window.__gum = []
  md.getUserMedia = (c) => (window.__gum.push(c && typeof c.audio === 'object' ? c.audio : {}), orig(c))
})
const page = await context.newPage()
const consoleErrors = []
const watch = (p) => {
  p.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
  p.on('console', (m) => m.type() === 'error' && consoleErrors.push('console.error: ' + m.text().slice(0, 200)))
}
watch(page)

const harness = () => page.evaluate(() => window.__harness)
const tab = (p, id) => p.click(`#tabbtn-${id}`)
const setCode = async (p, code) => {
  await tab(p, 'code')
  await p.fill('#code', code)
  await p.waitForFunction((c) => window.__harness?.sketch && window.__harness.sketch.stmts.length > 0 && document.querySelector('#code').value === c, code)
  await p.waitForTimeout(600) // the textarea debounces (300 ms) then runs
}
/** the runtime's catalog delta has this function (polled: waitForFunction does not await an async predicate) */
const hasDelta = async (p, name, timeout = 15000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await p.evaluate(async (n) => (await window.__harness.rt.getCatalogDelta()).some((d) => d.name === n), name)) return
    await p.waitForTimeout(200)
  }
  throw new Error(`${name} never reached the runtime catalog`)
}
/** accept the trust prompt if it is showing (the runtime ran in safe mode until then) */
const trustIfAsked = async (p) => {
  // the first run after load decides whether the prompt shows; wait for it
  await p.waitForFunction(() => /^(ran|failed)/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 20000 })
  if (await p.evaluate(() => !document.querySelector('#trust-banner').hidden)) {
    await tab(p, 'code')
    await p.click('#trust-once')
    await p.waitForTimeout(300)
  }
}
/** the sandboxed preview frame (opaque origin; Playwright can still evaluate in it) */
const previewFrame = async (p) => {
  const handle = await p.$('#stage iframe')
  return handle?.contentFrame()
}

console.log(`\nHydra iPad e2e: audio, plugins, MIDI · ${base} · 834×1194 touch · SOFTWARE WebGL, fake media\n`)

await step('shell installs the service worker; harness opens', async () => {
  await page.goto(base)
  await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => !!r && !!r.active), null, { timeout: 20000 })
  await page.goto(base + 'harness/')
  await page.waitForFunction(() => !!window.__harness?.rt, null, { timeout: 20000 })
  await page.evaluate(() => window.__harness.rt.ready)
  await page.evaluate(() => window.__harness.audio.onFrame((f) => (window.__lastAudio = f)))
})

// ------------------------------------------------------------------ audio

await step('audio sources list: mic, input device, file, stream, tab/screen (feature-detected), other apps', async () => {
  await tab(page, 'audio')
  const opts = await page.$$eval('[data-role=source] option', (o) => o.map((x) => x.value))
  assert.deepEqual(opts.filter((v) => v !== 'display'), ['mic', 'device', 'file', 'stream', 'other'])
  const hasGdm = await page.evaluate(() => !!navigator.mediaDevices?.getDisplayMedia)
  assert.equal(opts.includes('display'), hasGdm, 'Tab / screen only where getDisplayMedia exists')
  await page.selectOption('[data-role=source]', 'other')
  assert.match(await page.textContent('[data-role=other-apps]'), /cannot record what other apps play/)
})

await step('microphone (fake device playing a WAV): analysis runs with processing off; values reach the frame', async () => {
  await page.selectOption('[data-role=source]', 'mic')
  await page.click('[data-role=start]')
  await page.waitForFunction(() => window.__harness.audio.state === 'running', null, { timeout: 10000 })
  const asked = await page.evaluate(() => window.__gum.at(-1))
  assert.deepEqual([asked.echoCancellation, asked.noiseSuppression, asked.autoGainControl], [false, false, false], JSON.stringify(asked))
  await page.waitForFunction(() => window.__harness.audio.analysis === 'ok' && (window.__lastAudio?.vol ?? 0) > 0, null, { timeout: 10000 })
  await setCode(page, 'osc(() => 10 + a.fft[0] * 40, 0.1, 0.8).out()\n')
  const frame = await previewFrame(page)
  await frame.waitForFunction(() => typeof a !== 'undefined' && a.vol > 0, null, { timeout: 10000 })
  await shot(page, '01-audio-mic')
  const v = await frame.evaluate(() => a.vol)
  return `frame a.vol=${v.toFixed(2)}`
})

await step('audio → visual: per-frame message size and host→frame delay (target < 100 ms on desktop)', async () => {
  // host stamps each analysis frame; the frame stamps when `a.vol` takes that frame's value (checked every rAF, i.e.
  // when the next rendered frame would use it). Same machine clock (Date.now) on both sides.
  await page.evaluate(() => {
    window.__lat = { host: new Map(), bytes: [], n: 0 }
    window.__harness.audio.onFrame((f) => {
      window.__lat.host.set(f.vol, Date.now())
      window.__lat.bytes.push(JSON.stringify({ t: 'audio', vol: f.vol, specific: Array.from(f.specific) }).length)
      window.__lat.n++
    })
  })
  const frame = await previewFrame(page)
  await frame.evaluate(() => {
    window.__seen = []
    let last
    const loop = () => {
      if (a.vol !== last) {
        last = a.vol
        window.__seen.push([a.vol, Date.now()])
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  const t = Date.now()
  await page.waitForTimeout(3000)
  const seen = await frame.evaluate(() => window.__seen)
  const { host, bytes, n } = await page.evaluate(() => ({ host: [...window.__lat.host.entries()], bytes: window.__lat.bytes, n: window.__lat.n }))
  const hostMap = new Map(host)
  const d = seen.filter(([v]) => hostMap.has(v)).map(([v, at]) => at - hostMap.get(v)).sort((x, y) => x - y)
  assert.ok(d.length > 20, `matched ${d.length} frames`)
  const med = d[Math.floor(d.length / 2)]
  const p95 = d[Math.floor(d.length * 0.95)]
  const perSec = n / ((Date.now() - t) / 1000)
  const avgBytes = bytes.reduce((x, y) => x + y, 0) / bytes.length
  const lat = await page.evaluate(() => window.__harness.audio.latency)
  const analysisMs = (512 / (lat.sampleRate || 48000)) * 1000
  Object.assign(metrics, { audioMsgPerSec: +perSec.toFixed(1), audioMsgBytes: Math.round(avgBytes), hostToFrameMedianMs: med, hostToFrameP95Ms: p95, analysisWindowMs: +analysisMs.toFixed(1), baseLatencyMs: lat.base != null ? +(lat.base * 1000).toFixed(1) : null })
  const total = med + analysisMs + (lat.base ?? 0) * 1000
  assert.ok(total < 100, `estimated audio→visual ${total.toFixed(0)} ms`)
  return `${perSec.toFixed(0)} msg/s × ~${Math.round(avgBytes)} B · host→frame median ${med} ms (p95 ${p95}) · + analysis window ${analysisMs.toFixed(1)} ms + baseLatency ${((lat.base ?? 0) * 1000).toFixed(1)} ms ≈ ${total.toFixed(0)} ms`
})

await step('input device picker: fake inputs listed after permission; the choice is remembered', async () => {
  await tab(page, 'audio')
  await page.click('[data-role=start]') // stop
  await page.selectOption('[data-role=source]', 'device')
  await page.click('[data-role=find-inputs]')
  await page.waitForFunction(() => document.querySelectorAll('[data-role=device] option').length > 0)
  const opts = await page.$$eval('[data-role=device] option', (o) => o.map((x) => x.textContent))
  assert.ok(opts.some((t) => /fake/i.test(t)), opts.join(', '))
  const val = await page.$$eval('[data-role=device] option', (o) => o[o.length - 1].value)
  await page.selectOption('[data-role=device]', val)
  await page.click('[data-role=start]')
  await page.waitForFunction(() => window.__harness.audio.state === 'running', null, { timeout: 10000 })
  const saved = await page.evaluate(() => window.__harness.core.savedAudioInput())
  assert.ok(saved?.id || saved?.label, JSON.stringify(saved))
  await page.click('[data-role=start]') // stop
  return `${opts.length} input(s)`
})

await step('stream URL with CORS: plays and analyses', async () => {
  await page.selectOption('[data-role=source]', 'stream')
  await page.fill('[data-role=stream-url]', corsBase + 'beats.wav')
  await page.dispatchEvent('[data-role=stream-url]', 'change')
  await page.click('[data-role=start]')
  await page.waitForFunction(() => window.__harness.audio.state === 'running', null, { timeout: 15000 })
  await page.waitForFunction(() => (window.__lastAudio?.vol ?? 0) > 0, null, { timeout: 10000 })
  assert.equal(await page.evaluate(() => window.__harness.audio.analysis), 'ok')
  await page.click('[data-role=start]')
})

await step('stream URL without CORS: “plays but doesn’t allow analysis”, then play-only', async () => {
  await page.fill('[data-role=stream-url]', nocorsBase + 'beats.wav')
  await page.dispatchEvent('[data-role=stream-url]', 'change')
  await page.click('[data-role=start]')
  await page.waitForFunction(() => window.__harness.audio.state === 'error', null, { timeout: 15000 })
  assert.match(await page.textContent('[data-role=status]'), /plays but doesn.t allow analysis/i)
  await page.waitForSelector('[data-role=play-only]:not([hidden])')
  await shot(page, '02-audio-no-cors')
  await page.click('[data-role=play-only]')
  await page.waitForFunction(() => window.__harness.audio.state === 'running', null, { timeout: 15000 })
  assert.equal(await page.evaluate(() => window.__harness.audio.source.playOnly), true)
  await page.click('[data-role=start]')
})

await step('audio file: chosen through the Files picker, shown by name, kept on the device when asked', async () => {
  await page.selectOption('[data-role=source]', 'file')
  await page.check('[data-role=keep]')
  await page.setInputFiles('[data-role=file-input]', { name: 'beats.wav', mimeType: 'audio/wav', buffer: readFileSync(join(fx, 'beats.wav')) })
  await page.waitForFunction(() => /beats\.wav/.test(document.querySelector('[data-role=file-name]').textContent))
  if ((await page.evaluate(() => window.__harness.audio.state)) !== 'running') await page.click('[data-role=start]')
  await page.waitForFunction(() => window.__harness.audio.state === 'running' && (window.__lastAudio?.vol ?? 0) > 0, null, { timeout: 10000 })
  await page.waitForFunction(() => [...document.querySelectorAll('[data-role=saved] option')].some((o) => /beats/.test(o.textContent)), null, { timeout: 10000 })
  await page.click('[data-role=start]')
})

// ------------------------------------------------------------------ plugins

await step('unknown call before the plugin: the sketch names a function nobody defined', async () => {
  await setCode(page, 'e2eStripes(6).out()\n')
  assert.match(await page.textContent('#status'), /unknown function "e2eStripes"/)
})

await step('plugin manager: fetch by URL shows URL, size, version and SHA-256 before installing', async () => {
  await tab(page, 'plugins')
  await page.fill('[data-role=plugin-url]', PLUGIN_URL)
  await page.click('[data-role=plugin-fetch]')
  await page.waitForSelector('[data-role=plugin-preview]')
  assert.equal(await page.textContent('[data-role=preview-url]'), PLUGIN_URL)
  assert.match(await page.textContent('[data-role=preview-hash]'), /SHA-256 [0-9a-f]{64}/)
  assert.match(await page.textContent('[data-role=plugin-preview]'), /1\.0\.0/)
  assert.match(await page.textContent('[data-role=plugin-preview]'), /pinned version/)
  await shot(page, '03-plugin-preview')
})

await step('install and use in this sketch: trust gate first, then it runs in the frame; catalog and function list update', async () => {
  await page.click('[data-role=plugin-install-enable]')
  await page.waitForFunction(() => (window.__harness.sketch.plugins ?? []).some((p) => p.id === 'e2e-plugin'), null, { timeout: 15000 })
  // the manager probed it in a hidden sandboxed frame: the installed card lists what it adds
  await page.waitForFunction(() => /e2eStripes/.test(document.querySelector('[data-plugin="e2e-plugin"]')?.textContent ?? ''), null, { timeout: 15000 })
  // a sketch with a plugin asks first; until then the preview ran in safe mode, without the plugin
  await tab(page, 'code')
  await page.waitForSelector('#trust-banner:not([hidden])')
  assert.equal(await page.evaluate(async () => (await window.__harness.rt.getCatalogDelta()).some((d) => d.name === 'e2eStripes')), false, 'not loaded before trust')
  await page.click('#trust-once')
  await hasDelta(page, 'e2eStripes')
  await page.waitForFunction(() => !/unknown function/.test(document.querySelector('#status').textContent) && /^ran/.test(document.querySelector('#status').textContent))
  const origin = await page.evaluate(() => window.__harness.core.catalog.get('e2eStripes')?.origin)
  assert.equal(origin, 'plugin:e2e-plugin')
  await tab(page, 'plugins')
  assert.match(await page.textContent('#fn-list'), /plugin:e2e-plugin: e2eStripes \(src\)/)
  // what the frame did: its own global from the plugin, and no trace in this page
  const frame = await previewFrame(page)
  assert.equal(await frame.evaluate(() => typeof e2eHelper), 'function')
  assert.equal(await page.evaluate(() => typeof window.e2eHelper), 'undefined')
  // toCode adds the loadScript line for the manager plugin
  assert.match(await page.inputValue('#code'), new RegExp(`^await loadScript\\('${PLUGIN_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)\\n\\ne2eStripes`))
  await shot(page, '04-plugin-installed')
})

await step('the plugin is cached on the host (Cache Storage), and the service worker keeps that cache', async () => {
  const keys = await page.evaluate(async () => (await (await caches.open('hydra-ipad-scripts-v1')).keys()).map((r) => r.url))
  assert.ok(keys.includes(PLUGIN_URL), keys.join(', '))
})

await step('offline: reload the harness with the plugin server down; the plugin loads from the cache', async () => {
  await context.setOffline(true)
  await page.reload()
  await page.waitForFunction(() => !!window.__harness?.rt, null, { timeout: 20000 })
  await trustIfAsked(page)
  await hasDelta(page, 'e2eStripes')
  const r = await page.evaluate(async () => window.__harness.runNow(true))
  await context.setOffline(false)
  const errs = await page.$$eval('#errors .err', (e) => e.map((x) => x.textContent))
  assert.equal(r.ok, true, JSON.stringify(r) + ' ' + JSON.stringify(errs))
})

await step('a missing plugin is reported with its URL and the sketch keeps running', async () => {
  const missing = corsBase + 'nope@1.0.0/missing.js'
  await page.evaluate(async (url) => {
    const h = window.__harness
    const s = h.core.withPlugin(h.sketch, { id: 'missing', name: 'Missing', url })
    await h.lib.approve(s)
  }, missing)
  // apply through the manager's sketch access (same path as the toggle)
  await page.evaluate(async (url) => {
    const h = window.__harness
    h.lib.autosave(h.core.withPlugin(h.sketch, { id: 'missing', name: 'Missing', url }))
    await h.lib.flush()
  }, missing)
  await page.reload()
  await page.waitForFunction(() => !!window.__harness?.rt, null, { timeout: 20000 })
  await trustIfAsked(page)
  await page.waitForFunction((url) => [...document.querySelectorAll('#errors .err')].some((e) => e.textContent.includes(url)), missing, { timeout: 15000 })
  await page.waitForFunction(() => /^ran/.test(document.querySelector('#status').textContent), null, { timeout: 10000 })
  // clean up: drop the missing plugin again
  await page.evaluate(async () => {
    const h = window.__harness
    h.lib.autosave(h.core.withoutPlugin(h.sketch, 'missing'))
    await h.lib.flush()
  })
})

// ------------------------------------------------------------------ MIDI

await step('virtual controller: a fader drag drives hydra-midi’s cc(1) inside the sandboxed frame', async () => {
  await page.reload()
  await page.waitForFunction(() => !!window.__harness?.rt, null, { timeout: 20000 })
  await page.evaluate(async (url) => {
    const h = window.__harness
    const store = h.core.getPluginStore()
    await store.install(await store.preview(url))
  }, MIDI_URL)
  await setCode(page, `await loadScript('${MIDI_URL}')\nawait midi.start({ input: '*', channel: '*' })\nosc(() => 10 + cc(1)() * 50, 0.1, 0.8).out()\n`)
  await trustIfAsked(page)
  const frame = await previewFrame(page)
  await frame.waitForFunction(() => typeof cc === 'function' && navigator.requestMIDIAccess?.__hydraTouchShim === true, null, { timeout: 15000 })
  await frame.waitForFunction(() => midiState !== undefined)
  await tab(page, 'midi')
  const fader = page.locator('.hi-midi .fader[data-cc="1"]')
  const box = await fader.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 2, { steps: 8 })
  await page.mouse.up()
  await frame.waitForFunction(() => cc(1)() > 0.9, null, { timeout: 5000 })
  // a pad tap is a note on, release is note off
  const pad = page.locator('.hi-midi .pad[data-pad="36"]')
  const pb = await pad.boundingBox()
  await page.mouse.move(pb.x + 5, pb.y + 5)
  await page.mouse.down()
  await frame.waitForFunction(() => note(36)() === 1, null, { timeout: 5000 })
  await page.mouse.up()
  await frame.waitForFunction(() => note(36)() === 0, null, { timeout: 5000 })
  await shot(page, '05-midi-controller')
  return `cc(1)=${(await frame.evaluate(() => cc(1)())).toFixed(2)}`
})

await step('no Web MIDI (requestMIDIAccess removed): banner with a Diagnostics link; never silent', async () => {
  const p2 = await context.newPage()
  watch(p2)
  await p2.addInitScript(() => {
    delete Navigator.prototype.requestMIDIAccess
  })
  await p2.goto(page.url())
  await p2.waitForFunction(() => !!window.__harness?.rt, null, { timeout: 20000 })
  await tab(p2, 'code')
  await p2.waitForSelector('[data-role=midi-banner]')
  assert.match(await p2.textContent('[data-role=midi-banner]'), /Web MIDI isn’t available in this browser, so MIDI inputs won’t respond/)
  await shot(p2, '06-midi-banner')
  await p2.click('[data-role=midi-banner] a')
  await p2.waitForFunction(() => document.querySelector('#tabbtn-diag')?.getAttribute('aria-selected') === 'true', null, { timeout: 15000 })
  await p2.waitForFunction(() => /Web MIDI/.test(document.querySelector('#tab-diag table')?.textContent ?? ''), null, { timeout: 20000 })
  const row = await p2.evaluate(() => [...document.querySelectorAll('#tab-diag tr')].find((r) => /^Web MIDI$/.test(r.cells[0].textContent))?.cells[1].textContent)
  assert.equal(row, 'no')
  await shot(p2, '07-diagnostics')
  await p2.close()
})

// ------------------------------------------------------------------ every editor + shell

await step('the ⇄ menu in an editor opens the Plugins and MIDI sheets', async () => {
  const id = await page.evaluate(() => window.__harness.sketch.id)
  const apps = (await (await page.request.get(base + 'apps.json')).json()).apps.filter((a) => a.name !== 'harness')
  assert.ok(apps.length > 0)
  const ed = apps[0]
  await page.goto(new URL(ed.path, base).href + `#/s/${id}`)
  await page.waitForSelector('.hi-switch button', { timeout: 20000 })
  await page.click('.hi-switch > button')
  await page.click('.hi-switch [data-tool=plugins]')
  await page.waitForSelector('.hi-plugin-sheet [data-role=plugin-list]')
  await page.waitForFunction(() => /e2e-plugin|e2eStripes/i.test(document.querySelector('.hi-plugin-sheet').textContent))
  await shot(page, `08-${ed.name}-plugins-sheet`)
  await page.click('.hi-plugin-sheet [data-role=sheet-close]')
  await page.click('.hi-switch > button')
  await page.click('.hi-switch [data-tool=midi]')
  await page.waitForSelector('[data-role=midi-sheet] .fader')
  await shot(page, `09-${ed.name}-midi-sheet`)
  await page.click('[data-role=midi-sheet] [data-role=sheet-close]')
  return ed.name
})

await step('shell: Plugins… lists installed plugins; Import offers “Add to plugins” for loadScript lines', async () => {
  await page.goto(base)
  await page.click('[data-role=open-plugins]')
  await page.waitForFunction(() => /e2e-plugin/i.test(document.querySelector('.hi-plugin-sheet')?.textContent ?? ''), null, { timeout: 10000 })
  await page.click('.hi-plugin-sheet [data-role=sheet-close]')
  await page.getByRole('button', { name: 'Import…' }).click()
  await page.fill('.modal textarea', `await loadScript('${PLUGIN_URL}')\ne2eStripes(4).out()\n`)
  await page.waitForSelector('[data-role=import-plugins]:not([hidden])')
  await page.check('[data-role=import-add-plugins]')
  await page.fill('.modal input[type=text]', 'Imported with plugin')
  await page.locator('.modal').getByRole('button', { name: 'Import' }).click()
  await page.waitForSelector('.card:has-text("Imported with plugin")')
  await shot(page, '10-shell')
})

await step('no unexpected console errors', async () => {
  const unexpected = consoleErrors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource|nope@1\.0\.0|ERR_FAILED|MEDIA_ERR|has been blocked by CORS policy|NotSupportedError|offline/i.test(e))
  assert.deepEqual(unexpected, [])
})

await browser.close()
app.server.close()
cors.server.close()
nocors.server.close()
const failed = results.filter((r) => !r.ok)
writeFileSync(join(shots, 'metrics.json'), JSON.stringify({ when: new Date().toISOString(), software: true, metrics, results }, null, 2))
console.log(`\n${results.length - failed.length}/${results.length} steps passed in ${((Date.now() - t0) / 1000).toFixed(1)} s · screenshots and metrics in ${shots}`)
console.log('metrics (software WebGL, fake devices; not device performance):', JSON.stringify(metrics))
process.exit(failed.length ? 1 : 0)
