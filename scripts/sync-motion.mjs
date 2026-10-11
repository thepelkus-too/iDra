// hydra-motion (packages/motion, MIT) → the site and the plugin registry. iDra uses only the package's built file.
//   node scripts/sync-motion.mjs            update packages/core/plugins/registry.json (URL, version, SRI) from the built file
//   node scripts/sync-motion.mjs --check    fail if the registry entry does not match the built file
//   node scripts/sync-motion.mjs --copy <dir>  also copy the file to <dir>/plugins/hydra-motion.js (stable URL) and
//                                              <dir>/plugins/hydra-motion@<version>/hydra-motion.js (pinned URL the registry uses),
//                                              and every earlier build in packages/core/plugins/archive/ to its own pinned path
// Earlier versions stay served because sketches pin the version they were made with (packages/core/plugins/archive/README.md).
// After hydra-motion moves to its own repo, only the registry's url/version/integrity change (see packages/motion/EXTRACTING.md).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'packages/core/package.json'))
const pkgDir = dirname(require.resolve('hydra-motion/package.json'))
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const file = readFileSync(join(pkgDir, pkg.main), 'utf8')
const integrity = 'sha256-' + createHash('sha256').update(file).digest('base64')
const pinnedPath = `plugins/hydra-motion@${pkg.version}/hydra-motion.js`

export const motionBuild = { version: pkg.version, integrity, file, pinnedPath }

const regPath = join(root, 'packages/core/plugins/registry.json')
const reg = JSON.parse(readFileSync(regPath, 'utf8'))

// earlier builds, kept byte for byte so sketches pinned to them still load
const archiveDir = join(root, 'packages/core/plugins/archive')
const archived = JSON.parse(readFileSync(join(archiveDir, 'integrity.json'), 'utf8'))
const archiveErrors = []
for (const [path, sri] of Object.entries(archived)) {
  const p = join(archiveDir, path)
  if (!existsSync(p)) archiveErrors.push(`${path} is listed in archive/integrity.json but missing`)
  else if ('sha256-' + createHash('sha256').update(readFileSync(p)).digest('base64') !== sri) archiveErrors.push(`${path} no longer matches its SRI ${sri}: archived builds must not change`)
}
if (archived[pinnedPath.replace(/^plugins\//, '')]) archiveErrors.push(`${pkg.version} is archived but is also the current version: bump packages/motion's version`)
// the version the registry pointed at before must be archived before the registry moves on from it
const prevEntry = reg.plugins.find((p) => p.id === 'hydra-motion')
if (prevEntry && prevEntry.version !== pkg.version && !archived[prevEntry.url.replace(/^plugins\//, '')]) {
  archiveErrors.push(`hydra-motion ${prevEntry.version} is not archived; copy its built file to packages/core/plugins/archive/ first (see its README)`)
}
if (archiveErrors.length) {
  console.error(archiveErrors.join('\n'))
  process.exit(1)
}
const entry = {
  id: 'hydra-motion',
  name: 'hydra-motion',
  author: 'hydra-motion contributors',
  license: 'MIT',
  homepage: 'https://github.com/thepelkus-too/iDra/tree/main/packages/motion',
  url: pinnedPath,
  version: pkg.version,
  integrity,
  kind: 'js',
  description: 'Glides, holds and pads: knob() values that glide (k.to), jump (k.set) and hold momentarily (k.hold / k.release), pads written in the code (knob(0.5, { pads: [...] }), played with k.press / k.lift), and gate() envelopes. Adds the globals knob, gate and hydraMotion.',
  verified: {
    status: 'verified',
    checked: 'build',
    how: 'Built from packages/motion in this repository and served by this site at a versioned path; the SRI is generated from the built file at every build (scripts/sync-motion.mjs).',
  },
}
const at = reg.plugins.findIndex((p) => p.id === 'hydra-motion')
const same = at >= 0 && JSON.stringify(reg.plugins[at]) === JSON.stringify(entry)
const args = process.argv.slice(2)
if (args.includes('--check')) {
  if (!same) {
    console.error(`registry.json's hydra-motion entry does not match packages/motion/dist (${integrity}); run: node scripts/sync-motion.mjs`)
    process.exit(1)
  }
  console.log(`hydra-motion ${pkg.version} registry entry matches ${integrity}`)
} else if (!same) {
  if (at >= 0) reg.plugins[at] = entry
  else reg.plugins.unshift(entry)
  writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n')
  console.log(`registry.json: hydra-motion ${pkg.version} ${integrity}`)
}
const copy = args.indexOf('--copy')
if (copy >= 0) {
  const out = resolve(args[copy + 1])
  for (const p of ['plugins/hydra-motion.js', pinnedPath]) {
    mkdirSync(dirname(join(out, p)), { recursive: true })
    writeFileSync(join(out, p), file)
  }
  for (const path of Object.keys(archived)) {
    mkdirSync(dirname(join(out, 'plugins', path)), { recursive: true })
    writeFileSync(join(out, 'plugins', path), readFileSync(join(archiveDir, path)))
  }
  console.log(`hydra-motion ${pkg.version} (and ${Object.keys(archived).join(', ') || 'no earlier builds'}) → ${out}/plugins/`)
}
