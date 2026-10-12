// @vitest-environment jsdom
// Switching blocks off (`//` in the code) and the pieces of the "up to here" previews that do not need WebGL. The real preview
// pool runs in the browser run (e2e/acceptance.mjs, check 11).
import { afterEach, describe, expect, test } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { importText, isDisabled, setDisabled, toCode, walkCalls, type Sketch } from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import { ctx } from '../src/kit/ctx'
import { Store } from '../src/kit/store'
import { Script, type Look } from '../src/ui/Blocks'
import { chainLabel, disabledCount, noteRevived, switchIdOf, toggleSwitch } from '../src/ui/Chunk'
import { appPrefs } from '../src/prefs'
import { autoView, scriptSize } from '../src/view'

const sk = (code: string) => importText(code).sketch
const callId = (s: Sketch, fn: string) => [...walkCalls(s)].find((x) => x.call.fn === fn)!.call.id
const host = document.createElement('div')
document.body.appendChild(host)
afterEach(() => act(() => render(null, host)))

/** mount the scripts of the store's sketch, re-rendering on every commit (as the workspace does) */
function mount(s: Sketch): void {
  ctx.store = new Store(s)
  const look: Look = { shadowed: new Set(), errors: {} }
  const draw = () => {
    const cur = ctx.store.sketch
    const v = autoView(cur)
    render(
      <div>
        {cur.stmts.map((st) => (
          <Script key={st.id} s={st} x={v.pos[st.id].x} y={v.pos[st.id].y} collapsed={false} look={look} />
        ))}
      </div>,
      host,
    )
  }
  act(draw)
  ctx.store.onChange(draw)
}
const toggleOf = (id: string) => host.querySelector<HTMLButtonElement>(`[data-call="${id}"] > .blk-tools .disable-toggle`)!
const tap = (b: HTMLElement) => act(() => b.click()) // keyboard activation path: a click with detail 0

describe('a block switched off', () => {
  test('a modifier: its // writes a commented line, siblings untouched; dimmed, struck through, still editable; and back', () => {
    const code = 'osc(20, 0.1, 0.8)\n  .rotate(0.8)\n  .kaleid(4)\n  .out()\n'
    mount(sk(code))
    const id = callId(ctx.store.sketch, 'rotate')
    const b = toggleOf(id)
    expect(b.getAttribute('aria-pressed')).toBe('false')
    tap(b)
    expect(toCode(ctx.store.sketch)).toBe('osc(20, 0.1, 0.8)\n  // .rotate(0.8)\n  .kaleid(4)\n  .out()\n')
    const el = host.querySelector<HTMLElement>(`[data-call="${id}"]`)!
    expect(el.classList.contains('is-disabled') && el.classList.contains('off')).toBe(true)
    expect(el.dataset.off).toBe('1')
    // still selectable and editable: the number slot is there, the block is still a drop target
    expect(el.querySelectorAll('[data-testid=slot]').length).toBe(2)
    expect(el.dataset.drop).toBe('after')
    expect(host.querySelector(`[data-call="${callId(ctx.store.sketch, 'kaleid')}"]`)!.classList.contains('off')).toBe(false)
    tap(toggleOf(id))
    expect(toCode(ctx.store.sketch)).toBe(code)
  })

  test('the hat switches the whole script; the script keeps its place and size', () => {
    const code = 'osc(10).out()\n\nnoise(3)\n  .rotate(1)\n  .out(o1)\n'
    const s = sk(code)
    mount(s)
    const hat = callId(s, 'noise')
    const b = toggleOf(hat)
    expect(b.getAttribute('aria-label')).toBe('Switch off this script')
    tap(b)
    const off = ctx.store.sketch
    expect(isDisabled(off, s.stmts[1].id)).toBe(true)
    expect(toCode(off)).toBe('osc(10).out()\n\n// noise(3)\n//   .rotate(1)\n//   .out(o1)\n')
    const script = host.querySelector<HTMLElement>(`[data-stmt="${s.stmts[1].id}"]`)!
    expect(script.classList.contains('is-disabled')).toBe(true)
    expect(script.querySelector(`[data-call="${hat}"]`)!.classList.contains('off')).toBe(true)
    // reading order and layout ignore the switch
    expect(autoView(off).pos).toEqual(autoView(s).pos)
    expect(scriptSize(off.stmts[1])).toEqual(scriptSize(s.stmts[1]))
    tap(toggleOf(hat))
    expect(toCode(ctx.store.sketch)).toBe(code)
  })

  test('a modulate block takes its texture argument with it', () => {
    mount(sk('osc(20)\n  .modulate(noise(3).rotate(1), 0.1)\n  .out()\n'))
    tap(toggleOf(callId(ctx.store.sketch, 'modulate')))
    expect(toCode(ctx.store.sketch)).toBe('osc(20)\n  // .modulate(noise(3).rotate(1), 0.1)\n  .out()\n')
    // a block inside the socket can't switch alone: its // is marked unavailable and says what to switch instead
    const inner = toggleOf(callId(ctx.store.sketch, 'rotate'))
    expect(inner.getAttribute('aria-disabled')).toBe('true')
    expect(inner.title).toMatch(/texture argument/)
  })

  test('set and setup blocks switch as statements; a def in use takes its users along (one undo step)', () => {
    const s = sk('speed = 0.5\nk = 3\nosc(k).out()\n')
    mount(s)
    tap(host.querySelector<HTMLButtonElement>(`[data-stmt="${s.stmts[0].id}"] .disable-toggle`)!)
    expect(toCode(ctx.store.sketch)).toBe('// speed = 0.5\nk = 3\nosc(k).out()\n')
    toggleSwitch(s.stmts[1].id)
    expect(isDisabled(ctx.store.sketch, s.stmts[1].id) && isDisabled(ctx.store.sketch, s.stmts[2].id)).toBe(true)
    ctx.store.undo()
    expect(isDisabled(ctx.store.sketch, s.stmts[2].id)).toBe(false)
  })

  test('the selection bar switches a selected hat as its script', () => {
    const s = sk('osc(10).rotate(1).out()\n')
    expect(switchIdOf(s, callId(s, 'osc'))).toBe(s.stmts[0].id)
    expect(switchIdOf(s, callId(s, 'rotate'))).toBe(callId(s, 'rotate'))
  })
})

describe('commented-out code revived on import', () => {
  test('every corpus sketch with switched-off parts shows them as off blocks or scripts', () => {
    for (const entry of corpus) {
      const s = sk(entry.code)
      if (!disabledCount(s)) continue
      mount(s)
      for (const st of s.stmts) {
        if (st.disabled) expect(host.querySelector<HTMLElement>(`[data-stmt="${st.id}"]`)!.dataset.off, `${entry.name} ${st.id}`).toBe('1')
      }
      for (const { call } of walkCalls(s)) {
        if (call.disabled) expect(host.querySelector<HTMLElement>(`[data-call="${call.id}"]`)!.classList.contains('is-disabled'), `${entry.name} ${call.fn}`).toBe(true)
      }
      act(() => render(null, host))
    }
  })

  test('a fresh import with revived chunks leaves a note; a sketch another editor already opened does not', () => {
    const s = sk(corpus.find((c) => c.name.startsWith('35-'))!.code)
    expect(disabledCount(s)).toBeGreaterThan(0)
    noteRevived(s)
    expect(appPrefs.get(`revived:${s.id}`)).toBe(disabledCount(s))
    appPrefs.remove(`revived:${s.id}`)
    noteRevived({ ...s, meta: { stack: {} } })
    expect(appPrefs.get(`revived:${s.id}`)).toBeUndefined()
    noteRevived(sk('osc(10).out()\n'))
    expect(appPrefs.keys().filter((k) => k.startsWith('revived:'))).toEqual([])
  })
})

test('the peek title names the enabled calls up to the block', () => {
  let s = sk('osc(10).rotate(1).kaleid(4).scale(2).out()\n')
  s = setDisabled(s, callId(s, 'rotate'), true)
  const chain = (s.stmts[0] as Extract<Sketch['stmts'][number], { k: 'chain' }>).chain
  expect(chainLabel(chain, callId(s, 'kaleid'))).toBe('osc → kaleid')
  expect(chainLabel(chain, callId(s, 'rotate'))).toBe('osc → rotate')
})
