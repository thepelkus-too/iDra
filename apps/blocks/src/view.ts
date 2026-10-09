// View state (`sketch.meta.blocks`), block sizes and the default workspace layout. Pure: no DOM; the renderer takes its row
// heights from here so the layout is exact vertically (widths are estimates with generous gaps; the e2e run checks overlaps).
//
// Default layout (autoView): every top-level statement is a script; scripts are stacked in source order in columns that
// wrap at COL_H, columns left to right. A comment sits just above the script after it (it is attached in reading order).
import { catalog as defaultCatalog, type Call, type Catalog, type Chain, type Sketch, type Stmt, type Value } from '@hydra-ipad/core'
import { APP } from './app'
import { valueToMod } from './kit/mods'
import { srcToMath } from './math'

export { APP }

export interface XY {
  x: number
  y: number
}

export interface LooseStack {
  id: string
  x: number
  y: number
  /** blocks dragged off a script and left on the workspace (not part of the code until snapped back) */
  calls: Call[]
}

export interface BlocksMeta {
  v: 1
  /** statement id → top-left of its script */
  pos: Record<string, XY>
  loose?: LooseStack[]
  /** scripts folded to their hat */
  collapsed?: string[]
  cam?: { x: number; y: number; k: number }
}

export function metaOf(sketch: Sketch): BlocksMeta | undefined {
  const m = sketch.meta?.[APP] as Partial<BlocksMeta> | undefined
  return m && m.v === 1 && m.pos ? (m as BlocksMeta) : undefined
}

// ---------------------------------------------------------------- sizes (workspace units = CSS px at zoom 1)

export const HAT_H = 60
export const BLOCK_H = 50
export const CAP_H = 46
/** space a socket adds around what it holds (top + bottom) */
export const SOCKET_PAD = 10
export const ROW_PAD = 8
export const COL_H = 1500
export const COL_GAP = 90
export const GAP_Y = 36
export const X0 = 40
export const Y0 = 40

const textW = (s: string, px = 8.6) => Math.ceil(s.length * px)

/** Height of what sits in a texture socket. */
export function socketH(v: Value, cat: Catalog = defaultCatalog): number {
  if (v.k === 'tex') return chainH(v.chain, cat, true) + SOCKET_PAD * 2
  return 40
}

export function rowH(call: Call, hat: boolean, cat: Catalog = defaultCatalog): number {
  const base = hat ? HAT_H : BLOCK_H
  let inner = 0
  const inputs = cat.inputs(call.fn)
  call.args.forEach((a, i) => {
    if (a.k === 'tex' || inputs[i]?.type === 'sampler2D') inner = Math.max(inner, socketH(a, cat))
  })
  return Math.max(base, inner + ROW_PAD * 2 + (hat ? 8 : 0))
}

export function chainH(chain: Chain, cat: Catalog = defaultCatalog, nested = false): number {
  let h = rowH(chain.gen, true, cat)
  for (const m of chain.mods) h += rowH(m, false, cat)
  return nested ? h : h + CAP_H
}

function valueW(v: Value, label: string, cat: Catalog): number {
  const lw = textW(label, 6.5)
  switch (v.k) {
    case 'num': return lw + textW(String(v.v)) + 30
    case 'default': return lw + 40
    case 'tex': return chainW(v.chain, cat) + 28
    case 'ref':
    case 'var': return lw + textW(v.name) + 46
    case 'arr': return lw + 60 + v.v.length * 18 + 150
    case 'fn': {
      const m = valueToMod(v)
      if (m && m.kind !== 'expr') return lw + 330
      const math = srcToMath(v.src)
      if (math) return lw + textW(v.src, 9.5) + 40
      return lw + Math.min(260, textW(v.src, 7.4) + 40)
    }
    case 'js': return lw + Math.min(260, textW(v.src, 7.4) + 40)
    case 'vec4': return lw + v.v.length * 52
  }
}

export function callW(call: Call, cat: Catalog = defaultCatalog): number {
  const inputs = cat.inputs(call.fn)
  let w = 54 + textW(call.fn, 9.6)
  const n = Math.max(call.args.length, inputs.length)
  for (let i = 0; i < n; i++) w += valueW(call.args[i] ?? { k: 'default' }, inputs[i]?.name ?? '', cat) + 6
  if (!cat.get(call.fn)) w += 60
  return w
}

export function chainW(chain: Chain, cat: Catalog = defaultCatalog): number {
  return Math.max(200, ...[chain.gen, ...chain.mods].map((c) => callW(c, cat)))
}

export function lineCount(s: string, max: number): number {
  return Math.min(max, Math.max(1, s.split('\n').length))
}

/** Box of one script (any statement). */
export function scriptSize(s: Stmt, cat: Catalog = defaultCatalog, collapsed = false): { w: number; h: number } {
  switch (s.k) {
    case 'chain':
      if (collapsed) return { w: Math.max(240, callW(s.chain.gen, cat)), h: HAT_H + CAP_H }
      return { w: Math.max(chainW(s.chain, cat), 260), h: chainH(s.chain, cat) }
    case 'def': {
      const w = 150 + textW(s.name, 9.6) + valueW(s.value, '', cat)
      const h = s.value.k === 'tex' ? socketH(s.value, cat) + ROW_PAD * 2 : BLOCK_H
      return { w, h }
    }
    case 'comment':
      return { w: 280, h: 18 + lineCount(s.text, 6) * 18 }
    case 'raw':
      return { w: 380, h: 44 + lineCount(s.code, 8) * 17 + 14 }
    case 'source':
      return { w: 380, h: BLOCK_H }
    default:
      return { w: 300, h: BLOCK_H }
  }
}

// ---------------------------------------------------------------- default layout

/** Deterministic default view for a sketch that has none (or for "Tidy up"). Never reads or touches other apps' meta. */
export function autoView(sketch: Sketch, cat: Catalog = defaultCatalog, keep: Partial<BlocksMeta> = {}): BlocksMeta {
  const pos: Record<string, XY> = {}
  let x = X0
  let y = Y0
  let colW = 0
  for (const s of sketch.stmts) {
    const z = scriptSize(s, cat, keep.collapsed?.includes(s.id))
    if (y > Y0 && y + z.h > COL_H) {
      x += colW + COL_GAP
      y = Y0
      colW = 0
    }
    pos[s.id] = { x, y }
    colW = Math.max(colW, z.w)
    // a comment hugs the script it describes
    y += z.h + (s.k === 'comment' ? 8 : GAP_Y)
  }
  const meta: BlocksMeta = { v: 1, pos }
  if (keep.loose?.length) meta.loose = keep.loose
  if (keep.collapsed?.length) meta.collapsed = keep.collapsed
  return meta
}

/**
 * Reading order of scripts on the workspace: columns left to right (scripts whose left edges are within COLUMN_SNAP of the
 * column's first script belong to it), top to bottom inside a column. This is the statement order of the code.
 */
export const COLUMN_SNAP = 160
export function readingOrder(ids: string[], pos: Record<string, XY>): string[] {
  const xs = ids.filter((id) => pos[id]).sort((a, b) => pos[a].x - pos[b].x || pos[a].y - pos[b].y)
  const cols: string[][] = []
  let x0 = -Infinity
  for (const id of xs) {
    if (pos[id].x > x0 + COLUMN_SNAP) {
      cols.push([])
      x0 = pos[id].x
    }
    cols[cols.length - 1].push(id)
  }
  return [...cols.flatMap((c) => c.sort((a, b) => pos[a].y - pos[b].y || pos[a].x - pos[b].x)), ...ids.filter((id) => !pos[id])]
}

/**
 * Positions for statements that have none yet (added in the code view, or by another editor). New statements at the end of
 * the code go after the last script in reading order; anything else means the code order changed under the layout, so the
 * whole workspace is laid out again (reading order must stay the code order). Returns undefined when nothing is missing.
 */
export function fillPositions(sketch: Sketch, meta: BlocksMeta, cat: Catalog = defaultCatalog): BlocksMeta | undefined {
  const ids = sketch.stmts.map((s) => s.id)
  const missing = ids.filter((id) => !meta.pos[id])
  const stale = Object.keys(meta.pos).filter((id) => !ids.includes(id))
  if (!missing.length && !stale.length) return undefined
  const pos: Record<string, XY> = {}
  for (const id of ids) if (meta.pos[id]) pos[id] = meta.pos[id]
  const known = ids.filter((id) => pos[id])
  const tailOnly = missing.every((id) => ids.indexOf(id) >= known.length)
  const inOrder = readingOrder(known, pos).every((id, i) => id === known[i])
  if (!tailOnly || !inOrder) return { ...autoView(sketch, cat, meta), cam: meta.cam }
  const last = known[known.length - 1]
  let x = last ? pos[last].x : X0
  let y = last ? pos[last].y + scriptSize(sketch.stmts.find((s) => s.id === last)!, cat, meta.collapsed?.includes(last)).h + GAP_Y : Y0
  let colW = 300
  for (const id of missing) {
    const s = sketch.stmts.find((st) => st.id === id)!
    const z = scriptSize(s, cat)
    if (y > Y0 && y + z.h > COL_H) {
      x += Math.max(colW, ...known.filter((k) => Math.abs(pos[k].x - x) < COLUMN_SNAP).map((k) => scriptSize(sketch.stmts.find((st) => st.id === k)!, cat).w)) + COL_GAP
      y = Y0
      colW = 0
    }
    pos[id] = { x, y }
    colW = Math.max(colW, z.w)
    y += z.h + GAP_Y
  }
  return { ...meta, pos }
}
