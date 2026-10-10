// Document-level actions that are not about one row: dice, open / new / import / export, copy.
import { randomSketch, routeHash, toCode, type Sketch } from '@hydra-ipad/core'
import { ctx, edit } from './ctx'
import { mutateChain } from './mutate'
import { toast } from '@hydra-ipad/kit'
import { appPrefs } from './prefs'
import { APP } from './view'

export function currentSeed(): number {
  return appPrefs.get<number>('seed') ?? 1000 + Math.floor(Math.random() * 9000)
}

/** Replace the statements with randomSketch(seed). Undoable; the toast names the seed. */
export function rollDice(seed = currentSeed()): number {
  const r = randomSketch(seed, { name: ctx.store.sketch.name })
  edit((s) => ({ ...s, stmts: r.stmts, src: undefined }))
  appPrefs.set('seed', seed + 1)
  toast(`Rolled seed ${seed}`, { label: 'Undo', run: () => ctx.store.undo() })
  return seed
}

export function mutateActive(strength = 1): void {
  const sk = ctx.store.sketch
  const meta = sk.meta?.[APP] as { active?: string } | undefined
  const target = sk.stmts.find((s) => s.k === 'chain' && s.id === meta?.active) ?? sk.stmts.find((s) => s.k === 'chain')
  if (!target) return toast('There is no chain to mutate')
  const seed = Math.floor(Math.random() * 1e6)
  edit((s) => mutateChain(s, target.id, { seed, strength, catalog: ctx.catalog }))
  toast(strength >= 1.5 ? 'Mutated (bold)' : strength <= 0.6 ? 'Mutated (gentle)' : 'Mutated', { label: 'Undo', run: () => ctx.store.undo() })
}

export function codeOf(sketch: Sketch = ctx.store.sketch): string {
  return toCode(sketch)
}

export async function copyCode(): Promise<boolean> {
  const code = codeOf()
  try {
    await navigator.clipboard.writeText(code)
    toast('Code copied')
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = code
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
    toast(ok ? 'Code copied' : 'Could not copy; use Export instead')
    return ok
  }
}

export const fileNameFor = (s: Sketch): string => `${(s.name || 'sketch').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'sketch'}.js`

/** Share sheet with a file when the browser can, otherwise a download. */
export async function exportJs(): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const sk = ctx.store.sketch
  const code = codeOf(sk)
  const name = fileNameFor(sk)
  const file = new File([code], name, { type: 'text/javascript' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  try {
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: sk.name })
      return 'shared'
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled'
  }
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'downloaded'
}

/** Add a sketch from text to the shared library and open it here. */
export async function importAsNew(name: string, code: string): Promise<string> {
  await ctx.lib.flush()
  const s = await ctx.lib.create(name || 'Imported sketch', code)
  openSketch(s.id)
  return s.id
}

export async function newBlankSketch(): Promise<void> {
  await ctx.lib.flush()
  const s = await ctx.lib.create('Untitled', 'osc(20, 0.1, 0.8).out()\n')
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
