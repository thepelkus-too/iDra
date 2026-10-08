// Builds the whole site into dist/:
//   dist/                the shell (the only PWA: manifest + the single root-scope service worker)
//   dist/<name>/         every other apps/<name> that has a "build" script (auto-discovered)
//   dist/apps.json       the list of editors present in this build (name, title, description, path)
//   dist/sw.js           service worker with a precache list generated from the final dist/ contents,
//                        versioned by commit (VERCEL_GIT_COMMIT_SHA / GITHUB_SHA) or else a content hash
//   dist/version.json    build info shown by the shell
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const env = process.env
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env, ...opts })

rmSync(dist, { recursive: true, force: true })
console.log('› frame bundle')
sh('node', ['packages/core/scripts/build-frame.mjs'])

// ---- discover apps
const appsDir = join(root, 'apps')
const apps = readdirSync(appsDir)
  .filter((d) => existsSync(join(appsDir, d, 'package.json')))
  .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(appsDir, dir, 'package.json'), 'utf8')) }))
  .filter((a) => a.pkg.scripts && a.pkg.scripts.build)
const shell = apps.find((a) => a.dir === 'shell')
if (!shell) throw new Error('apps/shell is required: it is the installable shell')
const editors = apps.filter((a) => a.dir !== 'shell').sort((a, b) => (a.pkg.hydra?.order ?? 100) - (b.pkg.hydra?.order ?? 100) || a.dir.localeCompare(b.dir))

console.log('› shell → dist/')
sh('npm', ['run', 'build', '--workspace', shell.pkg.name])
for (const a of editors) {
  console.log(`› ${a.dir} → dist/${a.dir}/`)
  sh('npm', ['run', 'build', '--workspace', a.pkg.name])
  const out = join(appsDir, a.dir, 'dist')
  if (!existsSync(out)) throw new Error(`apps/${a.dir} built no dist/ folder`)
  cpSync(out, join(dist, a.dir), { recursive: true })
  rmSync(out, { recursive: true, force: true })
}

// ---- apps.json (no timestamps, so the content hash below is reproducible)
const commit = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || null
const branch = env.VERCEL_GIT_COMMIT_REF || env.GITHUB_REF_NAME || null
const manifest = {
  commit,
  branch,
  apps: editors.map((a) => ({ name: a.dir, title: a.pkg.hydra?.title || a.dir, description: a.pkg.hydra?.description || a.pkg.description || '', path: `${a.dir}/` })),
}
writeFileSync(join(dist, 'apps.json'), JSON.stringify(manifest, null, 2) + '\n')

// ---- service worker
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
const skip = (rel) => rel === 'sw.js' || rel === 'version.json' || rel.endsWith('.map') || rel.startsWith('.')
const files = walk(dist)
  .map((p) => relative(dist, p).split(sep).join('/'))
  .filter((r) => !skip(r))
  .sort()
const hash = createHash('sha256')
for (const f of files) hash.update(f).update(readFileSync(join(dist, f)))
const version = commit ? commit.slice(0, 12) : hash.digest('hex').slice(0, 12)
const template = readFileSync(join(appsDir, 'shell', 'sw.template.js'), 'utf8')
if (template.split('__VERSION__').length !== 2 || template.split('__PRECACHE__').length !== 2) throw new Error('sw.template.js lost its placeholders')
const precache = ['./', ...files.map((f) => './' + f)].filter((f) => f !== './')
writeFileSync(join(dist, 'sw.js'), template.replace("'__VERSION__'", () => JSON.stringify(version)).replace('__PRECACHE__', () => JSON.stringify(precache, null, 1)))
writeFileSync(join(dist, 'version.json'), JSON.stringify({ version, commit, branch, builtAt: new Date().toISOString(), apps: editors.map((a) => a.dir) }, null, 2) + '\n')

const total = files.reduce((n, f) => n + statSync(join(dist, f)).size, 0)
console.log(`\n✓ dist/ ready: shell + ${editors.length} editor(s) [${editors.map((a) => a.dir).join(', ')}], ${files.length} precached files, ${(total / 1048576).toFixed(2)} MB, version ${version}`)
void mkdirSync
