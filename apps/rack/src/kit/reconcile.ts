// Copied from apps/stack: after the code was edited as text, keep the ids (and per-node meta) of what is still "the same
// thing", so positions, selection and view state survive. Pure.
import { contentHash, type Call, type Chain, type Sketch, type Stmt, type Value } from '@hydra-ipad/core'

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
