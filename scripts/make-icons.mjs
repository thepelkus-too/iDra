// One-off: renders apps/shell/public/icons/icon.svg to the PNG sizes the web app manifest and iOS need.
// Run `node scripts/make-icons.mjs` after editing the SVG; the PNGs are committed so builds need no browser.
import { launch } from './lib/browser.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/shell/public/icons')
const svg = readFileSync(resolve(dir, 'icon.svg'), 'utf8')
const browser = await launch()
const page = await browser.newPage()
const render = async (size, name, { padding = 0, bg = false } = {}) => {
  await page.setViewportSize({ width: size, height: size })
  const inner = Math.round(size * (1 - padding * 2))
  await page.setContent(`<body style="margin:0;background:${bg ? '#0d1117' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px"><div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`)
  writeFileSync(resolve(dir, name), await page.screenshot({ omitBackground: !bg }))
}
await render(192, 'icon-192.png')
await render(512, 'icon-512.png')
await render(512, 'icon-maskable-512.png', { padding: 0.1, bg: true })
await render(180, 'apple-touch-icon.png', { bg: true })
await browser.close()
console.log('icons written to', dir)
