// @vitest-environment jsdom
// Every corpus sketch rendered by the real components (jsdom, no layout): nothing crashes, nothing is hidden.
import { describe as suite, expect, test, beforeEach } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { describe, importText, toCode, type Sketch } from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import { ctx } from '../src/ctx'
import { Store } from '../src/store'
import { StatementList } from '../src/ui/Rows'
import { makeViewState } from '../src/viewstate'

const host = document.createElement('div')
document.body.appendChild(host)

function mount(sketch: Sketch) {
  ctx.store = new Store(sketch)
  ctx.runner = { run() {}, track() {}, setLive() {}, rt: {} } as never
  act(() => render(<StatementList view={makeViewState(sketch, [], undefined)} />, host))
  return host
}
beforeEach(() => act(() => render(null, host)))

suite('the stack shows every statement of every corpus sketch', () => {
  for (const entry of corpus) {
    test(entry.name, () => {
      const sketch = importText(entry.code).sketch
      const d = describe(sketch)
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
