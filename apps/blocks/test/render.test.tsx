// @vitest-environment jsdom
// The blocks as the user sees them, rendered from the corpus without a browser: every statement is a script, every call a
// block with the attributes the drag code reads, texture inputs are sockets, and drop targets parse back to what they say.
import { describe, expect, test } from 'vitest'
import { render } from 'preact'
import { catalog, importText, type Sketch } from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import { ctx } from '../src/kit/ctx'
import { Store } from '../src/kit/store'
import { Script, type Look } from '../src/ui/Blocks'
import { parseRef } from '../src/drag'
import { autoView } from '../src/view'

function mount(sk: Sketch): HTMLElement {
  ctx.store = new Store(sk)
  const host = document.createElement('div')
  const look: Look = { shadowed: new Set(), errors: {} }
  const v = autoView(sk)
  render(
    <div>
      {sk.stmts.map((s) => (
        <Script key={s.id} s={s} x={v.pos[s.id].x} y={v.pos[s.id].y} collapsed={false} look={look} />
      ))}
    </div>,
    host,
  )
  return host
}

const calls = (c: { gen: any; mods: any[] }): any[] => [c.gen, ...c.mods].flatMap((x) => [x, ...x.args.flatMap((a: any) => (a.k === 'tex' ? calls(a.chain) : []))])

describe('blocks render every corpus sketch', () => {
  for (const entry of corpus) {
    test(entry.name, () => {
      const sk = importText(entry.code).sketch
      const host = mount(sk)
      for (const s of sk.stmts) {
        expect(host.querySelector(`[data-stmt="${s.id}"]`), `${s.k} ${s.id}`).toBeTruthy()
        const chain = s.k === 'chain' ? s.chain : s.k === 'def' && s.value.k === 'tex' ? s.value.chain : undefined
        if (!chain) continue
        for (const c of calls(chain)) {
          const el = host.querySelector<HTMLElement>(`[data-call="${c.id}"]`)
          expect(el, c.fn).toBeTruthy()
          expect(el!.dataset.drop).toBe('after')
          catalog.inputs(c.fn).forEach((inp, i) => {
            if (inp.type !== 'sampler2D') return
            const sock = host.querySelector<HTMLElement>(`[data-drop=socket][data-ref="${c.id}:${i}"]`)
            expect(sock, `${c.fn} socket ${i}`).toBeTruthy()
            expect(parseRef(sock!.dataset.ref!)).toEqual({ call: c.id, i })
          })
        }
      }
      // a chain without .out has an open cap with the one-tap fix
      const open = sk.stmts.filter((s) => s.k === 'chain' && s.chain.out === null).length
      expect(host.querySelectorAll('[data-testid=show-o0]').length).toBe(open)
      render(null, host)
    })
  }
})

test('a modulator shows as a wave reporter, a pattern as a step sequencer, our math as nested holes, anything else as JS; audio is the audio bin reporter', () => {
  const sk = importText('osc(() => Math.sin(time * 2) * 0.5 + 10, [1, 2, 3].fast(2), () => time * 0.5).rotate(() => window.innerWidth / 3).out()\n').sketch
  const host = mount(sk)
  const reps = [...host.querySelectorAll<HTMLElement>('[data-testid=reporter]')].map((r) => r.dataset.rep)
  expect(reps).toEqual(['sine', 'steps', 'math', 'js'])
  expect(host.querySelectorAll('[data-testid=step]').length).toBe(3)
  expect(host.querySelector('[data-drop=math][data-path="a"]')).toBeTruthy()
  render(null, host)
  const host2 = mount(importText('osc(() => a.fft[0] * 2 + 10).out()\n').sketch)
  expect(host2.querySelector<HTMLElement>('[data-testid=reporter]')!.dataset.rep).toBe('audio')
  render(null, host2)
})

test('an unknown call is a grey block with its arguments as slots', () => {
  const sk = importText('osc(10).myPluginFx(0.3, 2).out()\n').sketch
  const host = mount(sk)
  const b = host.querySelector<HTMLElement>('.block.unknown[data-fn=myPluginFx]')
  expect(b).toBeTruthy()
  expect(b!.querySelectorAll('[data-testid=slot]').length).toBe(2)
  render(null, host)
})
