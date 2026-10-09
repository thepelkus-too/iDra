// SPDX-License-Identifier: MIT
// Builds dist/hydra-motion.js (one ES2019 IIFE, no dependencies) and dist/easings.json.
//   node scripts/build.mjs
// The easing NAMES are read from the installed hydra-synth (devDependency) every build, so the plugin offers exactly
// Hydra's set; the curves are this package's own (src/easing.js) and the build fails if a name has no curve.
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { easingTable } from '../src/easing.js'
import { hydraEasingNames } from './hydra-paths.mjs'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const names = await hydraEasingNames()
easingTable(names) // throws when Hydra has a curve we do not

const licence = readFileSync(join(here, 'LICENSE'), 'utf8').trim()
const banner = `/*! hydra-motion v${pkg.version} | SPDX-License-Identifier: MIT
${licence.split('\n').map((l) => (l ? ' * ' + l : ' *')).join('\n')}
 */`

const out = await build({
  entryPoints: [join(here, 'src/index.js')],
  bundle: true,
  write: false,
  format: 'iife',
  target: ['es2019'],
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
  define: { __HM_VERSION__: JSON.stringify(pkg.version), __HM_EASINGS__: JSON.stringify(names) },
  logLevel: 'warning',
})
const body = out.outputFiles[0].text.trim()
const text = `${banner}\n${body}\n`
if (text.includes('// ---- ')) throw new Error('the built file must not contain the inline-block delimiter')

mkdirSync(join(here, 'dist'), { recursive: true })
writeFileSync(join(here, 'dist/hydra-motion.js'), text)
writeFileSync(join(here, 'dist/easings.json'), JSON.stringify(names) + '\n')
const sri = 'sha256-' + createHash('sha256').update(text).digest('base64')
const gz = gzipSync(Buffer.from(text), { level: 9 }).length
console.log(`hydra-motion ${pkg.version}: ${text.length} bytes, ${gz} gzipped, ${sri}`)
if (gz > 6144) throw new Error(`dist/hydra-motion.js is ${gz} bytes gzipped; the budget is 6 KB`)
