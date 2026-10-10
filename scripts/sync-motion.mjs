// hydra-motion (packages/motion, MIT) → the site and the plugin registry. iDra uses only the package's built file.
//   node scripts/sync-motion.mjs            update packages/core/plugins/registry.json (URL, version, SRI) from the built file
//   node scripts/sync-motion.mjs --check    fail if the registry entry does not match the built file
//   node scripts/sync-motion.mjs --copy <dir>  also copy the file to <dir>/plugins/hydra-motion.js (stable URL) and
//                                              <dir>/plugins/hydra-motion@<version>/hydra-motion.js (pinned URL the registry uses)
// After hydra-motion moves to its own repo, only the registry's url/version/integrity change (see packages/motion/EXTRACTING.md).
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  description: 'Glides, holds and pads: knob() values that glide (k.to), jump (k.set) and hold momentarily (k.hold / k.release), and gate() envelopes. Adds the globals knob, gate and hydraMotion.',
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
  console.log(`hydra-motion ${pkg.version} → ${out}/plugins/`)
}
