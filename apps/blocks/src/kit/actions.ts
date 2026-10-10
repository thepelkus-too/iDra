// Document-level actions: open / new / import / export / copy. Copied from apps/stack.
import { routeHash, toCode, type Sketch } from '@hydra-ipad/core'
import { ctx } from './ctx'
import { toast } from '@hydra-ipad/kit'

export function codeOf(sketch: Sketch = ctx.store.sketch): string {
  return toCode(sketch)
}

export async function copyText(text: string, done = 'Code copied'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast(done)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;left:-9999px;top:0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    toast(ok ? done : 'Could not copy; use Export instead')
    return ok
  }
}
export const copyCode = (): Promise<boolean> => copyText(codeOf())

export const fileNameFor = (s: Sketch, ext = 'js'): string => `${(s.name || 'sketch').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'sketch'}.${ext}`

/** Share sheet with a file when the browser can, otherwise a download. */
export async function exportFile(kind: 'js' | 'json' = 'js'): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const sk = ctx.store.sketch
  const text = kind === 'js' ? codeOf(sk) : JSON.stringify(sk, null, 2)
  const type = kind === 'js' ? 'text/javascript' : 'application/json'
  const name = fileNameFor(sk, kind)
  const file = new File([text], name, { type })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  try {
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: sk.name })
      return 'shared'
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled'
  }
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'downloaded'
}

/** Add a sketch from text (Hydra code, or a sketch .json with its layout) to the shared library and open it here. */
export async function importAsNew(name: string, text: string): Promise<string> {
  await ctx.lib.flush()
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Sketch
      if (parsed && parsed.version === 1 && Array.isArray(parsed.stmts)) {
        const s = await ctx.lib.create(name || parsed.name || 'Imported sketch', '')
        await ctx.lib.put({ ...parsed, id: s.id, name: name || parsed.name || s.name, createdAt: s.createdAt })
        openSketch(s.id)
        return s.id
      }
    } catch {
      /* not JSON: import as code */
    }
  }
  const s = await ctx.lib.create(name || 'Imported sketch', text)
  openSketch(s.id)
  return s.id
}

export async function newBlankSketch(code = 'osc(20, 0.1, 0.8).out()\n', name = 'Untitled'): Promise<void> {
  await ctx.lib.flush()
  const s = await ctx.lib.create(name, code)
  openSketch(s.id)
}

export async function duplicateCurrent(): Promise<void> {
  await ctx.lib.flush()
  const s = await ctx.lib.duplicate(ctx.store.sketch.id)
  if (s) openSketch(s.id)
}

export function openSketch(id: string): void {
  location.hash = routeHash(id)
}
