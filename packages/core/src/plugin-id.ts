// Tiny, dependency-free helpers shared by the host and the sandboxed frame bundle (keep it that way: the frame stays small).

/** A stable plugin id from a script URL: `…/npm/hydra-midi@0.4.6/dist/index.js` → `hydra-midi`, `…/hydra-blend.js` → `hydra-blend`. */
export function pluginIdFromUrl(url: string): string {
  let path = url
  let host = ''
  try {
    const u = new URL(url, 'https://x.invalid/')
    path = u.pathname
    host = u.host
  } catch {
    /* keep the raw string */
  }
  const parts = path.split('/').filter(Boolean)
  // npm packages on jsDelivr (/npm/<pkg>) and unpkg / esm.sh (/<pkg>): the package name (with scope) is the id
  const npm = /^(unpkg\.com|esm\.sh)$/i.test(host) ? -1 : parts.indexOf('npm')
  let id = ''
  if ((npm >= 0 || /^(unpkg\.com|esm\.sh)$/i.test(host)) && parts[npm + 1]) {
    const scoped = parts[npm + 1].startsWith('@') && parts[npm + 2]
    const noVersion = (x: string) => x.replace(/(.)@.*$/, '$1')
    id = scoped ? `${parts[npm + 1]}-${noVersion(parts[npm + 2])}` : noVersion(parts[npm + 1])
  } else if (/^(index|main|dist|bundle|plugin)(\.min)?\.m?js$/i.test(parts[parts.length - 1] ?? '') && parts.length > 1) {
    // `<name>[@version]/dist/index.js`: the nearest directory that is not a build folder names it
    const dirs = parts.slice(0, -1).filter((d) => !/^(dist|build|lib|src|umd|esm|cjs|min)$/i.test(d))
    id = (dirs[dirs.length - 1] ?? parts[parts.length - 2]).replace(/(.)@.*$/, '$1')
  } else {
    id = (parts[parts.length - 1] ?? 'plugin').replace(/(\.min)?\.m?js$/i, '')
  }
  return id.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin'
}

const LOAD_RE = /\bloadScript\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g

/** URLs passed to `loadScript('<url>')` in a piece of code. */
export function loadScriptUrls(code: string): string[] {
  return [...code.matchAll(LOAD_RE)].map((m) => m[2])
}
