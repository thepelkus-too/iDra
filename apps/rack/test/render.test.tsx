// @vitest-environment jsdom
// The rack as the user sees it, rendered from the corpus without a browser: every statement has a place, every call is a
// module with a knob, pad, fader or jack for each input, and the attributes the drag code reads are there.
import { describe, expect, test } from 'vitest'
import { render } from 'preact'
import { catalog, importText, type Chain, type Sketch } from '@hydra-ipad/core'
import { corpus } from '@hydra-ipad/core/corpus'
import { ctx } from '../src/kit/ctx'
import { Store } from '../src/kit/store'
import { Rack } from '../src/ui/Lanes'
import { panelOf } from '../src/panel'

function mount(sk: Sketch): HTMLElement {
  ctx.store = new Store(sk)
  const host = document.createElement('div')
  document.body.appendChild(host)
  render(<Rack />, host)
  return host
}
function unmount(host: HTMLElement) {
  render(null, host)
  host.remove()
}

/** the controls a call shows, by the attribute each carries */
function expectControls(host: HTMLElement, callId: string, fn: string, nArgs: number) {
  for (const c of panelOf(fn, nArgs, catalog)) {
    const key = c.t === 'xy' ? `xy-${callId}:${c.x}` : c.t === 'rgba' ? `rgba-${callId}` : c.t === 'vec' ? `vec-${callId}:${c.i}` : c.t === 'jack' ? undefined : `knob-${callId}:${c.i}`
    if (c.t === 'jack') expect(host.querySelector(`[data-drop=jack][data-ref="${callId}:${c.i}"]`), `${fn} jack`).toBeTruthy()
    else expect(host.querySelector(`[data-testid="${key}"]`), `${fn} ${c.t}`).toBeTruthy()
  }
}

describe('the rack renders every corpus sketch', () => {
  for (const entry of corpus) {
    test(entry.name, () => {
      const sk = importText(entry.code).sketch
      const host = mount(sk)
      for (const s of sk.stmts) {
        if (s.k === 'chain') {
          const row = (c: Chain) => {
            for (const call of [c.gen, ...c.mods]) {
              const el = host.querySelector<HTMLElement>(`[data-testid=module][data-call="${call.id}"]`)
              expect(el, call.fn).toBeTruthy()
              expectControls(host, call.id, call.fn, call.args.length)
              // nested chains are mini-modules: the header names the generator
              call.args.forEach((a, i) => a.k === 'tex' && expect(host.querySelector(`[data-testid="mini-${call.id}:${i}"]`)?.textContent).toContain(a.chain.gen.fn))
            }
          }
          row(s.chain)
          expect(host.querySelector(`[data-stmt="${s.id}"]`), 'chain row').toBeTruthy()
        } else {
          expect(host.querySelector(`[data-stmt="${s.id}"]`), `${s.k} ${s.id}`).toBeTruthy()
        }
      }
      unmount(host)
    })
  }
})

test('knob faces: numbers, defaults, modulators, steps, variables and expressions', () => {
  const sk = importText('const k = 2\nosc(() => Math.sin(time * 2) * 0.5 + 10, [1, 2, 3].fast(2), () => window.innerWidth / 3).rotate(k).out()\nshape(4).out(o1)\n').sketch
  const host = mount(sk)
  const faces = [...host.querySelectorAll<HTMLElement>('[data-drop=knob]')].map((k) => k.dataset.face)
  // lanes first: osc ×3, rotate angle (var) + speed (default), shape sides/radius/smoothing; then the Vars tray: k
  expect(faces).toEqual(['mod', 'mod', 'expr', 'var', 'num', 'num', 'num', 'num', 'num'])
  expect(host.querySelectorAll('.knob.dim').length).toBe(3) // rotate speed, shape radius, smoothing
  unmount(host)
})

test('an unknown call is a grey module with a knob per argument; empty lanes offer a generator', () => {
  const host = mount(importText('osc(10).myPluginFx(0.3, 2).out()\n').sketch)
  const m = host.querySelector<HTMLElement>('.module.unknown[data-fn=myPluginFx]')
  expect(m).toBeTruthy()
  expect(m!.querySelectorAll('[data-drop=knob]').length).toBe(2)
  expect(host.querySelector('[data-testid=add-gen-o0]')).toBeNull()
  for (const o of ['o1', 'o2', 'o3']) expect(host.querySelector(`[data-testid=add-gen-${o}]`)).toBeTruthy()
  unmount(host)
})
