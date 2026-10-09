// Plugin manager UI: add by URL / pasted code / the curated list, see URL + size + version + SHA-256 before installing,
// see what each plugin added, enable plugins per sketch. Used full-size by the shell and as a sheet in every editor
// (openPluginSheet, reachable from the switcher menu). Plugin code runs only in a sandboxed runtime frame.

import { Catalog } from './catalog'
import { getLibrary, type Library } from './library'
import type { PluginRef, Sketch } from './ir'
import {
  findLoadScripts,
  getPluginStore,
  pluginRefFor,
  pluginRefFromUrl,
  pluginRegistry,
  withPlugin,
  withoutPlugin,
  type InstalledPlugin,
  type PluginPreview,
  type PluginStore,
} from './plugins'
import { createRuntime } from './runtime/host'
import { h, injectStyles, TOKENS_CSS } from './ui'

const CSS = `
${TOKENS_CSS}
.hi-plugins{font:13px/1.4 system-ui,-apple-system,sans-serif;color:var(--hi-text);display:grid;gap:12px;max-width:760px}
.hi-plugins h3{margin:4px 0 0;font-size:14px}
.hi-plugins .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.hi-plugins input[type=url],.hi-plugins input[type=text],.hi-plugins textarea,.hi-plugins select{min-height:40px;padding:0 10px;border-radius:8px;border:1px solid var(--hi-line);background:var(--hi-bg);color:var(--hi-text);font:inherit;min-width:0}
.hi-plugins input[type=url]{flex:1}
.hi-plugins textarea{width:100%;min-height:110px;padding:8px;font:12px ui-monospace,Menlo,monospace;box-sizing:border-box}
.hi-plugins button{min-height:40px;padding:0 12px;border-radius:8px;border:1px solid var(--hi-line);background:var(--hi-panel);color:var(--hi-text);font:inherit;touch-action:manipulation}
.hi-plugins button.primary{background:var(--hi-accent);color:#042;border-color:transparent;font-weight:600}
.hi-plugins button.danger{color:var(--hi-bad)}
.hi-plugins .card{border:1px solid var(--hi-line);border-radius:12px;padding:10px 12px;background:var(--hi-panel);display:grid;gap:6px}
.hi-plugins .card.preview{border-color:var(--hi-warn)}
.hi-plugins .dim{color:var(--hi-dim)}
.hi-plugins .warn{color:var(--hi-warn)}
.hi-plugins .bad{color:var(--hi-bad)}
.hi-plugins .url{font:12px ui-monospace,Menlo,monospace;word-break:break-all;-webkit-user-select:text;user-select:text}
.hi-plugins .hash{font:11px ui-monospace,Menlo,monospace;color:var(--hi-dim);word-break:break-all;-webkit-user-select:text;user-select:text}
.hi-plugins .badge{display:inline-block;border:1px solid var(--hi-line);border-radius:999px;padding:0 8px;font-size:11px;color:var(--hi-dim)}
.hi-plugins .badge.ok{color:var(--hi-accent);border-color:var(--hi-accent)}
.hi-plugins .badge.no{color:var(--hi-warn);border-color:var(--hi-warn)}
.hi-plugins .chips{display:flex;flex-wrap:wrap;gap:4px}
.hi-plugins .chips code{background:var(--hi-bg);border-radius:6px;padding:1px 6px;font-size:12px}
.hi-plugins details summary{cursor:pointer;min-height:36px;display:flex;align-items:center}
.hi-plugin-sheet{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;padding:env(safe-area-inset-top) 0 0}
.hi-plugin-sheet>.box{background:var(--hi-bg);color:var(--hi-text);width:min(100%,820px);max-height:92vh;overflow:auto;-webkit-overflow-scrolling:touch;border-radius:16px 16px 0 0;padding:14px 16px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.4)}
.hi-plugin-sheet .head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.hi-plugin-sheet .head h2{margin:0;font:600 17px system-ui,-apple-system,sans-serif;flex:1}
.hi-plugin-sheet .head button{min-height:40px;min-width:44px;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-panel);color:var(--hi-text);font:inherit}
`

/** Read/write the sketch whose plugins the manager edits. */
export interface SketchAccess {
  get(): Sketch | Promise<Sketch>
  set(sketch: Sketch): void | Promise<void>
}

export interface PluginProbeResult {
  ok: boolean
  functions: string[]
  globals: string[]
  shadows: string[]
  error?: string
}

/**
 * Load a plugin in a throwaway, hidden sandboxed runtime (with its own catalog) to see what it adds, without touching
 * this page's catalog. Needs `hydra-frame.js` next to the page (every app has it).
 */
export async function probePlugin(ref: PluginRef, opts: { timeoutMs?: number } = {}): Promise<PluginProbeResult> {
  const host = h('div', { 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0;width:64px;height:64px;overflow:hidden;opacity:0;pointer-events:none' })
  document.body.appendChild(host)
  const cat = Catalog.fromHydra()
  const rt = createRuntime(host, { width: 64, height: 64, catalog: cat, allowCamera: false, requestTimeoutMs: opts.timeoutMs ?? 15000 })
  try {
    await rt.ready
    const r = await rt.loadPlugin(ref)
    return { ok: r.ok, functions: r.delta.map((d) => d.name), globals: r.globals ?? [], shadows: r.shadows ?? [], error: r.error }
  } catch (e) {
    return { ok: false, functions: [], globals: [], shadows: [], error: (e as Error).message }
  } finally {
    rt.dispose()
    host.remove()
  }
}

export interface PluginManagerOptions {
  store?: PluginStore
  /** enables "use in this sketch" toggles and the sketch's own loadScript lines */
  sketch?: SketchAccess
  /** how to inspect a plugin after install (default: probePlugin in a hidden sandboxed frame) */
  probe?: (ref: PluginRef) => Promise<PluginProbeResult>
  /** called after the sketch's plugin list changed */
  onSketchChange?: (sketch: Sketch) => void
}

export interface PluginManagerHandle {
  element: HTMLElement
  refresh(): Promise<void>
  destroy(): void
}

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1048576).toFixed(2)} MB`)

export function mountPluginManager(el: HTMLElement, opts: PluginManagerOptions = {}): PluginManagerHandle {
  injectStyles('plugin-manager', CSS)
  const store = opts.store ?? getPluginStore()
  const probe = opts.probe ?? probePlugin
  const root = h('div', { class: 'hi-plugins', 'data-role': 'plugin-manager' })
  el.appendChild(root)

  const urlInput = h('input', { type: 'url', placeholder: 'https://cdn.jsdelivr.net/npm/…/index.js', 'aria-label': 'Plugin URL', 'data-role': 'plugin-url', autocapitalize: 'off', autocomplete: 'off', spellcheck: false }) as HTMLInputElement
  const fetchBtn = h('button', { 'data-role': 'plugin-fetch' }, 'Fetch')
  const regSel = h('select', { 'aria-label': 'Known plugins', 'data-role': 'plugin-registry' }, h('option', { value: '' }, 'Known plugins…'),
    ...pluginRegistry().map((e) => h('option', { value: e.url }, `${e.name}${e.verified.status === 'verified' ? '' : ' (URL unverified)'}`))) as HTMLSelectElement
  const pasteName = h('input', { type: 'text', placeholder: 'Name', 'aria-label': 'Plugin name', 'data-role': 'paste-name' }) as HTMLInputElement
  const pasteText = h('textarea', { placeholder: 'Paste the plugin’s JavaScript here', 'aria-label': 'Plugin source', 'data-role': 'paste-src', spellcheck: false }) as HTMLTextAreaElement
  const pasteBtn = h('button', { 'data-role': 'paste-preview' }, 'Preview')
  const msg = h('div', { class: 'dim', 'data-role': 'plugin-msg', 'aria-live': 'polite' })
  const previewBox = h('div', {})
  const sketchBox = h('div', {})
  const list = h('div', { style: 'display:grid;gap:8px', 'data-role': 'plugin-list' })

  root.append(
    h('div', { class: 'dim' }, 'Plugins are other people’s code. They run only inside the sandboxed preview, never in this page, and you see the source URL and a hash before installing. Installed plugins are cached on this device so sketches keep working offline.'),
    h('h3', {}, 'Add a plugin'),
    h('div', { class: 'row' }, urlInput, fetchBtn),
    h('div', { class: 'row' }, regSel),
    h('details', {}, h('summary', {}, 'Paste code instead'), h('div', { style: 'display:grid;gap:6px' }, pasteName, pasteText, h('div', { class: 'row' }, pasteBtn))),
    msg,
    previewBox,
    sketchBox,
    h('h3', {}, 'Installed'),
    list,
  )

  let pending: PluginPreview | undefined
  const say = (text: string, cls = 'dim') => {
    msg.className = cls
    msg.textContent = text
  }

  // ---- preview → install
  const showPreview = () => {
    previewBox.textContent = ''
    const p = pending
    if (!p) return
    const reg = p.registry
    const card = h('div', { class: 'card preview', 'data-role': 'plugin-preview' },
      h('div', { class: 'row' }, h('strong', {}, p.name), p.version ? h('span', { class: 'badge' }, p.version) : null,
        h('span', { class: 'badge ' + (p.pinned ? 'ok' : 'no') }, p.pinned ? (p.from === 'pasted' ? 'pasted code' : 'pinned version') : 'not pinned'),
        reg ? h('span', { class: 'badge ' + (reg.verified.status === 'verified' ? 'ok' : 'no'), title: reg.verified.how }, reg.verified.status === 'verified' ? 'URL from README' : 'URL unverified') : null),
      p.url ? h('div', { class: 'url', 'data-role': 'preview-url' }, p.url) : h('div', { class: 'dim' }, 'Pasted code'),
      h('div', { class: 'dim' }, `${fmtSize(p.size)} · ${p.from === 'network' ? 'downloaded now' : p.from === 'cache' ? 'from this device’s cache' : 'pasted'}${reg ? ` · ${reg.license} · ${reg.author}` : ''}`),
      p.hash ? h('div', { class: 'hash', 'data-role': 'preview-hash' }, `SHA-256 ${p.hash}`) : null,
      reg ? h('div', { class: 'dim' }, reg.description) : null,
      !p.pinned ? h('div', { class: 'warn' }, 'This URL is not pinned to a version: it is re-downloaded when online, and what it does may change.') : null,
      reg && reg.verified.status !== 'verified' ? h('div', { class: 'warn' }, `URL not confirmed: ${reg.verified.how}`) : null,
      h('div', { class: 'row' },
        h('button', { class: 'primary', 'data-role': 'plugin-install', onclick: () => void install(false) }, 'Install'),
        opts.sketch ? h('button', { 'data-role': 'plugin-install-enable', onclick: () => void install(true) }, 'Install and use in this sketch') : null,
        h('button', { onclick: () => { pending = undefined; showPreview() } }, 'Cancel'),
      ),
    )
    previewBox.append(card)
  }
  const fetchUrl = async (url: string) => {
    if (!url.trim()) return
    say('Fetching…')
    try {
      pending = await store.preview(url)
      say('')
      showPreview()
    } catch (e) {
      pending = undefined
      showPreview()
      say(`Could not fetch it: ${(e as Error).message}`, 'bad')
    }
  }
  fetchBtn.addEventListener('click', () => void fetchUrl(urlInput.value))
  urlInput.addEventListener('keydown', (e) => e.key === 'Enter' && void fetchUrl(urlInput.value))
  regSel.addEventListener('change', () => {
    if (!regSel.value) return
    urlInput.value = regSel.value
    void fetchUrl(regSel.value)
    regSel.value = ''
  })
  pasteBtn.addEventListener('click', async () => {
    if (!pasteText.value.trim()) return say('Paste some code first.', 'warn')
    pending = await store.previewSource(pasteText.value, pasteName.value || 'pasted plugin')
    showPreview()
  })

  const inspect = async (p: InstalledPlugin) => {
    say(`Loading ${p.name} in a sandboxed frame to see what it adds…`)
    const r = await probe(pluginRefFor(p))
    await store.record(p.id, { functions: r.functions, globals: r.globals, shadows: r.shadows, error: r.ok ? undefined : r.error })
    say(r.ok ? `${p.name}: ${r.functions.length} function(s)${r.globals.length ? `, ${r.globals.length} global(s)` : ''}.` : `${p.name} did not load: ${r.error}`, r.ok ? 'dim' : 'bad')
    await render()
  }
  const install = async (enable: boolean) => {
    const p = pending
    if (!p) return
    const rec = await store.install(p)
    pending = undefined
    showPreview()
    if (enable) await setEnabled(rec, true)
    await inspect(rec)
  }

  // ---- per-sketch
  const setEnabled = async (p: InstalledPlugin, on: boolean) => {
    if (!opts.sketch) return
    const sk = await opts.sketch.get()
    const next = on ? withPlugin(sk, pluginRefFor(p)) : withoutPlugin(sk, p.id)
    await opts.sketch.set(next)
    opts.onSketchChange?.(next)
    await render()
  }
  const renderSketch = async () => {
    sketchBox.textContent = ''
    if (!opts.sketch) return
    const sk = await opts.sketch.get()
    const refs = sk.plugins ?? []
    const lines = findLoadScripts(sk).filter((l) => !l.inPlugins)
    const box = h('div', { class: 'card', 'data-role': 'sketch-plugins' }, h('strong', {}, `In “${sk.name}”`))
    if (!refs.length) box.append(h('div', { class: 'dim' }, 'This sketch uses no plugins from the manager.'))
    for (const r of refs) box.append(h('div', { class: 'row' }, h('code', {}, r.name), r.url ? h('span', { class: 'url' }, r.url) : h('span', { class: 'dim' }, 'pasted code'),
      h('button', { onclick: async () => { const s = await opts.sketch!.get(); const n = withoutPlugin(s, r.id); await opts.sketch!.set(n); opts.onSketchChange?.(n); await render() } }, 'Remove')))
    for (const l of lines) {
      box.append(h('div', { class: 'row', 'data-role': 'loadscript-line' },
        h('span', { class: 'dim' }, 'Loads'), h('span', { class: 'url' }, l.url),
        h('button', { 'data-role': 'add-to-plugins', onclick: async () => {
          // keep the line as it is; the plugin entry makes it cached (offline) and listed
          const s = await opts.sketch!.get()
          const ref = pluginRefFromUrl(l.url)
          const n = withPlugin(s, ref)
          await opts.sketch!.set(n)
          opts.onSketchChange?.(n)
          try {
            const prev = await store.preview(l.url)
            if (!(await store.get(prev.id))) await store.install(prev)
          } catch (e) {
            say(`Added, but it could not be fetched now: ${(e as Error).message}`, 'warn')
          }
          await render()
        } }, 'Add to plugins'),
      ))
    }
    sketchBox.append(box)
  }

  // ---- installed list
  const card = (p: InstalledPlugin, enabled: boolean | undefined) => {
    const fns = p.functions ?? []
    const globals = p.globals ?? []
    return h('div', { class: 'card', 'data-plugin': p.id },
      h('div', { class: 'row' }, h('strong', {}, p.name), p.version ? h('span', { class: 'badge' }, p.version) : null,
        h('span', { class: 'badge ' + (p.pinned ? 'ok' : 'no') }, p.src !== undefined ? 'pasted' : p.pinned ? 'pinned' : 'not pinned'),
        p.verified ? h('span', { class: 'badge ' + (p.verified === 'verified' ? 'ok' : 'no') }, p.verified === 'verified' ? 'URL from README' : 'URL unverified') : null,
        enabled ? h('span', { class: 'badge ok' }, 'in this sketch') : null),
      p.url ? h('div', { class: 'url' }, p.url) : null,
      h('div', { class: 'dim' }, `${fmtSize(p.size)}${p.loadedAt ? ` · last loaded ${new Date(p.loadedAt).toLocaleString()}` : ''}`),
      p.hash ? h('div', { class: 'hash' }, `SHA-256 ${p.hash}`) : null,
      fns.length ? h('div', { class: 'chips', 'data-role': 'plugin-functions' }, h('span', { class: 'dim' }, 'functions:'), ...fns.map((f) => h('code', {}, f))) : null,
      globals.length ? h('div', { class: 'chips' }, h('span', { class: 'dim' }, 'globals:'), ...globals.map((f) => h('code', {}, f))) : null,
      !fns.length && !globals.length && !p.lastError ? h('div', { class: 'dim' }, p.loadedAt ? 'Added no functions or globals.' : 'Not inspected yet.') : null,
      p.shadows?.length ? h('div', { class: 'warn' }, `Replaces existing: ${p.shadows.join(', ')}`) : null,
      p.lastError ? h('div', { class: 'bad' }, `Last load failed: ${p.lastError}`) : null,
      h('div', { class: 'row' },
        opts.sketch ? h('button', { class: enabled ? '' : 'primary', 'data-role': 'plugin-toggle', onclick: () => void setEnabled(p, !enabled) }, enabled ? 'Stop using in this sketch' : 'Use in this sketch') : null,
        h('button', { onclick: () => void inspect(p) }, 'Inspect'),
        p.url && !p.pinned ? h('button', { onclick: async () => {
          try {
            const fresh = await store.preview(p.url!, { refresh: true })
            if (fresh.hash === p.hash) say(`${p.name} is unchanged.`)
            else {
              pending = fresh
              showPreview()
              say(`${p.name} changed upstream: review the new hash and install it again.`, 'warn')
            }
          } catch (e) {
            say(`Could not check: ${(e as Error).message}`, 'bad')
          }
        } }, 'Check for changes') : null,
        h('button', { class: 'danger', onclick: async () => {
          await store.remove(p.id)
          if (p.url) await store.cache.remove(p.url)
          await render()
        } }, 'Remove'),
      ),
    )
  }
  const render = async () => {
    const [items, sk] = await Promise.all([store.list(), opts.sketch ? Promise.resolve(opts.sketch.get()) : Promise.resolve(undefined)])
    const on = new Set((sk?.plugins ?? []).map((p) => p.id))
    list.textContent = ''
    if (!items.length) list.append(h('div', { class: 'dim' }, 'No plugins installed yet.'))
    for (const p of items) list.append(card(p, sk ? on.has(p.id) : undefined))
    await renderSketch()
  }
  const unsub = store.subscribe(() => void render())
  void render()
  return {
    element: root,
    refresh: render,
    destroy() {
      unsub()
      root.remove()
    },
  }
}

export interface PluginSheetOptions extends PluginManagerOptions {
  /** the sketch to edit; with no `sketch` access the library copy is edited and the page reloads on close */
  sketchId?: string
  library?: Library
  title?: string
}

/** A bottom sheet with the plugin manager, for any editor. */
export function openPluginSheet(opts: PluginSheetOptions = {}): { close(): void; element: HTMLElement } {
  injectStyles('plugin-manager', CSS)
  const lib = opts.library ?? getLibrary()
  let changed = false
  let access = opts.sketch
  if (!access && opts.sketchId) {
    const id = opts.sketchId
    let cached: Sketch | undefined
    access = {
      async get() {
        if (cached) return cached
        await lib.flush().catch(() => {})
        const s = await lib.get(id)
        if (!s) throw new Error('sketch not found')
        return (cached = s)
      },
      async set(s) {
        cached = s
        changed = true
        await lib.put(s)
      },
    }
  }
  const box = h('div', { class: 'box' })
  const closeBtn = h('button', { type: 'button', 'aria-label': 'Close', 'data-role': 'sheet-close' }, 'Done')
  box.append(h('div', { class: 'head' }, h('h2', {}, opts.title ?? 'Plugins'), closeBtn))
  const back = h('div', { class: 'hi-plugin-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title ?? 'Plugins' }, box)
  const mgr = mountPluginManager(box, { ...opts, sketch: access })
  const close = () => {
    mgr.destroy()
    back.remove()
    // the editor holds its own copy of the sketch: reopen it so it picks up the new plugin list
    if (changed && !opts.sketch) location.reload()
  }
  closeBtn.addEventListener('click', close)
  back.addEventListener('pointerdown', (e) => e.target === back && close())
  document.body.appendChild(back)
  return { close, element: back }
}
