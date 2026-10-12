// @vitest-environment jsdom
// Every corpus sketch rendered by the real components (jsdom, no layout): nothing crashes, nothing is hidden.
import { describe as suite, expect, test, beforeEach } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { describe, enableAll, importText, toCode, type Sketch } from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import { ctx } from '../src/ctx'
import { Store } from '../src/store'
import { StatementList, toggleNode } from '../src/ui/Rows'
import { setPeek } from '../src/peek'
import { makeViewState } from '../src/viewstate'

const host = document.createElement('div')
document.body.appendChild(host)

function mount(sketch: Sketch) {
  ctx.store = new Store(sketch)
  ctx.runner = { run() {}, track() {}, setLive() {}, rt: undefined, trust: { pending: true, parts: [] } } as never
  act(() => render(<StatementList view={makeViewState(sketch, [], undefined)} />, host))
  return host
}
beforeEach(() => act(() => render(null, host)))

suite('the stack shows every statement of every corpus sketch', () => {
  for (const entry of corpus) {
    test(entry.name, () => {
      const sketch = importText(entry.code).sketch
      // the stack shows every statement, switched on or off (describe() leaves disabled ones out)
      const d = describe(enableAll(sketch))
      const el = mount(sketch)
      const stmts = [...el.querySelectorAll(':scope > .stack-list > .stmt')]
      expect(stmts.length).toBe(sketch.stmts.length)
      expect(el.querySelectorAll('[data-testid=stmt-chain]').length).toBe(d.chains.length)
      expect(el.querySelectorAll('[data-testid=stmt-def]').length).toBe(d.defs.length)
      expect(el.querySelectorAll('[data-testid=stmt-raw]').length).toBe(d.raws)
      expect(el.querySelectorAll('[data-testid=note-row]').length).toBe(d.comments)
      // each statement's stable id is on its row, in source order
      expect(stmts.map((s) => (s as HTMLElement).dataset.stmt)).toEqual(sketch.stmts.map((s) => s.id))
      // raw code is visible (first line) and its full text is reachable
      for (const s of sketch.stmts) {
        if (s.k !== 'raw') continue
        const row = el.querySelector(`[data-stmt="${s.id}"]`)!
        expect(row.textContent).toContain(s.code.split('\n')[0].trim().slice(0, 30))
      }
      // every call of every chain is a row with its name on it
      let calls = 0
      for (const st of sketch.stmts) {
        if (st.k !== 'chain') continue
        calls += 1 + st.chain.mods.length
        const rows = el.querySelectorAll(`[data-stmt="${st.id}"] > .stmt-main > .chain > .rows > .crow:not(.out)`)
        expect(rows.length).toBe(1 + st.chain.mods.length)
      }
      expect(el.querySelectorAll('.crow[data-call]').length).toBeGreaterThanOrEqual(calls)
      // rendering never changes the sketch
      expect(toCode(ctx.store.sketch)).toBe(entry.code)
    })
  }
})

suite('rows for the odd cases', () => {
  test('an unknown function is a generic row with editable name and arguments', () => {
    const el = mount(importText('osc(5).myPluginFx(2, () => time).out()\n').sketch)
    const row = el.querySelector('[data-fn=myPluginFx]')!
    expect(row).toBeTruthy()
    expect(row.classList.contains('unknown')).toBe(true)
    expect(row.querySelectorAll('[data-token]').length).toBeGreaterThanOrEqual(3)
    expect(row.querySelector('.addarg')).toBeTruthy()
  })

  test('a chain without .out says so and offers to send it to o0', () => {
    const el = mount(importText('osc(5).rotate(1)\n').sketch)
    expect(el.querySelector('[data-testid=flag-not-rendered]')).toBeTruthy()
    expect(el.querySelector('[data-testid=send-to-o0]')?.textContent).toContain('send to o0')
  })

  test('a variable reference is a chip that names its definition; a def shows used-count', () => {
    const el = mount(importText('const amt = 0.3\nosc(5).rotate(amt).out()\n').sketch)
    expect(el.querySelector('[data-testid=var-chip]')?.textContent).toContain('amt')
    expect(el.querySelector('.uses')?.textContent).toBe('used 1×')
  })

  test('comments and settings are rows too', () => {
    const el = mount(importText('// hello\nspeed = 0.5\nbpm = 90\ns0.initCam()\nrender(o1)\nosc().out()\n').sketch)
    expect(el.querySelector('[data-testid=note-row]')?.textContent).toContain('hello')
    expect(el.querySelectorAll('[data-testid=setting-row]').length).toBe(2)
    expect(el.querySelector('[data-testid=source-row]')).toBeTruthy()
    expect(el.querySelector('[data-testid=render-row]')).toBeTruthy()
  })

  test('the broken sketch is one raw row with a red status dot', () => {
    const broken = corpus.find((c) => c.broken)!
    const el = mount(importText(broken.code).sketch)
    expect(el.querySelectorAll('[data-testid=raw-row]').length).toBe(1)
    expect(el.querySelector('[data-testid=raw-status]')?.getAttribute('data-state')).toBe('error')
  })
})

suite('switching off and previews', () => {
  test('every top-level row has a // toggle; pockets do not; the generator’s switches the chain', () => {
    const el = mount(importText('osc(5)\n  .rotate(1)\n  .modulate(noise(3))\n  .out()\nbpm = 90\n').sketch)
    expect(el.querySelectorAll('.crow[data-call] > .row-toggle').length).toBe(3)
    expect(el.querySelector('.pocket .row-toggle')).toBeNull()
    expect(el.querySelector('[data-testid=stmt-setting] .stmt-toggle')).toBeTruthy()
    expect(el.querySelector('[data-testid=stmt-chain] .stmt-toggle')).toBeNull()
    expect(el.querySelector('[data-testid=add-mod]')).toBeNull()
  })

  test('a disabled modifier and a disabled statement are shown in place, dimmed, with the toggle pressed', () => {
    const sketch = importText('osc(5)\n  // .rotate(1)\n  .out()\n// noise(3).out(o1)\n').sketch
    const el = mount(sketch)
    const row = el.querySelector('[data-fn=rotate]')!
    expect(row.classList.contains('is-disabled')).toBe(true)
    expect(row.querySelector('.row-toggle')?.getAttribute('aria-pressed')).toBe('true')
    const st = el.querySelectorAll('.stack-list > .stmt')[1]
    expect(st.classList.contains('is-disabled')).toBe(true)
    expect(st.querySelector('.crow.gen .row-toggle')?.getAttribute('aria-pressed')).toBe('true')
  })

  test('toggleNode switches a modifier off and on as one undo step each; the text is commented, siblings unchanged', () => {
    const code = 'osc(5)\n  .rotate(1)\n  .kaleid(4)\n  .out()\n'
    const sketch = importText(code).sketch
    mount(sketch)
    const rot = (sketch.stmts[0] as Extract<Sketch['stmts'][0], { k: 'chain' }>).chain.mods[0]
    act(() => toggleNode(rot.id, '.rotate'))
    expect(toCode(ctx.store.sketch)).toBe('osc(5)\n  // .rotate(1)\n  .kaleid(4)\n  .out()\n')
    act(() => toggleNode(rot.id, '.rotate'))
    expect(toCode(ctx.store.sketch)).toBe(code)
    act(() => void ctx.store.undo())
    expect(toCode(ctx.store.sketch)).toBe('osc(5)\n  // .rotate(1)\n  .kaleid(4)\n  .out()\n')
  })

  test('a refused switch (a call inside a pocket) changes nothing', () => {
    const sketch = importText('osc().modulate(noise(3).rotate(1)).out()\n').sketch
    mount(sketch)
    const inner = (sketch.stmts[0] as Extract<Sketch['stmts'][0], { k: 'chain' }>).chain.mods[0].args[0]
    if (inner.k !== 'tex') throw new Error('pocket expected')
    act(() => toggleNode(inner.chain.mods[0].id))
    expect(ctx.store.sketch).toBe(sketch)
  })

  test('an eye on every top-level row opens the peek under that row (one at a time)', () => {
    const el = mount(importText('osc(5)\n  .rotate(1)\n  .kaleid(4)\n  .out()\n').sketch)
    expect(el.querySelectorAll('.crow[data-call] > [data-testid=eye]').length).toBe(3)
    act(() => (el.querySelector('[data-fn=rotate] [data-testid=eye]') as HTMLButtonElement).click())
    expect(el.querySelectorAll('[data-testid=peek-row]').length).toBe(1)
    expect(el.querySelector('[data-fn=rotate] + [data-testid=peek-row]')).toBeTruthy()
    act(() => (el.querySelector('[data-fn=kaleid] [data-testid=eye]') as HTMLButtonElement).click())
    expect(el.querySelectorAll('[data-testid=peek-row]').length).toBe(1)
    expect(el.querySelector('[data-fn=kaleid] + [data-testid=peek-row]')).toBeTruthy()
    act(() => setPeek(undefined))
  })

  test('texture parameters are marked as drop targets', () => {
    const el = mount(importText('osc().modulate(o1).blend(noise(3)).out()\n').sketch)
    expect(el.querySelectorAll('[data-tex-call]').length).toBe(2)
  })
})
