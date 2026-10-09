// View state (`sketch.meta.rack`) and how a sketch is laid out as a rack. Pure: no DOM.
//
// The lane layout is derived from the code every time (a chain sits in the lane of the output it writes, rows in source
// order), so it can never disagree with the code; what is stored is what the code cannot say: scenes, pinned controls,
// bypassed modules, frozen lanes, which mini-modules are open and the crossfade length.
import { OUT_NAMES, type Call, type Chain, type OutName, type Sketch, type Stmt } from '@hydra-ipad/core'
import { APP } from './app'

export { APP }

export interface Scene {
  /** the statements as they were when stored (the whole sketch body) */
  stmts: Stmt[]
  at: number
}

export interface Bypassed {
  /** chain the module was taken out of */
  chain: string
  /** the module it followed (null: right after the generator) */
  after: string | null
  call: Call
}

export interface RackMeta {
  v: 1
  /** slot '1'..'8' → scene */
  scenes?: Record<string, Scene>
  /** controls shown in performance mode: `callId:i` or `d:defId` (at most 8) */
  pins?: string[]
  bypass?: Bypassed[]
  /** lanes the dice and morph leave alone */
  frozen?: OutName[]
  /** expanded mini-modules (socket keys `callId:i`) */
  open?: string[]
  /** scene crossfade, in beats */
  fade?: number
}

export function metaOf(sketch: Sketch): RackMeta | undefined {
  const m = sketch.meta?.[APP] as Partial<RackMeta> | undefined
  return m && m.v === 1 ? (m as RackMeta) : undefined
}

/** Default view for a sketch this app has never seen: deterministic, never reads or touches other apps' meta. */
export function autoView(_sketch: Sketch): RackMeta {
  return { v: 1, fade: 4 }
}

// ---------------------------------------------------------------- layout

export type ChainStmt = Extract<Stmt, { k: 'chain' }>
export interface Row {
  stmt: ChainStmt
  /** a later chain writes the same output */
  shadowed: boolean
}
export interface Layout {
  lanes: Record<OutName, Row[]>
  /** chains with no `.out` */
  unplugged: ChainStmt[]
  vars: Array<Extract<Stmt, { k: 'def' }>>
  notes: Array<Extract<Stmt, { k: 'comment' }>>
  raw: Array<Extract<Stmt, { k: 'raw' }>>
  /** settings, sources, render() (shown in the top bar and mixer) */
  setup: Stmt[]
}

export const laneOf = (c: Chain): OutName | null => c.out ?? null

export function layoutOf(sketch: Sketch): Layout {
  const lanes = Object.fromEntries(OUT_NAMES.map((o) => [o, [] as Row[]])) as Record<OutName, Row[]>
  const out: Layout = { lanes, unplugged: [], vars: [], notes: [], raw: [], setup: [] }
  for (const s of sketch.stmts) {
    switch (s.k) {
      case 'chain': {
        const lane = laneOf(s.chain)
        if (!lane) out.unplugged.push(s)
        else {
          for (const r of lanes[lane]) r.shadowed = true
          lanes[lane].push({ stmt: s, shadowed: false })
        }
        break
      }
      case 'def': out.vars.push(s); break
      case 'comment': out.notes.push(s); break
      case 'raw': out.raw.push(s); break
      default: out.setup.push(s)
    }
  }
  return out
}

/** Which outputs each lane reads (`src(oN)` or `oN` anywhere in its chains): the mixer's routing matrix. */
export function readsOf(sketch: Sketch): Record<OutName, OutName[]> {
  const r = Object.fromEntries(OUT_NAMES.map((o) => [o, [] as OutName[]])) as Record<OutName, OutName[]>
  const visit = (c: Chain, into: Set<OutName>) => {
    for (const call of [c.gen, ...c.mods])
      for (const a of call.args) {
        if (a.k === 'ref' && /^o[0-3]$/.test(a.name)) into.add(a.name as OutName)
        if (a.k === 'tex') visit(a.chain, into)
      }
  }
  for (const s of sketch.stmts) {
    if (s.k !== 'chain') continue
    const lane = laneOf(s.chain)
    if (!lane) continue
    const set = new Set(r[lane])
    visit(s.chain, set)
    r[lane] = OUT_NAMES.filter((o) => set.has(o))
  }
  return r
}

/** The bpm the sketch sets (Hydra's default is 30), for beat-synced rates and crossfades. */
export function bpmOf(sketch: Sketch): number {
  let bpm = 30
  for (const s of sketch.stmts) if (s.k === 'setting' && s.name === 'bpm' && s.v > 0) bpm = s.v
  return bpm
}
