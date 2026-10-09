// SPDX-License-Identifier: MIT
// The built file as a plain Hydra user loads it: a script evaluated in a page's global scope.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { gzipSync } from 'node:zlib'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = readFileSync(join(here, 'dist/hydra-motion.js'), 'utf8')
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const page = (extra = {}) => {
  const warnings = []
  const ctx = vm.createContext({ console: { warn: (m) => warnings.push(m), log() {} }, time: 0, bpm: 30, ...extra })
  return { ctx, warnings, run: (code) => vm.runInContext(code, ctx) }
}

test('installs knob, gate and hydraMotion only', () => {
  const p = page()
  const before = new Set(Object.keys(p.ctx))
  p.run(dist)
  const added = Object.keys(p.ctx).filter((k) => !before.has(k)).sort()
  assert.deepEqual(added, ['gate', 'hydraMotion', 'knob'])
  assert.equal(p.run('hydraMotion.version'), pkg.version)
  assert.equal(p.run('const k = knob(0.5); time = 0; k.to(1, 1); time = 0.5; k()'), 0.75)
  assert.deepEqual(p.warnings, [])
})

test('leaves an existing global alone, with a warning', () => {
  const p = page({ knob: 'mine' })
  p.run(dist)
  assert.equal(p.run('knob'), 'mine')
  assert.equal(typeof p.run('gate'), 'function')
  assert.equal(typeof p.run('hydraMotion.knob'), 'function')
  assert.match(p.warnings.join('\n'), /global "knob" already exists/)
})

test('loading twice keeps the first copy (a self-contained sketch re-run)', () => {
  const p = page()
  p.run(dist)
  const first = p.run('knob')
  p.run(dist)
  assert.equal(p.run('knob'), first)
  assert.deepEqual(p.warnings, [])
})

test('ES2019 single file under 6 KB gzipped, carrying the MIT licence', () => {
  assert.ok(gzipSync(Buffer.from(dist)).length < 6144)
  assert.match(dist, /^\/\*! hydra-motion v\d+\.\d+\.\d+ \| SPDX-License-Identifier: MIT/)
  assert.match(dist, /Permission is hereby granted, free of charge/)
  assert.match(dist, /Copyright \(c\) hydra-motion contributors/)
  // no syntax newer than ES2019 slipped in
  assert.doesNotMatch(dist, /\?\?|\?\.[a-zA-Z_$(]|\*\*=|static\s*\{/)
  assert.deepEqual(JSON.parse(readFileSync(join(here, 'dist/easings.json'), 'utf8')), JSON.parse(page().run(dist + ';JSON.stringify(hydraMotion.easings)')))
})

test('self-contained package: SPDX MIT on every file, no imports from outside the package', () => {
  const walk = (d) => readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    if (f === 'node_modules') return []
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
  const files = walk(here).filter((f) => /\.(m?js|json|md)$/.test(f) && !f.endsWith('package.json') && !f.endsWith('easings.json'))
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    assert.match(text.slice(0, 400), /SPDX-License-Identifier: MIT/, `${relative(here, f)} has no SPDX header`)
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1]
      if (spec.startsWith('.')) {
        const target = resolve(dirname(f), spec)
        assert.ok(!relative(here, target).startsWith('..'), `${relative(here, f)} imports ${spec}, outside the package`)
      } else {
        assert.ok(/^(node:|esbuild$|hydra-synth)/.test(spec), `${relative(here, f)} imports ${spec}, not a declared dependency`)
      }
    }
  }
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.name, 'hydra-motion')
})
