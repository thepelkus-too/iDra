// Renders the repository's docs (README.md and every .md under docs/, subfolders included) to static pages in <out>/docs/, so they can be read inside
// the app and, because scripts/build-all.mjs precaches everything in dist/, offline.
//   node scripts/build-docs.mjs [outDir=dist]
// Links between docs are rewritten to the rendered pages; links to other repository files go to GitHub.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { escapeHtml, render } from './lib/markdown.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'https://github.com/thepelkus-too/iDra/blob/main/'

/** repository-relative path → page file name (flat, so every page shares one folder: docs/guides/a.md → guides-a.html) */
const pageFor = (rel) => (rel === 'README.md' ? 'readme.html' : rel.replace(/^docs\//, '').replace(/\.md$/, '').replace(/\//g, '-').toLowerCase() + '.html')

/** README.md plus every .md under docs/, at any depth, in path order */
export function docSources(root = repoRoot) {
  const walk = (dir) =>
    readdirSync(join(root, dir))
      .sort()
      .flatMap((f) => {
        const rel = `${dir}/${f}`
        if (f.startsWith('.')) return []
        if (statSync(join(root, rel)).isDirectory()) return walk(rel)
        return f.endsWith('.md') ? [rel] : []
      })
  const top = walk('docs')
  return ['README.md', ...top.filter((r) => r.split('/').length === 2), ...top.filter((r) => r.split('/').length > 2)]
}

export function buildDocs(outDir = join(repoRoot, 'dist'), root = repoRoot) {
  const sources = docSources(root)
  const pageNames = new Map()
  for (const rel of sources) {
    const page = pageFor(rel)
    if (pageNames.has(page)) throw new Error(`docs: ${rel} and ${pageNames.get(page)} would both render to ${page}; rename one`)
    pageNames.set(page, rel)
  }
  const known = new Set(sources)
  const out = join(outDir, 'docs')
  mkdirSync(out, { recursive: true })
  const pages = []
  for (const rel of sources) {
    const link = (href) => {
      if (/^[a-z]+:|^#/i.test(href)) return href
      const [path, hash = ''] = href.split('#')
      const target = posix.normalize(posix.join(posix.dirname(rel), path))
      if (known.has(target)) return pageFor(target) + (hash ? '#' + hash : '')
      return REPO + target + (hash ? '#' + hash : '')
    }
    const { html, title } = render(readFileSync(join(root, rel), 'utf8'), { link })
    const page = pageFor(rel)
    pages.push({ rel, page, title: title || rel })
    writeFileSync(join(out, page), layout(title || rel, html, rel))
  }
  const list = pages
    .map((p) => `<li><a href="${p.page}"><strong>${escapeHtml(p.title)}</strong><small>${escapeHtml(p.rel)}</small></a></li>`)
    .join('\n')
  writeFileSync(join(out, 'index.html'), layout('Docs', `<h1>Docs</h1><p class="dim">The repository's documentation, saved with the app so it reads offline.</p><ul class="toc">${list}</ul>`, null))
  return pages
}

// the app's palette and light/dark switch (packages/core/src/ui.ts)
const CSS = `
:root{color-scheme:dark light;--bg:#14161a;--panel:#1d2026;--line:#2f3540;--text:#e8eaee;--dim:#9aa3b2;--accent:#5ac8c8;--nav:rgba(20,22,26,.92)}
@media (prefers-color-scheme: light){:root{--bg:#f4f5f7;--panel:#fff;--line:#d5d9e0;--text:#1b1e24;--dim:#5d6676;--accent:#127a7a;--nav:rgba(244,245,247,.92)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
nav{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;padding:calc(8px + env(safe-area-inset-top)) 16px 8px;background:var(--nav);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--text);text-decoration:none}
nav .src{margin-left:auto;border:0;background:none;color:var(--dim);font-size:13px}
main{max-width:860px;margin:0 auto;padding:16px 16px calc(48px + env(safe-area-inset-bottom));overflow-wrap:anywhere}
a{color:var(--accent)}
h1{font-size:28px;line-height:1.25}h2{font-size:22px;margin-top:2em;padding-bottom:4px;border-bottom:1px solid var(--line)}h3{font-size:18px;margin-top:1.6em}
code{font:14px/1.5 ui-monospace,Menlo,monospace;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:1px 5px}
pre{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;overflow-x:auto;-webkit-overflow-scrolling:touch}
pre code{background:none;border:0;padding:0;font-size:13px;white-space:pre}
.table{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:1em 0}
table{border-collapse:collapse;font-size:14px;min-width:100%}
th,td{border:1px solid var(--line);padding:6px 10px;vertical-align:top;text-align:left}
th{background:var(--panel)}
blockquote{margin:1em 0;padding:4px 14px;border-left:3px solid var(--accent);color:var(--dim)}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}
li{margin:4px 0}
.dim{color:var(--dim)}
.toc{list-style:none;padding:0;display:grid;gap:10px}
.toc a{display:grid;gap:2px;padding:12px 14px;min-height:44px;border-radius:12px;border:1px solid var(--line);background:var(--panel);text-decoration:none;color:var(--text)}
.toc small{color:var(--dim);font-size:13px}
`

const layout = (title, body, rel) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0d1117">
<title>${escapeHtml(title)} · Hydra iPad docs</title>
<link rel="icon" href="../icons/icon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>
<nav><a href="../">← Library</a>${rel ? '<a href="./">All docs</a>' : ''}${rel ? `<a class="src" href="${REPO}${rel}" rel="noopener" target="_blank">${escapeHtml(rel)}</a>` : ''}</nav>
<main>
${body}
</main>
</body>
</html>
`

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pages = buildDocs(process.argv[2] ? resolve(process.argv[2]) : undefined)
  console.log(`✓ docs: ${pages.length} pages`)
}
