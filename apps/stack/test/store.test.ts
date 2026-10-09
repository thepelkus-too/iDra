import { describe, expect, test } from 'vitest'
import { importText, num, toCode, withMeta } from '@hydra-ipad/core'
import { setArg } from '../src/model'
import { Store } from '../src/store'
import { APP } from '../src/view'

const base = () => importText('osc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .out()\n').sketch
const rotId = (s: ReturnType<typeof base>) => (s.stmts[0] as any).chain.mods[0].id as string

describe('Store', () => {
  test('undo and redo walk the history; a new edit clears redo', () => {
    const st = new Store(base())
    const id = rotId(st.sketch)
    st.commit(setArg(st.sketch, { call: id, i: 0 }, num(1)))
    st.endGroup()
    st.commit(setArg(st.sketch, { call: id, i: 0 }, num(2)))
    expect(toCode(st.sketch)).toContain('rotate(2)')
    expect(st.undo()).toBe(true)
    expect(toCode(st.sketch)).toContain('rotate(1)')
    expect(st.undo()).toBe(true)
    expect(toCode(st.sketch)).toContain('rotate(0.8)')
    expect(st.undo()).toBe(false)
    expect(st.redo()).toBe(true)
    expect(toCode(st.sketch)).toContain('rotate(1)')
    st.commit(setArg(st.sketch, { call: id, i: 0 }, num(5)))
    expect(st.canRedo).toBe(false)
  })

  test('a scrub is one undo step, however many commits it made', () => {
    const st = new Store(base())
    const id = rotId(st.sketch)
    for (let i = 1; i <= 40; i++) st.commit(setArg(st.sketch, { call: id, i: 0 }, num(i / 10)), { coalesce: 'scrub' })
    expect(st.past.length).toBe(1)
    st.undo()
    expect(toCode(st.sketch)).toContain('rotate(0.8)')
  })

  test('endGroup closes a coalescing group', () => {
    const st = new Store(base())
    const id = rotId(st.sketch)
    st.commit(setArg(st.sketch, { call: id, i: 0 }, num(1)), { coalesce: 'k' })
    st.endGroup()
    st.commit(setArg(st.sketch, { call: id, i: 0 }, num(2)), { coalesce: 'k' })
    expect(st.past.length).toBe(2)
  })

  test('view changes are saved with the sketch but are not undoable, and undo keeps meta and name', () => {
    const st = new Store(withMeta({ ...base(), meta: { graph: { z: 1 } } }, APP, { v: 1, mode: 'blocks' }))
    const id = rotId(st.sketch)
    st.commit(setArg(st.sketch, { call: id, i: 0 }, num(3)))
    st.setView({ mode: 'code' })
    expect(st.past.length).toBe(1)
    st.undo()
    expect(toCode(st.sketch)).toContain('rotate(0.8)')
    expect((st.sketch.meta![APP] as any).mode).toBe('code')
    expect(st.sketch.meta!.graph).toEqual({ z: 1 })
    st.redo()
    expect(toCode(st.sketch)).toContain('rotate(3)')
  })

  test('change listeners see every commit; load resets history', () => {
    const st = new Store(base())
    const seen: string[] = []
    st.onChange((c) => seen.push(c.opts.source ?? ''))
    const id = rotId(st.sketch)
    st.commit(setArg(st.sketch, { call: id, i: 0 }, num(3)))
    st.undo()
    st.load(base())
    expect(seen).toEqual(['edit', 'undo', 'load'])
    expect(st.canUndo).toBe(false)
  })
})
