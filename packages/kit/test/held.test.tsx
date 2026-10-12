// @vitest-environment jsdom
// The kit's held/draft controls, run bar and out-of-sync badge, against a fake host and runtime.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { activeOnly, importText, toCode, type PlayingMap, type Runtime, type Sketch } from '@hydra-ipad/core'
import { setKitHost, type KitHost } from '../src/host'
import { HeldControls, RunBar, SyncBadge, heldActions, numberTargets, setHoldAll, setLiveWhileHeld, setRunAllMode } from '../src/Held'

const sk = (code: string) => importText(code).sketch
const el = document.createElement('div')
document.body.appendChild(el)

interface Fake {
  sketch: Sketch
  commits: Array<{ sketch: Sketch; opts?: Record<string, unknown> }>
  parts: string[][]
  alls: Array<{ reset: string; force?: boolean }>
  playing: PlayingMap
  emit: () => void
}
let fake: Fake

function install(code: string, withRun = true): Fake {
  const subs = new Set<() => void>()
  const playingSubs = new Set<() => void>()
  const f: Fake = { sketch: sk(code), commits: [], parts: [], alls: [], playing: {}, emit: () => playingSubs.forEach((l) => l()) }
  const rt = { playing: () => f.playing, onPlaying: (cb: () => void) => (playingSubs.add(cb), () => playingSubs.delete(cb)) } as unknown as Runtime
  const host: KitHost = {
    app: 'test',
    sketch: () => f.sketch,
    commit: (next, opts) => {
      f.sketch = next
      f.commits.push({ sketch: next, opts })
      subs.forEach((l) => l())
    },
    subscribe: (cb) => (subs.add(cb), () => subs.delete(cb)),
    invoke: () => false,
    trusted: () => true,
    runtime: () => rt,
    ...(withRun ? { runPart: (_s: Sketch, ids: string[]) => void f.parts.push(ids), runAll: (o: { reset: string; force?: boolean }) => void f.alls.push(o) } : {}),
  }
  setKitHost(host)
  fake = f
  return f
}

beforeEach(() => {
  localStorage.clear()
  setHoldAll(false)
})
afterEach(() => act(() => render(null, el)))

const HELD = 'osc(10).rotate(0.2).out(o0)\n// osc(10).rotate(0.5).kaleid(4).out(o0)\nnoise(3).out(o1)\n'

describe('heldActions', () => {
  it('describes a held chain and runs one change in place', () => {
    const s = sk(HELD)
    const a = heldActions(s, s.stmts[0].id, { app: 'test' })
    expect(a.info.state).toBe('held')
    expect(a.info.changes.map((c) => c.label)).toEqual(['rotate: 0.2 → 0.5', 'kaleid added'])
    const plan = a.runChange(a.info.changes[0].id)
    expect(toCode(plan.sketch)).toBe('osc(10).rotate(0.5).out(o0)\n// osc(10).rotate(0.5).kaleid(4).out(o0)\nnoise(3).out(o1)\n')
    expect(plan.run).toEqual([s.stmts[0].id])
  })

  it('with the follow switch off, the last change keeps an empty draft (held, nothing pending)', () => {
    let s = sk('osc(1).out()\n// osc(2).out()')
    const id = s.stmts[0].id
    s = heldActions(s, id, { app: 'test' }).setFollow(false)
    const a = heldActions(s, id, { app: 'test' })
    expect(a.follows).toBe(false)
    const after = a.runChange(a.info.changes[0].id).sketch
    expect(toCode(after)).toBe('osc(2).out()\n// osc(2).out()')
    expect(heldActions(after, id, { app: 'test' }).info).toMatchObject({ state: 'held', changes: [] })
  })

  it('hold all holds a following chain', () => {
    const s = sk('osc().out()')
    expect(heldActions(s, s.stmts[0].id, { app: 'test' }).info.state).toBe('following')
    setHoldAll(true)
    expect(heldActions(s, s.stmts[0].id, { app: 'test' }).info.state).toBe('held')
  })

  it('numbers stay live while held: a draft number also targets the playing call', () => {
    const s = sk(HELD)
    const draftRotate = (s.stmts[1] as any).chain.mods[0].id
    const playRotate = (s.stmts[0] as any).chain.mods[0].id
    install(HELD)
    expect(numberTargets(s, draftRotate)).toEqual([draftRotate])
    setLiveWhileHeld(true)
    expect(numberTargets(s, draftRotate)).toEqual([draftRotate, playRotate])
    expect(numberTargets(s, playRotate)).toEqual([playRotate])
  })
})

describe('<HeldControls>', () => {
  it('lists the pending changes; ▶ on one runs only that chain, without the editor re-running', () => {
    const f = install(HELD)
    const id = f.sketch.stmts[0].id
    act(() => render(<HeldControls id={id} />, el))
    const count = el.querySelector('.held-count') as HTMLButtonElement
    expect(count.textContent).toBe('2 pending')
    act(() => count.click())
    const items = [...el.querySelectorAll('.held-changes li')]
    expect(items.map((li) => li.querySelector('.held-label')!.textContent)).toEqual(['rotate: 0.2 → 0.5', 'kaleid added'])
    act(() => (items[1].querySelector('button[aria-label^="Run"]') as HTMLButtonElement).click())
    expect(f.commits.at(-1)!.opts).toEqual({ noRun: true })
    expect(f.parts).toEqual([[id]])
    expect(toCode(f.sketch)).toBe('osc(10).rotate(0.2).kaleid(4).out(o0)\n// osc(10).rotate(0.5).kaleid(4).out(o0)\nnoise(3).out(o1)\n')
    expect(el.querySelector('.held-count')!.textContent).toBe('1 pending')
  })

  it('▶ Run swaps in the draft (A/B); ↺ Revert deletes it', () => {
    const f = install(HELD)
    const [a, b] = f.sketch.stmts
    act(() => render(<HeldControls id={a.id} />, el))
    act(() => (el.querySelector('.held-run') as HTMLButtonElement).click())
    expect(toCode(f.sketch)).toBe('// osc(10).rotate(0.2).out(o0)\nosc(10).rotate(0.5).kaleid(4).out(o0)\nnoise(3).out(o1)\n')
    expect(f.parts).toEqual([[b.id]])
    // b plays now; a is its draft: revert from b's controls deletes a
    act(() => render(<HeldControls id={b.id} />, el))
    act(() => (el.querySelector('.held-revert') as HTMLButtonElement).click())
    expect(toCode(f.sketch)).toBe('osc(10).rotate(0.5).kaleid(4).out(o0)\nnoise(3).out(o1)\n')
  })

  it('the follow switch is view state; run buttons hide when the editor has no partial runs', () => {
    const f = install('osc().out()', false)
    const id = f.sketch.stmts[0].id
    act(() => render(<HeldControls id={id} />, el))
    const fb = el.querySelector('.held-follow') as HTMLButtonElement
    expect(fb.getAttribute('aria-pressed')).toBe('true')
    act(() => fb.click())
    expect(f.commits.at(-1)!.opts).toEqual({ view: true })
    expect(el.querySelector('.held-follow')!.getAttribute('aria-pressed')).toBe('false')
    expect(toCode(f.sketch)).toBe('osc().out()')
    install('// osc().out()', false)
    act(() => render(<HeldControls id={fake.sketch.stmts[0].id} />, el))
    expect(el.querySelector('.held-run')).toBeNull()
  })
})

describe('<RunBar> and <SyncBadge>', () => {
  it('Run all follows the preference; Hush + run all is a forced clean slate; Run all held runs the drafts', () => {
    const f = install('osc(1).out()\n// osc(2).out()')
    act(() => render(<RunBar />, el))
    act(() => (el.querySelector('.run-all') as HTMLButtonElement).click())
    expect(f.alls.at(-1)).toEqual({ reset: 'none' })
    act(() => setRunAllMode('clean'))
    act(() => (el.querySelector('.run-all') as HTMLButtonElement).click())
    expect(f.alls.at(-1)).toEqual({ reset: 'clean' })
    act(() => (el.querySelector('.hush-run') as HTMLButtonElement).click())
    expect(f.alls.at(-1)).toEqual({ reset: 'clean', force: true })
    const held = el.querySelector('.run-held') as HTMLButtonElement
    expect(held.textContent).toBe('▶ Run all held (1)')
    act(() => held.click())
    expect(toCode(f.sketch)).toBe('// osc(1).out()\nosc(2).out()')
    expect(f.parts).toEqual([[f.sketch.stmts[1].id]])
  })

  it('shows Out of sync only while the screen differs from the code', () => {
    const f = install('osc(1).out()\nnoise().out(o1)')
    const [a, b] = f.sketch.stmts as any[]
    f.playing = { o0: { stmt: a.id, chain: activeOnly(a.chain) }, o1: { stmt: b.id, chain: b.chain } }
    act(() => render(<SyncBadge />, el))
    expect(el.querySelector('.sync-badge')).toBeNull()
    // the o1 chain is deleted from the code but still plays
    act(() => fake.sketch && (f.sketch = { ...f.sketch, stmts: [a] }) && f.emit())
    const badge = el.querySelector('.sync-badge') as HTMLButtonElement
    expect(badge.title).toContain('o1')
    act(() => badge.click())
    expect(f.alls.at(-1)).toEqual({ reset: 'none' })
  })
})
