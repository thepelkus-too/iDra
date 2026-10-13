// @vitest-environment jsdom
// The trust gate in the runner: code the owner types is theirs, code from outside (the sketch as opened, pastes) asks.
import { describe, expect, test } from 'vitest'
import { fromCode, getLibrary, type Sketch } from '@hydra-ipad/core'
import { Runner } from '../src/runner'

const decide = (r: Runner, s: Sketch): Promise<{ safe: boolean }> => (r as any).decide(s)
const edit = (s: Sketch, code: string): Sketch => fromCode(code, { id: s.id, name: s.name })

describe('runner trust', () => {
  test('code typed into an opened sketch runs without asking; the code it opened with still asks', async () => {
    const r = new Runner(document.createElement('div'))
    const opened = fromCode('osc().out()\n')
    r.run(false, opened)
    expect(await decide(r, opened)).toEqual({ safe: false })
    const typed = edit(opened, 'f = () => fetch("mine")\nosc().out()\n')
    r.run(false, typed)
    expect(await decide(r, typed)).toEqual({ safe: false })
    expect(r.trust.pending).toBe(false)
    // the approval is stored: reopening it does not ask
    await getLibrary().approveKeys(typed.id, []) // waits for the pending write
    expect(await getLibrary().needsTrust(typed)).toBe(false)
    r.dispose()
  })

  test('a sketch opened with code asks, and editing around that code does not approve it', async () => {
    const r = new Runner(document.createElement('div'))
    const opened = fromCode('f = () => fetch("theirs")\nosc().out()\n')
    r.run(false, opened)
    expect(await decide(r, opened)).toEqual({ safe: true })
    const edited = edit(opened, 'f = () => fetch("theirs")\nosc(20).out()\n')
    r.run(false, edited)
    expect(await decide(r, edited)).toEqual({ safe: true })
    // switched off, then back on (undo): still theirs
    const off = edit(opened, 'osc(20).out()\n')
    r.run(false, off)
    r.run(false, edited)
    expect(await decide(r, edited)).toEqual({ safe: true })
    r.dispose()
  })

  test('code that arrives with a paste asks', async () => {
    const r = new Runner(document.createElement('div'))
    const opened = fromCode('osc().out()\n')
    r.run(false, opened)
    document.dispatchEvent(new Event('paste'))
    const pasted = edit(opened, 'f = () => fetch("pasted")\nosc().out()\n')
    r.run(false, pasted)
    expect(await decide(r, pasted)).toEqual({ safe: true })
    // the next code the owner types is theirs again
    const typed = edit(opened, 'osc().out()\ng = () => fetch("mine")\n')
    r.run(false, typed)
    expect(await decide(r, typed)).toEqual({ safe: false })
    r.dispose()
  })
})
