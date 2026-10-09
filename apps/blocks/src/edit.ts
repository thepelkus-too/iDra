// Block edits as pure functions of the sketch: what a drop does. The workspace calls these and commits the result with the
// view state (positions, loose stacks) in one step, so undo restores both.
import { DEFAULT, chainStmt, makeChain, newId, type Call, type Chain, type OutName, type Sketch, type Stmt, type Value } from '@hydra-ipad/core'
import { findCallDeep, insertStmt, mapChains, removeStmt, respace, setArg, stmtOf, updateChain, type ArgRef } from './kit/model'
import { readingOrder, type XY } from './view'


/** Where a block lives: the chain, and its index (-1 = the generator, the hat). */
export interface BlockAt {
  chain: Chain
  index: number
  /** the top-level statement around it */
  stmt: Stmt
  /** set when the chain sits in a texture socket */
  socket?: { call: string; i: number }
  /** set when the chain is a def's value */
  def?: string
}

export function locate(sketch: Sketch, callId: string): BlockAt | undefined {
  let found: BlockAt | undefined
  const visit = (chain: Chain, stmt: Stmt, socket?: { call: string; i: number }, def?: string) => {
    if (found) return
    const calls = [chain.gen, ...chain.mods]
    const k = calls.findIndex((c) => c.id === callId)
    if (k >= 0) found = { chain, index: k - 1, stmt, socket, def }
    for (const c of calls) c.args.forEach((a, i) => a.k === 'tex' && visit(a.chain, stmt, { call: c.id, i }))
  }
  for (const s of sketch.stmts) {
    if (s.k === 'chain') visit(s.chain, s)
    else if (s.k === 'def' && s.value.k === 'tex') visit(s.value.chain, s, undefined, s.id)
  }
  return found
}

/** Take the blocks from `fromIndex` to the end of a chain off it (Scratch: dragging a block takes the ones below it too). */
export function detachTail(sketch: Sketch, chainId: string, fromIndex: number): { sketch: Sketch; calls: Call[] } {
  let calls: Call[] = []
  const next = updateChain(sketch, chainId, (c) => {
    calls = c.mods.slice(fromIndex)
    return { ...c, mods: c.mods.slice(0, fromIndex), src: c.src ? { ...c.src, gaps: c.src.gaps.slice(0, fromIndex + 1) } : c.src }
  })
  return { sketch: next, calls }
}

/** Snap blocks into a chain after position `after` (-1 = right under the hat). */
export function insertCalls(sketch: Sketch, chainId: string, after: number, calls: Call[]): Sketch {
  return updateChain(sketch, chainId, (c) => {
    const mods = c.mods.slice()
    mods.splice(after + 1, 0, ...calls)
    return { ...c, mods }
  })
}

/** A whole script dropped into a texture socket: the chain moves into the argument (its `.out` goes away). */
export function scriptIntoSocket(sketch: Sketch, stmtId: string, target: ArgRef): Sketch {
  const s = stmtOf(sketch, stmtId)
  if (!s || s.k !== 'chain') return sketch
  const chain: Chain = { ...s.chain, out: undefined, src: undefined }
  return setArg(removeStmt(sketch, stmtId), target, { k: 'tex', chain })
}

/** A stack pulled out of a socket becomes its own (not yet rendered) script, inserted after the statement it came from. */
export function socketToScript(sketch: Sketch, from: ArgRef): { sketch: Sketch; stmt?: Stmt } {
  const v = 'def' in from ? stmtOf(sketch, from.def) : undefined
  const value: Value | undefined = 'def' in from ? (v && v.k === 'def' ? v.value : undefined) : findCallDeep(sketch, from.call)?.call.args[from.i]
  if (!value || value.k !== 'tex') return { sketch }
  const owner = 'def' in from ? from.def : topStmtOf(sketch, from.call)?.id
  const stmt = chainStmt({ ...value.chain, out: null, src: undefined })
  let next = setArg(sketch, from, DEFAULT)
  const at = next.stmts.findIndex((x) => x.id === owner)
  next = insertStmt(next, at + 1, stmt)
  return { sketch: next, stmt }
}

/** A new script from loose blocks or a palette hat. */
export function addScript(sketch: Sketch, gen: Call, mods: Call[] = [], out: OutName | null = null, index = sketch.stmts.length): { sketch: Sketch; stmt: Stmt } {
  const stmt = chainStmt(makeChain(gen, mods, out))
  return { sketch: insertStmt(sketch, index, stmt), stmt }
}

export function topStmtOf(sketch: Sketch, callId: string): Stmt | undefined {
  return locate(sketch, callId)?.stmt
}

/** Every call id inside a value (a nested stack), for liveness checks and highlighting. */
export function callIdsOf(chain: Chain): string[] {
  const out: string[] = []
  for (const c of [chain.gen, ...chain.mods]) {
    out.push(c.id)
    for (const a of c.args) if (a.k === 'tex') out.push(...callIdsOf(a.chain))
  }
  return out
}

/**
 * Put the statements in the reading order of their scripts (columns left to right, top to bottom), then make sure no variable
 * is used before its definition (core's validate): a def that would be is moved up to just before its first use.
 */
export function reorderByPosition(sketch: Sketch, pos: Record<string, XY>): Sketch {
  const order = readingOrder(sketch.stmts.map((s) => s.id), pos)
  const byId = new Map(sketch.stmts.map((s) => [s.id, s]))
  let stmts = order.map((id) => byId.get(id)!)
  if (stmts.every((s, i) => s === sketch.stmts[i])) return sketch
  stmts = hoistDefs(stmts)
  const prevNext = new Map(sketch.stmts.map((s, i) => [s.id, sketch.stmts[i - 1]?.id]))
  const touched = stmts.filter((s, i) => prevNext.get(s.id) !== stmts[i - 1]?.id).map((s) => s.id)
  let next = respace({ ...sketch, stmts }, touched)
  // the first statement never starts with a blank line
  if (next.stmts[0]?.src?.before) next = respace(next, [next.stmts[0].id])
  return next
}

/** A definition must come before its first use: move a def up to just before the first statement that uses it (so core's
 *  validate never reports var-before-def after a reorder). */
export function hoistDefs(stmts: Stmt[]): Stmt[] {
  const out = stmts.slice()
  const uses = (s: Stmt, name: string): boolean => {
    const inVal = (v: Value): boolean => (v.k === 'var' && v.name === name) || (v.k === 'tex' && inChain(v.chain))
    const inChain = (c: Chain): boolean => [c.gen, ...c.mods].some((call) => call.args.some(inVal))
    if (s.k === 'chain') return inChain(s.chain)
    if (s.k === 'def') return inVal(s.value)
    return false
  }
  for (let guard = 0; guard < out.length * 2; guard++) {
    let moved = false
    for (let i = 0; i < out.length; i++) {
      const d = out[i]
      if (d.k !== 'def') continue
      const first = out.findIndex((s) => s !== d && uses(s, d.name))
      if (first >= 0 && first < i) {
        out.splice(i, 1)
        out.splice(first, 0, d)
        moved = true
        break
      }
    }
    if (!moved) break
  }
  return out
}

/** Every number in a statement nudged by up to ±amount (relative): the "mutate" play button. */
export function mutateStmt(sketch: Sketch, stmtId: string, rnd: () => number, amount = 0.15): Sketch {
  const s = stmtOf(sketch, stmtId)
  if (!s) return sketch
  const nudge = (v: number) => {
    const d = (rnd() * 2 - 1) * amount * (Math.abs(v) > 0.05 ? Math.abs(v) : 0.2)
    return +(v + d).toFixed(Math.abs(v) >= 10 ? 1 : 3)
  }
  const fixCall = (c: Call): Call => ({ ...c, args: c.args.map((a) => (a.k === 'num' ? { ...a, v: nudge(a.v) } : a.k === 'tex' ? { ...a, chain: fixChain(a.chain) } : a)) })
  const fixChain = (c: Chain): Chain => ({ ...c, gen: fixCall(c.gen), mods: c.mods.map(fixCall) })
  if (s.k === 'chain') return { ...sketch, stmts: sketch.stmts.map((x) => (x.id === stmtId ? { ...s, chain: fixChain(s.chain) } : x)) }
  if (s.k === 'def' && s.value.k === 'num') return { ...sketch, stmts: sketch.stmts.map((x) => (x.id === stmtId ? { ...s, value: { k: 'num', v: nudge((s.value as { v: number }).v) } } : x)) }
  if (s.k === 'def' && s.value.k === 'tex') return { ...sketch, stmts: sketch.stmts.map((x) => (x.id === stmtId ? { ...s, value: { k: 'tex', chain: fixChain((s.value as { chain: Chain }).chain) } } : x)) }
  return sketch
}

/** Copy calls with fresh ids (loose stacks dropped back, duplicates). */
export function freshCalls(calls: Call[]): Call[] {
  const fresh = (c: Call): Call => ({ id: newId('c'), fn: c.fn, ...(c.src ? { src: c.src } : {}), args: c.args.map((a) => (a.k === 'tex' ? { k: 'tex', chain: freshChain(a.chain) } : a)) })
  const freshChain = (c: Chain): Chain => ({ id: newId('h'), gen: fresh(c.gen), mods: c.mods.map(fresh) })
  return calls.map(fresh)
}

export { mapChains }
