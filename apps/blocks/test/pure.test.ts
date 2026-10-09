import { describe, expect, test } from 'vitest'
import { canonicalSketch, catalog, importText, toCode, validate, withMeta, type Sketch } from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import { HELP, helpFor } from '../src/help'
import { MATH_ITEMS, mathToSrc, setAt, srcToMath } from '../src/math'
import { APP, autoView, metaOf, readingOrder, scriptSize } from '../src/view'
import { applyDrop } from '../src/drop'
import { hoistDefs, mutateStmt, reorderByPosition } from '../src/edit'
import type { Payload, Target } from '../src/drag'
import { findCallDeep } from '../src/kit/model'

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('help', () => {
  test('every catalog function has a help line of at most 12 words', () => {
    for (const f of catalog.list()) {
      expect(HELP[f.name], f.name).toBeTruthy()
      expect(HELP[f.name].replace(/\s*TODO review$/, '').split(/\s+/).length, f.name).toBeLessThanOrEqual(12)
    }
    expect(helpFor(undefined, 'nope')).toMatch(/does not know/)
  })
})

describe('math reporters', () => {
  test('round trip of everything the palette makes, nested', () => {
    for (const it of MATH_ITEMS) {
      const src = mathToSrc(it.node)
      expect(srcToMath(src), src).toEqual(it.node)
    }
    const deep = setAt(MATH_ITEMS[0].node, ['a'], { t: 'op', op: '*', a: { t: 'fn', fn: 'sin', a: { t: 'time' } }, b: { t: 'num', v: -0.5 } })
    const src = mathToSrc(deep)
    expect(src).toBe('() => (Math.sin(time) * -0.5) + 1')
    expect(srcToMath(src)).toEqual(deep)
  })
  test('text it did not write stays JS', () => {
    expect(srcToMath('() => Math.sin(time)*2')).toBeUndefined()
    expect(srcToMath('() => a.fft[0]')).toBeUndefined()
    expect(srcToMath('() => 3')).toBeUndefined()
  })
})

describe('autoView over the corpus', () => {
  for (const entry of corpus) {
    test(entry.name, () => {
      const sketch = importText(entry.code).sketch
      const v = autoView(sketch)
      expect(Object.keys(v.pos).length).toBe(sketch.stmts.length)
      const boxes = sketch.stmts.map((s) => ({ id: s.id, ...v.pos[s.id], ...scriptSize(s) }))
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `${boxes[i].id} × ${boxes[j].id}`).toBe(false)
      expect(readingOrder(sketch.stmts.map((s) => s.id), v.pos)).toEqual(sketch.stmts.map((s) => s.id))
      expect(autoView(sketch)).toEqual(v)
      const withView = withMeta({ ...sketch, meta: { graph: { x: 1 } } }, APP, v as never)
      expect(toCode(withView)).toBe(entry.code)
      expect(withView.meta!.graph).toEqual({ x: 1 })
      expect(metaOf(JSON.parse(JSON.stringify(withView)))).toEqual(v)
      // reordering by an untouched layout changes nothing
      expect(reorderByPosition(sketch, v.pos)).toBe(sketch)
    })
  }
})

// ---------------------------------------------------------------- drops, as a user would do them
function drive(code = '') {
  let sk: Sketch = importText(code).sketch
  let meta = autoView(sk)
  const drop = (p: Payload, t: Target, at = { x: 600, y: 600 }) => {
    const r = applyDrop(sk, meta, p, t, at)
    if (r.error) throw new Error(r.error)
    sk = r.sketch
    meta = { ...meta, ...r.view }
    return r
  }
  return { drop, get sk() { return sk }, get meta() { return meta }, set sk(v: Sketch) { sk = v } }
}
const canon = (s: Sketch) => JSON.stringify(canonicalSketch(s))
const chainOf = (sk: Sketch, i = 0) => sk.stmts.filter((s) => s.k === 'chain')[i] as Extract<Sketch['stmts'][number], { k: 'chain' }>

describe('drops', () => {
  test('acceptance 1: build osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out()', () => {
    const d = drive()
    d.drop({ t: 'new', item: { t: 'fn', fn: 'osc' } }, { t: 'empty' }, { x: 40, y: 40 })
    let c = chainOf(d.sk)
    expect(c.chain.out).toBe(null)
    d.drop({ t: 'new', item: { t: 'fn', fn: 'rotate' } }, { t: 'after', chainId: c.chain.id, index: -1, top: true, stmtId: c.id })
    c = chainOf(d.sk)
    d.drop({ t: 'new', item: { t: 'fn', fn: 'modulate' } }, { t: 'after', chainId: c.chain.id, index: 0, top: true, stmtId: c.id })
    d.drop({ t: 'new', item: { t: 'cap', out: 'o0' } }, { t: 'after', chainId: c.chain.id, index: 1, top: true, stmtId: c.id })
    c = chainOf(d.sk)
    // the fresh modulate carries a noise() in its socket: set the numbers like the keypad would
    const set = (callId: string, i: number, v: number) => {
      const call = findCallDeep(d.sk, callId)!.call
      const args = call.args.slice()
      while (args.length <= i) args.push({ k: 'default' })
      args[i] = { k: 'num', v }
      d.sk = { ...d.sk, stmts: d.sk.stmts.map((s) => (s.k === 'chain' && s.id === c.id ? { ...s, chain: replaceCall(s.chain, callId, { ...call, args }) } : s)) }
    }
    set(c.chain.gen.id, 0, 20)
    set(c.chain.gen.id, 2, 0.8)
    set(c.chain.mods[0].id, 0, 0.8)
    const noise = (chainOf(d.sk).chain.mods[1].args[0] as { chain: { gen: { id: string } } }).chain.gen.id
    set(noise, 0, 3)
    set(chainOf(d.sk).chain.mods[1].id, 1, 0.1)
    expect(canon(d.sk)).toBe(canon(importText('osc(20,0.1,0.8).rotate(0.8).modulate(noise(3),0.1).out()').sketch))
  })

  test('acceptance 2: sine into rotate.angle, pattern into shape.sides', () => {
    const d = drive('osc(20, 0.1, 0.8).rotate(0.8).out()\nshape(3).out(o1)\n')
    const rot = chainOf(d.sk).chain.mods[0].id
    d.drop({ t: 'new', item: { t: 'value', value: { k: 'fn', src: 'mod:sine' }, label: 'sine' } }, { t: 'slot', ref: { call: rot, i: 0 } })
    expect(toCode(d.sk)).toMatch(/rotate\(\(\) => Math\.sin\(time \* 1\) \* [\d.]+ \+ 0\.8\)/)
    const shape = chainOf(d.sk, 1).chain.gen.id
    d.drop({ t: 'new', item: { t: 'value', value: { k: 'fn', src: 'mod:steps' }, label: 'pattern' } }, { t: 'slot', ref: { call: shape, i: 0 } })
    expect(toCode(d.sk)).toMatch(/shape\(\[3, [\d.]+, [\d.]+\]\)/)
    // taking the sine back out restores the number it was centred on
    const v = findCallDeep(d.sk, rot)!.call.args[0]
    d.drop({ t: 'value', from: { call: rot, i: 0 }, value: v }, { t: 'trash' })
    expect(toCode(d.sk)).toMatch(/rotate\(0\.8\)/)
  })

  test('acceptance 3: o0 into modulate\'s socket makes feedback', () => {
    const d = drive('osc(10).modulate(noise(3), 0.1).out(o0)\n')
    const mod = chainOf(d.sk).chain.mods[0].id
    d.drop({ t: 'new', item: { t: 'value', value: { k: 'ref', name: 'o0' }, label: 'o0' } }, { t: 'socket', ref: { call: mod, i: 0 } })
    // 0.1 is modulate's default, so the regenerated call leaves it out
    expect(canon(d.sk)).toBe(canon(importText('osc(10).modulate(o0, 0.1).out(o0)\n').sketch))
    expect(validate(d.sk).filter((p) => p.severity === 'error')).toEqual([])
  })

  test('stacks move between scripts, into loose stacks and back; scripts go into sockets and come back out', () => {
    const d = drive('osc(10).rotate(1).kaleid(4).out()\nnoise(3).out(o1)\n')
    const a = chainOf(d.sk)
    const b = chainOf(d.sk, 1)
    // take rotate (and kaleid under it) off and snap under noise
    d.drop({ t: 'stack', chainId: a.chain.id, from: 0, calls: a.chain.mods }, { t: 'after', chainId: b.chain.id, index: -1, top: true, stmtId: b.id })
    expect(toCode(d.sk)).toBe('osc(10).out()\nnoise(3).rotate(1).kaleid(4).out(o1)\n')
    // kaleid onto the workspace: a loose stack, not in the code
    const b2 = chainOf(d.sk, 1)
    d.drop({ t: 'stack', chainId: b2.chain.id, from: 1, calls: b2.chain.mods.slice(1) }, { t: 'empty' })
    expect(toCode(d.sk)).not.toMatch(/kaleid/)
    expect(d.meta.loose).toHaveLength(1)
    d.drop({ t: 'loose', id: d.meta.loose![0].id }, { t: 'after', chainId: a.chain.id, index: -1, top: true, stmtId: a.id })
    expect(toCode(d.sk)).toMatch(/^osc\(10\)\.kaleid\(4\)\.out\(\)/)
    expect(d.meta.loose).toEqual([])
    // the noise script into a new blend's socket, then back out as its own script
    const a2 = chainOf(d.sk)
    d.drop({ t: 'new', item: { t: 'fn', fn: 'blend' } }, { t: 'after', chainId: a2.chain.id, index: 0, top: true, stmtId: a2.id })
    const blend = chainOf(d.sk).chain.mods[1].id
    d.drop({ t: 'script', stmtId: b.id }, { t: 'socket', ref: { call: blend, i: 0 } })
    expect(toCode(d.sk)).toMatch(/blend\(noise\(3\)\.rotate\(1\)\)/)
    expect(d.sk.stmts.filter((s) => s.k === 'chain')).toHaveLength(1)
    d.drop({ t: 'nested', from: { call: blend, i: 0 } }, { t: 'empty' }, { x: 2000, y: 40 })
    expect(d.sk.stmts.filter((s) => s.k === 'chain')).toHaveLength(2)
    expect(chainOf(d.sk, 1).chain.out).toBe(null)
  })

  test('a hat cannot snap under a block; modifiers cannot start a socket', () => {
    const d = drive('osc(10).out()\n')
    const a = chainOf(d.sk)
    expect(() => d.drop({ t: 'new', item: { t: 'fn', fn: 'noise' } }, { t: 'after', chainId: a.chain.id, index: -1, top: true, stmtId: a.id })).toThrow(/starts a new script/)
  })

  test('moving a script reorders the code by reading order, and a def never ends up after its use', () => {
    const d = drive('const k = 2\nosc(k).out()\nnoise(3).out(o1)\n')
    const [def, a, b] = d.sk.stmts
    d.drop({ t: 'script', stmtId: b.id }, { t: 'empty' }, { x: 40, y: 0 })
    expect(d.sk.stmts.map((s) => s.id)).toEqual([b.id, def.id, a.id])
    // the def dragged below its use is pulled back up
    d.drop({ t: 'script', stmtId: def.id }, { t: 'empty' }, { x: 40, y: 5000 })
    expect(validate(d.sk).filter((p) => p.code === 'var-before-def')).toEqual([])
    expect(hoistDefs(d.sk.stmts)).toEqual(d.sk.stmts)
  })

  test('mutate nudges numbers only', () => {
    const sk = importText('osc(20, 0.1, 0.8).modulate(noise(3), 0.1).out()\n').sketch
    let i = 0
    const m = mutateStmt(sk, sk.stmts[0].id, () => [0.9, 0.1, 0.5, 0.7, 0.3][i++ % 5])
    expect(toCode(m)).not.toBe(toCode(sk))
    expect(toCode(m)).toMatch(/^osc\([\d.]+, [\d.]+, [\d.]+\)\.modulate\(noise\([\d.]+\), [\d.]+\)\.out\(\)\n$/)
  })

  test('a number edit on a corpus sketch changes one line', () => {
    for (const entry of corpus) {
      const d = drive(entry.code)
      for (const st of d.sk.stmts) {
        if (st.k !== 'chain') continue
        const call = [st.chain.gen, ...st.chain.mods].find((c) => !c.src?.text.includes('\n') && c.args.some((a, k) => a.k === 'num' && catalog.inputs(c.fn)[k]?.type === 'float'))
        if (!call) continue
        const i = call.args.findIndex((a, k) => a.k === 'num' && catalog.inputs(call.fn)[k]?.type === 'float')
        const before = toCode(d.sk)
        d.drop({ t: 'new', item: { t: 'value', value: { k: 'num', v: 7.5 }, label: '7.5' } }, { t: 'slot', ref: { call: call.id, i } })
        const a = before.split('\n'), b = toCode(d.sk).split('\n')
        expect(b.length, entry.name).toBe(a.length)
        expect(a.filter((l, k) => l !== b[k]).length, entry.name).toBe(1)
        break
      }
    }
  })
})

function replaceCall(chain: any, id: string, call: any): any {
  const fix = (c: any): any => (c.id === id ? call : { ...c, args: c.args.map((a: any) => (a.k === 'tex' ? { ...a, chain: replaceCall(a.chain, id, call) } : a)) })
  return { ...chain, gen: fix(chain.gen), mods: chain.mods.map(fix) }
}
