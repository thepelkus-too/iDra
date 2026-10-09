// What the selection bar, the keyboard and the dice do: duplicate, delete, mutate, fold, surprise me. Each is one commit
// (one undo step) of the sketch together with the positions it needs.
import { DEFAULT, newId, randomSketch, type Call, type Chain, type Sketch } from '@hydra-ipad/core'
import { commit, metaNow, ui } from './doc'
import { locate, mutateStmt, reorderByPosition } from './edit'
import { ctx } from './kit/ctx'
import { duplicateStmt, removeMod, removeStmt, setArg, updateChain } from './kit/model'
import { toast } from './kit/overlay'
import { scriptSize, type XY } from './view'

const freshCall = (c: Call): Call => ({ id: newId('c'), fn: c.fn, args: c.args.map((a) => (a.k === 'tex' ? { k: 'tex', chain: freshChain(a.chain) } : structuredClone(a))) })
const freshChain = (c: Chain): Chain => ({ id: newId('h'), gen: freshCall(c.gen), mods: c.mods.map(freshCall) })

/** The selected block (a call) or script (a statement). */
function selection(sk: Sketch = ctx.store.sketch) {
  const sel = ui.state.sel
  if (!sel) return undefined
  const at = locate(sk, sel)
  if (at) return { kind: 'block' as const, at }
  const stmt = sk.stmts.find((s) => s.id === sel)
  return stmt ? { kind: 'stmt' as const, stmt } : undefined
}

/** The top-level statement the selection is in. */
export function selectedStmtId(): string | undefined {
  const s = selection()
  return s?.kind === 'block' ? s.at.stmt.id : s?.stmt.id
}

export function duplicateSel(): void {
  const sk = ctx.store.sketch
  const s = selection(sk)
  if (!s) return void toast('Select a block or a script first')
  if (s.kind === 'block' && s.at.index >= 0) {
    const copy = freshCall(s.at.chain.mods[s.at.index])
    const i = s.at.index
    commit(updateChain(sk, s.at.chain.id, (c) => ({ ...c, mods: [...c.mods.slice(0, i + 1), copy, ...c.mods.slice(i + 1)] })))
    return ui.select(copy.id, s.at.stmt.id)
  }
  const stmtId = s.kind === 'block' ? s.at.stmt.id : s.stmt.id
  const next = duplicateStmt(sk, stmtId)
  const k = next.stmts.findIndex((x) => x.id === stmtId)
  const copy = next.stmts[k + 1]
  if (!copy || copy.id === stmtId) return
  const meta = metaNow(sk)
  const p = meta.pos[stmtId] ?? { x: 40, y: 40 }
  const z = scriptSize(copy, ctx.catalog)
  const pos = { ...meta.pos, [copy.id]: { x: p.x + 24, y: p.y + z.h + 24 } }
  commit(reorderByPosition(next, pos), { pos })
  ui.select(copy.id)
}

export function deleteSel(): void {
  const sk = ctx.store.sketch
  const s = selection(sk)
  if (!s) return void toast('Select a block or a script first')
  const meta = metaNow(sk)
  const dropPos = (id: string) => {
    const pos = { ...meta.pos }
    delete pos[id]
    return pos
  }
  if (s.kind === 'block') {
    const { at } = s
    if (at.index >= 0) commit(removeMod(sk, at.chain.id, at.chain.mods[at.index].id))
    else if (at.socket) commit(setArg(sk, at.socket, DEFAULT))
    else if (at.def) commit(setArg(sk, { def: at.def }, DEFAULT))
    else commit(removeStmt(sk, at.stmt.id), { pos: dropPos(at.stmt.id) })
  } else commit(removeStmt(sk, s.stmt.id), { pos: dropPos(s.stmt.id) })
  ui.select(undefined)
  toast('Deleted', { label: 'Undo', run: () => ctx.store.undo() })
}

export function mutateSel(rnd: () => number = Math.random): void {
  const id = selectedStmtId()
  if (!id) return void toast('Select a script to mutate')
  const sk = ctx.store.sketch
  const next = mutateStmt(sk, id, rnd)
  if (next !== sk) commit(next)
}

export function foldSel(): void {
  const id = selectedStmtId()
  if (!id) return
  const c = metaNow().collapsed ?? []
  ctx.store.setView({ collapsed: c.includes(id) ? c.filter((x) => x !== id) : [...c, id] })
}

/** Surprise me: a random valid script, dropped at `at`. It shows on its output straight away (an earlier script on the same
 *  output is marked shadowed; undo takes it back). */
export function dice(at: XY, seed = Math.floor(Math.random() * 1e9)): void {
  const r = randomSketch(seed, { catalog: ctx.catalog })
  const chain = r.stmts.find((s) => s.k === 'chain')
  if (!chain || chain.k !== 'chain') return void toast('No luck this time: roll again')
  const stmt = { id: newId('s'), k: 'chain' as const, chain: freshChain(chain.chain) }
  stmt.chain.out = chain.chain.out
  const sk = ctx.store.sketch
  const meta = metaNow(sk)
  const pos = { ...meta.pos, [stmt.id]: at }
  commit(reorderByPosition({ ...sk, stmts: [...sk.stmts, stmt] }, pos), { pos })
  ui.select(stmt.id)
}
