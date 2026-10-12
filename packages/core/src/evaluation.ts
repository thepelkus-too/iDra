// The evaluation model (docs/evaluation.md): when edits reach the screen. Held and draft chains are plain Hydra in the
// sketch itself, written as the revivable `//` comments of disable.ts, with no marker syntax:
//
//   osc(10, 0.1).rotate(0.2).out(o0)                 // playing on o0
//   // osc(10, 0.1).rotate(0.5).kaleid(4).out(o0)    // its draft (pending edits)
//   // noise(3).colorama(0.2).out(o1)                // a draft for o1, never run
//
// A draft is a disabled chain statement; it pairs with the enabled chain drawing the same output. Everything here is a pure
// function of the sketch; the runtime's partial run (`runtime.runPart`) evaluates what these return.
import { contentString, reId, withMeta, type Call, type Chain, type ChainStmt, type OutName, type Sketch, type Stmt, type Value } from './ir'
import { namesUsed, setDisabled } from './disable'

export type ChainState = 'following' | 'held' | 'draft'

/** Everything aimed at one output. */
export interface OutputGroup {
  out: OutName
  /** the enabled chain statement that draws `out`: the last one, as later code wins in Hydra */
  playing?: string
  /** earlier enabled chain statements aimed at `out`, overridden by `playing` */
  shadowed: string[]
  /** disabled chain statements aimed at `out`, in statement order */
  drafts: string[]
  /** the draft holding `playing`'s pending edits: the draft nearest to it (the one after it on a tie) */
  pending?: string
}

const isChain = (s: Stmt): s is ChainStmt => s.k === 'chain'
const outOf = (s: Stmt): OutName | undefined => (isChain(s) && s.chain.out ? s.chain.out : undefined)

/** One entry per output that has a chain aimed at it, playing or drafted, in o0…o3 order. */
export function outputGroups(sketch: Sketch): OutputGroup[] {
  const by = new Map<OutName, { enabled: number[]; drafts: number[] }>()
  sketch.stmts.forEach((s, i) => {
    const out = outOf(s)
    if (!out) return
    const g = by.get(out) ?? { enabled: [], drafts: [] }
    ;(s.disabled ? g.drafts : g.enabled).push(i)
    by.set(out, g)
  })
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([out, g]) => {
      const p = g.enabled[g.enabled.length - 1]
      let pending: number | undefined
      if (p !== undefined) {
        for (const d of g.drafts) {
          if (pending === undefined || Math.abs(d - p) < Math.abs(pending - p) || (Math.abs(d - p) === Math.abs(pending - p) && d > p)) pending = d
        }
      }
      const id = (i: number) => sketch.stmts[i].id
      return {
        out,
        playing: p === undefined ? undefined : id(p),
        shadowed: g.enabled.slice(0, -1).map(id),
        drafts: g.drafts.map(id),
        pending: pending === undefined ? undefined : id(pending),
      }
    })
}

const chainStmtOf = (sketch: Sketch, id: string): ChainStmt | undefined => {
  const s = sketch.stmts.find((x) => x.id === id)
  return s && isChain(s) ? s : undefined
}

export interface ChainInfo {
  state: ChainState
  out?: OutName
  /** the playing chain statement of the pair (this one, when it plays) */
  playing?: string
  /** the draft with the pending edits (this one, when it is a draft paired with a playing chain) */
  pending?: string
  /** pending changes between `playing` and `pending` */
  changes: ChainChange[]
}

/**
 * The state of chain statement `id`:
 * - `draft`: a disabled chain with nothing of it playing (an alternative, or a chain never run). When a chain plays on its
 *   output and this draft is the nearest one, `playing` and `changes` describe the pair;
 * - `held`: it plays and has a draft copy with pending edits, or its follow switch is off (`follow: false`);
 * - `following`: it plays, has no draft copy, and edits re-run it.
 * Shadowed chains (an earlier chain on the same output) read as following with `playing` set to the chain that wins.
 */
export function chainInfo(sketch: Sketch, id: string, opts: { follow?: boolean } = {}): ChainInfo {
  const s = chainStmtOf(sketch, id)
  const out = s ? outOf(s) : undefined
  const g = out ? outputGroups(sketch).find((x) => x.out === out) : undefined
  if (!s || !g) return { state: s?.disabled ? 'draft' : 'following', out, changes: [] }
  const pair = g.playing && g.pending ? { playing: g.playing, pending: g.pending } : undefined
  const changes = pair && (pair.playing === id || pair.pending === id) ? pendingChanges(sketch, pair.playing) : []
  if (s.disabled) return { state: 'draft', out, playing: g.playing, pending: pair?.pending === id ? id : undefined, changes: pair?.pending === id ? changes : [] }
  if (g.playing !== id) return { state: 'following', out, playing: g.playing, changes: [] }
  const held = !!pair || opts.follow === false
  return { state: held ? 'held' : 'following', out, playing: id, pending: pair?.pending, changes }
}

// ---------------------------------------------------------------- changes (an IR diff, one entry per call)

export type ChangeKind = 'arg' | 'add' | 'remove' | 'move' | 'swap' | 'toggle'

export interface ChainChange {
  /** stable while the two chains do not change: pass it to applyChanges / discardChanges */
  id: string
  kind: ChangeKind
  /** the call in the playing chain (all but `add`) */
  from?: string
  /** the call in the draft (all but `remove`) */
  to?: string
  /** the function: the draft's for add and swap, the playing chain's otherwise */
  fn: string
  /** `arg` only: the argument index */
  index?: number
  /** in plain words: "rotate: 0.2 → 0.5", "kaleid added", "osc → noise" */
  label: string
}

type Slot =
  | { t: 'anchor'; p: Call; d: Call; changes: ChainChange[] }
  | { t: 'swap'; p: Call; d: Call; change: ChainChange }
  | { t: 'remove'; p: Call; change: ChainChange }
  | { t: 'add'; d: Call; change: ChainChange }
  | { t: 'move-src'; p: Call; change: ChainChange }
  | { t: 'move-dst'; p: Call; d: Call; change: ChainChange }

interface Alignment {
  gen: Slot
  /** gap g holds the draft-side items then the playing-side items that sit before anchor g (gap K: after the last) */
  gaps: Array<{ draft: Slot[]; playing: Slot[] }>
  anchors: Slot[]
  changes: ChainChange[]
}

const DEFAULT_VALUE: Value = { k: 'default' }
const sameContent = (a: unknown, b: unknown) => contentString(a) === contentString(b)
const callContent = (c: Call) => contentString({ fn: c.fn, args: c.args, disabled: !!c.disabled })

function showValue(v: Value | undefined): string {
  if (!v) return 'default'
  switch (v.k) {
    case 'num':
      return String(Math.round(v.v * 1000) / 1000)
    case 'default':
      return 'default'
    case 'ref':
    case 'var':
      return v.name
    case 'fn':
    case 'js':
      return v.src.length > 24 ? v.src.slice(0, 23) + '…' : v.src
    case 'arr':
      return `[${v.v.join(', ')}]`
    case 'vec4':
      return `[${v.v.join(', ')}]`
    case 'tex':
      return `${v.chain.gen.fn}(…)`
  }
}

/** Argument and on/off changes between two calls of the same function. */
function callChanges(p: Call, d: Call, at: string): ChainChange[] {
  const out: ChainChange[] = []
  const n = Math.max(p.args.length, d.args.length)
  for (let i = 0; i < n; i++) {
    const a = p.args[i] ?? DEFAULT_VALUE
    const b = d.args[i] ?? DEFAULT_VALUE
    if (!sameContent(a, b)) out.push({ id: `arg:${at}:${i}`, kind: 'arg', from: p.id, to: d.id, fn: p.fn, index: i, label: `${p.fn}: ${showValue(a)} → ${showValue(b)}` })
  }
  if (!!p.disabled !== !!d.disabled) out.push({ id: `toggle:${at}`, kind: 'toggle', from: p.id, to: d.id, fn: p.fn, label: `${p.fn} switched ${d.disabled ? 'off' : 'on'}` })
  return out
}

/** Longest common subsequence of the modifiers, matched by function; equal calls weigh more than calls that only share a name. */
function lcs(a: Call[], b: Call[]): Array<[number, number]> {
  const n = a.length
  const m = b.length
  const w = (i: number, j: number) => (a[i].fn !== b[j].fn ? 0 : callContent(a[i]) === callContent(b[j]) ? 3 : 2)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const k = w(i, j)
      dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1], k ? k + dp[i + 1][j + 1] : 0)
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    const k = w(i, j)
    if (k && dp[i][j] === k + dp[i + 1][j + 1]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return pairs
}

function align(playing: Chain, draft: Chain): Alignment {
  const changes: ChainChange[] = []
  let gen: Slot
  if (playing.gen.fn === draft.gen.fn) {
    const cs = callChanges(playing.gen, draft.gen, 'gen')
    gen = { t: 'anchor', p: playing.gen, d: draft.gen, changes: cs }
    changes.push(...cs)
  } else {
    const change: ChainChange = { id: 'swap:gen', kind: 'swap', from: playing.gen.id, to: draft.gen.id, fn: draft.gen.fn, label: `${playing.gen.fn} → ${draft.gen.fn}` }
    gen = { t: 'swap', p: playing.gen, d: draft.gen, change }
    changes.push(change)
  }

  const P = playing.mods
  const D = draft.mods
  const pairs = lcs(P, D)
  const pGap = new Array<number>(P.length)
  const dGap = new Array<number>(D.length)
  const matchedP = new Set(pairs.map(([i]) => i))
  const matchedD = new Set(pairs.map(([, j]) => j))
  {
    let k = 0
    for (let i = 0; i < P.length; i++) {
      while (k < pairs.length && pairs[k][0] < i) k++
      pGap[i] = k
    }
    k = 0
    for (let j = 0; j < D.length; j++) {
      while (k < pairs.length && pairs[k][1] < j) k++
      dGap[j] = k
    }
  }
  const anchors: Slot[] = pairs.map(([i, j]) => {
    const cs = callChanges(P[i], D[j], P[i].id)
    return { t: 'anchor', p: P[i], d: D[j], changes: cs }
  })
  // moves: an unmatched call that reappears unchanged somewhere else
  const restP = P.map((_, i) => i).filter((i) => !matchedP.has(i))
  const restD = D.map((_, j) => j).filter((j) => !matchedD.has(j))
  const moveOfP = new Map<number, number>()
  const movedD = new Set<number>()
  for (const i of restP) {
    const j = restD.find((x) => !movedD.has(x) && callContent(D[x]) === callContent(P[i]))
    if (j === undefined) continue
    moveOfP.set(i, j)
    movedD.add(j)
  }
  const gaps: Alignment['gaps'] = Array.from({ length: pairs.length + 1 }, () => ({ draft: [], playing: [] }))
  const moveChange = new Map<number, ChainChange>()
  for (const [i, j] of moveOfP) moveChange.set(i, { id: `move:${P[i].id}`, kind: 'move', from: P[i].id, to: D[j].id, fn: P[i].fn, label: `${P[i].fn} moved` })
  // within a gap, unmatched calls pair up in order as swaps (one function replaced by another in place)
  for (let g = 0; g < gaps.length; g++) {
    const ps = restP.filter((i) => pGap[i] === g && !moveOfP.has(i))
    const ds = restD.filter((j) => dGap[j] === g && !movedD.has(j))
    const nSwap = Math.min(ps.length, ds.length)
    const swapOfD = new Map<number, number>()
    for (let k = 0; k < nSwap; k++) swapOfD.set(ds[k], ps[k])
    const swapped = new Set(swapOfD.values())
    for (let j = 0; j < D.length; j++) {
      if (dGap[j] !== g || matchedD.has(j)) continue
      if (movedD.has(j)) {
        const i = [...moveOfP].find(([, x]) => x === j)![0]
        gaps[g].draft.push({ t: 'move-dst', p: P[i], d: D[j], change: moveChange.get(i)! })
      } else if (swapOfD.has(j)) {
        const i = swapOfD.get(j)!
        gaps[g].draft.push({ t: 'swap', p: P[i], d: D[j], change: { id: `swap:${P[i].id}`, kind: 'swap', from: P[i].id, to: D[j].id, fn: D[j].fn, label: `${P[i].fn} → ${D[j].fn}` } })
      } else gaps[g].draft.push({ t: 'add', d: D[j], change: { id: `add:${D[j].id}`, kind: 'add', to: D[j].id, fn: D[j].fn, label: `${D[j].fn} added` } })
    }
    for (let i = 0; i < P.length; i++) {
      if (pGap[i] !== g || matchedP.has(i) || swapped.has(i)) continue
      if (moveOfP.has(i)) gaps[g].playing.push({ t: 'move-src', p: P[i], change: moveChange.get(i)! })
      else gaps[g].playing.push({ t: 'remove', p: P[i], change: { id: `remove:${P[i].id}`, kind: 'remove', from: P[i].id, fn: P[i].fn, label: `${P[i].fn} removed` } })
    }
  }
  // the list in chain order: per gap, draft side then playing side, then its anchor
  for (let g = 0; g < gaps.length; g++) {
    for (const s of gaps[g].draft) if (s.t !== 'anchor') changes.push(s.change)
    for (const s of gaps[g].playing) if (s.t === 'remove') changes.push(s.change)
    if (g < anchors.length) changes.push(...(anchors[g] as Extract<Slot, { t: 'anchor' }>).changes)
  }
  return { gen, gaps, anchors, changes }
}

/**
 * What a draft changes compared with the playing chain, one entry per call: a call added, removed, moved or swapped for
 * another function, one argument's value, or a modifier switched off or on. Ten drags on one argument are one change, and
 * an edit that was undone is none: this compares the two chains, it is not an edit history. A call that was added or
 * swapped in is one change with whatever arguments it has, so nothing in the list depends on anything else.
 */
export function chainChanges(playing: Chain, draft: Chain): ChainChange[] {
  return align(playing, draft).changes
}

/** Pairs of calls that are the same call in both versions (playing call id → draft call id): unchanged, edited or moved. */
export function callPairs(playing: Chain, draft: Chain): Map<string, string> {
  const a = align(playing, draft)
  const m = new Map<string, string>()
  if (a.gen.t === 'anchor') m.set(a.gen.p.id, a.gen.d.id)
  for (const s of a.anchors) if (s.t === 'anchor') m.set(s.p.id, s.d.id)
  for (const g of a.gaps) for (const s of g.draft) if (s.t === 'move-dst') m.set(s.p.id, s.d.id)
  return m
}

/** A copy of a call with fresh ids. Its text records stay (they are checked against its content when written). */
const freshCall = (c: Call): Call => {
  const copy = reId(structuredClone(c))
  // a revived disabled modifier remembers its comment opener; the copy may land where it is not a comment
  if (copy.src?.lead !== undefined) {
    const { lead: _l, ...rest } = copy.src
    void _l
    copy.src = rest
  }
  return copy
}

/**
 * The chain with the changes in `selected` applied. `keep: 'playing'` builds on the playing chain (its ids stay, calls taken
 * from the draft get fresh ids): what plays after running some changes. `keep: 'draft'` builds on the draft: the draft with
 * every unselected change undone. Selecting every change gives the draft's calls in the draft's order; selecting none gives
 * the playing chain's.
 */
export function composeChain(playing: Chain, draft: Chain, selected: ReadonlySet<string>, keep: 'playing' | 'draft'): Chain {
  const a = align(playing, draft)
  const fromP = (c: Call) => (keep === 'playing' ? c : freshCall(c))
  const fromD = (c: Call) => (keep === 'draft' ? c : freshCall(c))
  const mix = (s: Extract<Slot, { t: 'anchor' }>): Call => {
    const base = keep === 'playing' ? s.p : s.d
    let args = base.args.slice()
    let disabled = !!base.disabled
    for (const c of s.changes) {
      const take = selected.has(c.id) ? s.d : s.p
      if (c.kind === 'arg') {
        while (args.length <= c.index!) args.push(DEFAULT_VALUE)
        args[c.index!] = take.args[c.index!] ?? DEFAULT_VALUE
      } else if (c.kind === 'toggle') disabled = !!take.disabled
    }
    while (args.length && args[args.length - 1].k === 'default') args = args.slice(0, -1)
    const changed = !sameContent(args, base.args) || disabled !== !!base.disabled
    if (!changed) return base
    const next: Call = { ...base, args }
    if (disabled) next.disabled = true
    else delete next.disabled
    return next
  }
  const emit = (s: Slot): Call | undefined => {
    switch (s.t) {
      case 'anchor':
        return mix(s)
      case 'swap':
        return selected.has(s.change.id) ? fromD(s.d) : fromP(s.p)
      case 'add':
        return selected.has(s.change.id) ? fromD(s.d) : undefined
      case 'remove':
        return selected.has(s.change.id) ? undefined : fromP(s.p)
      case 'move-src':
        return selected.has(s.change.id) ? undefined : fromP(s.p)
      case 'move-dst':
        // the same call either way; keep the base side's node
        return selected.has(s.change.id) ? (keep === 'playing' ? s.p : s.d) : undefined
    }
  }
  const mods: Call[] = []
  for (let g = 0; g < a.gaps.length; g++) {
    for (const s of a.gaps[g].draft) {
      const c = emit(s)
      if (c) mods.push(c)
    }
    for (const s of a.gaps[g].playing) {
      const c = emit(s)
      if (c) mods.push(c)
    }
    if (g < a.anchors.length) mods.push(emit(a.anchors[g])!)
  }
  const gen = emit(a.gen)!
  const base = keep === 'playing' ? playing : draft
  const next: Chain = { ...base, gen, mods }
  // a different list of calls: preserved gaps are reused by position, which is only safe while they are plain whitespace
  const ids = (c: Chain) => [c.gen, ...c.mods].map((x) => x.id).join(',')
  if (ids(next) !== ids(base) && next.src?.gaps.some((g) => /\S/.test(g))) delete next.src
  return next
}

// ---------------------------------------------------------------- operations on the sketch

export interface RunPlan {
  sketch: Sketch
  /** statement ids for `runtime.runPart` (empty when nothing needs to run) */
  run: string[]
}

/** Changes pending on playing chain `playingId`: the diff to its nearest draft (empty when it has none). */
export function pendingChanges(sketch: Sketch, playingId: string): ChainChange[] {
  const pair = pairOf(sketch, playingId)
  return pair ? chainChanges(pair.playing.chain, pair.draft.chain) : []
}

function pairOf(sketch: Sketch, playingId: string): { playing: ChainStmt; draft: ChainStmt } | undefined {
  const g = outputGroups(sketch).find((x) => x.playing === playingId)
  if (!g?.pending) return undefined
  return { playing: chainStmtOf(sketch, playingId)!, draft: chainStmtOf(sketch, g.pending)! }
}

const replaceStmt = (sketch: Sketch, id: string, f: (s: Stmt) => Stmt | undefined): Sketch => ({
  ...sketch,
  stmts: sketch.stmts.flatMap((s) => {
    if (s.id !== id) return [s]
    const n = f(s)
    return n ? [n] : []
  }),
})

/**
 * Run a draft (the whole chain): it is uncommented and every chain that was drawing its output is commented out, so the
 * chain that was playing becomes a draft and running it again switches back (A/B). Defs the draft needs that are switched
 * off are switched on with it. `run` is what to evaluate: the draft and those defs.
 */
export function runDraft(sketch: Sketch, draftId: string): RunPlan {
  const d = chainStmtOf(sketch, draftId)
  const out = d && outOf(d)
  if (!d || !out || !d.disabled) return { sketch, run: [] }
  let next = sketch
  for (const s of sketch.stmts) if (s.id !== draftId && !s.disabled && outOf(s) === out) next = setDisabled(next, s.id, true)
  const before = new Set(next.stmts.filter((s) => s.disabled).map((s) => s.id))
  next = setDisabled(next, draftId, false, { cascade: true })
  const enabled = next.stmts.filter((s) => before.has(s.id) && !s.disabled).map((s) => s.id)
  return { sketch: next, run: enabled }
}

/** Revert: delete the draft copy, so the playing chain is following again (unless its follow switch is off). */
export function revertDraft(sketch: Sketch, draftId: string): Sketch {
  const d = chainStmtOf(sketch, draftId)
  if (!d?.disabled) return sketch
  const i = sketch.stmts.indexOf(d)
  const stmts = sketch.stmts.filter((s) => s !== d)
  // what followed takes the draft's leading whitespace (a draft on the first line leaves no blank line behind)
  const next = stmts[i]
  if (next?.src && d.src && !(next.k === 'comment' && next.trailing)) stmts[i] = { ...next, src: { ...next.src, before: d.src.before } } as Stmt
  return { ...sketch, stmts }
}

/**
 * Run some of a held chain's pending changes: the playing chain is edited to include them (in place: no A/B copy) and
 * re-run; the draft keeps the rest. When nothing is left pending the draft goes away, unless `keepDraft` (the chain's
 * follow switch is off, so it stays held with nothing pending: the caller decides, as the switch is view state).
 */
export function applyChanges(sketch: Sketch, playingId: string, changeIds: Iterable<string>, opts: { keepDraft?: boolean } = {}): RunPlan {
  const pair = pairOf(sketch, playingId)
  if (!pair) return { sketch, run: [] }
  const all = chainChanges(pair.playing.chain, pair.draft.chain)
  const want = new Set([...changeIds].filter((id) => all.some((c) => c.id === id)))
  if (!want.size) return { sketch, run: [] }
  const chain = composeChain(pair.playing.chain, pair.draft.chain, want, 'playing')
  let next = replaceStmt(sketch, playingId, (s) => ({ ...(s as ChainStmt), chain }))
  if (!opts.keepDraft && chainChanges(chain, pair.draft.chain).length === 0) next = revertDraft(next, pair.draft.id)
  return { sketch: next, run: [playingId] }
}

/** Discard some pending changes: only the draft is edited. A draft left identical to the playing chain goes away (unless `keepDraft`). */
export function discardChanges(sketch: Sketch, playingId: string, changeIds: Iterable<string>, opts: { keepDraft?: boolean } = {}): Sketch {
  const pair = pairOf(sketch, playingId)
  if (!pair) return sketch
  const drop = new Set(changeIds)
  const all = chainChanges(pair.playing.chain, pair.draft.chain)
  const keepIds = new Set(all.filter((c) => !drop.has(c.id)).map((c) => c.id))
  if (keepIds.size === all.length) return sketch
  const chain = composeChain(pair.playing.chain, pair.draft.chain, keepIds, 'draft')
  if (!opts.keepDraft && keepIds.size === 0) return revertDraft(sketch, pair.draft.id)
  return replaceStmt(sketch, pair.draft.id, (s) => ({ ...(s as ChainStmt), chain }))
}

/**
 * A copy of chain statement `id` with fresh ids, on the line after it (after a comment trailing it); `disabled` makes it a
 * draft. The copy keeps the original's text records, so it is written exactly like the original, commented out.
 */
function copyAfter(sketch: Sketch, id: string, disabled: boolean): { sketch: Sketch; id: string } | undefined {
  const i = sketch.stmts.findIndex((s) => s.id === id)
  const s = sketch.stmts[i]
  if (!s || !isChain(s)) return undefined
  const copy = reId(structuredClone(s))
  if (copy.src) copy.src = { ...copy.src, before: '\n' }
  if (disabled) copy.disabled = true
  else delete copy.disabled
  let at = i + 1
  while (sketch.stmts[at]?.k === 'comment' && (sketch.stmts[at] as Extract<Stmt, { k: 'comment' }>).trailing) at++
  const stmts = sketch.stmts.slice()
  stmts.splice(at, 0, copy)
  return { sketch: { ...sketch, stmts }, id: copy.id }
}

/**
 * Hold a playing chain for editing: a draft copy is inserted right after it, and edits go to the copy until Run (or
 * Revert). Returns the existing pending draft when there is one already.
 */
export function holdCopy(sketch: Sketch, playingId: string): { sketch: Sketch; draft?: string } {
  const pair = pairOf(sketch, playingId)
  if (pair) return { sketch, draft: pair.draft.id }
  const s = chainStmtOf(sketch, playingId)
  if (!s || s.disabled || !outOf(s)) return { sketch }
  const r = copyAfter(sketch, playingId, true)!
  return { sketch: r.sketch, draft: r.id }
}

/**
 * Copy chain: a draft copy aimed at the same output, right after the original (playing or not). Preparing a replacement
 * for a live chain needs nothing else: keep tweaking the original, restructure the copy, run the copy when ready.
 */
export function duplicateAsDraft(sketch: Sketch, id: string): { sketch: Sketch; draft?: string } {
  const r = copyAfter(sketch, id, true)
  return r ? { sketch: r.sketch, draft: r.id } : { sketch }
}

/** Playing chains with a pending draft, and how many changes each has. */
export function heldChains(sketch: Sketch): Array<{ out: OutName; playing: string; draft: string; changes: number }> {
  return outputGroups(sketch).flatMap((g) => {
    if (!g.playing || !g.pending) return []
    const n = pendingChanges(sketch, g.playing).length
    return n ? [{ out: g.out, playing: g.playing, draft: g.pending, changes: n }] : []
  })
}

/**
 * Run all held: every held chain's draft runs at once (each as a whole-chain Run, so each old version stays as a draft to
 * switch back to). Unlike Run all, which runs the buffer as it stands with drafts skipped.
 */
export function runAllHeld(sketch: Sketch): RunPlan {
  let next = sketch
  const run = new Set<string>()
  for (const h of heldChains(sketch)) {
    const r = runDraft(next, h.draft)
    next = r.sketch
    r.run.forEach((id) => run.add(id))
  }
  return { sketch: next, run: next.stmts.filter((s) => run.has(s.id)).map((s) => s.id) }
}

/**
 * What a partial run of `ids` evaluates, in sketch order: those statements (enabled ones), plus the enabled `def`s they
 * read (transitively) and the source statements of the sources they read. Settings (`speed`, `bpm`) and raw code run only
 * when they are in `ids`; everything else stays as the frame has it.
 */
export function partialRunSet(sketch: Sketch, ids: Iterable<string>): string[] {
  const want = new Set(ids)
  const live = sketch.stmts.filter((s) => !s.disabled)
  const out = new Set<string>()
  const queue: Stmt[] = live.filter((s) => want.has(s.id))
  const defsByName = new Map<string, Stmt[]>()
  const srcBySlot = new Map<string, Stmt>()
  for (const s of live) {
    if (s.k === 'def') defsByName.set(s.name, [...(defsByName.get(s.name) ?? []), s])
    else if (s.k === 'source') srcBySlot.set(s.slot, s)
  }
  while (queue.length) {
    const s = queue.shift()!
    if (out.has(s.id) || s.k === 'comment') continue
    out.add(s.id)
    for (const n of namesUsed(s)) for (const d of defsByName.get(n) ?? []) queue.push(d)
    for (const slot of sourcesRead(s)) {
      const src = srcBySlot.get(slot)
      if (src) queue.push(src)
    }
  }
  return sketch.stmts.filter((s) => out.has(s.id)).map((s) => s.id)
}

function sourcesRead(s: Stmt): Set<string> {
  const out = new Set<string>()
  const val = (v: Value) => {
    if (v.k === 'ref' && v.name.startsWith('s')) out.add(v.name)
    else if (v.k === 'tex') chain(v.chain)
  }
  const chain = (c: Chain) => {
    for (const call of [c.gen, ...c.mods]) if (!call.disabled) call.args.forEach(val)
  }
  if (s.k === 'chain') chain(s.chain)
  else if (s.k === 'def') val(s.value)
  return out
}

// ---------------------------------------------------------------- follow switch (view state) and sync

interface EvalMeta {
  /** chain statement ids whose follow switch is off */
  hold?: string[]
}

/**
 * Whether edits to chain `id` go straight to the playing chain (`true`) or first make a draft copy. The only state of the
 * model that is not code: it decides where an edit goes, never what runs, so it lives in `sketch.meta[app]`.
 */
export function followsEdits(sketch: Sketch, app: string, id: string, dflt = true): boolean {
  const m = sketch.meta?.[app] as EvalMeta | undefined
  if (m?.hold?.includes(id)) return false
  return dflt
}

export function setFollow(sketch: Sketch, app: string, id: string, on: boolean): Sketch {
  const m = (sketch.meta?.[app] as EvalMeta | undefined) ?? {}
  const hold = (m.hold ?? []).filter((x) => x !== id && sketch.stmts.some((s) => s.id === x))
  if (!on) hold.push(id)
  return withMeta(sketch, app, { hold })
}

/**
 * Where an edit to chain `id` should go: the pending draft when the chain is held, a new draft copy when its follow switch
 * is off (or everything is held: `holdAll`), else the chain itself. Editors call this before applying a structural edit or
 * a number change to a playing chain, and map call ids with `callPairs` when the edit targets a call.
 */
export function editTarget(sketch: Sketch, id: string, opts: { follow?: boolean; holdAll?: boolean } = {}): { sketch: Sketch; target: string; copied: boolean } {
  const s = chainStmtOf(sketch, id)
  if (!s || s.disabled) return { sketch, target: id, copied: false }
  const g = outputGroups(sketch).find((x) => x.playing === id)
  if (!g) return { sketch, target: id, copied: false }
  if (g.pending) return { sketch, target: g.pending, copied: false }
  if (opts.follow === false || opts.holdAll) {
    const r = holdCopy(sketch, id)
    if (r.draft) return { sketch: r.sketch, target: r.draft, copied: true }
  }
  return { sketch, target: id, copied: false }
}

/** What the runtime last ran on one output (`runtime.playing()`). */
export interface PlayingChain {
  /** the statement it ran as (ids change when the code is re-imported; compare chains, not ids) */
  stmt: string
  /** the chain as it runs now: disabled modifiers left out, live numbers applied */
  chain: Chain
}

export type PlayingMap = Partial<Record<OutName, PlayingChain>>

/**
 * Outputs where the screen and the document disagree: the document's chain for the output (the enabled one that wins)
 * differs from what the runtime is drawing there, or one side has a chain and the other none. Once pieces run separately
 * (vanilla Run all, a held chain's Run) this can happen, e.g. after deleting a chain that was playing; the editor then
 * shows "out of sync" with a one-tap Run all.
 */
export function outOfSync(sketch: Sketch, playing: PlayingMap): OutName[] {
  const docs = new Map<OutName, Chain>()
  for (const g of outputGroups(sketch)) if (g.playing) docs.set(g.out, activeOnly(chainStmtOf(sketch, g.playing)!.chain))
  const outs = new Set<OutName>([...docs.keys(), ...(Object.keys(playing) as OutName[])])
  return [...outs].sort().filter((o) => {
    const d = docs.get(o)
    const p = playing[o]?.chain
    if (!d || !p) return !!d !== !!p
    return contentString(d) !== contentString(p)
  })
}

/** The chain with disabled modifiers left out (as it runs). */
export function activeOnly(c: Chain): Chain {
  const fix = (call: Call): Call => (call.args.some((a) => a.k === 'tex') ? { ...call, args: call.args.map((a) => (a.k === 'tex' ? { ...a, chain: activeOnly(a.chain) } : a)) } : call)
  return { ...c, gen: fix(c.gen), mods: c.mods.filter((m) => !m.disabled).map(fix) }
}
