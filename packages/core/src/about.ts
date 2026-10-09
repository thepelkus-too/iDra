import { h, injectStyles, TOKENS_CSS } from './ui'

// AGPL-3.0 §13: users interacting with a hosted copy over a network must be offered the source.
// Every app (and the shell) shows this link. The URL comes from the root package.json `repository` field,
// injected at build time as `__REPO_URL__` (see apps' vite config) or passed explicitly.

export const LICENSE_NAME = 'AGPL-3.0'

const CSS = `${TOKENS_CSS}
.hi-about{font:12px/1.3 system-ui,-apple-system,sans-serif;color:var(--hi-dim)}
.hi-about a{color:var(--hi-accent);text-decoration:underline;padding:10px 4px;display:inline-block;min-height:24px}
`

declare const __REPO_URL__: string | undefined

export function repoUrl(explicit?: string): string {
  if (explicit) return explicit
  try {
    if (typeof __REPO_URL__ !== 'undefined' && __REPO_URL__) return __REPO_URL__
  } catch {
    /* not defined */
  }
  return 'https://github.com/thepelkus-too/iDra'
}

export interface AboutOptions {
  repo?: string
  /** extra text such as "branch main · abc1234" */
  build?: string
}

/** Small "About / Source · AGPL-3.0" footer. Required on every page that serves the app. */
export function mountAbout(el: HTMLElement, opts: AboutOptions = {}): HTMLElement {
  injectStyles('about', CSS)
  const url = repoUrl(opts.repo)
  const node = h(
    'div',
    { class: 'hi-about' },
    h('a', { href: url, target: '_blank', rel: 'noopener' }, 'About / Source'),
    ` · ${LICENSE_NAME}`,
    opts.build ? ` · ${opts.build}` : '',
  )
  el.appendChild(node)
  return node
}
