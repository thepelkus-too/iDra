import { getLibrary, type Library } from './library'
import type { Sketch } from './ir'
import { h, injectStyles, TOKENS_CSS } from './ui'

// Editors live under one origin and one service-worker scope, so switching between them is plain link navigation
// (`../<app>/#/s/<sketchId>`): an installed iPad web app stays inside its scope instead of opening a browser bar.

export interface AppInfo {
  name: string
  title: string
  description?: string
  /** path relative to the site root, e.g. `graph/` */
  path: string
}
export interface AppsManifest {
  generated?: string
  commit?: string | null
  branch?: string | null
  apps: AppInfo[]
}

export interface Route {
  sketchId?: string
}

/** `#/s/<id>` → {sketchId}. Anything else → {}. */
export function parseRoute(hash: string): Route {
  const m = /^#?\/s\/([^/?#]+)/.exec(hash || '')
  return m ? { sketchId: decodeURIComponent(m[1]) } : {}
}
export function routeHash(sketchId?: string): string {
  return sketchId ? `#/s/${encodeURIComponent(sketchId)}` : '#/'
}

const CSS = `
${TOKENS_CSS}
.hi-switch{position:relative;display:inline-block;font:14px/1.2 system-ui,-apple-system,sans-serif}
.hi-switch>button{min-height:40px;min-width:44px;padding:0 12px;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-panel);color:var(--hi-text);font:inherit;touch-action:manipulation}
.hi-switch .menu{position:absolute;z-index:1000;top:calc(100% + 6px);left:0;min-width:200px;background:var(--hi-panel);color:var(--hi-text);border:1px solid var(--hi-line);border-radius:12px;padding:6px;box-shadow:0 8px 28px rgba(0,0,0,.35);display:none}
.hi-switch.open .menu{display:block}
.hi-switch .menu a{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:0 12px;border-radius:8px;color:inherit;text-decoration:none}
.hi-switch .menu a:hover,.hi-switch .menu a:focus-visible{background:var(--hi-bg)}
.hi-switch .menu a[aria-current=page]{color:var(--hi-accent);font-weight:600}
.hi-switch .menu small{color:var(--hi-dim)}
.hi-switch .menu hr{border:0;border-top:1px solid var(--hi-line);margin:4px 6px}
.hi-switch .menu button.tool{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:44px;padding:0 12px;border:0;border-radius:8px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.hi-switch .menu button.tool:hover,.hi-switch .menu button.tool:focus-visible{background:var(--hi-bg)}
`

export interface SwitcherOptions {
  /** name of the current app (matches `apps.json`), or 'shell' */
  current: string
  sketchId?: string
  library?: Library
  /** where apps.json lives; default: the site root inferred from this app's location */
  manifestUrl?: string
  /** fallback list when apps.json is not available (dev servers) */
  apps?: AppInfo[]
  /** called instead of navigating (tests) */
  navigate?: (url: string) => void
  /** show "Plugins…" and "MIDI controller…" in the menu (default true) */
  tools?: boolean
  /**
   * How the Plugins sheet reads and writes the open sketch. Without it the sheet edits the library copy of `sketchId`
   * and reloads the page on close if the plugin list changed (so the editor picks it up).
   */
  sketchAccess?: { get(): Sketch | Promise<Sketch>; set(sketch: Sketch): void | Promise<void> }
  /** more tools for the menu, after Plugins and MIDI (the kit's "Pads"); shown even with `tools: false` */
  extraTools?: Array<{ label: string; small?: string; key: string; run: () => void }>
}

export interface SwitcherHandle {
  element: HTMLElement
  refresh(sketchId?: string): void
  destroy(): void
}

/** Where the site root is, given where we are. Shell: here. Any app under `<root>/<name>/`: one level up. */
export function siteRoot(current: string, base: string = typeof location !== 'undefined' ? location.href : 'http://localhost/'): URL {
  return new URL(current === 'shell' ? './' : '../', base)
}

export async function loadAppsManifest(url: string): Promise<AppsManifest | undefined> {
  try {
    const r = await fetch(url, { cache: 'no-cache' })
    if (!r.ok) return undefined
    return (await r.json()) as AppsManifest
  } catch {
    return undefined
  }
}

export function mountSwitcher(el: HTMLElement, opts: SwitcherOptions): SwitcherHandle {
  injectStyles('switcher', CSS)
  const lib = opts.library ?? getLibrary()
  const root = siteRoot(opts.current)
  let sketchId = opts.sketchId
  let apps: AppInfo[] = opts.apps ?? []
  const menu = h('div', { class: 'menu', role: 'menu' })
  const button = h('button', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, `⇄ ${opts.current}`)
  const wrap = h('div', { class: 'hi-switch' }, button, menu)
  el.appendChild(wrap)

  const go = async (url: string) => {
    try {
      await lib.flush()
    } catch {
      /* navigate anyway; autosave already retried */
    }
    if (opts.navigate) opts.navigate(url)
    else location.assign(url)
  }
  const link = (label: string, href: string, current: boolean, small?: string) => {
    const a = h('a', { href, role: 'menuitem', ...(current ? { 'aria-current': 'page' } : {}) }, label, small ? h('small', {}, small) : null)
    a.addEventListener('click', (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || (ev as MouseEvent).button > 0) return
      ev.preventDefault()
      wrap.classList.remove('open')
      void go(a.href)
    })
    return a
  }
  const render = () => {
    menu.textContent = ''
    menu.appendChild(link('Library', new URL(sketchId ? `./${routeHash(sketchId)}` : './', root).href, opts.current === 'shell', 'all sketches'))
    for (const app of apps) {
      const url = new URL(app.path.replace(/^\//, ''), root)
      url.hash = routeHash(sketchId)
      menu.appendChild(link(app.title || app.name, url.href, app.name === opts.current, app.description))
    }
    if (opts.tools !== false) {
      menu.appendChild(h('hr'))
      menu.appendChild(tool('Plugins…', 'add Hydra extensions', 'plugins', async () => {
        // loaded on demand: keeps the switcher light and avoids an import cycle (the sheets use siteRoot from here)
        const { openPluginSheet } = await import('./plugin-manager')
        openPluginSheet({ sketchId, sketch: opts.sketchAccess, library: lib })
      }))
      menu.appendChild(tool('MIDI controller…', 'faders, keys, pads', 'midi', async () => {
        const { openMidiSheet } = await import('./midi-panel')
        openMidiSheet()
      }))
    }
    if (opts.extraTools?.length) {
      if (opts.tools === false) menu.appendChild(h('hr'))
      for (const t of opts.extraTools) menu.appendChild(tool(t.label, t.small ?? '', t.key, async () => t.run()))
    }
  }
  const tool = (label: string, small: string, key: string, run: () => Promise<void>) => {
    const b = h('button', { type: 'button', role: 'menuitem', class: 'tool', 'data-tool': key }, label, h('small', {}, small))
    b.addEventListener('click', () => {
      wrap.classList.remove('open')
      button.setAttribute('aria-expanded', 'false')
      run().catch((e) => console.error(e))
    })
    return b
  }
  render()
  button.addEventListener('click', () => {
    const open = wrap.classList.toggle('open')
    button.setAttribute('aria-expanded', String(open))
  })
  const onDoc = (ev: Event) => {
    if (!wrap.contains(ev.target as Node)) wrap.classList.remove('open')
  }
  document.addEventListener('pointerdown', onDoc)

  void (async () => {
    const m = await loadAppsManifest(opts.manifestUrl ?? new URL('apps.json', root).href)
    if (m?.apps?.length) {
      apps = m.apps
      render()
    }
  })()

  return {
    element: wrap,
    refresh(id) {
      sketchId = id
      render()
    },
    destroy() {
      document.removeEventListener('pointerdown', onDoc)
      wrap.remove()
    },
  }
}
