// Shared Vite setup for every app in this monorepo.
//   // apps/<name>/vite.config.mjs
//   import { hydraApp } from '@hydra-ipad/core/vite'
//   export default hydraApp(import.meta.url)
// It builds with base './' (so the app works at any path under the shared origin), copies the sandboxed-frame bundle next to the
// page as hydra-frame.js, and injects __REPO_URL__ / __COMMIT__ / __BRANCH__ (used by the About link and build info).
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const framePath = resolve(here, 'dist-frame/hydra-frame.js')

export function repoUrlFrom(startDir) {
  let dir = startDir
  for (let i = 0; i < 6; i++) {
    const p = resolve(dir, 'package.json')
    if (existsSync(p)) {
      const pkg = JSON.parse(readFileSync(p, 'utf8'))
      if (pkg.repository) {
        const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url
        return String(url).replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://')
      }
    }
    dir = dirname(dir)
  }
  return 'https://github.com/thepelkus-too/iDra'
}

export function hydraFrame() {
  const load = () => {
    if (!existsSync(framePath)) throw new Error('hydra-frame.js is missing: run `npm run build:frame` first (build:all and dev do this for you)')
    return readFileSync(framePath)
  }
  return {
    name: 'hydra-frame',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url || '').split('?')[0].endsWith('/hydra-frame.js')) {
          res.setHeader('content-type', 'text/javascript')
          res.end(load())
        } else next()
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'hydra-frame.js', source: load() })
    },
  }
}

// Dev server only: serve hydra-motion's built file at the site paths build-all.mjs copies it to (plugins/…), so the
// registry's site-relative URL works under `vite dev` too.
export function hydraMotionDev() {
  let file
  try {
    const req = createRequire(resolve(here, 'package.json'))
    const dir = dirname(req.resolve('hydra-motion/package.json'))
    file = resolve(dir, JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')).main)
  } catch {
    file = undefined
  }
  return {
    name: 'hydra-motion-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (file && /\/plugins\/hydra-motion(@[^/]+\/hydra-motion)?\.js$/.test((req.url || '').split('?')[0])) {
          res.setHeader('content-type', 'text/javascript')
          res.end(readFileSync(file))
        } else next()
      })
    },
  }
}

export function hydraApp(metaUrl, extra = {}) {
  const root = dirname(fileURLToPath(metaUrl))
  const env = process.env
  const commit = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || ''
  const branch = env.VERCEL_GIT_COMMIT_REF || env.GITHUB_REF_NAME || ''
  const { plugins = [], define = {}, build = {}, server = {}, ...rest } = extra
  return {
    root,
    base: './',
    plugins: [hydraFrame(), hydraMotionDev(), ...plugins],
    define: {
      // where the site root is relative to this app (the shell is the root; every other app is in <root>/<name>/)
      __SITE_ROOT__: JSON.stringify(basename(root) === 'shell' ? './' : '../'),
      __REPO_URL__: JSON.stringify(repoUrlFrom(root)),
      __COMMIT__: JSON.stringify(commit),
      __BRANCH__: JSON.stringify(branch),
      ...define,
    },
    build: { outDir: 'dist', emptyOutDir: true, target: ['es2020', 'safari14'], sourcemap: false, ...build },
    server: { host: true, ...server },
    ...rest,
  }
}
