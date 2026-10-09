// The default view of any sketch (including one imported from plain text) and the helpers that keep ids stable
// when the text is edited. Pure: no DOM, unit-tested against the whole corpus (test/view.test.ts).
import {
  contentHash,
  describe,
  type Chain,
  type Call,
  type OutName,
  type Sketch,
  type Stmt,
  type Value,
} from '@hydra-ipad/core'

export const APP = 'stack'

export type RowKind = 'chain' | 'var' | 'note' | 'raw' | 'render' | 'source' | 'setting'

export interface StackMeta {
  v: 1
  mode: 'blocks' | 'code'
  /** one entry per statement, in source order, at the time the view was built */
  rows: Array<{ id: string; kind: RowKind }>
  /** the chain strip as built: source order, labelled by output */
  chains: Array<{ id: string; label: string; flag?: 'not-rendered' | 'shadowed' }>
  /** statement id of the chain the dice, mutate and the strip act on */
  active?: string
  renderMode: 'single' | 'all'
}

export function rowKind(s: Stmt): RowKind {
  switch (s.k) {
    case 'chain': return 'chain'
    case 'def': return 'var'
    case 'comment': return 'note'
    case 'raw': return 'raw'
    case 'render': return 'render'
    case 'source': return 'source'
    case 'setting': return 'setting'
  }
}

export interface StripItem {
  stmtId: string
  chainId: string
  /** `o0`, or `—` for a chain that is not rendered */
  label: string
  gen: string
  out: OutName | null
  flag?: 'not-rendered' | 'shadowed'
}

/** The chain strip for the current sketch: every top-level chain in source order. */
export function stripOf(sketch: Sketch): StripItem[] {
  const d = describe(sketch)
  return d.chains.map((c) => ({
    stmtId: c.stmtId,
    chainId: c.chainId,
    label: c.out ?? '—',
    gen: c.gen,
    out: c.out,
    flag: !c.rendered ? 'not-rendered' : c.shadowed ? 'shadowed' : undefined,
  }))
}

/** Pick the chain the strip starts on: the one that wins o0, else the first rendered one, else the first. */
export function defaultActive(sketch: Sketch): string | undefined {
  const strip = stripOf(sketch)
  const d = describe(sketch)
  const winner = d.outputs.o0.winner
  const byWinner = winner ? strip.find((s) => s.chainId === winner) : undefined
  return (byWinner ?? strip.find((s) => !s.flag) ?? strip[0])?.stmtId
}

/** Deterministic default view. Pure function of the sketch: same input, same output; never reads or touches other apps' meta. */
export function autoView(sketch: Sketch): StackMeta {
  const strip = stripOf(sketch)
  const d = describe(sketch)
  return {
    v: 1,
    mode: 'blocks',
    rows: sketch.stmts.map((s) => ({ id: s.id, kind: rowKind(s) })),
    chains: strip.map((s) => ({ id: s.stmtId, label: s.label, ...(s.flag ? { flag: s.flag } : {}) })),
    active: defaultActive(sketch),
    renderMode: d.activeRender === 'all' ? 'all' : 'single',
  }
}

export function metaOf(sketch: Sketch): StackMeta | undefined {
  const m = sketch.meta?.[APP] as Partial<StackMeta> | undefined
  return m && m.v === 1 ? (m as StackMeta) : undefined
}

// ---------------------------------------------------------------- id carry-over after a text edit

const sig = (s: Stmt): string => contentHash(s)

/** Longest common subsequence of equal items; returns index pairs. */
function lcs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length
  const m = b.length
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
  const out: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j])
      i++
      j++
    } else if (t[i + 1][j] >= t[i][j + 1]) i++
    else j++
  }
  return out
}

function carryValue(o: Value, n: Value): Value {
  if (o.k === 'tex' && n.k === 'tex') return { ...n, chain: carryChain(o.chain, n.chain) }
  return n
}
function carryCall(o: Call, n: Call): Call {
  if (o.fn !== n.fn) return n
  const args = n.args.map((a, i) => (o.args[i] ? carryValue(o.args[i], a) : a))
  return { ...n, id: o.id, ...(o.meta && !n.meta ? { meta: o.meta } : {}), args }
}
function carryChain(o: Chain, n: Chain): Chain {
  const gen = carryCall(o.gen, n.gen)
  const mods = n.mods.map((m, i) => (o.mods[i] ? carryCall(o.mods[i], m) : m))
  return { ...n, id: o.id, ...(o.meta && !n.meta ? { meta: o.meta } : {}), gen, mods }
}
function carryStmt(o: Stmt, n: Stmt): Stmt {
  const meta = o.meta && !n.meta ? { meta: o.meta } : {}
  if (o.k === 'chain' && n.k === 'chain') return { ...n, id: o.id, ...meta, chain: carryChain(o.chain, n.chain) }
  if (o.k === 'def' && n.k === 'def') return { ...n, id: o.id, ...meta, value: carryValue(o.value, n.value) }
  if (o.k === n.k) return { ...n, id: o.id, ...meta } as Stmt
  return n
}

/**
 * After the text was edited: take the new parse but keep the ids (and per-node meta) of the statements, chains and calls
 * that are still "the same thing", so selection, the active chain and open rows survive. Unchanged statements are anchors
 * (longest common subsequence by content); changed ones between two anchors pair up in order when they are of the same kind.
 * Sketch-level fields (name, id, meta, plugins, createdAt) always come from `prev`.
 */
export function reconcile(prev: Sketch, parsed: Sketch): Sketch {
  const a = prev.stmts
  const b = parsed.stmts
  const anchors = lcs(a.map(sig), b.map(sig))
  const out: Stmt[] = new Array(b.length)
  const pair = (i: number, j: number) => {
    out[j] = carryStmt(a[i], b[j])
  }
  let pi = 0
  let pj = 0
  const between = (ai: number, bj: number) => {
    // statements strictly between the previous anchor and this one
    let i = pi
    let j = pj
    while (i < ai && j < bj) {
      if (a[i].k === b[j].k) {
        pair(i, j)
        i++
        j++
      } else if (ai - i > bj - j) i++
      else {
        out[j] = b[j]
        j++
      }
    }
    for (; j < bj; j++) out[j] = b[j]
  }
  for (const [ai, bj] of anchors) {
    between(ai, bj)
    pair(ai, bj)
    pi = ai + 1
    pj = bj + 1
  }
  between(a.length, b.length)
  return {
    ...parsed,
    id: prev.id,
    name: prev.name,
    createdAt: prev.createdAt,
    modifiedAt: prev.modifiedAt,
    meta: prev.meta,
    plugins: prev.plugins,
    stmts: out,
  }
}
