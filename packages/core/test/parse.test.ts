import { describe, expect, test } from 'vitest'
import { importText, fromCode } from '../src/parse'
import { toCode } from '../src/codegen'
import { canonicalSketch } from '../src/normalize'
import { catalog } from '../src/catalog'
import type { Stmt } from '../src/ir'

const kinds = (code: string) => importText(code).sketch.stmts.map((s) => s.k)
const first = (code: string): any => importText(code).sketch.stmts[0]
const args = (code: string): any[] => first(code).chain.gen.args
const roundTrip = (code: string) => {
  const s = fromCode(code)
  expect(toCode(s)).toBe(code)
  const again = fromCode(toCode(s, { fresh: true }))
  expect(canonicalSketch(again)).toEqual(canonicalSketch(s))
}

describe('statement classification', () => {
  test('chains with and without out()', () => {
    expect(first('osc(1).out()').chain.out).toBe('o0')
    expect(first('osc(1).out(o2)').chain.out).toBe('o2')
    expect(first('osc(1).rotate(2)').chain.out).toBeNull()
    expect(first('osc(1).out(o9)').k).toBe('raw')
    expect(first('osc(1).out(x)').k).toBe('raw')
    expect(first('osc(1).out().rotate(1)').k).toBe('raw')
    expect(first('foo(1).bar(2)').k).toBe('raw') // not provably Hydra without .out
    expect(first('foo(1).bar(2).out()').k).toBe('chain')
  })
  test('settings, defs, sources, render', () => {
    expect(kinds('speed = 2\nbpm = 90\nspeed = () => 1\nfps = 30\nx.y = 2\nz += 1')).toEqual(['setting', 'setting', 'def', 'def', 'raw', 'raw'])
    expect(first('let a = 1, b = 2').k).toBe('raw')
    expect(first('let a').k).toBe('raw')
    expect(first('const {a} = o').k).toBe('raw')
    expect(first('s0.initCam()').init).toEqual({ kind: 'cam' })
    expect(first('s1.initImage("a.png")').init).toEqual({ kind: 'image', arg: 'a.png' })
    expect(first('s2.initVideo(`v.mp4`)').init).toEqual({ kind: 'video', arg: 'v.mp4' })
    expect(first('s3.initCam(1, {})').init).toEqual({ kind: 'cam', argsSrc: '1, {}' })
    expect(first('s4.initCam()').k).toBe('raw')
    expect(first('render()').target).toBe('all')
    expect(first('render(o3)').target).toBe('o3')
    expect(first('render(o3, 1)').k).toBe('raw')
    expect(first('render(x)').k).toBe('raw')
  })
  test('update functions, directives, stray semicolons, loops stay raw', () => {
    expect(kinds('update = () => {}\nafterUpdate = () => 1\n"use strict"\n;\nfor(;;){}')).toEqual(['raw', 'raw', 'raw', 'raw']) // the `;` ends the directive
  })
  test('bpm(60) is a raw call (no such function exists in hydra-synth)', () => {
    expect(first('bpm(60)').k).toBe('raw')
  })
})

describe('arguments', () => {
  test('numbers, negatives, strings, identifiers', () => {
    expect(args('osc(-1, +2, .5)')).toEqual([{ k: 'num', v: -1 }, { k: 'num', v: 2 }, { k: 'num', v: 0.5 }])
    expect(args('osc(1e-3)')).toEqual([{ k: 'num', v: 0.001 }])
    expect(args('osc(0x10)')).toEqual([{ k: 'num', v: 16 }])
    expect(args('osc(-0)')).toEqual([{ k: 'num', v: 0 }])
    expect(args('osc("x")')).toEqual([{ k: 'js', src: '"x"' }])
    expect(args('osc(time)')).toEqual([{ k: 'js', src: 'time' }])
    expect(args('osc(Math.PI / 2, (1 + 2) * 3)')).toEqual([{ k: 'js', src: 'Math.PI / 2' }, { k: 'js', src: '(1 + 2) * 3' }])
    expect(args('osc(noise)')).toEqual([{ k: 'js', src: 'noise' }])
  })
  test('functions', () => {
    expect(args('osc(() => 1, function () { return 2 }, (t) => t)')).toEqual([
      { k: 'fn', src: '() => 1' },
      { k: 'fn', src: 'function () { return 2 }' },
      { k: 'fn', src: '(t) => t' },
    ])
    expect(args('osc((() => 1))')[0]).toEqual({ k: 'fn', src: '(() => 1)' })
  })
  test('arrays and their modifiers keep order', () => {
    expect(args('osc([1, 2].fast(2).smooth())')[0]).toEqual({ k: 'arr', v: [1, 2], mods: { fast: 2, smooth: 1 } })
    expect(Object.keys(args('osc([1].ease("sin").smooth(0.5))')[0].mods)).toEqual(['ease', 'smooth'])
    expect(Object.keys(args('osc([1].smooth(0.5).ease("sin"))')[0].mods)).toEqual(['smooth', 'ease'])
    expect(args('osc([1, 2].fit())')[0].mods).toEqual({ fit: [0, 1] })
    expect(args('osc([1, 2].offset().fast())')[0].mods).toEqual({ offset: 0.5, fast: 1 })
    expect(args('osc([1, 2].fast(2).fast(4))')[0].mods).toEqual({ fast: 4 })
    expect(args('osc([1, x])')[0].k).toBe('js') // non-numeric element
    expect(args('osc([1, 2].fast(x))')[0].k).toBe('js')
    expect(args('osc([1, 2].ease(fn))')[0].k).toBe('js')
    expect(args('osc([, 1])')[0].k).toBe('js')
    expect(args('osc([[1], [2]])')[0].k).toBe('js')
  })
  test('sum takes a vec4; other arrays stay patterns', () => {
    expect(first('osc().sum([1, 0.5, 1, 1])').chain.mods[0].args[0]).toEqual({ k: 'vec4', v: [1, 0.5, 1, 1] })
    expect(first('osc().sum([1, 0.5, 1, 1].fast(2))').chain.mods[0].args[0].k).toBe('arr')
  })
  test('textures: nested chains, refs, vars, unknown plugin calls in texture slots', () => {
    const c = first('osc().modulate(noise(3).thresh(), 0.1).blend(o1).layer(src(s0)).mask(foo(2))').chain
    expect(c.mods[0].args[0].k).toBe('tex')
    expect(c.mods[0].args[0].chain.mods[0].fn).toBe('thresh')
    expect(c.mods[1].args[0]).toEqual({ k: 'ref', name: 'o1' })
    expect(c.mods[2].args[0].chain.gen.args[0]).toEqual({ k: 'ref', name: 's0' })
    expect(c.mods[3].args[0].chain.gen.fn).toBe('foo') // unknown but in a texture slot
    expect(args('shape(scaledSides(8))')[0]).toEqual({ k: 'js', src: 'scaledSides(8)' }) // numeric slot: a JS call
    const s = importText('const b = osc(1)\nosc().modulate(b)').sketch
    expect((s.stmts[1] as any).chain.mods[0].args[0]).toEqual({ k: 'var', name: 'b' })
  })
  test('a name defined later or never is not a var', () => {
    expect((importText('osc().modulate(b)\nconst b = osc(1)').sketch.stmts[0] as any).chain.mods[0].args[0]).toEqual({ k: 'js', src: 'b' })
  })
})

describe('layout, comments and byte-exactness', () => {
  const samples = [
    'osc(1).out()',
    'osc( 1 ,\n 2 )\n.rotate( 3 )   .out( o1 )  ;',
    '// a\n// b\n\n/* c */\nosc().out() // d\n/* e */ noise().out(o1)',
    'osc(1) /* x */ .rotate(2) // y\n  .out()',
    '  \n\n  osc().out()  \n\n\n',
    '',
    '   ',
    '// only a comment',
    '/* only */',
    'osc().out();;',
    'const a = 1 /* c */ ;\nosc(a).out()',
    '﻿osc().out()',
    'osc(1).out()\r\nnoise(2).out(o1)\r\n',
    'osc().out()\nthrow new Error("x")',
    'osc(`a${1}b`).out()',
    'a = b = 3',
    'if (1) osc().out()',
  ]
  for (const code of samples) {
    test(`exact + stable: ${JSON.stringify(code).slice(0, 50)}`, () => roundTrip(code))
  }
  test('a stray semicolon after a statement is its own raw statement but nothing is lost', () => {
    expect(toCode(fromCode('osc().out();;'))).toBe('osc().out();;')
  })
  test('comment grouping, trailing flag and block comments', () => {
    const k = importText('// a\n// b\nosc().out() // t\n/* blk */\n').sketch.stmts as Stmt[]
    expect(k.map((s) => s.k)).toEqual(['comment', 'chain', 'comment', 'comment'])
    expect((k[0] as any).text).toBe('a\nb')
    expect((k[2] as any).trailing).toBe(true)
    expect((k[3] as any).block).toBe(true)
    expect((k[3] as any).text).toBe('blk')
  })
  test('a hashbang or an ES module line fails whole-text parsing and stays verbatim', () => {
    const r = importText('import x from "y"\nosc().out()')
    expect(r.sketch.stmts).toHaveLength(1)
    expect(r.sketch.stmts[0].k).toBe('raw')
    expect(r.report.parseFailed).toBe(true)
  })
  test('large inputs import quickly', () => {
    const code = Array.from({ length: 3000 }, (_, i) => `// ${i}\nosc(${i}, 0.1).rotate(${i / 7})\n  .modulate(noise(${i % 9}), 0.1)\n  .out(o${i % 4})\n`).join('\n')
    const t = performance.now()
    const s = fromCode(code)
    expect(performance.now() - t).toBeLessThan(5000)
    expect(s.stmts.length).toBe(6000)
    expect(toCode(s)).toBe(code)
  })
})

describe('unknown calls', () => {
  const text = 'foo(3).bar(2).out()\nosc(10).bar(1, 2).modulate(foo(7).bar(2), 0.1).out(o1)\n'
  test('are generic calls that round-trip byte for byte, in both exports', () => {
    const s = fromCode(text)
    expect(toCode(s)).toBe(text)
    expect(toCode(fromCode(toCode(s, { fresh: true })))).toBe(toCode(s, { fresh: true }))
    expect((s.stmts[0] as any).chain.gen.fn).toBe('foo')
    expect(catalog.has('foo')).toBe(false)
  })
  test('report lists them', () => {
    expect(importText(text).report.unknownCalls).toEqual(['bar', 'foo'])
  })
})

describe('edit then export', () => {
  test('editing a def number rewrites only its statement', () => {
    const code = 'const a = 1\nconst b = 2\nosc(a, b).out()\n'
    const s = fromCode(code)
    const d: any = s.stmts[1]
    const s2 = { ...s, stmts: [s.stmts[0], { ...d, value: { k: 'num', v: 5 } }, s.stmts[2]] }
    expect(toCode(s2 as any)).toBe('const a = 1\nconst b = 5\nosc(a, b).out()\n')
  })
  test('deleting a statement keeps the others exactly', () => {
    const code = 'osc(1).out()\n\n// keep\nnoise(2).out(o1)\n'
    const s = fromCode(code)
    expect(toCode({ ...s, stmts: s.stmts.filter((x) => x.k !== 'chain' || (x.chain.gen.fn !== 'osc')) })).toBe('\n\n// keep\nnoise(2).out(o1)\n')
  })
})
