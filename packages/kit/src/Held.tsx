// The evaluation model in the editors (docs/evaluation.md): following, held and draft chains, runs at three sizes (one
// change, one chain, every held chain), Run all as vanilla Hydra or as a clean slate, and the "out of sync" badge. Every
// state is plain code (core's evaluation.ts: a draft is a `//` chain); the only view state is each chain's follow switch.
import {
  applyChanges,
  callPairs,
  chainInfo,
  discardChanges,
  followsEdits,
  heldChains,
  locate,
  outOfSync,
  outputGroups,
  revertDraft,
  runAllHeld,
  runDraft,
  setFollow,
  type ChainChange,
  type ChainInfo,
  type RunPlan,
  type Sketch,
} from '@hydra-ipad/core'
import { useEffect, useState } from 'preact/hooks'
import { kitHost, kitPrefs, useHost } from './host'
import { toast } from './overlay'

// ---------------------------------------------------------------- preferences

export type RunAllMode = 'vanilla' | 'clean'

/** Run all and partial runs: vanilla Hydra (default: only the code runs) or a clean slate first (the screen matches the code). */
export function runAllMode(): RunAllMode {
  return kitPrefs().get<RunAllMode>('runAll') === 'clean' ? 'clean' : 'vanilla'
}
export function setRunAllMode(m: RunAllMode): void {
  kitPrefs().set('runAll', m)
  bump()
}
/** "Numbers stay live while held": a number dragged on a held chain also moves the playing one. Off by default. */
export function liveWhileHeld(): boolean {
  return kitPrefs().get<boolean>('liveWhileHeld') === true
}
export function setLiveWhileHeld(on: boolean): void {
  kitPrefs().set('liveWhileHeld', on)
  bump()
}

let holdAllOn = false
/**
 * Hold all, for performance moments: every chain is held, so edits make drafts and nothing reaches the screen until Run.
 * Not saved: it lasts for the page. Releasing it runs nothing (Run all, or Run all held, does).
 */
export function holdAll(): boolean {
  return holdAllOn
}
export function setHoldAll(on: boolean): void {
  holdAllOn = on
  bump()
}

const prefListeners = new Set<() => void>()
function bump() {
  prefListeners.forEach((l) => l())
}
function usePrefs() {
  const [, set] = useState(0)
  useEffect(() => {
    const f = () => set((v) => v + 1)
    prefListeners.add(f)
    return () => void prefListeners.delete(f)
  }, [])
}

// ---------------------------------------------------------------- actions (no UI)

export interface HeldActions {
  info: ChainInfo
  /** the chain's follow switch (view state in `meta.<app>`) */
  follows: boolean
  /** Run: the draft runs as the whole chain and the version that was playing becomes the draft (A/B) */
  run?(): RunPlan
  /** Revert: the draft copy is deleted */
  revert?(): Sketch
  runChange(id: string): RunPlan
  discardChange(id: string): Sketch
  setFollow(on: boolean): Sketch
}

/**
 * What the controls for chain statement `id` can do, without any UI: editors that draw their own (a context menu, the
 * output node) get the same rules. `id` may be the playing chain or one of its drafts. `follow` is the editor's default
 * for chains without a stored switch (Chain Stack, Graph and Blocks follow by default).
 */
export function heldActions(sketch: Sketch, id: string, opts: { app: string; follow?: boolean }): HeldActions {
  const follows = followsEdits(sketch, opts.app, id, opts.follow ?? true)
  const info = chainInfo(sketch, id, { follow: follows && !holdAllOn })
  const keepDraft = !follows
  const playing = info.playing
  const draft = info.state === 'draft' ? id : info.pending
  return {
    info,
    follows,
    run: draft ? () => runDraft(sketch, draft) : undefined,
    revert: info.pending ? () => revertDraft(sketch, info.pending!) : undefined,
    runChange: (c) => (playing ? applyChanges(sketch, playing, [c], { keepDraft }) : { sketch, run: [] }),
    discardChange: (c) => (playing ? discardChanges(sketch, playing, [c], { keepDraft }) : sketch),
    setFollow: (on) => setFollow(sketch, opts.app, playing ?? id, on),
  }
}

/**
 * The calls a number edit on call `callId` should change. Normally just that call. With "numbers stay live while held",
 * a number on a held chain's draft also moves the same argument of the playing chain (when the call is the same call in
 * both: unchanged, edited or moved), so it can be tweaked live during a restructure; the editor applies the value to each
 * id (and `setLive` for the playing one).
 */
export function numberTargets(sketch: Sketch, callId: string): string[] {
  if (!liveWhileHeld()) return [callId]
  const at = locate(sketch, callId)
  if (!at?.stmt.disabled || at.stmt.k !== 'chain') return [callId]
  const g = outputGroups(sketch).find((x) => x.pending === at.stmt.id)
  const playing = g?.playing ? sketch.stmts.find((s) => s.id === g.playing) : undefined
  if (!playing || playing.k !== 'chain') return [callId]
  for (const [p, d] of callPairs(playing.chain, at.stmt.chain)) if (d === callId) return [callId, p]
  return [callId]
}

/**
 * Commit a plan and run what it says: the edit is committed without the editor's own re-run (`noRun`), then the kit asks
 * for a partial run of exactly those statements. Editors that do not offer `runPart` yet run the whole sketch as usual.
 */
export function perform(plan: RunPlan | Sketch, note?: string): void {
  const host = kitHost()
  if (!host) return
  const before = host.sketch()
  const p: RunPlan = 'stmts' in plan ? { sketch: plan, run: [] } : plan
  if (p.sketch === before) return
  host.commit(p.sketch, { noRun: true })
  if (p.run.length) host.runPart?.(p.sketch, p.run)
  if (note) toast(note, { label: 'Undo', run: () => host.commit(before) })
}

/** Run all with the current preference (vanilla or clean slate). */
export function runAll(): void {
  kitHost()?.runAll?.({ reset: runAllMode() === 'clean' ? 'clean' : 'none' })
}
/** Hush + run all: everything goes black and the whole sketch runs from a clean slate, sources re-initialised. */
export function hushAndRunAll(): void {
  kitHost()?.runAll?.({ reset: 'clean', force: true })
}
/** Run all held: every held chain's draft runs at once. */
export function runAllHeldNow(): void {
  const host = kitHost()
  if (!host) return
  const plan = runAllHeld(host.sketch())
  if (plan.run.length) perform(plan)
}

// ---------------------------------------------------------------- UI

export interface HeldControlsProps {
  /** a chain statement: the playing chain (its `.out` row, output node or hat block) or a draft */
  id: string
  /** the editor's default for the follow switch */
  follow?: boolean
  /** what the chain is, for accessible names ("the o0 chain") */
  what?: string
  class?: string
}

/**
 * The controls on a chain's output: the follow switch, and when it is held "N pending" (which lists the changes, each with
 * ▶ run and ✕ discard), ▶ Run and ↺ Revert. On a draft with nothing of it playing: ▶ Run, which takes over the output.
 * Run buttons appear only when the editor offers partial runs (`KitHost.runPart`).
 */
export function HeldControls({ id, follow, what, class: cls }: HeldControlsProps) {
  const host = useHost()
  usePrefs()
  const [open, setOpen] = useState(false)
  if (!host) return null
  const sk = host.sketch()
  const a = heldActions(sk, id, { app: host.app, follow })
  const { info } = a
  if (!info.out) return null
  const canRun = !!host.runPart
  const n = info.changes.length
  const name = what ?? `the ${info.out} chain`
  const isDraft = info.state === 'draft'
  return (
    <span class={`held-controls state-${info.state}${cls ? ` ${cls}` : ''}`} data-no-undo-tap>
      {!isDraft && (
        <button
          type="button"
          class={`held-follow${a.follows ? ' on' : ''}`}
          aria-pressed={a.follows}
          aria-label={a.follows ? `Hold ${name}: edits wait for Run` : `Follow edits on ${name}`}
          title={a.follows ? 'Following: every edit re-runs this chain. Tap to hold edits until Run.' : 'Held: edits wait for Run. Tap to follow edits again.'}
          onClick={(e) => {
            e.stopPropagation()
            host.commit(a.setFollow(!a.follows), { view: true })
          }}
        >
          {a.follows ? '⟳' : '⏸'}
        </button>
      )}
      {n > 0 && (
        <button type="button" class="held-count" aria-expanded={open} onClick={(e) => (e.stopPropagation(), setOpen(!open))}>
          {n} pending
        </button>
      )}
      {canRun && a.run && (isDraft ? !(info.pending === id && n === 0) : n > 0) && (
        <button type="button" class="held-run" aria-label={`Run ${name}`} title={isDraft && info.playing ? 'Run this version: it takes over the output; the one playing becomes a draft' : 'Run the pending version'} onClick={(e) => (e.stopPropagation(), perform(a.run!()))}>
          ▶ Run
        </button>
      )}
      {a.revert && !isDraft && (
        <button type="button" class="held-revert" aria-label={`Revert ${name}`} title="Discard the pending version" onClick={(e) => (e.stopPropagation(), perform(a.revert!(), 'Reverted'))}>
          ↺
        </button>
      )}
      {open && n > 0 && <ChangeList changes={info.changes} actions={a} canRun={canRun} />}
    </span>
  )
}

function ChangeList({ changes, actions, canRun }: { changes: ChainChange[]; actions: HeldActions; canRun: boolean }) {
  return (
    <ul class="held-changes" role="list">
      {changes.map((c) => (
        <li key={c.id} data-change={c.id}>
          <span class="held-label">{c.label}</span>
          {canRun && (
            <button type="button" aria-label={`Run: ${c.label}`} onClick={(e) => (e.stopPropagation(), perform(actions.runChange(c.id)))}>
              ▶
            </button>
          )}
          <button type="button" aria-label={`Discard: ${c.label}`} onClick={(e) => (e.stopPropagation(), perform(actions.discardChange(c.id)))}>
            ✕
          </button>
        </li>
      ))}
    </ul>
  )
}

/** "Out of sync" with a one-tap Run all, shown only while what plays differs from the code (per output). */
export function SyncBadge({ class: cls }: { class?: string }) {
  const host = useHost()
  const rt = host?.runtime?.()
  const [, set] = useState(0)
  useEffect(() => rt?.onPlaying(() => set((v) => v + 1)), [rt])
  if (!host || !rt || !host.runAll) return null
  const outs = outOfSync(host.sketch(), rt.playing())
  if (!outs.length) return null
  return (
    <button type="button" class={`sync-badge${cls ? ` ${cls}` : ''}`} title={`The screen differs from the code on ${outs.join(', ')}`} onClick={(e) => (e.stopPropagation(), runAll())}>
      Out of sync · Run all
    </button>
  )
}

/**
 * The sketch-wide run controls: Run all (vanilla or clean slate, the preference beside it), Run all held, Hush + run all,
 * and Hold all. For an editor's toolbar or menu; each piece is also exported as a function.
 */
export function RunBar({ class: cls }: { class?: string }) {
  const host = useHost()
  usePrefs()
  if (!host?.runAll) return null
  const held = heldChains(host.sketch()).length
  const mode = runAllMode()
  return (
    <div class={`run-bar${cls ? ` ${cls}` : ''}`} role="group" aria-label="Run">
      <button type="button" class="run-all" onClick={runAll} title={mode === 'clean' ? 'Clean slate, then run everything' : 'Run everything as Hydra does: what the code no longer mentions keeps playing'}>
        ▶ Run all
      </button>
      <select aria-label="Run all mode" value={mode} onChange={(e) => setRunAllMode((e.currentTarget as HTMLSelectElement).value as RunAllMode)}>
        <option value="vanilla">vanilla</option>
        <option value="clean">clean slate</option>
      </select>
      {host.runPart && held > 0 && (
        <button type="button" class="run-held" onClick={runAllHeldNow}>
          ▶ Run all held ({held})
        </button>
      )}
      <button type="button" class="hush-run" onClick={hushAndRunAll} title="Everything black, then run the whole sketch">
        Hush + run all
      </button>
      <button type="button" class={`hold-all${holdAllOn ? ' on' : ''}`} aria-pressed={holdAllOn} onClick={() => setHoldAll(!holdAllOn)} title="Hold every chain: edits wait for Run">
        ⏸ Hold all
      </button>
    </div>
  )
}
