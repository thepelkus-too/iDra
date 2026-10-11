// @vitest-environment jsdom
// The kit's DisableToggle and PreviewPeek, rendered (jsdom: no WebGL, so the preview pool is a fake).
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { importText, isDisabled, setPreviewMode, toCode, walkCalls, type PreviewHandle, type PreviewPool, type PreviewSpec, type PreviewState, type Sketch } from '@hydra-ipad/core'
import { DisableToggle, disableAction } from '../src/DisableToggle'
import { PreviewPeek, peekMessage } from '../src/PreviewPeek'

const sk = (code: string) => importText(code).sketch
const callId = (s: Sketch, fn: string) => [...walkCalls(s)].find((x) => x.call.fn === fn)!.call.id
const host = document.createElement('div')
document.body.appendChild(host)
afterEach(() => act(() => render(null, host)))

describe('disableAction', () => {
  it('switches a modifier off as a // line and back to the same text', () => {
    const s = sk('osc(20, 0, 1)\n  .rotate(0.8)\n  .out()\n')
    const a = disableAction(s, callId(s, 'rotate'), 'rotate')
    expect(a).toMatchObject({ available: true, pressed: false, label: 'Switch off rotate' })
    const off = a.apply().sketch!
    expect(toCode(off)).toBe('osc(20, 0, 1)\n  // .rotate(0.8)\n  .out()\n')
    const back = disableAction(off, callId(off, 'rotate'))
    expect(back).toMatchObject({ pressed: true, label: 'Switch on' })
    expect(toCode(back.apply().sketch!)).toBe('osc(20, 0, 1)\n  .rotate(0.8)\n  .out()\n')
  })
  it('a generator is refused with the statement to switch instead', () => {
    const s = sk('osc(20).out()')
    const r = disableAction(s, callId(s, 'osc')).apply()
    expect(r.sketch).toBeUndefined()
    expect(r.instead).toBe(s.stmts[0].id)
    expect(r.note).toMatch(/whole chain/)
  })
  it('a def still in use switches together with its users, and says so', () => {
    const s = sk('k = 3\nosc(k).out()\nsolid(1).out(o1)\n')
    const a = disableAction(s, s.stmts[0].id)
    expect(a.available).toBe(true)
    expect(a.check.ok).toBe(false)
    const r = a.apply()
    expect(isDisabled(r.sketch!, s.stmts[0].id) && isDisabled(r.sketch!, s.stmts[1].id)).toBe(true)
    expect(r.note).toBe('Also switched off 1 statement that uses it.')
    // switching the chain back on brings k back
    const on = disableAction(r.sketch!, s.stmts[1].id).apply()
    expect(on.note).toBe('Also switched on 1 definition it needs.')
    expect(toCode(on.sketch!)).toBe(toCode(s))
  })
})

describe('<DisableToggle>', () => {
  it('shows the state, switches from the keyboard, explains a refusal in its title', () => {
    let s = sk('osc(20)\n  .rotate(0.8)\n  .out()\n')
    const id = callId(s, 'rotate')
    act(() => render(<DisableToggle id={id} what="rotate" sketch={s} onChange={(n) => (s = n)} />, host))
    const b = host.querySelector('button.disable-toggle') as HTMLButtonElement
    expect(b.getAttribute('aria-pressed')).toBe('false')
    expect(b.getAttribute('aria-label')).toBe('Switch off rotate')
    act(() => b.click()) // keyboard activation: a click with detail 0
    expect(isDisabled(s, id)).toBe(true)
    act(() => render(<DisableToggle id={callId(s, 'osc')} sketch={s} onChange={(n) => (s = n)} />, host))
    const g = host.querySelector('button.disable-toggle') as HTMLButtonElement
    expect(g.classList.contains('unavailable')).toBe(true)
    expect(g.getAttribute('aria-disabled')).toBe('true')
    expect(g.title).toMatch(/generator starts its chain/)
  })
})

class FakeHandle implements PreviewHandle {
  state: PreviewState = 'waiting'
  approximate = false
  notes: string[] = []
  reason?: string
  active = false
  visible = false
  closed = false
  updates = 0
  cbs = new Set<(h: PreviewHandle) => void>()
  constructor(public spec: PreviewSpec) {}
  update() {
    this.updates++
  }
  setVisible(v: boolean) {
    this.visible = v
  }
  setActive(a: boolean) {
    this.active = a
  }
  setFps() {}
  onFrame() {
    return () => {}
  }
  onState(cb: (h: PreviewHandle) => void) {
    this.cbs.add(cb)
    return () => this.cbs.delete(cb)
  }
  set(st: Partial<FakeHandle>) {
    Object.assign(this, st)
    this.cbs.forEach((c) => c(this))
  }
  close() {
    this.closed = true
  }
}
function fakePool() {
  const handles: FakeHandle[] = []
  const pool = {
    open: (spec: PreviewSpec) => {
      const h = new FakeHandle(spec)
      handles.push(h)
      return h
    },
    stats: {} as never,
    mode: 'demand',
    setMode() {},
    dispose() {},
  } as unknown as PreviewPool
  return { pool, handles }
}

describe('<PreviewPeek>', () => {
  const s = sk('osc(20)\n  .rotate(0.8)\n  .out()\n')
  it('opens one preview, expands to animate, shows ≈ and refusals, closes on unmount', () => {
    const { pool, handles } = fakePool()
    act(() => render(<PreviewPeek spec={{ kind: 'diff', callId: callId(s, 'rotate') }} pool={pool} sketch={s} trusted label="rotate" />, host))
    expect(handles).toHaveLength(1)
    const h = handles[0]
    const pic = host.querySelector('.peek-pic') as HTMLButtonElement
    expect(pic.getAttribute('aria-label')).toBe('Expand preview of rotate')
    act(() => pic.click())
    expect(h.active).toBe(true)
    expect(host.querySelectorAll('.peek-ab button')).toHaveLength(2)
    act(() => h.set({ state: 'running', approximate: true, notes: ['It reads o1, copied from the main output about once a second.'] }))
    expect(host.querySelector('.peek-badge')?.textContent).toBe('≈')
    expect(host.querySelector('.peek-note')?.textContent).toMatch(/reads o1/)
    act(() => h.set({ state: 'refused', reason: 'reads o1, which can’t be previewed in isolation' }))
    expect(host.querySelector('.peek-msg')?.textContent).toMatch(/can’t be previewed/)
    act(() => render(null, host))
    expect(h.closed).toBe(true)
  })
  it('passes edits on without reopening, and renders nothing while previews are off', () => {
    const { pool, handles } = fakePool()
    act(() => render(<PreviewPeek spec={{ kind: 'prefix', chainId: (s.stmts[0] as { chain: { id: string } }).chain.id }} pool={pool} sketch={s} trusted={false} />, host))
    const s2 = sk('osc(30)\n  .rotate(0.8)\n  .out()\n')
    act(() => render(<PreviewPeek spec={{ kind: 'prefix', chainId: (s.stmts[0] as { chain: { id: string } }).chain.id }} pool={pool} sketch={s2} trusted />, host))
    expect(handles).toHaveLength(1)
    expect(handles[0].updates).toBeGreaterThan(0)
    act(() => setPreviewMode('off'))
    expect(host.querySelector('.preview-peek')).toBeNull()
    act(() => setPreviewMode('demand'))
    expect(host.querySelector('.preview-peek')).not.toBeNull()
  })
  it('says why there is no picture', () => {
    expect(peekMessage({ state: 'untrusted' })).toMatch(/run the sketch/)
    expect(peekMessage({ state: 'running' })).toBeUndefined()
  })
})
