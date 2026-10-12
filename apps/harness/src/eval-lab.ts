import {
  applyChanges,
  appStorage,
  chainInfo,
  chainToCode,
  discardChanges,
  duplicateAsDraft,
  h,
  heldChains,
  holdCopy,
  outOfSync,
  outputGroups,
  revertDraft,
  runAllHeld,
  runDraft,
  type RunPlan,
  type Runtime,
  type Sketch,
} from '@hydra-ipad/core'

// Evaluation lab: the evaluation model (docs/evaluation.md) on the open sketch, without an editor. Each output lists its
// playing chain, the draft with its pending changes (▶ run one, ✕ discard one, ▶ Run the whole chain, ↺ Revert) and other
// drafts; Run all runs as vanilla Hydra or from a clean slate; "Run on every edit" off makes the Code tab deliberate.
// Everything it changes is the sketch's code: drafts are `//` chains, so the Code tab shows each step.

export interface EvalLabDeps {
  runtime: () => Runtime
  sketch: () => Sketch
  /** save and show an edited sketch, without running it */
  commit: (s: Sketch) => void
  /** the sketch must run in safe mode (not trusted yet, or the safe toggle) */
  safe: () => Promise<boolean>
  /** after a run from the lab: the status line */
  report: (msg: string) => void
}

export type RunMode = 'vanilla' | 'clean'

export interface EvalLab {
  /** the Code tab runs on every edit (today's behaviour) */
  autoRun(): boolean
  /** Run all / edit runs: vanilla Hydra or a clean slate */
  mode(): RunMode
  refresh(): void
}

export function mountEvalLab(el: HTMLElement, deps: EvalLabDeps): EvalLab {
  const prefs = appStorage('harness')
  const auto = h('input', { type: 'checkbox', id: 'ev-auto', checked: prefs.get<boolean>('evalAuto') !== false }) as HTMLInputElement
  auto.addEventListener('change', () => prefs.set('evalAuto', auto.checked))
  const modeSel = h('select', { id: 'ev-mode', 'aria-label': 'Run all mode' }, h('option', { value: 'vanilla' }, 'vanilla'), h('option', { value: 'clean' }, 'clean slate')) as HTMLSelectElement
  modeSel.value = prefs.get<string>('evalMode') === 'clean' ? 'clean' : 'vanilla'
  modeSel.addEventListener('change', () => prefs.set('evalMode', modeSel.value))
  const runAllBtn = h('button', { type: 'button', id: 'ev-run-all', class: 'primary' }, '▶ Run all')
  const heldBtn = h('button', { type: 'button', id: 'ev-run-held' }, '▶ Run all held')
  const hushBtn = h('button', { type: 'button', id: 'ev-hush-run' }, 'Hush + run all')
  const sync = h('div', { class: 'status', id: 'ev-sync', 'aria-live': 'polite' })
  const list = h('div', { id: 'ev-list' })
  el.append(
    h('p', { class: 'status' }, 'Held and draft chains are commented-out chains in the code. A draft pairs with the chain playing on the same output; its differences are the pending changes. Vanilla runs leave whatever the code no longer mentions playing, as Hydra does; clean slate resets everything first.'),
    h('div', { class: 'row' }, h('label', { class: 'lab-field' }, auto, 'Run on every edit'), h('label', { class: 'lab-field' }, 'Run all', modeSel)),
    h('div', { class: 'row' }, runAllBtn, heldBtn, hushBtn),
    sync,
    list,
  )

  const mode = (): RunMode => (modeSel.value === 'clean' ? 'clean' : 'vanilla')
  const result = (what: string, r: { ok: boolean; error?: string; ms: number }) => deps.report(`${what}: ${r.ok ? 'ran' : `failed (${r.error})`} · ${r.ms.toFixed(0)} ms`)

  async function perform(plan: RunPlan, what: string) {
    deps.commit(plan.sketch)
    if (plan.run.length) result(what, await deps.runtime().runPart(plan.sketch, plan.run, { safe: await deps.safe() }))
    render()
  }
  runAllBtn.addEventListener('click', async () => {
    result(`Run all (${mode()})`, await deps.runtime().run(deps.sketch(), { safe: await deps.safe(), reset: mode() === 'clean' ? 'clean' : 'none', force: true }))
  })
  heldBtn.addEventListener('click', () => void perform(runAllHeld(deps.sketch()), 'Run all held'))
  hushBtn.addEventListener('click', async () => {
    result('Hush + run all', await deps.runtime().run(deps.sketch(), { safe: await deps.safe(), reset: 'clean', force: true }))
  })

  const btn = (label: string, attrs: Record<string, string>, f: () => void) => {
    const b = h('button', { type: 'button', ...attrs }, label)
    b.addEventListener('click', f)
    return b
  }

  function render() {
    const s = deps.sketch()
    list.textContent = ''
    const nHeld = heldChains(s).length
    heldBtn.textContent = `▶ Run all held${nHeld ? ` (${nHeld})` : ''}`
    ;(heldBtn as HTMLButtonElement).disabled = !nHeld
    let rt: Runtime | undefined
    try {
      rt = deps.runtime()
    } catch {
      rt = undefined
    }
    const outs = rt ? outOfSync(s, rt.playing()) : []
    sync.textContent = outs.length ? `Out of sync on ${outs.join(', ')}: the screen differs from the code. Run all brings them together.` : 'In sync: the screen shows the code.'
    sync.dataset.sync = outs.length ? 'out' : 'in'
    for (const g of outputGroups(s)) {
      const box = h('section', { class: 'ev-out', 'data-out': g.out }, h('h3', {}, g.out))
      const line = (id: string) => {
        const st = s.stmts.find((x) => x.id === id)
        return st?.k === 'chain' ? chainToCode({ ...st.chain, out: st.chain.out ?? undefined }) : ''
      }
      if (g.playing) {
        const info = chainInfo(s, g.playing)
        const row = h('div', { class: 'ev-chain playing', 'data-stmt': g.playing },
          h('code', {}, line(g.playing)),
          h('span', { class: 'ev-state' }, info.state === 'held' ? `held · ${info.changes.length} pending` : 'following'),
        )
        const acts = h('div', { class: 'row' })
        if (!g.pending) acts.append(btn('Hold a copy', { 'data-act': 'hold' }, () => void perform({ sketch: holdCopy(deps.sketch(), g.playing!).sketch, run: [] }, 'Hold')))
        acts.append(btn('Copy as draft', { 'data-act': 'copy' }, () => void perform({ sketch: duplicateAsDraft(deps.sketch(), g.playing!).sketch, run: [] }, 'Copy')))
        if (g.pending) {
          acts.append(
            btn('▶ Run', { 'data-act': 'run' }, () => void perform(runDraft(deps.sketch(), g.pending!), `Run ${g.out}`)),
            btn('↺ Revert', { 'data-act': 'revert' }, () => void perform({ sketch: revertDraft(deps.sketch(), g.pending!), run: [] }, 'Revert')),
          )
        }
        row.append(acts)
        if (info.changes.length) {
          const ul = h('ul', { class: 'ev-changes' })
          for (const c of info.changes) {
            ul.append(h('li', { 'data-change': c.id },
              h('span', {}, c.label),
              btn('▶', { 'aria-label': `Run: ${c.label}`, 'data-act': 'run-change' }, () => void perform(applyChanges(deps.sketch(), g.playing!, [c.id]), `Run ${c.label}`)),
              btn('✕', { 'aria-label': `Discard: ${c.label}`, 'data-act': 'discard-change' }, () => void perform({ sketch: discardChanges(deps.sketch(), g.playing!, [c.id]), run: [] }, 'Discard')),
            ))
          }
          row.append(ul)
        }
        box.append(row)
      }
      for (const id of g.shadowed) box.append(h('div', { class: 'ev-chain shadowed', 'data-stmt': id }, h('code', {}, line(id)), h('span', { class: 'ev-state' }, 'overridden by a later chain')))
      for (const id of g.drafts) {
        const pending = id === g.pending
        box.append(h('div', { class: `ev-chain draft${pending ? ' pending' : ''}`, 'data-stmt': id },
          h('code', {}, `// ${line(id)}`),
          h('span', { class: 'ev-state' }, pending ? 'draft (pending edits)' : 'draft'),
          pending ? '' : btn('▶ Run', { 'data-act': 'run-draft' }, () => void perform(runDraft(deps.sketch(), id), `Run draft on ${g.out}`)),
        ))
      }
      list.append(box)
    }
    if (!list.children.length) list.append(h('p', { class: 'status' }, 'No chain draws an output yet.'))
  }

  let unsub: (() => void) | undefined
  let rtSeen: Runtime | undefined
  return {
    autoRun: () => auto.checked,
    mode,
    refresh() {
      try {
        const rt = deps.runtime()
        if (rt && rt !== rtSeen) {
          unsub?.()
          rtSeen = rt
          unsub = rt.onPlaying(() => render())
        }
      } catch {
        /* not started yet */
      }
      render()
    },
  }
}
