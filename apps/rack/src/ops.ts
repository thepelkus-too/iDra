// Rack edits as pure functions of the sketch (and the rack's view state where a module lives outside the code, as bypass
// does). The UI commits each result as one undo step.
import {
  DEFAULT,
  OUT_NAMES,
  chainStmt,
  makeCall,
  makeChain,
  newId,
  num,
  randomSketch,
  type Call,
  type Catalog,
  type Chain,
  type OutName,
  type Sketch,
  type Stmt,
  type Value,
} from '@hydra-ipad/core'
import { findCallDeep, findChain, insertStmt, newCall, removeMod, setArg, updateCall, updateChain, type ArgRef } from './kit/model'
import { defaultSpec, modToValue, valueToMod, type ModKind, type ModSpec } from './kit/mods'
import { laneOf, layoutOf, type Bypassed, type RackMeta } from './view'

// ---------------------------------------------------------------- modules

/** A new chain `fn().out(lane)` (a new row in that lane, written after everything else so it is the one you see). */
export function addGenerator(sk: Sketch, lane: OutName | null, fn: string, cat: Catalog): { sketch: Sketch; stmt: Stmt } {
  const stmt = chainStmt(makeChain(newCall(fn, cat), [], lane))
  return { sketch: insertStmt(sk, sk.stmts.length, stmt), stmt }
}

/** Insert a module into a chain after position `after` (-1 = right after the generator). */
export function addModule(sk: Sketch, chainId: string, after: number, fn: string, cat: Catalog): { sketch: Sketch; call: Call } {
  const call = newCall(fn, cat)
  return { sketch: updateChain(sk, chainId, (c) => ({ ...c, mods: [...c.mods.slice(0, after + 1), call, ...c.mods.slice(after + 1)] })), call }
}

/** Swap a module's function, keeping the values of inputs whose names match. */
export function swapFn(sk: Sketch, callId: string, fn: string, cat: Catalog): Sketch {
  return updateCall(sk, callId, (c) => {
    if (c.fn === fn) return c
    if (!cat.has(fn)) return { ...c, fn }
    const oldIns = cat.has(c.fn) ? cat.inputs(c.fn) : []
    const fresh = newCall(fn, cat)
    const args: Value[] = cat.inputs(fn).map((inp, i) => {
      const j = oldIns.findIndex((o) => o.name === inp.name && o.type === inp.type)
      return j >= 0 && c.args[j] ? c.args[j] : (fresh.args[i] ?? DEFAULT)
    })
    while (args.length && args[args.length - 1].k === 'default') args.pop()
    return { ...c, fn, args }
  })
}

/** Take a module out of the code but keep it in place on the rack (dimmed), so bypass again puts it back where it was. */
export function bypass(sk: Sketch, meta: RackMeta, chainId: string, callId: string): { sketch: Sketch; bypass: Bypassed[] } {
  const chain = findChain(sk, chainId)
  const i = chain?.mods.findIndex((m) => m.id === callId) ?? -1
  if (!chain || i < 0) return { sketch: sk, bypass: meta.bypass ?? [] }
  const entry: Bypassed = { chain: chainId, after: i > 0 ? chain.mods[i - 1].id : null, call: chain.mods[i] }
  // modules bypassed after this one hang off it: re-anchor them to what it followed
  const rest = (meta.bypass ?? []).map((b) => (b.chain === chainId && b.after === callId ? { ...b, after: entry.after } : b))
  return { sketch: removeMod(sk, chainId, callId), bypass: [...rest, entry] }
}

export function unbypass(sk: Sketch, meta: RackMeta, callId: string): { sketch: Sketch; bypass: Bypassed[] } {
  const list = meta.bypass ?? []
  const b = list.find((x) => x.call.id === callId)
  if (!b) return { sketch: sk, bypass: list }
  const chain = findChain(sk, b.chain)
  const rest = list.filter((x) => x !== b)
  if (!chain) return { sketch: sk, bypass: rest }
  const at = b.after === null ? 0 : chain.mods.findIndex((m) => m.id === b.after) + 1
  return { sketch: updateChain(sk, b.chain, (c) => ({ ...c, mods: [...c.mods.slice(0, at), b.call, ...c.mods.slice(at)] })), bypass: rest }
}

/** Bypassed modules whose chain is gone are dropped from the view (they were never in the code). */
export function liveBypass(sk: Sketch, meta: RackMeta): Bypassed[] {
  return (meta.bypass ?? []).filter((b) => !!findChain(sk, b.chain))
}

// ---------------------------------------------------------------- modulation

/** Assign a modulation source to a number input: centred on the current value, depth a quarter of the hint range. */
export function assignMod(sk: Sketch, ref: ArgRef, kind: ModKind, cat: Catalog, template: Partial<ModSpec> = {}): Sketch {
  const { base, span } = baseOf(sk, ref, cat)
  const spec: ModSpec = { ...defaultSpec(kind, +base.toFixed(4), kind === 'steps' ? span / 2 : span / 4), ...template }
  if (kind === 'steps') spec.steps = (spec.steps ?? []).map((x) => +x.toFixed(2))
  if (template.amp === undefined && kind !== 'steps') spec.amp = +spec.amp.toFixed(4)
  return setArg(sk, ref, modToValue(spec))
}

/** Take the modulation off: the knob goes back to the value it was centred on. */
export function removeMod_(sk: Sketch, ref: ArgRef, cat: Catalog): Sketch {
  return setArg(sk, ref, num(+baseOf(sk, ref, cat).base.toFixed(4)))
}
export { removeMod_ as unassignMod }

/** The plain number under an input: its value, the centre of its modulator, or the default. */
export function baseOf(sk: Sketch, ref: ArgRef, cat: Catalog): { base: number; span: number; min: number; max: number } {
  const v = getValue(sk, ref)
  let min = 0
  let max = 1
  let d = 0
  if ('call' in ref) {
    const call = findCallDeep(sk, ref.call)?.call
    const inp = call && cat.has(call.fn) ? cat.inputs(call.fn)[ref.i] : undefined
    if (call && inp) ({ min, max } = cat.hint(call.fn, inp.name))
    if (typeof inp?.default === 'number') d = inp.default
  }
  const m = v ? valueToMod(v) : undefined
  const base = v?.k === 'num' ? v.v : m && m.kind !== 'expr' && m.kind !== 'steps' ? m.off : m?.kind === 'steps' ? (m.steps?.[0] ?? d) : d
  if (!('call' in ref)) {
    min = Math.min(0, base * 2)
    max = Math.max(1, Math.abs(base) * 2)
  }
  return { base, span: max - min, min, max }
}

function getValue(sk: Sketch, ref: ArgRef): Value | undefined {
  if ('def' in ref) {
    const s = sk.stmts.find((x) => x.id === ref.def)
    return s && s.k === 'def' ? s.value : undefined
  }
  return findCallDeep(sk, ref.call)?.call.args[ref.i]
}

// ---------------------------------------------------------------- lanes and routing

/** The chain you see in a lane (its last writer). */
export function activeChain(sk: Sketch, lane: OutName): Extract<Stmt, { k: 'chain' }> | undefined {
  const rows = layoutOf(sk).lanes[lane]
  return rows[rows.length - 1]?.stmt
}

/**
 * The routing matrix: lane `to` reads lane `from`. In an empty lane that starts a chain `src(from).out(to)`; otherwise it
 * appends `.blend(src(from), 0.5)` to the lane's chain (with `to === from` that is feedback).
 */
export function routeLane(sk: Sketch, to: OutName, from: OutName): { sketch: Sketch; call?: Call; stmt?: Stmt } {
  const active = activeChain(sk, to)
  const srcChain = makeChain(makeCall('src', [{ k: 'ref', name: from }]))
  if (!active) {
    const stmt = chainStmt({ ...srcChain, out: to })
    return { sketch: insertStmt(sk, sk.stmts.length, stmt), stmt }
  }
  const call = makeCall('blend', [{ k: 'tex', chain: srcChain }, num(0.5)])
  return { sketch: updateChain(sk, active.chain.id, (c) => ({ ...c, mods: [...c.mods, call] })), call }
}

/** Remove the modules of a lane that read `from` directly in a texture input (`blend(src(o1))`, `modulate(o1)`). */
export function unrouteLane(sk: Sketch, to: OutName, from: OutName): Sketch {
  const readsDirect = (v: Value) => (v.k === 'ref' && v.name === from) || (v.k === 'tex' && v.chain.mods.length === 0 && v.chain.gen.fn === 'src' && v.chain.gen.args[0]?.k === 'ref' && (v.chain.gen.args[0] as { name: string }).name === from)
  let next = sk
  for (const s of sk.stmts) {
    if (s.k !== 'chain' || laneOf(s.chain) !== to) continue
    for (const m of s.chain.mods) if (m.args.some(readsDirect)) next = removeMod(next, s.chain.id, m.id)
  }
  return next
}

// ---------------------------------------------------------------- dice, mutate, morph

/** Random numbers within each input's hint range for one call (modulated inputs and textures stay). */
export function randomizeCall(sk: Sketch, callId: string, cat: Catalog, rnd: () => number): Sketch {
  return updateCall(sk, callId, (c) => {
    if (!cat.has(c.fn)) return c
    const inputs = cat.inputs(c.fn)
    const args = inputs.map((inp, i) => {
      const a = c.args[i] ?? DEFAULT
      if (inp.type !== 'float' || (a.k !== 'num' && a.k !== 'default')) return a
      const h = cat.hint(c.fn, inp.name)
      const v = h.min + rnd() * (h.max - h.min)
      return num(h.integer ? Math.round(v) : +v.toFixed(h.max - h.min >= 10 ? 1 : 3))
    })
    while (args.length && args[args.length - 1].k === 'default') args.pop()
    return { ...c, args }
  })
}

/** Every plain number of a chain nudged by up to ±amount of its hint range, kept inside the range. */
export function mutateChain(sk: Sketch, chainId: string, cat: Catalog, rnd: () => number, amount = 0.15): Sketch {
  const fixCall = (c: Call): Call => {
    const inputs = cat.has(c.fn) ? cat.inputs(c.fn) : []
    return {
      ...c,
      args: c.args.map((a, i) => {
        if (a.k === 'tex') return { ...a, chain: fixChain(a.chain) }
        if (a.k !== 'num' || inputs[i]?.type !== 'float') return a
        const h = cat.hint(c.fn, inputs[i].name)
        const span = h.max - h.min || 1
        const v = Math.max(Math.min(h.min, a.v), Math.min(Math.max(h.max, a.v), a.v + (rnd() * 2 - 1) * amount * span))
        return num(h.integer ? Math.round(v) : +v.toFixed(span >= 10 ? 1 : 3))
      }),
    }
  }
  const fixChain = (c: Chain): Chain => ({ ...c, gen: fixCall(c.gen), mods: c.mods.map(fixCall) })
  return updateChain(sk, chainId, fixChain)
}

/** A whole random chain for a lane (replacing the one you see there), from core's randomSketch. */
export function randomLane(sk: Sketch, lane: OutName, cat: Catalog, seed: number): Sketch {
  const r = randomSketch(seed, { catalog: cat, out: lane })
  const fresh = r.stmts.find((s) => s.k === 'chain')
  if (!fresh || fresh.k !== 'chain') return sk
  const chain: Chain = { ...fresh.chain, id: newId('h'), out: lane }
  const active = activeChain(sk, lane)
  if (!active) return insertStmt(sk, sk.stmts.length, chainStmt(chain))
  return { ...sk, stmts: sk.stmts.map((s) => (s.id === active.id ? { ...active, chain, src: undefined } : s)) }
}

/** Mutate every chain of every lane that is not frozen (the target of "morph to random"). */
export function mutateLanes(sk: Sketch, cat: Catalog, rnd: () => number, frozen: OutName[] = [], amount = 0.35): Sketch {
  let next = sk
  for (const o of OUT_NAMES) {
    if (frozen.includes(o)) continue
    for (const r of layoutOf(sk).lanes[o]) next = mutateChain(next, r.stmt.chain.id, cat, rnd, amount)
  }
  return next
}
