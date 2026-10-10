// node --test scripts/lib/markdown.test.mjs (part of npm test): the docs renderer used by scripts/build-docs.mjs
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { render } from './markdown.mjs'

const html = (md, opts) => render(md, opts).html

test('headings get ids and the first h1 is the title', () => {
  const r = render('# Hello `x`\n\n## Part one\n\n## Part one')
  assert.equal(r.title, 'Hello x')
  assert.match(r.html, /<h2 id="part-one">/)
  assert.match(r.html, /<h2 id="part-one-1">/)
})

test('inline code, bold, italic, links and bare URLs; raw HTML is escaped', () => {
  assert.equal(html('a `<b>*x*</b>` **bold** *it* [l](docs/x.md) <i>'), '<p>a <code>&lt;b&gt;*x*&lt;/b&gt;</code> <strong>bold</strong> <em>it</em> <a href="docs/x.md">l</a> &lt;i&gt;</p>')
  assert.match(html('see https://hydra.ojack.xyz.'), /<a href="https:\/\/hydra.ojack.xyz" rel="noopener" target="_blank">https:\/\/hydra.ojack.xyz<\/a>\./)
  assert.match(html('[x](javascript:alert(1))'), /href="#"/)
  assert.equal(html('snake_case_name'), '<p>snake_case_name</p>')
})

test('links can be rewritten', () => {
  assert.match(html('[m](docs/motion.md#api)', { link: (h) => h.replace('docs/motion.md', 'motion.html') }), /href="motion.html#api"/)
})

test('fenced code keeps its text exactly', () => {
  assert.equal(html('```js\nk = knob(0.5) // <x> & y\n\n  z\n```'), '<pre><code class="language-js">k = knob(0.5) // &lt;x&gt; &amp; y\n\n  z</code></pre>')
})

test('tables, with pipes inside code spans', () => {
  const out = html('| a | b |\n|---|--:|\n| `x \\| y` | 2 |')
  assert.match(out, /<th>a<\/th><th style="text-align:right">b<\/th>/)
  assert.match(out, /<td><code>x \| y<\/code><\/td>/)
})

test('nested and numbered lists, continuation lines, block quotes', () => {
  const out = html('1. one\n   still one\n2. two\n   * nested\n\n> quoted\n> **line**')
  assert.match(out, /^<ol><li>one\nstill one<\/li><li>two\n<ul><li>nested<\/li><\/ul><\/li><\/ol>/)
  assert.match(out, /<blockquote><p>quoted\n<strong>line<\/strong><\/p><\/blockquote>/)
  assert.match(html('3. c\n4. d'), /<ol start="3">/)
})

test('every repository doc renders with a title and balanced tags', () => {
  const root = new URL('../../', import.meta.url)
  const files = ['README.md', ...readdirSync(new URL('docs/', root)).filter((f) => f.endsWith('.md')).map((f) => 'docs/' + f)]
  for (const f of files) {
    const r = render(readFileSync(new URL(f, root), 'utf8'))
    assert.ok(r.title, f)
    for (const tag of ['p', 'ul', 'ol', 'li', 'pre', 'table', 'blockquote', 'strong', 'em', 'a', 'code']) {
      const open = (r.html.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length
      const close = (r.html.match(new RegExp(`</${tag}>`, 'g')) || []).length
      assert.equal(open, close, `${f}: <${tag}> ${open} open, ${close} closed`)
    }
  }
})
