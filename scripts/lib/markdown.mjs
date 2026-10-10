// A small Markdown → HTML renderer for the repository's own docs (scripts/build-docs.mjs), so the in-app docs need no
// runtime library and no new dependency. It covers what docs/*.md and README.md use: ATX headings, paragraphs, fenced
// code, pipe tables, nested bullet and numbered lists, block quotes, rules, and inline code / bold / italic / links /
// bare URLs. Raw HTML is never passed through: everything is escaped.

export const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;|&#\d+;/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

const safeHref = (href) => (/^(https?:|mailto:|#|\.{0,2}\/|[\w.-]+(\/|$|#|\.))/i.test(href) && !/^\s*javascript:/i.test(href) ? href : '#')

/** inline markup; `link(href)` may rewrite link targets (e.g. docs/x.md → x.html) */
export function inline(text, { link = (h) => h } = {}) {
  const out = []
  let i = 0
  let plain = ''
  const flush = () => {
    if (plain) out.push(autolink(escapeHtml(plain)))
    plain = ''
  }
  while (i < text.length) {
    const rest = text.slice(i)
    let m
    if (rest[0] === '\\' && /^\\[\\`*_[\]()#|!<>-]/.test(rest)) {
      plain += rest[1]
      i += 2
    } else if ((m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest))) {
      flush()
      out.push(`<code>${escapeHtml(m[2].replace(/^ (.*) $/, '$1'))}</code>`)
      i += m[0].length
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush()
      const href = link(m[2])
      const ext = /^https?:/i.test(href)
      out.push(`<a href="${escapeHtml(safeHref(href))}"${ext ? ' rel="noopener" target="_blank"' : ''}>${inline(m[1], { link })}</a>`)
      i += m[0].length
    } else if ((m = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest))) {
      flush()
      out.push(`<strong>${inline(m[2], { link })}</strong>`)
      i += m[0].length
    } else if ((m = /^\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/.exec(rest)) || (/^_/.test(rest) && !/\w$/.test(plain) && (m = /^_(?=\S)([\s\S]*?\S)_(?!\w)/.exec(rest)))) {
      flush()
      out.push(`<em>${inline(m[1], { link })}</em>`)
      i += m[0].length
    } else {
      plain += rest[0]
      i += 1
    }
  }
  flush()
  return out.join('')
}

// bare URLs in already-escaped text; trailing punctuation stays outside the link
const autolink = (s) =>
  s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"&]/g, (u) => `<a href="${u}" rel="noopener" target="_blank">${u}</a>`)

const isFence = (l) => /^ {0,3}(```|~~~)/.exec(l)
const isHeading = (l) => /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l)
const isRule = (l) => /^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(l)
const listItem = (l) => /^( *)([-*+]|\d+[.)])\s+(.*)$/.exec(l)
const isTableSep = (l) => l.includes('|') && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l)
const startsTable = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])
const splitRow = (l) => {
  let s = l.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  // pipes inside code spans or escaped (\|) do not split cells
  const cells = []
  let cur = ''
  let tick = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (c === '`') {
      tick ^= 1
      cur += c
    } else if (c === '|' && !tick) {
      cells.push(cur.trim())
      cur = ''
    } else cur += c
  }
  cells.push(cur.trim())
  return cells
}

/**
 * Render Markdown to HTML.
 * @returns {{ html: string, title: string, headings: Array<{ level: number, text: string, id: string }> }}
 */
export function render(md, opts = {}) {
  const lines = md.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')
  const headings = []
  const used = new Map()
  const idFor = (text) => {
    const base = slugify(text) || 'section'
    const n = used.get(base) || 0
    used.set(base, n + 1)
    return n ? `${base}-${n}` : base
  }
  const html = blocks(lines, { ...opts, headings, idFor })
  return { html, title: headings.find((h) => h.level === 1)?.text || headings[0]?.text || '', headings }
}

function blocks(lines, ctx) {
  const out = []
  let i = 0
  const inl = (t) => inline(t, ctx)
  const startsBlock = (l) => isFence(l) || isHeading(l) || isRule(l) || /^ {0,3}>/.test(l) || listItem(l)
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    let m
    if ((m = isFence(line))) {
      const fence = m[1]
      const lang = line.trim().slice(3).trim().split(/\s+/)[0]
      const indent = /^ */.exec(line)[0].length
      const body = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++].replace(new RegExp(`^ {0,${indent}}`), ''))
      i++
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`)
    } else if ((m = isHeading(line))) {
      const level = m[1].length
      const text = m[2]
      const id = ctx.idFor(text)
      const plain = inline(text, ctx).replace(/<[^>]*>/g, '')
      ctx.headings.push({ level, text: plain.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), id })
      out.push(`<h${level} id="${id}">${inl(text)}</h${level}>`)
      i++
    } else if (isRule(line)) {
      out.push('<hr>')
      i++
    } else if (/^ {0,3}>/.test(line)) {
      const body = []
      while (i < lines.length && lines[i].trim() && (/^ {0,3}>/.test(lines[i]) || !startsBlock(lines[i]))) body.push(lines[i++].replace(/^ {0,3}> ?/, ''))
      out.push(`<blockquote>${blocks(body, ctx)}</blockquote>`)
    } else if (startsTable(lines, i)) {
      const head = splitRow(line)
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''))
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]))
      const cell = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inl(c)}</${tag}>`
      out.push(
        `<div class="table"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`).join('') +
          '</tbody></table></div>',
      )
    } else if ((m = listItem(line))) {
      const base = m[1].length
      const ordered = /\d/.test(m[2])
      const start = ordered ? parseInt(m[2], 10) : 1
      const items = []
      let loose = false
      while (i < lines.length) {
        const im = listItem(lines[i])
        if (!im || im[1].length !== base || /\d/.test(im[2]) !== ordered) break
        const contentIndent = im[0].length - im[3].length
        const body = [im[3]]
        i++
        let blank = false
        while (i < lines.length) {
          const l = lines[i]
          if (!l.trim()) {
            blank = true
            body.push('')
            i++
            continue
          }
          const ind = /^ */.exec(l)[0].length
          const sib = listItem(l)
          if (sib && sib[1].length <= base) break
          if (ind > base) {
            if (blank && !sib && ind < contentIndent) break
            body.push(l.slice(Math.min(ind, contentIndent)))
          } else if (!blank && !startsBlock(l)) body.push(l.trim()) // lazy continuation
          else break
          blank = false
          i++
        }
        while (body.length && !body[body.length - 1].trim()) body.pop()
        if (blank && i < lines.length && listItem(lines[i])?.[1].length === base) loose = true
        items.push(body)
      }
      const li = items.map((body) => {
        const inner = blocks(body, ctx)
        return `<li>${loose ? inner : inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1')}</li>`
      })
      out.push(ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>${li.join('')}</ol>` : `<ul>${li.join('')}</ul>`)
    } else {
      const para = []
      do para.push(lines[i++].trim())
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !startsTable(lines, i))
      out.push(`<p>${inl(para.join('\n'))}</p>`)
    }
  }
  return out.join('\n')
}
