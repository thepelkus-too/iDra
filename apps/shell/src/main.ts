import {
  appStorage,
  applyAppBase,
  exportWithPrelude,
  findMotionPlugin,
  getLibrary,
  h,
  getPluginStore,
  injectStyles,
  isStandalone,
  loadScriptUrls,
  openPluginSheet,
  pluginRefFromUrl,
  withPlugin,
  loadAppsManifest,
  mountAbout,
  mountUpdateToast,
  needsTrustPrompt,
  parseRoute,
  routeHash,
  siteRoot,
  type AppInfo,
  type LibraryEntry,
} from '@hydra-ipad/core'
import { CSS } from './styles'

applyAppBase()
injectStyles('shell', CSS)

const lib = getLibrary()
;(window as any).__hydra = { lib } // test hook (the e2e run adds meta to a sketch before opening it in an editor)
const prefs = appStorage('shell')
const root = document.getElementById('app')!
let apps: AppInfo[] = []
let entries: LibraryEntry[] = []
let riskIds = new Set<string>()
let highlight = parseRoute(location.hash).sketchId

// ------------------------------------------------------------------ small helpers

const fmtDate = (t: number) => {
  const d = new Date(t)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
const gradientFor = (id: string) => {
  let x = 0
  for (const c of id) x = (x * 31 + c.charCodeAt(0)) >>> 0
  const a = x % 360
  return `linear-gradient(135deg, hsl(${a} 55% 28%), hsl(${(a + 70) % 360} 60% 18%))`
}
const download = (name: string, text: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = h('a', { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  setTimeout(() => (a.remove(), URL.revokeObjectURL(url)), 1000)
}
const stamp = () => new Date().toISOString().slice(0, 10)
const safeName = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'sketch'

function modal(title: string, body: HTMLElement[], actions: Array<{ label: string; primary?: boolean; danger?: boolean; run: () => void | Promise<void | boolean> }>): { close(): void } {
  const close = () => back.remove()
  const back = h('div', { class: 'modal-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': title })
  const box = h('div', { class: 'modal' }, h('h2', {}, title), ...body)
  const row = h('div', { class: 'row end' })
  for (const a of actions) {
    row.appendChild(
      h('button', {
        type: 'button',
        class: a.primary ? 'primary' : a.danger ? 'danger' : '',
        onclick: async () => {
          const keep = await a.run()
          if (keep !== false) close()
        },
      }, a.label),
    )
  }
  box.appendChild(row)
  back.appendChild(box)
  back.addEventListener('pointerdown', (e) => e.target === back && close())
  document.body.appendChild(back)
  return { close }
}

const toast = (msg: string) => {
  const t = h('div', { class: 'note-toast', role: 'status' }, msg)
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 4000)
}

// ------------------------------------------------------------------ actions

async function refresh() {
  entries = await lib.list()
  const risky = new Set<string>()
  for (const e of entries) {
    const s = await lib.get(e.id)
    if (s && (await lib.needsTrust(s))) risky.add(e.id)
  }
  riskIds = risky
  renderGrid()
}

async function newSketch() {
  const name = h('input', { type: 'text', value: 'Untitled', 'aria-label': 'Sketch name', autofocus: true })
  modal('New sketch', [name], [
    { label: 'Cancel', run: () => {} },
    { label: 'Create', primary: true, run: async () => { const s = await lib.create(name.value.trim() || 'Untitled', 'osc(20, 0.1, 0.8).out()\n'); highlight = s.id; await refresh() } },
  ])
}

function importDialog() {
  const text = h('textarea', { rows: 10, placeholder: 'Paste Hydra code here, or choose a .js / .json file below…', spellcheck: false, 'aria-label': 'Sketch code' })
  const name = h('input', { type: 'text', placeholder: 'Name (optional)', 'aria-label': 'Sketch name' })
  const file = h('input', { type: 'file', accept: '.js,.json,.txt,.mjs,text/javascript,application/json,text/plain', 'aria-label': 'Sketch file' })
  const info = h('div', { class: 'dim' })
  // code that loads scripts (`await loadScript(url)`): offer to add them to the plugin manager, so they are cached for
  // offline use and listed with their hash. The lines stay in the sketch exactly as written.
  const addPlugins = h('input', { type: 'checkbox', 'data-role': 'import-add-plugins' }) as HTMLInputElement
  const pluginsRow = h('label', { class: 'dim', hidden: true, 'data-role': 'import-plugins' }, addPlugins, ' ')
  const showScripts = () => {
    const urls = /^\s*[[{]/.test(text.value) ? [] : loadScriptUrls(text.value)
    pluginsRow.hidden = !urls.length
    pluginsRow.lastChild!.textContent = ` Add to plugins (fetch, cache for offline use, list with a hash): ${urls.join(', ')}`
  }
  text.addEventListener('input', showScripts)
  file.addEventListener('change', async () => {
    const f = file.files?.[0]
    if (!f) return
    text.value = await f.text()
    if (!name.value) name.value = f.name.replace(/\.(js|json|txt|mjs)$/i, '')
    info.textContent = `${f.name}: ${text.value.length} characters`
    showScripts()
  })
  pluginsRow.append(h('span', {}))
  modal('Import', [text, name, file, info, pluginsRow], [
    { label: 'Cancel', run: () => {} },
    {
      label: 'Import',
      primary: true,
      run: async () => {
        const code = text.value
        if (!code.trim()) return false
        // a backup bundle or an exported sketch is JSON; everything else is Hydra text
        if (/^\s*[[{]/.test(code)) {
          try {
            const data = JSON.parse(code)
            if (data && (data.sketches || data.stmts || Array.isArray(data))) {
              const r = await lib.restore(data)
              toast(`Restored ${r.imported} new, ${r.replaced} replaced, ${r.skipped} skipped`)
              await refresh()
              return
            }
          } catch {
            /* not JSON: treat as code */
          }
        }
        let { sketch, warnings } = await lib.importCode(name.value.trim() || 'Imported sketch', code)
        highlight = sketch.id
        if (addPlugins.checked) {
          const failed: string[] = []
          for (const url of loadScriptUrls(code)) {
            try {
              await getPluginStore().install(await getPluginStore().preview(url))
              sketch = withPlugin(sketch, pluginRefFromUrl(url))
            } catch (e) {
              failed.push(`${url} (${(e as Error).message})`)
            }
          }
          await lib.put(sketch)
          if (failed.length) warnings = [...warnings, `could not add ${failed.join(', ')}`]
        }
        toast(warnings.length ? `Imported with ${warnings.length} note(s): ${warnings[0]}` : 'Imported')
        await refresh()
      },
    },
  ])
}

function renameDialog(e: LibraryEntry) {
  const name = h('input', { type: 'text', value: e.name, 'aria-label': 'Sketch name' })
  modal('Rename', [name], [
    { label: 'Cancel', run: () => {} },
    { label: 'Rename', primary: true, run: async () => { await lib.rename(e.id, name.value.trim() || e.name); await refresh() } },
  ])
}
function deleteDialog(e: LibraryEntry) {
  modal('Delete sketch?', [h('p', {}, `"${e.name}" and its saved revisions will be removed from this device. Back it up first if you might want it again.`)], [
    { label: 'Cancel', run: () => {} },
    { label: 'Delete', danger: true, run: async () => { await lib.remove(e.id); await refresh() } },
  ])
}
async function duplicate(e: LibraryEntry) {
  const c = await lib.duplicate(e.id)
  if (c) highlight = c.id
  await refresh()
}
async function exportJS(e: LibraryEntry) {
  download(`${safeName(e.name)}.js`, await lib.exportJS(e.id), 'text/javascript')
}
/** "Make this sketch self-contained": hydra-motion's code inlined at the top instead of a loadScript line (docs/motion.md). */
async function exportSelfContained(e: LibraryEntry) {
  const s = await lib.get(e.id)
  if (!s) return
  if (!findMotionPlugin(s)) toast('This sketch does not use hydra-motion; exported as usual')
  try {
    download(`${safeName(e.name)}.js`, await exportWithPrelude(s), 'text/javascript')
  } catch (err) {
    toast(`Could not inline hydra-motion: ${(err as Error).message}`)
  }
}
async function exportJSON(e: LibraryEntry) {
  download(`${safeName(e.name)}.hydra.json`, await lib.exportJSON(e.id), 'application/json')
}
async function backup() {
  download(`hydra-ipad-backup-${stamp()}.json`, await lib.exportJSON('all'), 'application/json')
}
function restoreDialog() {
  const file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Backup file' })
  const overwrite = h('input', { type: 'checkbox' })
  modal('Restore from backup', [
    h('p', {}, 'Choose a backup made with “Backup everything”. Sketches that are newer on this device are kept unless you tick overwrite.'),
    file,
    h('label', { class: 'check' }, overwrite, ' overwrite sketches with the same id'),
  ], [
    { label: 'Cancel', run: () => {} },
    {
      label: 'Restore',
      primary: true,
      run: async () => {
        const f = file.files?.[0]
        if (!f) return false
        try {
          const r = await lib.restore(await f.text(), { overwrite: overwrite.checked })
          toast(`Restored ${r.imported} new, ${r.replaced} replaced, ${r.skipped} skipped`)
          await refresh()
        } catch (err) {
          toast(`Could not restore: ${(err as Error).message}`)
        }
      },
    },
  ])
}
async function aboutDialog() {
  const info = await lib.storageInfo()
  const rows: Array<[string, string]> = [
    ['Where sketches live', info.note],
    ['Storage engine', info.backend],
    ['Persistent storage', info.persisted === undefined ? 'unknown' : info.persisted ? 'granted' : 'not granted (the browser may evict data under pressure)'],
    ['Used', info.usage !== undefined && info.quota ? `${(info.usage / 1048576).toFixed(1)} MB of ${(info.quota / 1048576).toFixed(0)} MB` : 'unknown'],
    ['Running as', isStandalone() ? 'installed app (Home Screen)' : 'browser tab'],
  ]
  const dl = h('dl', { class: 'facts' })
  for (const [k, v] of rows) dl.append(h('dt', {}, k), h('dd', {}, v))
  const persist = h('button', { type: 'button', onclick: async () => { toast((await lib.persist()) ? 'Persistent storage granted' : 'Persistent storage was not granted') } }, 'Request persistent storage')
  modal('About & storage', [dl, persist, h('p', { class: 'dim' }, `Source: ${__REPO_URL__} · License: AGPL-3.0 (hydra-synth is AGPL-3.0 too).`)], [{ label: 'Close', primary: true, run: () => {} }])
}

// ------------------------------------------------------------------ rendering

const rootUrl = siteRoot('shell')
const appHref = (app: AppInfo, id: string) => new URL(app.path.replace(/^\//, '') + routeHash(id), rootUrl).href
const defaultApp = () => apps.find((a) => a.name === prefs.get<string>('lastApp')) ?? apps.find((a) => a.name === 'harness') ?? apps[0]

function card(e: LibraryEntry): HTMLElement {
  const thumb = h('div', { class: 'thumb', style: e.thumbnail ? `background-image:url(${e.thumbnail})` : `background-image:${gradientFor(e.id)}` }, e.thumbnail ? null : h('span', {}, e.name.slice(0, 1).toUpperCase()))
  const menu = h('div', { class: 'menu', hidden: true, role: 'menu' })
  for (const app of apps) {
    const a = h('a', { href: appHref(app, e.id), role: 'menuitem' }, app.title || app.name, h('small', {}, app.description ?? ''))
    a.addEventListener('click', () => prefs.set('lastApp', app.name))
    menu.append(a)
  }
  if (!apps.length) menu.append(h('div', { class: 'dim pad' }, 'No editors in this build'))
  const more = h('button', { type: 'button', 'aria-label': `More actions for ${e.name}`, 'aria-haspopup': 'menu' }, '⋯')
  const actions = h('div', { class: 'menu', hidden: true, role: 'menu' },
    h('button', { type: 'button', role: 'menuitem', onclick: () => renameDialog(e) }, 'Rename'),
    h('button', { type: 'button', role: 'menuitem', onclick: () => void duplicate(e) }, 'Duplicate'),
    h('button', { type: 'button', role: 'menuitem', onclick: () => void exportJS(e) }, 'Export .js'),
    h('button', { type: 'button', role: 'menuitem', title: 'Inline the hydra-motion plugin so the file runs in plain Hydra with no network', onclick: () => void exportSelfContained(e) }, 'Export .js, self-contained'),
    h('button', { type: 'button', role: 'menuitem', onclick: () => void exportJSON(e) }, 'Export .json'),
    h('button', { type: 'button', role: 'menuitem', class: 'danger', onclick: () => deleteDialog(e) }, 'Delete'),
  )
  const openIn = h('button', { type: 'button', 'aria-haspopup': 'menu' }, 'Open in…')
  const toggle = (m: HTMLElement) => {
    document.querySelectorAll('.card .menu').forEach((x) => x !== m && ((x as HTMLElement).hidden = true))
    m.hidden = !m.hidden
  }
  openIn.addEventListener('click', () => toggle(menu))
  more.addEventListener('click', () => toggle(actions))
  const primary = defaultApp()
  const open = primary ? h('a', { class: 'open', href: appHref(primary, e.id), 'aria-label': `Open ${e.name}` }, thumb) : thumb
  open.addEventListener?.('click', () => primary && prefs.set('lastApp', primary.name))
  return h('article', { class: 'card' + (e.id === highlight ? ' hl' : ''), 'data-id': e.id },
    open,
    h('div', { class: 'meta' },
      h('div', { class: 'name', title: e.name }, e.name),
      h('div', { class: 'dim' }, fmtDate(e.modifiedAt), riskIds.has(e.id) ? h('span', { class: 'risk', title: 'Contains code that needs your OK before it runs' }, ' ⚠ runs code') : null),
    ),
    h('div', { class: 'row' }, openIn, more),
    menu,
    actions,
  )
}

function renderGrid() {
  const grid = root.querySelector('.grid')!
  grid.textContent = ''
  if (!entries.length) grid.append(h('p', { class: 'empty' }, 'No sketches yet. Create one or import some code.'))
  for (const e of entries) grid.append(card(e))
  const hl = grid.querySelector('.hl')
  hl?.scrollIntoView({ block: 'nearest' })
}

async function render() {
  const header = h('header', {},
    h('h1', {}, 'Hydra iPad'),
    h('div', { class: 'row wrap' },
      h('button', { type: 'button', class: 'primary', onclick: () => void newSketch() }, 'New'),
      h('button', { type: 'button', onclick: importDialog }, 'Import…'),
      h('button', { type: 'button', onclick: () => void backup() }, 'Backup everything'),
      h('button', { type: 'button', onclick: restoreDialog }, 'Restore…'),
      h('button', { type: 'button', 'data-role': 'open-plugins', onclick: () => void openPluginSheet({ title: 'Plugins on this device' }) }, 'Plugins…'),
      h('button', { type: 'button', onclick: () => void aboutDialog() }, 'Storage & about'),
    ),
  )
  const storage = h('p', { class: 'dim storage' })
  const grid = h('main', { class: 'grid' })
  const footer = h('footer', {})
  const commit = typeof __COMMIT__ === 'string' && __COMMIT__ ? __COMMIT__.slice(0, 7) : ''
  const branch = typeof __BRANCH__ === 'string' && __BRANCH__ ? __BRANCH__ : ''
  mountAbout(footer, { build: [branch && `branch ${branch}`, commit && `commit ${commit}`].filter(Boolean).join(' · ') || 'local build' })
  root.append(header, storage, grid, footer)
  lib.storageInfo().then((i) => (storage.textContent = i.note)).catch(() => {})
  document.addEventListener('pointerdown', (ev) => {
    if (!(ev.target as HTMLElement).closest('.card .menu, .card button')) document.querySelectorAll('.card .menu').forEach((m) => ((m as HTMLElement).hidden = true))
  })
  await lib.seedIfEmpty()
  void lib.persist()
  await refresh()
}

// ------------------------------------------------------------------ boot

lib.subscribe(() => void refresh())
window.addEventListener('hashchange', () => { highlight = parseRoute(location.hash).sketchId; renderGrid() })
loadAppsManifest(new URL('apps.json', rootUrl).href).then((m) => {
  if (m?.apps) {
    apps = m.apps
    renderGrid()
  }
})
void render()
mountUpdateToast()

if ('serviceWorker' in navigator && import.meta.env.PROD && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('service worker registration failed', e))
}
