import { describe, expect, test } from 'vitest'
import { corpus, corpusByName } from '../src/corpus'
import { importText, fromCode } from '../src/parse'
import { commentOut, toCode, toCodeWithMap, toRunnable, uncommentOut } from '../src/codegen'
import { canonicalSketch } from '../src/normalize'
import { validate } from '../src/validate'
import { describe as describeSketch } from '../src/analyze'
import { needsTrustPrompt, riskyParts, trustFingerprint } from '../src/trust'
import { buildGraph } from '../src/autoLayout'
import { randomSketch, rng } from '../src/randomize'
import { activeSketch, canDisable, disabledNodes, enableAll, isDisabled, setDisabled, toggleDisabled } from '../src/disable'
import type { Call, Chain, Sketch } from '../src/ir'

const chainOf = (s: Sketch, i: number): Chain => {
  const st = s.stmts.filter((x) => x.k === 'chain')[i] as Extract<Sketch['stmts'][number], { k: 'chain' }>
  return st.chain
}
const canon = (s: Sketch) => canonicalSketch(s)

/** every node the toggle could be offered on: statements, and the modifiers of chains written one call per line */
function candidates(s: Sketch): string[] {
  const ids: string[] = []
  for (const st of s.stmts) {
    ids.push(st.id)
    const chain = st.k === 'chain' ? st.chain : st.k === 'def' && st.value.k === 'tex' ? st.value.chain : undefined
    if (chain) for (const c of [chain.gen, ...chain.mods]) ids.push(c.id)
  }
  return ids
}

describe('disabled nodes: text form', () => {
  test('a disabled modifier is its own commented line; the IR order does not change', () => {
    const s = fromCode('osc(10).rotate(0.8).kaleid(4).out()\n')
    const rot = chainOf(s, 0).mods[0]
    const d = setDisabled(s, rot.id, true)
    expect(toCode(d)).toBe('osc(10)\n  // .rotate(0.8)\n  .kaleid(4).out()\n')
    expect(chainOf(d, 0).mods.map((m) => m.id)).toEqual(chainOf(s, 0).mods.map((m) => m.id))
    expect(toRunnable(d).code).not.toBe(toRunnable(s).code)
    expect(toRunnable(d).code).toBe(toRunnable(fromCode('osc(10).kaleid(4).out()')).code)
    // and back: the original single line
    expect(toCode(setDisabled(d, rot.id, false))).toBe('osc(10).rotate(0.8).kaleid(4).out()\n')
  })

  test('the last modifier before .out(), and two neighbours, keep the next segment off the comment line', () => {
    const s = fromCode('osc().rotate(1).kaleid(2).out(o1)')
    const [a, b] = chainOf(s, 0).mods
    const d = setDisabled(setDisabled(s, a.id, true), b.id, true)
    expect(toCode(d)).toBe('osc()\n  // .rotate(1)\n  // .kaleid(2)\n  .out(o1)')
    expect(canon(fromCode(toCode(d)))).toEqual(canon(d))
  })

  test('a disabled statement is commented line by line; what follows it starts on its own line', () => {
    const s = fromCode('osc().out(); noise(3).rotate(1).out(o1)\nsrc(o1).out(o2)')
    const d = setDisabled(s, s.stmts[0].id, true)
    expect(toCode(d)).toBe('// osc().out();\nnoise(3).rotate(1).out(o1)\nsrc(o1).out(o2)')
    const d2 = setDisabled(s, s.stmts[1].id, true)
    expect(toCode(d2)).toBe('osc().out();\n// noise(3).rotate(1).out(o1)\nsrc(o1).out(o2)')
    expect(canon(fromCode(toCode(d2)))).toEqual(canon(d2))
    // switched back on, the original text returns
    expect(toCode(setDisabled(d2, s.stmts[1].id, false))).toBe('osc().out(); noise(3).rotate(1).out(o1)\nsrc(o1).out(o2)')
  })

  test('a disabled statement keeps its own layout and its disabled modifiers', () => {
    const s = fromCode('osc(10)\n  .rotate(1)\n  .kaleid(4)\n  .out(o1)')
    const k = chainOf(s, 0).mods[1]
    const d = setDisabled(setDisabled(s, k.id, true), s.stmts[0].id, true)
    expect(toCode(d)).toBe('// osc(10)\n//   .rotate(1)\n//   // .kaleid(4)\n//   .out(o1)')
    const back = fromCode(toCode(d))
    expect(canon(back)).toEqual(canon(d))
    expect(toCode(back)).toBe(toCode(d))
    expect(toCode(setDisabled(back, back.stmts[0].id, false))).toBe('osc(10)\n  .rotate(1)\n  // .kaleid(4)\n  .out(o1)')
  })

  test('commentOut and uncommentOut are inverse, CRLF included', () => {
    for (const t of ['osc()\n  .rotate()\n\n  .out()', 'a = 1\r\n  b', '', 'x']) expect(uncommentOut(commentOut(t))).toBe(t)
    expect(commentOut('osc()\n\n.out()')).toBe('// osc()\n//\n// .out()')
  })

  test('source ranges point into commented text', () => {
    const s = fromCode('osc(10).rotate(1).out()\nnoise(2).out(o1)')
    const d = setDisabled(s, s.stmts[0].id, true)
    const { code, map } = toCodeWithMap(d, { fresh: true })
    const rot = chainOf(d, 0).mods[0]
    expect(code.slice(map[rot.id].from, map[rot.id].to)).toBe('.rotate(1)')
    expect(code.slice(map[s.stmts[0].id].from, map[s.stmts[0].id].to).startsWith('// osc(10)')).toBe(true)
  })
})

describe('disabled nodes: importing commented-out code', () => {
  test('the corpus sketches with commented code revive their disabled nodes and stay byte-identical', () => {
    const m = importText(corpusByName('34-disabled-modifiers')!.code)
    expect(m.report.revived).toBe(8)
    const chains = m.sketch.stmts.filter((s) => s.k === 'chain') as Array<{ chain: Chain }>
    expect(chains[0].chain.mods.map((x) => x.fn + (x.disabled ? '-' : ''))).toEqual(['rotate', 'kaleid-', 'color', 'scale-', 'pixelate-'])
    expect(chains[1].chain.mods.map((x) => x.fn + (x.disabled ? '-' : ''))).toEqual(['rotate-', 'kaleid-', 'colorama', 'modulate-', 'blend-'])
    // prose, a partial line, an .out() and a statement-ending `;` stay comments
    expect(chains[2].chain.mods.map((x) => x.fn)).toEqual(['scrollX'])
    const blend = chains[1].chain.mods[4]
    expect(blend.args[0].k).toBe('tex')
    const st = importText(corpusByName('35-disabled-statements')!.code)
    expect(st.report.revived).toBe(9)
    expect(st.sketch.stmts.filter((s) => s.disabled).map((s) => s.k)).toEqual(['setting', 'setting', 'source', 'chain', 'chain', 'chain', 'def', 'render'])
    // nothing that is prose was revived
    const comments = st.sketch.stmts.filter((s) => s.k === 'comment').map((s) => (s as { text: string }).text)
    expect(comments.some((t) => t.includes('try osc(10) with rotation') && t.includes('hush()'))).toBe(true)
    expect(comments.some((t) => t.startsWith('block comments'))).toBe(true)
  })

  test('a draft and its trailing note, next to the chain it would replace', () => {
    const t = 'osc(10, 0.1).rotate(0.2).out(o0)   // playing\n// osc(10, 0.1).rotate(0.5).kaleid(4).out(o0)   // draft\n'
    const s = fromCode(t)
    expect(s.stmts.map((x) => x.k + (x.disabled ? '-' : ''))).toEqual(['chain', 'comment', 'chain-', 'comment'])
    expect(toCode(s)).toBe(t)
    const on = setDisabled(s, s.stmts[2].id, false)
    expect(toCode(on)).toBe('osc(10, 0.1).rotate(0.2).out(o0)   // playing\nosc(10, 0.1).rotate(0.5).kaleid(4).out(o0)   // draft\n')
  })

  test('a prose line before commented code stays a comment; the code after it is revived', () => {
    const s = fromCode('// a second layer:\n// noise(3).out(o1)\nosc().out()')
    expect(s.stmts.map((x) => x.k + (x.disabled ? '-' : ''))).toEqual(['comment', 'chain-', 'chain'])
  })

  test('things that are not complete statements stay comments', () => {
    for (const t of ['// osc(\n// 10).out( \nosc().out()', '// hush()', '// osc(1).out() and more', '// x', '//osc', '// let', '// speed up a bit', '// .rotate(1)']) {
      const r = importText(t)
      expect(r.report.revived, t).toBe(0)
      expect(toCode(r.sketch)).toBe(t)
    }
  })
})

describe('canDisable', () => {
  const s = fromCode(`b = osc(3).rotate(0.1)
k = 0.5
osc(10).modulate(noise(3).rotate(1), k).kaleid(4).out()
src(b).out(o1)
// a note
await loadScript('https://example.com/x.js')
`)
  const [defB, defK, main, user, note, raw] = s.stmts
  const mainChain = chainOf(s, 0)

  test('modifiers yes, generators and nested calls no (with the node to use instead)', () => {
    expect(canDisable(s, mainChain.mods[0].id)).toMatchObject({ ok: true, kind: 'call', disabled: false })
    expect(canDisable(s, mainChain.gen.id)).toMatchObject({ ok: false, instead: main.id })
    const nested = (mainChain.mods[0].args[0] as { chain: Chain }).chain
    expect(canDisable(s, nested.gen.id)).toMatchObject({ ok: false, instead: mainChain.mods[0].id })
    expect(canDisable(s, nested.mods[0].id)).toMatchObject({ ok: false, instead: mainChain.mods[0].id })
    // a def holding a chain: its modifiers too
    const bChain = (defB as { value: { chain: Chain } }).value.chain
    expect(canDisable(s, bChain.mods[0].id).ok).toBe(true)
  })

  test('a used def is blocked, with its users as the cascade; disabling the only chain is fine', () => {
    const c = canDisable(s, defK.id)
    expect(c.ok).toBe(false)
    expect(c.cascade).toEqual([main.id])
    expect(setDisabled(s, defK.id, true)).toBe(s)
    const d = setDisabled(s, defK.id, true, { cascade: true })
    expect(isDisabled(d, defK.id) && isDisabled(d, main.id)).toBe(true)
    expect(validate(d).filter((p) => p.severity === 'error')).toEqual([])
    // the chain needs k back: enabling it lists k
    const back = canDisable(d, main.id)
    expect(back).toMatchObject({ ok: false, disabled: true, cascade: [defK.id] })
    expect(canon(setDisabled(d, main.id, false, { cascade: true }))).toEqual(canon(s))
    // the whole sketch's only drawing chains can go
    const one = fromCode('osc().out()')
    expect(canDisable(one, one.stmts[0].id).ok).toBe(true)
    expect(toRunnable(setDisabled(one, one.stmts[0].id, true)).code).toBe('')
  })

  test('transitive users cascade; raw code using a def blocks it', () => {
    const c = canDisable(s, defB.id)
    expect(c.cascade).toEqual([user.id])
    const t = fromCode('a = 1\nb = () => a * 2\nosc(b).out()\n')
    expect(canDisable(t, t.stmts[0].id).cascade).toEqual([t.stmts[1].id, t.stmts[2].id])
    const r = fromCode('a = 1\nfor (let i = 0; i < a; i++) {}\n')
    expect(canDisable(r, r.stmts[0].id)).toMatchObject({ ok: false })
    expect(canDisable(r, r.stmts[0].id).cascade).toBeUndefined()
    // another enabled def of the same name keeps users satisfied
    const two = fromCode('a = 1\na = 2\nosc(a).out()')
    expect(canDisable(two, two.stmts[0].id).ok).toBe(true)
  })

  test('comments and raw code cannot be disabled', () => {
    expect(canDisable(s, note.id)).toMatchObject({ ok: false, kind: 'stmt' })
    expect(canDisable(s, raw.id)).toMatchObject({ ok: false, kind: 'stmt' })
    expect(canDisable(s, 'nope')).toMatchObject({ ok: false, kind: 'missing' })
  })

  test('toggleDisabled flips; enabling removes the flag entirely', () => {
    const id = mainChain.mods[1].id
    const d = toggleDisabled(s, id)
    expect(isDisabled(d, id)).toBe(true)
    const e = toggleDisabled(d, id)
    expect(JSON.stringify(e)).toBe(JSON.stringify(s))
  })
})

describe('everything else ignores disabled nodes', () => {
  test('validate: no problems inside disabled code; enabled code using a disabled def is flagged', () => {
    const s = fromCode('// osc().rotate(o1).out()\nb = osc(2)\nosc().modulate(b).out()\n')
    expect(validate(s)).toEqual([])
    const d = setDisabled(s, s.stmts[1].id, true, { cascade: false })
    expect(d).toBe(s) // blocked
    const forced: Sketch = { ...s, stmts: s.stmts.map((x, i) => (i === 1 ? { ...x, disabled: true } : x)) }
    expect(validate(forced).map((p) => p.code)).toEqual(['uses-disabled'])
  })

  test('describe: counts, and which shadowing and feedback facts change', () => {
    const s = fromCode('osc().out()\n// noise().out()\nsrc(o1).modulate(o1).out(o1)\n')
    const d = describeSketch(s)
    expect(d.chains).toHaveLength(2)
    expect(d.disabled.count).toBe(1)
    expect(d.shadowed).toEqual([])
    expect(d.disabledEffects.unshadowed).toEqual([chainOf(s, 0).id])
    expect(d.disabledEffects.winners.o0).toEqual({ now: chainOf(s, 0).id, ifEnabled: chainOf(s, 1).id })
    // switching off the modifier that reads o1 removes nothing (src(o1) still reads it); switching off the chain does
    const fb = chainOf(s, 2)
    const off = setDisabled(s, fb.mods[0].id, true)
    expect(describeSketch(off).feedbackEdges).toHaveLength(1)
    const t = fromCode('osc().modulate(o0).out()')
    const t2 = setDisabled(t, chainOf(t, 0).mods[0].id, true)
    expect(describeSketch(t2).feedbackEdges).toEqual([])
    expect(describeSketch(t2).disabledEffects.feedbackOff).toEqual([{ chainId: chainOf(t, 0).id, output: 'o0' }])
  })

  test('trust: disabled code is not risky; enabling it is', () => {
    const s = fromCode('f = () => fetch("x")\nosc().out()\n')
    expect(needsTrustPrompt(s)).toBe(true)
    const d = setDisabled(s, s.stmts[0].id, true)
    expect(riskyParts(d)).toEqual([])
    expect(needsTrustPrompt(d)).toBe(false)
    const fp = trustFingerprint(s)
    expect(needsTrustPrompt(setDisabled(d, s.stmts[0].id, false), fp)).toBe(false)
    const m = fromCode('osc().modulate(osc(), () => fetch("x")).out()')
    const md = setDisabled(m, chainOf(m, 0).mods[0].id, true)
    expect(needsTrustPrompt(m)).toBe(true)
    expect(needsTrustPrompt(md)).toBe(false)
  })

  test('autoLayout keeps disabled nodes in place, flagged; skip mode lays out only what runs', () => {
    const s = fromCode('osc().rotate().out()\n// noise().out(o1)\n')
    const d = setDisabled(s, chainOf(s, 0).mods[0].id, true)
    const g = buildGraph(d)
    const rot = chainOf(d, 0).mods[0]
    expect(g.nodes.find((n) => n.id === rot.id)?.disabled).toBe(true)
    expect(g.nodes.find((n) => n.id === chainOf(d, 1).gen.id)?.disabled).toBe(true)
    expect(g.edges.filter((e) => e.disabled).length).toBeGreaterThanOrEqual(3)
    const skip = buildGraph(d, { disabled: 'skip' })
    expect(skip.nodes.some((n) => n.id === rot.id)).toBe(false)
    expect(skip.nodes.some((n) => n.label === 'o1')).toBe(false)
  })

  test('activeSketch / enableAll / disabledNodes', () => {
    const s = fromCode(corpusByName('35-disabled-statements')!.code)
    expect(activeSketch(s).stmts.some((x) => x.disabled)).toBe(false)
    expect(disabledNodes(enableAll(s))).toEqual({ stmts: [], calls: [] })
    const plain = fromCode('osc().out()')
    expect(activeSketch(plain)).toBe(plain)
  })
})

describe('round trips', () => {
  /** disable `ids` in order (cascades allowed), returning the ids actually switched */
  function disableSome(s: Sketch, ids: string[]): { sketch: Sketch; switched: string[][] } {
    const switched: string[][] = []
    let cur = s
    for (const id of ids) {
      const c = canDisable(cur, id)
      if (c.disabled || (!c.ok && !c.cascade?.length)) continue
      const next = setDisabled(cur, id, true, { cascade: true })
      if (next === cur) continue
      switched.push([id, ...(c.cascade ?? [])])
      cur = next
    }
    return { sketch: cur, switched }
  }
  function enableBack(s: Sketch, switched: string[][]): Sketch {
    let cur = s
    for (const group of [...switched].reverse()) {
      cur = {
        ...cur,
        stmts: cur.stmts.map((st) => {
          let x = st
          if (group.includes(x.id) && x.disabled) {
            const { disabled: _d, ...rest } = x
            void _d
            x = rest as typeof x
          }
          const fix = (c: Chain): Chain => ({ ...c, mods: c.mods.map((m): Call => (group.includes(m.id) && m.disabled ? (({ disabled: _o, ...r }) => r)(m) : m)) })
          if (x.k === 'chain') x = { ...x, chain: fix(x.chain) }
          else if (x.k === 'def' && x.value.k === 'tex') x = { ...x, value: { ...x.value, chain: fix(x.value.chain) } }
          return x
        }),
      }
    }
    return cur
  }

  const inputs: Array<{ name: string; text: string }> = [
    ...corpus.filter((c) => !c.broken).map((c) => ({ name: c.name, text: c.code })),
    ...Array.from({ length: 80 }, (_, i) => {
      const s = randomSketch(1000 + i, { chains: 1 + (i % 3) })
      const extra = i % 4 === 0 ? `k = ${(i % 7) / 10}\nspeed = 0.5\n` : ''
      return { name: `random ${i}`, text: extra + toCode(s, { fresh: true }) }
    }),
  ]

  test('toCode(enable(disable(x))) is the original text, and every disabled form re-imports to the same IR', () => {
    let toggles = 0
    for (const { name, text } of inputs) {
      const x = importText(text).sketch
      const ids = candidates(x)
      const r = rng(text.length * 7919 + ids.length)
      for (let round = 0; round < 6; round++) {
        const pick = ids.filter(() => r.chance(round === 0 ? 1 : 0.3))
        const { sketch: d, switched } = disableSome(x, pick)
        toggles += switched.length
        const out = toCode(d)
        // the disabled form is ordinary text that reads back as the same IR, byte for byte when re-exported
        const again = importText(out)
        expect(canon(again.sketch), `${name} round ${round}\n${out}`).toEqual(canon(d))
        expect(toCode(again.sketch), name).toBe(out)
        // and nothing disabled runs
        expect(toRunnable(d).code).toBe(toRunnable(activeSketch(d)).code)
        expect(toCode(enableBack(d, switched)), `${name} round ${round}`).toBe(text)
        // enabling on the re-imported text gives the original IR back
        const reEnabled = enableBack(again.sketch, switched.map((g) => g.map((id) => mapId(d, again.sketch, id))))
        expect(canon(reEnabled), `${name} re-enabled`).toEqual(canon(x))
      }
    }
    expect(toggles).toBeGreaterThan(500)
  })
})

/** the id of the node at the same place in another import of the same structure */
function mapId(from: Sketch, to: Sketch, id: string): string {
  const order = (s: Sketch): string[] => {
    const ids: string[] = []
    for (const st of s.stmts) {
      if (st.k === 'comment') continue
      ids.push(st.id)
      const chain = st.k === 'chain' ? st.chain : st.k === 'def' && st.value.k === 'tex' ? st.value.chain : undefined
      if (chain) for (const c of [chain.gen, ...chain.mods]) ids.push(c.id)
    }
    return ids
  }
  const a = order(from)
  const b = order(to)
  return b[a.indexOf(id)] ?? id
}
