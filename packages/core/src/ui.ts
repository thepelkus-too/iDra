// Tiny DOM helpers shared by core's vanilla UI pieces (switcher, audio panel, diagnostics). No framework.

type Attrs = Record<string, unknown> & { class?: string; style?: string }

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Array<Node | string | null | undefined | false>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = String(v)
    else if (k === 'style') el.setAttribute('style', String(v))
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else if (k in el && k !== 'list') (el as any)[k] = v
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}

const injected = new Set<string>()
export function injectStyles(id: string, css: string): void {
  if (injected.has(id) || typeof document === 'undefined') return
  injected.add(id)
  const s = document.createElement('style')
  s.dataset.hydraUi = id
  s.textContent = css
  document.head.appendChild(s)
}

/** Design tokens used by core's widgets; apps may override the custom properties. */
export const TOKENS_CSS = `
:root{--hi-bg:#14161a;--hi-panel:#1d2026;--hi-line:#2f3540;--hi-text:#e8eaee;--hi-dim:#9aa3b2;--hi-accent:#5ac8c8;--hi-warn:#e6a23c;--hi-bad:#e5645f;--hi-r:10px}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--hi-bg:#f4f5f7;--hi-panel:#fff;--hi-line:#d5d9e0;--hi-text:#1b1e24;--hi-dim:#5d6676;--hi-accent:#127a7a;--hi-warn:#9a6200;--hi-bad:#b3261e}}
:root[data-theme="light"]{--hi-bg:#f4f5f7;--hi-panel:#fff;--hi-line:#d5d9e0;--hi-text:#1b1e24;--hi-dim:#5d6676;--hi-accent:#127a7a;--hi-warn:#9a6200;--hi-bad:#b3261e}
`

/** Baseline page rules every app wants on an iPad: no tap delay, no pinch-zoom, safe areas, no rubber-banding. */
export const APP_BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--hi-bg);color:var(--hi-text);font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{touch-action:manipulation;-webkit-tap-highlight-color:transparent;overscroll-behavior:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
button,input,select,textarea{font:inherit;color:inherit}
button{touch-action:manipulation;-webkit-touch-callout:none}
a{color:var(--hi-accent)}
`
export function applyAppBase(): void {
  injectStyles('tokens', TOKENS_CSS)
  injectStyles('app-base', APP_BASE_CSS)
}
