import { describe, expect, test } from 'vitest'
import { canonicalSketch, catalog, importText, num, toCode, validate, walkCalls, type Sketch } from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import {
  defsBefore,
  duplicateMod,
  duplicateStmt,
  findCallDeep,
  getArg,
  insertMod,
  insertStmt,
  moveMod,
  moveStmt,
  newCall,
  newChainStmt,
  removeMod,
  removeStmt,
  renameDef,
  replaceFn,
  setArg,
  setOut,
  setupInsertIndex,
  uniqueName,
} from '../src/model'

const imp = (code: string): Sketch => importText(code).sketch
const chainOf = (s: Sketch) => (s.stmts.find((x) => x.k === 'chain') as Extract<Sketch['stmts'][number], { k: 'chain' }>).chain

describe('identity-preserving edits', () => {
  const base = imp('osc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .modulate(noise(3), 0.1)\n  .out()\n\nnoise(4).out(o1)\n')

  test('editing one call leaves every other statement and call the same object', () => {
    const rot = chainOf(base).mods[0]
    const next = setArg(base, { call: rot.id, i: 0 }, num(1.5))
    expect(next).not.toBe(base)
    expect(next.stmts[1]).toBe(base.stmts[1])
    expect(chainOf(next).gen).toBe(chainOf(base).gen)
    expect(chainOf(next).mods[1]).toBe(chainOf(base).mods[1])
    expect(getArg(next, { call: rot.id, i: 0 })).toEqual({ k: 'num', v: 1.5 })
  })

  test('a no-op edit returns the same sketch', () => {
    const rot = chainOf(base).mods[0]
    expect(setOut(base, chainOf(base).id, 'o0')).toBe(base)
    expect(replaceFn(base, rot.id, 'rotate')).toBe(base)
  })

  test('nested texture calls are reachable and editable', () => {
    const mod = chainOf(base).mods[1]
    const inner = (mod.args[0] as any).chain.gen
    const next = setArg(base, { call: inner.id, i: 0 }, num(9))
    expect(toCode(next)).toContain('noise(9)')
    expect(findCallDeep(next, inner.id)?.call.id).toBe(inner.id)
  })
})

describe('chain edits', () => {
  const base = imp('osc(20)\n  .rotate(0.8)\n  .color(1, 0, 0)\n  .out()\n')
  test('moveMod / removeMod / duplicateMod / insertMod', () => {
    const c = chainOf(base)
    expect(toCode(moveMod(base, c.id, 0, 1))).toContain('.color(1, 0, 0)\n  .rotate(0.8)')
    expect(chainOf(removeMod(base, c.id, c.mods[0].id)).mods.map((m) => m.fn)).toEqual(['color'])
    const dup = chainOf(duplicateMod(base, c.id, c.mods[0].id))
    expect(dup.mods.map((m) => m.fn)).toEqual(['rotate', 'rotate', 'color'])
    expect(new Set(dup.mods.map((m) => m.id)).size).toBe(3)
    const ins = chainOf(insertMod(base, c.id, 1, newCall('pixelate')))
    expect(ins.mods.map((m) => m.fn)).toEqual(['rotate', 'pixelate', 'color'])
  })

  test('newCall fills texture inputs with a pocket so the chain validates', () => {
    const call = newCall('modulate')
    expect(call.args[0].k).toBe('tex')
    expect(newCall('src').args[0]).toEqual({ k: 'ref', name: 's0' })
    expect(newCall('osc').args).toEqual([])
  })

  test('replaceFn keeps compatible arguments and adds a pocket when a texture becomes necessary', () => {
    const c = chainOf(base)
    const next = replaceFn(base, c.mods[0].id, 'scale')
    expect(chainOf(next).mods[0].fn).toBe('scale')
    expect(chainOf(next).mods[0].args[0]).toEqual({ k: 'num', v: 0.8 })
    const blend = replaceFn(base, c.mods[0].id, 'blend')
    expect(chainOf(blend).mods[0].args[0].k).toBe('tex')
    expect(chainOf(blend).mods[0].id).toBe(c.mods[0].id)
  })
})

describe('statements and variables', () => {
  const base = imp('const amt = 0.3\nconst w = amt\nosc(20).modulate(noise(3), amt).out()\n')
  test('renameDef follows var references', () => {
    const def = base.stmts[0]
    const next = renameDef(base, def.id, 'amount')
    expect(toCode(next)).toContain('const amount = 0.3')
    expect(toCode(next)).toContain('.modulate(noise(3), amount)')
  })
  test('defsBefore only offers earlier definitions', () => {
    const chain = base.stmts.find((s) => s.k === 'chain')!
    expect(defsBefore(base, chain.id).map((d) => d.name)).toEqual(['amt', 'w'])
    expect(defsBefore(base, base.stmts[0].id)).toEqual([])
  })
  test('duplicateStmt gives a def its own name and every node a fresh id', () => {
    const next = duplicateStmt(base, base.stmts[0].id)
    expect(next.stmts.length).toBe(base.stmts.length + 1)
    const names = next.stmts.filter((s) => s.k === 'def').map((s: any) => s.name)
    expect(new Set(names).size).toBe(names.length)
    const dupChain = duplicateStmt(base, base.stmts[2].id)
    const ids = [...walkCalls(dupChain)].map((x) => x.call.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  test('moveStmt, uniqueName, setupInsertIndex', () => {
    expect(moveStmt(base, base.stmts[2].id, 0).stmts[0].k).toBe('chain')
    expect(uniqueName(base, 'amt')).toBe('amt2')
    expect(uniqueName(base, 'free')).toBe('free')
    const s = imp('// header\nbpm = 90\nosc().out()\n')
    expect(setupInsertIndex(s)).toBe(2)
  })
})

describe('over the whole corpus', () => {
  /** the first plain number of a float input in a top-level chain whose original call text is a single line */
  function target(s: Sketch) {
    for (const st of s.stmts) {
      if (st.k !== 'chain') continue
      for (const call of [st.chain.gen, ...st.chain.mods]) {
        if (call.src?.text.includes('\n')) continue
        const inputs = catalog.inputs(call.fn)
        const i = call.args.findIndex((a, k) => a.k === 'num' && inputs[k]?.type === 'float')
        if (i >= 0) return { id: call.id, i, v: (call.args[i] as { v: number }).v }
      }
    }
    return undefined
  }

  let edited = 0
  for (const entry of corpus) {
    test(`${entry.name}: one numeric edit changes exactly one line of the export`, () => {
      const s = importText(entry.code).sketch
      const t = target(s)
      if (!t) return
      edited++
      const next = setArg(s, { call: t.id, i: t.i }, num(t.v + 0.123))
      const a = toCode(s).split('\n')
      const b = toCode(next).split('\n')
      expect(b.length).toBe(a.length)
      expect(a.filter((line, k) => line !== b[k]).length).toBe(1)
    })
  }
  test('most of the corpus has such a number', () => expect(edited).toBeGreaterThan(20))

  test('known core limit: a number inside a def that holds a chain re-lays that definition out', () => {
    // docs/FRONTEND_CONTRACT.md §9.5 holds for chains; core regenerates a def chain from scratch (listed as a core change request)
    const s = importText('const base = osc(30, 0.1, 1.5).rotate(0.3)\nbase.out(o1)\n').sketch
    const call = (s.stmts[0] as any).value.chain.gen
    const next = setArg(s, { call: call.id, i: 0 }, num(31))
    expect(toCode(next)).toBe('const base = osc(31, 0.1, 1.5)\n  .rotate(0.3)\nbase.out(o1)\n')
  })
})

describe('statement edits keep the text valid and the other statements as they were', () => {
  const ops: Array<[string, (s: Sketch) => Sketch]> = [
    ['insert at the top', (s) => insertStmt(s, 0, newChainStmt(s))],
    ['insert in the middle', (s) => insertStmt(s, Math.floor(s.stmts.length / 2), newChainStmt(s))],
    ['insert at the end', (s) => insertStmt(s, s.stmts.length, newChainStmt(s))],
    ['move the first to the end', (s) => (s.stmts.length > 1 ? moveStmt(s, s.stmts[0].id, s.stmts.length - 1) : s)],
    ['move the last to the top', (s) => (s.stmts.length > 1 ? moveStmt(s, s.stmts[s.stmts.length - 1].id, 0) : s)],
    ['remove the first', (s) => (s.stmts.length ? removeStmt(s, s.stmts[0].id) : s)],
    ['duplicate the first', (s) => (s.stmts.length ? duplicateStmt(s, s.stmts[0].id) : s)],
  ]
  for (const entry of corpus) {
    if (entry.broken) continue
    for (const [name, op] of ops) {
      test(`${entry.name}: ${name}`, () => {
        const s = importText(entry.code).sketch
        const next = op(s)
        const text = toCode(next)
        const again = importText(text)
        expect(again.report.parseFailed).toBe(false)
        // text is stable, and the recognised statements survive a round trip (neighbouring comments merge; raw runs can regroup)
        expect(toCode(again.sketch)).toBe(text)
        const errors = validate(next).filter((p) => p.severity === 'error')
        if (errors.length) {
          // e.g. a chain moved above the variable it uses: the editor must say so (red dot), not hide it
          expect(errors.every((p) => ['var-before-def', 'unknown-var'].includes(p.code))).toBe(true)
          return
        }
        const plain = (x: Sketch): Sketch => ({ ...x, stmts: x.stmts.filter((t) => t.k !== 'comment' && t.k !== 'raw') })
        expect(plain(again.sketch).stmts.map((x) => x.k)).toEqual(plain(next).stmts.map((x) => x.k))
        expect(canonicalSketch(plain(again.sketch))).toEqual(canonicalSketch(plain(next)))
        // the statements that were not touched keep their original text
        for (const st of s.stmts) if (next.stmts.some((x) => x.id === st.id) && st.src) expect(text).toContain(st.src.text)
      })
    }
  }
})
