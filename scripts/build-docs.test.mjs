// node --test scripts/build-docs.test.mjs (part of npm test): every doc gets a page, subfolders included, and the
// repository's real docs/ folder is covered in full, so a new file or folder there never silently goes missing.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildDocs } from './build-docs.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('docs in subfolders are rendered, listed and linkable', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-src-'))
  const out = mkdtempSync(join(tmpdir(), 'docs-out-'))
  mkdirSync(join(root, 'docs/guides/deeper'), { recursive: true })
  writeFileSync(join(root, 'README.md'), '# Readme\n\nSee [a](docs/a.md).')
  writeFileSync(join(root, 'docs/a.md'), '# A\n\n[setup](guides/setup.md#step) and [c](guides/deeper/c.md)')
  writeFileSync(join(root, 'docs/guides/setup.md'), '# Setup\n\n## Step\n\n[back](../a.md) [code](../../src/x.ts)')
  writeFileSync(join(root, 'docs/guides/deeper/c.md'), '# C')
  writeFileSync(join(root, 'docs/guides/notes.txt'), 'not markdown')
  const pages = buildDocs(out, root)
  assert.deepEqual(pages.map((p) => p.rel).sort(), ['README.md', 'docs/a.md', 'docs/guides/deeper/c.md', 'docs/guides/setup.md'])
  const index = readFileSync(join(out, 'docs/index.html'), 'utf8')
  for (const p of pages) assert.ok(index.includes(`href="${p.page}"`), `${p.rel} listed`)
  assert.match(readFileSync(join(out, 'docs/a.html'), 'utf8'), /href="guides-setup.html#step"[\s\S]*href="guides-deeper-c.html"/)
  const setup = readFileSync(join(out, 'docs/guides-setup.html'), 'utf8')
  assert.match(setup, /href="a.html"/)
  assert.match(setup, /href="https:\/\/github.com\/thepelkus-too\/iDra\/blob\/main\/src\/x.ts"/)
})

test('two docs that would share a page name fail the build', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-src-'))
  mkdirSync(join(root, 'docs/guides'), { recursive: true })
  writeFileSync(join(root, 'README.md'), '# R')
  writeFileSync(join(root, 'docs/guides-a.md'), '# 1')
  writeFileSync(join(root, 'docs/guides/a.md'), '# 2')
  assert.throws(() => buildDocs(mkdtempSync(join(tmpdir(), 'docs-out-')), root), /both render to guides-a.html/)
})

test("every .md under the repository's docs/ has a page", () => {
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.md') ? [join(d, f)] : []))
  const expected = walk(join(repo, 'docs')).length + 1 // + README.md
  const pages = buildDocs(mkdtempSync(join(tmpdir(), 'docs-out-')))
  assert.equal(pages.length, expected)
})
