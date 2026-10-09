// Where ports sit on a node (canvas units) and how cables are drawn. Shared by the canvas and its tests.
import type { Catalog } from '@hydra-ipad/core'
import type { GNode, Port } from '../model'
import { HEAD, ROW, sizeOf, type XY } from '../view'

export function portPos(n: GNode, p: XY, port: Port | 'out', cat: Catalog): XY {
  const s = sizeOf(n, cat)
  if (n.kind === 'out') return port === 'out' ? { x: p.x + s.w, y: p.y + s.h / 2 } : { x: p.x, y: p.y + s.h / 2 }
  if (n.kind === 'src') return { x: p.x + s.w, y: p.y + s.h / 2 }
  if (port === 'out') return { x: p.x + s.w, y: p.y + HEAD / 2 }
  if (port === 'in') return { x: p.x, y: p.y + HEAD / 2 }
  return { x: p.x, y: p.y + HEAD + port * ROW + ROW / 2 }
}

/** A horizontal-ish bezier; backwards cables (feedback) loop around below. */
export function cablePath(a: XY, b: XY): string {
  const dx = b.x - a.x
  if (dx >= 40) {
    const c = Math.max(40, dx * 0.5)
    return `M${a.x},${a.y} C${a.x + c},${a.y} ${b.x - c},${b.y} ${b.x},${b.y}`
  }
  const k = 80 + Math.min(200, Math.abs(dx) * 0.25)
  const dy = Math.abs(b.y - a.y) < 60 ? 90 : 0
  return `M${a.x},${a.y} C${a.x + k},${a.y + dy} ${b.x - k},${b.y + dy} ${b.x},${b.y}`
}

export function midpoint(a: XY, b: XY): XY {
  const dx = b.x - a.x
  if (dx >= 40) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const dy = Math.abs(b.y - a.y) < 60 ? 68 : 0
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + dy }
}
