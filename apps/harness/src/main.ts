import {
  appStorage,
  applyAppBase,
  catalog,
  createRuntime,
  describe,
  getAudioEngine,
  getLibrary,
  h,
  importText,
  injectStyles,
  liveId,
  mountAbout,
  mountSwitcher,
  mountUpdateToast,
  newSketch,
  num,
  parseRoute,
  randomSketch,
  routeHash,
  setArg,
  toCode,
  validate,
  walkCalls,
  withMeta,
  type Isolation,
  type Runtime,
  type RuntimeError,
  type Sketch,
} from '@hydra-ipad/core'
import * as core from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import { CSS } from './styles'
import { mountAudioLab, mountDiagnostics } from './diagnostics'

applyAppBase()
injectStyles('harness', CSS)

const APP = 'harness'
const lib = getLibrary()
const prefs = appStorage(APP)
const audio = getAudioEngine()

let sketch: Sketch
let rt: Runtime
let isolation: Isolation = (prefs.get<Isolation>('isolation') ?? 'iframe') as Isolation
let trusted = false // the owner said "run it" for this page load / this sketch
let seed = Date.now() % 100000

const root = document.getElementById('app')!

// ------------------------------------------------------------------ chrome

const nameInput = h('input', { class: 'name', type: 'text', 'aria-label': 'Sketch name', id: 'sketch-name' }) as HTMLInputElement
const runBtn = h('button', { type: 'button', class: 'primary', id: 'btn-run' }, 'Run')
const diceBtn = h('button', { type: 'button', id: 'btn-random', title: 'Randomize' }, '🎲 Randomize')
const safeToggle = h('input', { type: 'checkbox', id: 'safe-mode' }) as HTMLInputElement
const isoSel = h('select', { id: 'isolation', 'aria-label': 'Isolation mode' },
  h('option', { value: 'iframe' }, 'iframe (sandboxed)'),
  h('option', { value: 'inline' }, 'inline (no isolation)'),
) as HTMLSelectElement
isoSel.value = isolation
const switcherHost = h('span', {})
const top = h('div', { class: 'top' }, switcherHost, nameInput, runBtn, diceBtn, h('label', { title: 'Run only recognised chains; skip raw code and plugins' }, safeToggle, ' safe'), isoSel)

const banner = h('div', { class: 'banner', hidden: true, id: 'trust-banner' })
const camBanner = h('div', { class: 'banner', hidden: true, id: 'camera-banner' })
const textarea = h('textarea', { class: 'code', id: 'code', spellcheck: false, autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Hydra code' }) as HTMLTextAreaElement
const status = h('div', { class: 'status', id: 'status' })
const facts = h('div', { class: 'status', id: 'facts' })
const corpusSel = h('select', { id: 'corpus', 'aria-label': 'Load a corpus sketch' }, h('option', { value: '' }, 'load corpus sketch…'), ...corpus.map((c) => h('option', { value: c.name }, c.name))) as HTMLSelectElement
const codeTab = h('div', { class: 'tab on', id: 'tab-code' }, banner, camBanner, textarea, h('div', { class: 'row' }, corpusSel), facts, status)
const knobsTab = h('div', { class: 'tab', id: 'tab-knobs' })
const diagTab = h('div', { class: 'tab', id: 'tab-diag' })
const audioTab = h('div', { class: 'tab', id: 'tab-audio' })
const tabs = [
  ['code', 'Code', codeTab],
  ['knobs', 'Numbers', knobsTab],
  ['diag', 'Diagnostics', diagTab],
  ['audio', 'Audio lab', audioTab],
] as const
const tabBar = h('div', { class: 'tabs', role: 'tablist' })
for (const [id, label, el] of tabs) {
  const b = h('button', { type: 'button', role: 'tab', id: `tabbtn-${id}`, 'aria-selected': String(id === 'code') }, label)
  b.addEventListener('click', () => {
    for (const [i2, , e2] of tabs) {
      e2.classList.toggle('on', i2 === id)
      tabBar.querySelector(`#tabbtn-${i2}`)!.setAttribute('aria-selected', String(i2 === id))
    }
    prefs.set('tab', id)
    if (id === 'knobs') renderKnobs()
  })
  tabBar.append(b)
}
const stage = h('div', { class: 'stage', id: 'stage' })
const errorsEl = h('div', { class: 'errors', id: 'errors', 'aria-live': 'polite' })
const main = h('div', { class: 'main' },
  h('div', { class: 'panel' }, tabBar, h('div', { style: 'min-height:0;overflow:hidden;display:grid' }, codeTab, knobsTab, diagTab, audioTab)),
  h('div', { class: 'stage-wrap' }, stage, errorsEl),
)
const foot = h('div', { class: 'foot' })
root.append(top, main, foot)
mountAbout(foot, { build: typeof __COMMIT__ === 'string' && __COMMIT__ ? `commit ${__COMMIT__.slice(0, 7)}` : 'local build' })
mountDiagnostics(diagTab, () => isolation)
mountAudioLab(audioTab)
mountUpdateToast()

// ------------------------------------------------------------------ errors

function showError(e: RuntimeError) {
  const row = h('div', { class: 'err ' + (e.kind === 'warning' ? 'warning' : '') }, `${e.kind}: ${e.message}`)
  row.addEventListener('click', () => row.remove())
  errorsEl.append(row)
  while (errorsEl.children.length > 6) errorsEl.firstElementChild!.remove()
}

// ------------------------------------------------------------------ run / save

let saveTimer: ReturnType<typeof setTimeout> | undefined
let thumbTimer: ReturnType<typeof setTimeout> | undefined
function persist(s: Sketch) {
  sketch = s
  lib.autosave(s)
  clearTimeout(thumbTimer)
  thumbTimer = setTimeout(async () => {
    try {
      const t = await rt.thumbnail()
      if (t) await lib.setThumbnail(sketch.id, t)
    } catch {
      /* no GL, or runtime gone */
    }
  }, 4000)
}

function updateCameraBanner() {
  const uses = describe(sketch).usesCamera
  camBanner.hidden = !(uses && isolation === 'iframe')
  if (camBanner.hidden) return
  camBanner.textContent = ''
  camBanner.append(
    h('strong', {}, 'Camera / screen sources need inline mode.'),
    h('span', { class: 'status' }, 'Browsers refuse camera access inside the isolated frame. Inline mode runs the sketch without isolation, so only use it for sketches you trust.'),
    h('button', { type: 'button', id: 'camera-inline', class: 'warn', onclick: async () => { isoSel.value = 'inline'; isoSel.dispatchEvent(new Event('change')) } }, 'Switch to inline'),
  )
}

async function runNow(force = false) {
  const need = !trusted && (await lib.needsTrust(sketch))
  banner.hidden = !need
  updateCameraBanner()
  const r = await rt.run(sketch, { safe: need || safeToggle.checked, force })
  const problems = validate(sketch, catalog).filter((p) => p.severity !== 'info')
  status.textContent = `${r.ok ? 'ran' : 'failed'} · ${r.recompiled ? 'recompiled' : 'numbers only'} · ${r.ms.toFixed(0)} ms · ${isolation}${r.skipped.length ? ` · ${r.skipped.length} skipped (safe mode)` : ''}${problems.length ? ` · ${problems.length} problem(s): ${problems[0].message}` : ''}`
  return r
}

function showSketchText(s: Sketch) {
  const code = toCode(s)
  if (textarea.value !== code) textarea.value = code
  nameInput.value = s.name
  const d = describe(s)
  const parts = [`${d.chains.length} chain(s)`, d.defs.length && `${d.defs.length} def(s)`, d.raws && `${d.raws} raw block(s)`, d.notRendered.length && `${d.notRendered.length} not rendered`, d.feedbackEdges.length && 'feedback', d.shadowed.length && `${d.shadowed.length} shadowed`].filter(Boolean)
  facts.textContent = parts.join(' · ')
}

let textTimer: ReturnType<typeof setTimeout> | undefined
textarea.addEventListener('input', () => {
  clearTimeout(textTimer)
  textTimer = setTimeout(() => {
    const imp = importText(textarea.value, { id: sketch.id, name: sketch.name })
    const next: Sketch = { ...imp.sketch, createdAt: sketch.createdAt, meta: sketch.meta, plugins: sketch.plugins }
    persist(next)
    status.textContent = `${imp.report.chains} chain(s), ${imp.report.raw} raw block(s)${imp.warnings.length ? ' · ' + imp.warnings[0] : ''}`
    void runNow().then(() => renderKnobs())
  }, 300)
})
nameInput.addEventListener('change', () => persist({ ...sketch, name: nameInput.value.trim() || sketch.name }))
runBtn.addEventListener('click', () => void runNow(true))
safeToggle.addEventListener('change', () => void runNow(true))
diceBtn.addEventListener('click', () => {
  const r = randomSketch(seed++)
  const next: Sketch = { ...sketch, stmts: r.stmts, src: undefined }
  persist(next)
  showSketchText(next)
  void runNow().then(() => renderKnobs())
})
corpusSel.addEventListener('change', () => {
  const c = corpus.find((x) => x.name === corpusSel.value)
  if (!c) return
  textarea.value = c.code
  textarea.dispatchEvent(new Event('input'))
  corpusSel.value = ''
})
isoSel.addEventListener('change', async () => {
  isolation = isoSel.value as Isolation
  prefs.set('isolation', isolation)
  await startRuntime()
  await runNow(true)
})

// ------------------------------------------------------------------ trust gate

function renderBanner() {
  banner.textContent = ''
  banner.append(
    h('strong', {}, 'This sketch runs code. Run it?'),
    h('span', { class: 'status' }, 'It contains code the editor cannot show as chains. Running it in safe mode skips that code.'),
    h('button', { type: 'button', id: 'trust-once', onclick: () => { trusted = true; void runNow(true) } }, 'Run it once'),
    h('button', { type: 'button', id: 'trust-always', class: 'warn', onclick: async () => { await lib.approve(sketch); trusted = true; void runNow(true) } }, 'Always for this sketch'),
  )
}

// ------------------------------------------------------------------ numbers tab (live knobs)

function renderKnobs() {
  knobsTab.textContent = ''
  let n = 0
  for (const { call } of walkCalls(sketch)) {
    const inputs = catalog.inputs(call.fn)
    call.args.forEach((a, i) => {
      const inp = inputs[i]
      if (a.k !== 'num' || !inp || inp.type !== 'float') return
      n++
      const hint = catalog.hint(call.fn, inp.name)
      const id = liveId(call.id, i)
      const range = h('input', { type: 'range', min: hint.min, max: hint.max, step: hint.step ?? 0.01, value: a.v, 'aria-label': `${call.fn} ${inp.name}` }) as HTMLInputElement
      const box = h('input', { type: 'number', step: 'any', value: a.v, 'data-arg-id': id, 'aria-label': `${call.fn} ${inp.name} value` }) as HTMLInputElement
      const apply = (v: number) => {
        if (!Number.isFinite(v)) return
        rt.setLive(id, v) // instant: no recompile
        sketch = setArg(sketch, call.id, i, num(v))
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          persist(sketch)
          showSketchText(sketch)
        }, 150)
      }
      range.addEventListener('input', () => { box.value = range.value; apply(Number(range.value)) })
      box.addEventListener('input', () => { range.value = box.value; apply(Number(box.value)) })
      knobsTab.append(h('div', { class: 'knob' }, h('label', {}, `${call.fn}.${inp.name}`), range, box))
    })
  }
  if (!n) knobsTab.append(h('p', { class: 'status' }, 'No plain numbers in this sketch.'))
}

// ------------------------------------------------------------------ runtime

async function startRuntime() {
  rt?.dispose()
  stage.textContent = ''
  errorsEl.textContent = ''
  rt = createRuntime(stage, { isolation, audio, catalog, width: 960, height: 540 })
  rt.onError(showError)
  rt.onError((e) => e.kind === 'camera' && updateCameraBanner())
  rt.forwardPointer(true)
  ;(window as any).__harness = { get rt() { return rt }, get sketch() { return sketch }, lib, audio, runNow, core }
  await rt.ready.catch((e) => showError({ kind: 'runtime', message: String(e.message ?? e), at: Date.now() }))
}

// ------------------------------------------------------------------ boot

async function boot() {
  await lib.seedIfEmpty()
  const id = parseRoute(location.hash).sketchId
  let s = id ? await lib.get(id) : undefined
  if (!s) s = await lib.mostRecent()
  if (!s) s = await lib.create('Untitled', 'osc(20, 0.1, 0.8).out()\n')
  if (location.hash !== routeHash(s.id)) history.replaceState(null, '', routeHash(s.id))
  sketch = s
  mountSwitcher(switcherHost, { current: APP, sketchId: s.id })
  sketch = withMeta(sketch, APP, { lastOpened: Date.now() })
  showSketchText(sketch)
  renderBanner()
  const tab = prefs.get<string>('tab')
  if (tab && tab !== 'code') (document.getElementById(`tabbtn-${tab}`) as HTMLElement | null)?.click()
  await startRuntime()
  await runNow()
  renderKnobs()
  window.addEventListener('pagehide', () => void lib.flush())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void lib.flush())
  window.addEventListener('hashchange', async () => {
    const nid = parseRoute(location.hash).sketchId
    if (nid && nid !== sketch.id) {
      await lib.flush()
      const ns = await lib.get(nid)
      if (ns) {
        sketch = ns
        trusted = false
        showSketchText(ns)
        await runNow(true)
        renderKnobs()
      }
    }
  })
  persist(sketch)
  void newSketch
}
void boot()
