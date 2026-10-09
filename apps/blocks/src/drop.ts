// What a drop does, as a pure function: (sketch, view, payload, target, point) → new sketch and view, or a reason it does not
// fit. The workspace commits the result in one undo step. Unit-tested without a DOM (test/drop.test.ts).
import {
  DEFAULT,
  catalog as defaultCatalog,
  makeChain,
  newId,
  num,
  rawStmt,
  type Catalog,
  type Sketch,
  type Stmt,
  type Value,
} from '@hydra-ipad/core'
import { defaultSpec, modToValue, valueToMod, type ModKind } from './kit/mods'
import { findCallDeep, getArg, insertStmt, newCall, removeStmt, setArg, setOut, stmtOf, type ArgRef } from './kit/model'
import { addScript, callIdsOf, detachTail, freshCalls, insertCalls, locate, reorderByPosition, scriptIntoSocket, socketToScript } from './edit'
import type { Payload, PItem, Target } from './drag'
import { getAt, setAt, srcToMath, mathToSrc, type MathNode } from './math'
import type { BlocksMeta, XY } from './view'

export interface DropResult {
  sketch: Sketch
  view: Partial<BlocksMeta>
  error?: string
  /** select this (call or statement id) after the drop */
  select?: string
}

const isGen = (fn: string, cat: Catalog) => cat.get(fn)?.type === 'src'

/** What a value in an input goes back to when its reporter is taken away. */
export function restValue(v: Value | undefined): Value {
  const m = v ? valueToMod(v) : undefined
  if (m && m.kind !== 'expr' && m.kind !== 'steps') return num(+m.off.toFixed(4))
  return DEFAULT
}

/** Current plain number in an input (for centring a wave reporter on it). */
function around(sk: Sketch, ref: ArgRef, cat: Catalog): { at: number; span: number } {
  const v = getArg(sk, ref)
  if ('def' in ref) return { at: v?.k === 'num' ? v.v : 0, span: 1 }
  const call = findCallDeep(sk, ref.call)?.call
  const inp = call ? cat.inputs(call.fn)[ref.i] : undefined
  const hint = call && inp ? cat.hint(call.fn, inp.name) : { min: 0, max: 1 }
  const d = typeof inp?.default === 'number' ? inp.default : 0
  return { at: v?.k === 'num' ? v.v : d, span: hint.max - hint.min }
}

/** The value a palette reporter writes into an input. */
export function reporterValue(item: Extract<PItem, { t: 'value' }>, sk: Sketch, ref: ArgRef, cat: Catalog): Value {
  const v = item.value
  if (v.k === 'fn' && v.src.startsWith('mod:')) {
    const kind = v.src.slice(4) as ModKind
    const { at, span } = around(sk, ref, cat)
    const spec = defaultSpec(kind, +at.toFixed(4), kind === 'steps' ? span / 2 : span / 4)
    if (kind === 'steps') spec.steps = (spec.steps ?? []).map((x) => +x.toFixed(2))
    return modToValue(spec)
  }
  return structuredClone(v)
}

/** A reporter as a math part (for dropping time / mouse / random into a math hole). */
function asMath(p: Payload): MathNode | undefined {
  if (p.t !== 'new') return undefined
  if (p.item.t === 'math') return structuredClone(p.item.node)
  if (p.item.t === 'value' && p.item.value.k === 'fn') {
    const k = p.item.value.src
    if (k === 'mod:time') return { t: 'time' }
    if (k === 'mod:mouseX') return { t: 'mouseX' }
    if (k === 'mod:mouseY') return { t: 'mouseY' }
    if (k === 'mod:rnd') return { t: 'random' }
  }
  return undefined
}

function inputType(sk: Sketch, ref: ArgRef, cat: Catalog): string {
  if ('def' in ref) {
    const s = stmtOf(sk, ref.def)
    return s && s.k === 'def' && (s.value.k === 'tex' || s.value.k === 'ref') ? 'sampler2D' : 'float'
  }
  const call = findCallDeep(sk, ref.call)?.call
  return (call && cat.inputs(call.fn)[ref.i]?.type) ?? 'any'
}

/** a socket inside the thing being moved (dropping a stack into itself) */
function inside(sk: Sketch, ref: ArgRef, ids: string[]): boolean {
  return 'call' in ref && ids.includes(ref.call)
}

function setupStmt(what: Extract<PItem, { t: 'setup' }>['what'], sk: Sketch): Stmt {
  const name = (base: string) => {
    const taken = new Set(sk.stmts.flatMap((s) => (s.k === 'def' ? [s.name] : [])))
    for (let i = 1; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`
  }
  switch (what) {
    case 'bpm': return { id: newId('s'), k: 'setting', name: 'bpm', v: 120 }
    case 'speed': return { id: newId('s'), k: 'setting', name: 'speed', v: 1 }
    case 'cam': return { id: newId('s'), k: 'source', slot: 's0', init: { kind: 'cam' } }
    case 'screen': return { id: newId('s'), k: 'source', slot: 's0', init: { kind: 'screen' } }
    case 'image': return { id: newId('s'), k: 'source', slot: 's0', init: { kind: 'image', arg: 'https://' } }
    case 'video': return { id: newId('s'), k: 'source', slot: 's0', init: { kind: 'video', arg: 'https://' } }
    case 'render': return { id: newId('s'), k: 'render', target: 'all' }
    case 'raw': return rawStmt('// any JavaScript')
    case 'comment': return { id: newId('s'), k: 'comment', text: 'a note' }
    case 'var-num': return { id: newId('s'), k: 'def', name: name('amount'), decl: 'const', value: num(0.5) }
    case 'var-tex': return { id: newId('s'), k: 'def', name: name('pic'), decl: 'const', value: { k: 'tex', chain: makeChain(newCall('noise')) } }
  }
}

/** Put a new statement on the workspace at a point and in reading order. */
function place(sk: Sketch, meta: BlocksMeta, stmt: Stmt, at: XY): DropResult {
  const pos = { ...meta.pos, [stmt.id]: at }
  const withIt = sk.stmts.some((s) => s.id === stmt.id) ? sk : insertStmt(sk, sk.stmts.length, stmt)
  return { sketch: reorderByPosition(withIt, pos), view: { pos }, select: stmt.id }
}

export function applyDrop(sk: Sketch, meta: BlocksMeta, p: Payload, t: Target, at: XY, cat: Catalog = defaultCatalog): DropResult {
  const none = (error?: string): DropResult => ({ sketch: sk, view: {}, error })
  const loose = meta.loose ?? []
  if (t.t === 'none') return none()

  switch (p.t) {
    // ------------------------------------------------ blocks taken off a script (with everything under them)
    case 'stack': {
      const { sketch: off } = detachTail(sk, p.chainId, p.from)
      if (t.t === 'after') {
        if (t.chainId === p.chainId && t.index >= p.from) return none()
        // the target chain must still exist once the blocks are off (not a socket inside the blocks being moved)
        if (!callIdsInChain(off, t.chainId).length) return none()
        return { sketch: insertCalls(off, t.chainId, t.index, p.calls), view: {}, select: p.calls[0]?.id }
      }
      if (t.t === 'trash') return { sketch: off, view: {} }
      if (t.t === 'socket') return none('A stack in a socket needs a hat block (a picture maker) on top')
      if (t.t === 'empty') return { sketch: off, view: { loose: [...loose, { id: newId('l'), x: at.x, y: at.y, calls: p.calls }] } }
      return none()
    }
    case 'loose': {
      const L = loose.find((l) => l.id === p.id)
      if (!L) return none()
      const rest = loose.filter((l) => l.id !== p.id)
      if (t.t === 'after') return { sketch: insertCalls(sk, t.chainId, t.index, freshCalls(L.calls)), view: { loose: rest } }
      if (t.t === 'trash') return { sketch: sk, view: { loose: rest } }
      if (t.t === 'empty') return { sketch: sk, view: { loose: [...rest, { ...L, x: at.x, y: at.y }] } }
      return none('Loose blocks snap under a block of a script')
    }
    // ------------------------------------------------ a whole script
    case 'script': {
      const s = stmtOf(sk, p.stmtId)
      if (!s) return none()
      if (t.t === 'trash') {
        const pos = { ...meta.pos }
        delete pos[p.stmtId]
        return { sketch: removeStmt(sk, p.stmtId), view: { pos } }
      }
      if (t.t === 'socket') {
        if (s.k !== 'chain') return none('Only a script made of blocks fits in a socket')
        if (inputType(sk, t.ref, cat) !== 'sampler2D' && inputType(sk, t.ref, cat) !== 'any') return none('That socket takes a number')
        if (('call' in t.ref && locate(sk, t.ref.call)?.stmt.id === p.stmtId) || ('def' in t.ref && t.ref.def === p.stmtId)) return none('A script cannot go inside itself')
        const pos = { ...meta.pos }
        delete pos[p.stmtId]
        return { sketch: scriptIntoSocket(sk, p.stmtId, t.ref), view: { pos } }
      }
      // anywhere else: it moves, and the code follows the new reading order
      const pos = { ...meta.pos, [p.stmtId]: at }
      return { sketch: reorderByPosition(sk, pos), view: { pos } }
    }
    // ------------------------------------------------ a stack pulled out of a socket
    case 'nested': {
      const v = getArg(sk, p.from)
      if (!v || v.k !== 'tex') return none()
      if (t.t === 'trash') return { sketch: setArg(sk, p.from, DEFAULT), view: {} }
      if (t.t === 'socket') {
        if (inside(sk, t.ref, callIdsOf(v.chain))) return none('A stack cannot go inside itself')
        if (inputType(sk, t.ref, cat) === 'float') return none('That socket takes a number')
        return { sketch: setArg(setArg(sk, p.from, DEFAULT), t.ref, v), view: {} }
      }
      if (t.t === 'empty') {
        const r = socketToScript(sk, p.from)
        if (!r.stmt) return none()
        return place(r.sketch, meta, r.stmt, at)
      }
      return none()
    }
    // ------------------------------------------------ a reporter taken out of an input
    case 'value': {
      const back = restValue(p.value)
      if (t.t === 'trash' || t.t === 'empty') return { sketch: setArg(sk, p.from, back), view: {} }
      if (t.t === 'slot' || t.t === 'socket') {
        const want = inputType(sk, t.ref, cat)
        const tex = p.value.k === 'ref' || p.value.k === 'tex'
        if ((want === 'sampler2D') !== tex && want !== 'any' && p.value.k !== 'var') return none(tex ? 'That input takes a number' : 'That socket takes a picture')
        return { sketch: setArg(setArg(sk, p.from, back), t.ref, p.value), view: {} }
      }
      return none()
    }
    // ------------------------------------------------ from the palette
    case 'new': {
      const it = p.item
      if (it.t === 'fn') {
        const call = newCall(it.fn, cat)
        if (isGen(it.fn, cat)) {
          if (t.t === 'socket') {
            if (inputType(sk, t.ref, cat) === 'float') return none('That input takes a number')
            return { sketch: setArg(sk, t.ref, { k: 'tex', chain: makeChain(call) }), view: {}, select: call.id }
          }
          if (t.t === 'after') return none(`${it.fn} makes a picture from scratch: it starts a new script`)
          if (t.t === 'empty') {
            const r = addScript(sk, call, [], null)
            return place(r.sketch, meta, r.stmt, at)
          }
          return none()
        }
        if (t.t === 'after') return { sketch: insertCalls(sk, t.chainId, t.index, [call]), view: {}, select: call.id }
        if (t.t === 'empty') return { sketch: sk, view: { loose: [...loose, { id: newId('l'), x: at.x, y: at.y, calls: [call] }] } }
        if (t.t === 'socket') return none(`${it.fn} changes a picture: snap it under a block`)
        return none()
      }
      if (it.t === 'cap') {
        if (t.t !== 'after' || !t.stmtId) return none('Snap "show on" under a script')
        const s = stmtOf(sk, t.stmtId)
        if (!s || s.k !== 'chain' || !t.top) return none('Only a script can be shown on an output')
        return { sketch: setOut(sk, s.chain.id, it.out), view: {} }
      }
      if (it.t === 'setup') {
        if (t.t !== 'empty') return none('Drop this on an empty part of the workspace')
        return place(sk, meta, setupStmt(it.what, sk), at)
      }
      // reporters
      const m = asMath(p)
      if (t.t === 'math') {
        if (!m) return none('Only numbers, time, the mouse and math blocks fit here')
        const cur = getArg(sk, t.ref)
        const tree = cur && cur.k === 'fn' ? srcToMath(cur.src) : undefined
        if (!tree || !getAt(tree, t.path)) return none()
        return { sketch: setArg(sk, t.ref, { k: 'fn', src: mathToSrc(setAt(tree, t.path, m)) }), view: {} }
      }
      if (t.t === 'slot' || t.t === 'socket') {
        const want = inputType(sk, t.ref, cat)
        if (it.t === 'math') {
          if (want === 'sampler2D') return none('That socket takes a picture')
          return { sketch: setArg(sk, t.ref, { k: 'fn', src: mathToSrc(it.node) }), view: {} }
        }
        const v = reporterValue(it, sk, t.ref, cat)
        const tex = v.k === 'ref' || v.k === 'tex'
        if (want === 'sampler2D' && !tex && v.k !== 'var') return none('That socket takes a picture: try o0 or a stack')
        if (want === 'float' && tex) return none('That input takes a number')
        return { sketch: setArg(sk, t.ref, v), view: {} }
      }
      return none('Drop a reporter into a round slot of a block')
    }
  }
}

function callIdsInChain(sk: Sketch, chainId: string): string[] {
  for (const s of sk.stmts) {
    const found = s.k === 'chain' && s.chain.id === chainId ? s.chain : undefined
    if (found) return callIdsOf(found)
  }
  // a nested chain: find through any call in it
  let out: string[] = []
  const visit = (c: { id: string; gen: { args: Value[] }; mods: Array<{ args: Value[] }> }) => {
    if (c.id === chainId) out = callIdsOf(c as never)
    for (const call of [c.gen, ...c.mods]) for (const a of call.args) if (a.k === 'tex') visit(a.chain)
  }
  for (const s of sk.stmts) {
    if (s.k === 'chain') visit(s.chain)
    if (s.k === 'def' && s.value.k === 'tex') visit(s.value.chain)
  }
  return out
}
