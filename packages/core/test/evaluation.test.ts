import { describe, expect, test } from 'vitest'
import { fromCode } from '../src/parse'
import { toCode } from '../src/codegen'
import { canonicalSketch } from '../src/normalize'
import {
  applyChanges,
  callPairs,
  chainChanges,
  chainInfo,
  composeChain,
  discardChanges,
  duplicateAsDraft,
  editTarget,
  followsEdits,
  heldChains,
  holdCopy,
  outOfSync,
  outputGroups,
  partialRunSet,
  pendingChanges,
  revertDraft,
  runAllHeld,
  runDraft,
  setFollow,
  type PlayingMap,
} from '../src/evaluation'
import { activeOnly } from '../src/evaluation'
import { contentString, type Chain, type ChainStmt, type Sketch } from '../src/ir'

const chains = (s: Sketch) => s.stmts.filter((x): x is ChainStmt => x.k === 'chain')
const chainOf = (code: string): Chain => chains(fromCode(code))[0].chain
const same = (a: Chain, b: Chain) => contentString(a) === contentString(b)
const kinds = (code1: string, code2: string) => chainChanges(chainOf(code1), chainOf(code2)).map((c) => `${c.kind} ${c.label}`)

describe('pairing drafts with playing chains', () => {
  test('a draft is a commented chain; it pairs with the chain playing on the same output', () => {
    const s = fromCode('osc(10, 0.1).rotate(0.2).out(o0)\n// osc(10, 0.1).rotate(0.5).kaleid(4).out(o0)\n// noise(3).colorama(0.2).out(o1)\n')
    const [a, b, c] = chains(s)
    expect(b.disabled).toBe(true)
    const groups = outputGroups(s)
    expect(groups).toEqual([
      { out: 'o0', playing: a.id, shadowed: [], drafts: [b.id], pending: b.id },
      { out: 'o1', playing: undefined, shadowed: [], drafts: [c.id], pending: undefined },
    ])
    expect(chainInfo(s, a.id)).toMatchObject({ state: 'held', out: 'o0', playing: a.id, pending: b.id })
    expect(chainInfo(s, a.id).changes.map((x) => x.label)).toEqual(['rotate: 0.2 → 0.5', 'kaleid added'])
    expect(chainInfo(s, b.id)).toMatchObject({ state: 'draft', playing: a.id, pending: b.id })
    expect(chainInfo(s, c.id)).toMatchObject({ state: 'draft', playing: undefined, changes: [] })
  })

  test('a playing chain without a draft follows, unless its follow switch is off', () => {
    const s = fromCode('osc().out()')
    const id = s.stmts[0].id
    expect(chainInfo(s, id).state).toBe('following')
    expect(chainInfo(s, id, { follow: false }).state).toBe('held')
    const off = setFollow(s, 'stack', id, false)
    expect(followsEdits(off, 'stack', id)).toBe(false)
    expect(followsEdits(off, 'graph', id)).toBe(true)
    expect(followsEdits(setFollow(off, 'stack', id, true), 'stack', id)).toBe(true)
    // view state only: the code does not change
    expect(toCode(off)).toBe(toCode(s))
  })

  test('last one wins: the later enabled chain plays, the earlier is shadowed; the nearest draft holds the pending edits', () => {
    const s = fromCode('// osc(1).out()\nosc(2).out()\nosc(3).out()\n// osc(4).out()\n// osc(5).out()')
    const [d1, a, b, d4, d5] = chains(s)
    const g = outputGroups(s)[0]
    expect(g.playing).toBe(b.id)
    expect(g.shadowed).toEqual([a.id])
    expect(g.drafts).toEqual([d1.id, d4.id, d5.id])
    expect(g.pending).toBe(d4.id)
    expect(chainInfo(s, a.id)).toMatchObject({ state: 'following', playing: b.id })
  })
})

describe('changes: an IR diff, one entry per call', () => {
  test('argument values, added, removed and swapped calls', () => {
    expect(kinds('osc(10).rotate(0.2).out()', 'osc(10).rotate(0.5).out()')).toEqual(['arg rotate: 0.2 → 0.5'])
    expect(kinds('osc(10).out()', 'osc(10).kaleid(4).out()')).toEqual(['add kaleid added'])
    expect(kinds('osc(10).kaleid(4).out()', 'osc(10).out()')).toEqual(['remove kaleid removed'])
    expect(kinds('osc(10).rotate(1).kaleid(4).out()', 'osc(10).scale(2).kaleid(4).out()')).toEqual(['swap rotate → scale'])
    expect(kinds('osc(10).out()', 'noise(10).out()')).toEqual(['swap osc → noise'])
    expect(kinds('osc(10).out()', 'osc(20, 0.2).out()')).toEqual(['arg osc: 10 → 20', 'arg osc: default → 0.2'])
  })

  test('a call that reappears unchanged elsewhere is a move', () => {
    expect(kinds('osc().rotate(1).kaleid(4).scale(2).out()', 'osc().kaleid(4).scale(2).rotate(1).out()')).toEqual(['move rotate moved'])
  })

  test('no changes between equal chains, whatever their ids or formatting', () => {
    expect(chainChanges(chainOf('osc(10).rotate(0.2).out()'), chainOf('osc(10)\n  .rotate(0.2)\n  .out()'))).toEqual([])
  })

  test('a modifier switched off in the draft is a toggle', () => {
    expect(kinds('osc().rotate(1).kaleid(4).out()', 'osc()\n  // .rotate(1)\n  .kaleid(4).out()')).toEqual(['toggle rotate switched off'])
  })

  test('callPairs maps each playing call to the same call in the draft', () => {
    const p = chainOf('osc(1).rotate(1).kaleid(4).out()')
    const d = chainOf('osc(2).scale(3).rotate(1.5).kaleid(4).out()')
    const m = callPairs(p, d)
    expect(m.get(p.gen.id)).toBe(d.gen.id)
    expect(m.get(p.mods[0].id)).toBe(d.mods[1].id)
    expect(m.get(p.mods[1].id)).toBe(d.mods[2].id)
  })
})

describe('composeChain: applying some changes', () => {
  const cases: Array<[string, string]> = [
    ['osc(10).rotate(0.2).out()', 'osc(20).rotate(0.5).kaleid(4).out()'],
    ['osc().rotate(1).kaleid(4).scale(2).out()', 'osc().kaleid(4).scale(2).rotate(1).out()'],
    ['osc().rotate(1).kaleid(4).out()', 'noise(2).scale(1).kaleid(5).pixelate(3).out()'],
    ['osc().a(1).b(2).c(3).d(4).out()', 'osc().d(4).x(9).b(3).y(1).out()'],
    ['osc().out()', 'osc().modulate(noise(3).rotate(1), 0.2).out()'],
    ['osc().rotate(1).out()', 'osc()\n  // .rotate(1)\n  .kaleid(2).out()'],
  ]
  test.each(cases)('every change selected gives the draft, none gives the playing chain: %s → %s', (a, b) => {
    const p = chainOf(a)
    const d = chainOf(b)
    const all = new Set(chainChanges(p, d).map((c) => c.id))
    for (const keep of ['playing', 'draft'] as const) {
      expect(same(composeChain(p, d, all, keep), d)).toBe(true)
      expect(same(composeChain(p, d, new Set(), keep), p)).toBe(true)
    }
  })

  test.each(cases)('applying one change at a time reaches the draft and each step removes exactly that change: %s → %s', (a, b) => {
    let p = chainOf(a)
    const d = chainOf(b)
    let left = chainChanges(p, d)
    let guard = 0
    while (left.length && guard++ < 20) {
      const next = composeChain(p, d, new Set([left[0].id]), 'playing')
      const after = chainChanges(next, d)
      expect(after.length).toBe(left.length - 1)
      // the playing chain keeps its ids
      expect(next.id).toBe(p.id)
      p = next
      left = after
    }
    expect(left).toEqual([])
  })

  test('discarding one change at a time on the draft side reaches the playing chain', () => {
    const p = chainOf('osc(10).rotate(0.2).out()')
    let d = chainOf('osc(20).rotate(0.5).kaleid(4).out()')
    let left = chainChanges(p, d)
    while (left.length) {
      const keepIds = new Set(left.slice(1).map((c) => c.id))
      d = composeChain(p, d, keepIds, 'draft')
      const after = chainChanges(p, d)
      expect(after.length).toBe(left.length - 1)
      left = after
    }
    expect(same(d, p)).toBe(true)
  })

  test('calls taken from the draft get fresh ids, so no id appears twice in the sketch', () => {
    const s = fromCode('osc(10).out(o0)\n// osc(10).kaleid(4).out(o0)')
    const [a] = chains(s)
    const add = pendingChanges(s, a.id).find((c) => c.kind === 'add')!
    const r = applyChanges(s, a.id, [add.id])
    const ids = chains(r.sketch).flatMap((c) => [c.chain.gen.id, ...c.chain.mods.map((m) => m.id)])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('operations on the sketch (all plain code)', () => {
  const held = 'osc(10, 0.1).rotate(0.2).out(o0)\n// osc(10, 0.1).rotate(0.5).kaleid(4).out(o0)\nnoise(3).out(o1)\n'

  test('Run a draft: it is uncommented and the chain that was playing becomes the draft (A/B)', () => {
    const s = fromCode(held)
    const [a, b] = chains(s)
    const r = runDraft(s, b.id)
    expect(r.run).toEqual([b.id])
    expect(toCode(r.sketch)).toBe('// osc(10, 0.1).rotate(0.2).out(o0)\nosc(10, 0.1).rotate(0.5).kaleid(4).out(o0)\nnoise(3).out(o1)\n')
    // and back
    const back = runDraft(r.sketch, a.id)
    expect(toCode(back.sketch)).toBe(held)
    // the text revives to the same model
    expect(canonicalSketch(fromCode(toCode(r.sketch)))).toEqual(canonicalSketch(r.sketch))
  })

  test('Run a draft switches off every chain drawing its output, and switches on the defs it needs', () => {
    const s = fromCode('osc(1).out()\nosc(2).out()\n// let k = 3\n// noise(k).out()')
    const [, , d] = chains(s)
    const r = runDraft(s, d.id)
    expect(toCode(r.sketch)).toBe('// osc(1).out()\n// osc(2).out()\nlet k = 3\nnoise(k).out()')
    expect(r.run).toEqual([r.sketch.stmts[2].id, d.id])
  })

  test('Revert deletes the draft copy', () => {
    const s = fromCode(held)
    expect(toCode(revertDraft(s, chains(s)[1].id))).toBe('osc(10, 0.1).rotate(0.2).out(o0)\nnoise(3).out(o1)\n')
    // only drafts can be reverted
    expect(revertDraft(s, chains(s)[0].id)).toBe(s)
  })

  test('Run one change: the playing line includes it, the draft keeps the rest; the last one removes the draft', () => {
    const s = fromCode(held)
    const [a] = chains(s)
    const [rot, kal] = pendingChanges(s, a.id)
    const r1 = applyChanges(s, a.id, [rot.id])
    expect(r1.run).toEqual([a.id])
    expect(toCode(r1.sketch)).toBe('osc(10, 0.1).rotate(0.5).out(o0)\n// osc(10, 0.1).rotate(0.5).kaleid(4).out(o0)\nnoise(3).out(o1)\n')
    expect(pendingChanges(r1.sketch, a.id).map((c) => c.label)).toEqual(['kaleid added'])
    const r2 = applyChanges(r1.sketch, a.id, [kal.id])
    expect(toCode(r2.sketch)).toBe('osc(10, 0.1).rotate(0.5).kaleid(4).out(o0)\nnoise(3).out(o1)\n')
    expect(chainInfo(r2.sketch, a.id).state).toBe('following')
    // with the follow switch off the empty draft stays (held, nothing pending)
    const kept = applyChanges(r1.sketch, a.id, [kal.id], { keepDraft: true })
    expect(chains(kept.sketch)).toHaveLength(3)
  })

  test('Discard one change: only the draft is edited', () => {
    const s = fromCode(held)
    const [a] = chains(s)
    const [rot, kal] = pendingChanges(s, a.id)
    const d1 = discardChanges(s, a.id, [kal.id])
    expect(toCode(d1)).toBe('osc(10, 0.1).rotate(0.2).out(o0)\n// osc(10, 0.1).rotate(0.5).out(o0)\nnoise(3).out(o1)\n')
    expect(toCode(discardChanges(d1, a.id, [rot.id]))).toBe('osc(10, 0.1).rotate(0.2).out(o0)\nnoise(3).out(o1)\n')
  })

  test('hold a copy and copy chain both add a draft right after the original', () => {
    const s = fromCode('osc(10).out()\nnoise().out(o1)')
    const a = s.stmts[0].id
    const h = holdCopy(s, a)
    expect(toCode(h.sketch)).toBe('osc(10).out()\n// osc(10).out()\nnoise().out(o1)')
    expect(chainInfo(h.sketch, a)).toMatchObject({ state: 'held', pending: h.draft, changes: [] })
    // holding again returns the same draft
    expect(holdCopy(h.sketch, a)).toEqual({ sketch: h.sketch, draft: h.draft })
    const c = duplicateAsDraft(s, s.stmts[1].id)
    expect(toCode(c.sketch)).toBe('osc(10).out()\nnoise().out(o1)\n// noise().out(o1)')
  })

  test('editTarget: a held chain edits its draft; follow off makes one; following edits the chain itself', () => {
    const s = fromCode(held)
    const [a, b, n] = chains(s)
    expect(editTarget(s, a.id)).toMatchObject({ target: b.id, copied: false })
    expect(editTarget(s, n.id)).toMatchObject({ target: n.id, copied: false })
    const t = editTarget(s, n.id, { follow: false })
    expect(t.copied).toBe(true)
    expect(chains(t.sketch)).toHaveLength(4)
    expect(editTarget(s, n.id, { holdAll: true }).copied).toBe(true)
  })

  test('Run all held runs every held chain with pending changes', () => {
    const s = fromCode('osc(1).out(o0)\n// osc(2).out(o0)\nnoise(1).out(o1)\n// noise(2).out(o1)\nshape(3).out(o2)\n// shape(3).out(o2)\n// voronoi().out(o3)')
    expect(heldChains(s).map((h) => h.out)).toEqual(['o0', 'o1'])
    const r = runAllHeld(s)
    expect(toCode(r.sketch)).toBe('// osc(1).out(o0)\nosc(2).out(o0)\n// noise(1).out(o1)\nnoise(2).out(o1)\nshape(3).out(o2)\n// shape(3).out(o2)\n// voronoi().out(o3)')
    expect(r.run).toEqual([chains(s)[1].id, chains(s)[3].id])
  })
})

describe('partial runs and sync', () => {
  test('a partial run takes the defs and sources it reads, not settings or other chains', () => {
    const s = fromCode('speed = 2\ns0.initImage("a.png")\nlet k = 4\nlet j = k + 1\nosc(j).modulate(src(s0)).out()\nnoise(k).out(o1)\nrender(o0)')
    const ids = s.stmts.map((x) => x.id)
    expect(partialRunSet(s, [ids[4]])).toEqual([ids[1], ids[2], ids[3], ids[4]])
    expect(partialRunSet(s, [ids[0], ids[5]])).toEqual([ids[0], ids[2], ids[5]])
  })

  test('outOfSync compares what plays with the document, per output', () => {
    const s = fromCode('osc(10).out()\nnoise(3).out(o1)')
    const [a, b] = chains(s)
    const playing: PlayingMap = { o0: { stmt: a.id, chain: activeOnly(a.chain) }, o1: { stmt: b.id, chain: b.chain } }
    expect(outOfSync(s, playing)).toEqual([])
    // ids do not matter (a re-import), contents do
    expect(outOfSync(fromCode('osc(10).out()\nnoise(3).out(o1)'), playing)).toEqual([])
    // a chain deleted from the code keeps playing
    expect(outOfSync(fromCode('osc(10).out()'), playing)).toEqual(['o1'])
    // a new chain that has not run
    expect(outOfSync(fromCode('osc(10).out()\nnoise(3).out(o1)\nshape().out(o2)'), playing)).toEqual(['o2'])
    // an edit that has not run
    expect(outOfSync(fromCode('osc(11).out()\nnoise(3).out(o1)'), playing)).toEqual(['o0'])
    // a draft does not count
    expect(outOfSync(fromCode('osc(10).out()\n// osc(99).out()\nnoise(3).out(o1)'), playing)).toEqual([])
  })
})
