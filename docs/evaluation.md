# The evaluation model: when edits reach the screen

On hydra.ojack.xyz, running code is deliberate (a line, a block or everything) and it **accumulates**: running one line
leaves every other output playing. iDra's editors used to re-run the whole sketch from a blank slate on every edit, so
one chain could not be built while another played. This is the model that replaces that (agreed with the owner on
2026-10-10/11). Core and the shared kit support it; each editor adopts it in its own step (09).

## Everything is code

Held and draft chains are written in the sketch as the revivable `//` comments of disabled statements ("Disabled nodes"
in docs/IR.md), with no marker syntax, so the sketch still runs in vanilla Hydra and means the same there:

```js
osc(10, 0.1).rotate(0.2).out(o0)                 // playing on o0
// osc(10, 0.1).rotate(0.5).kaleid(4).out(o0)    // its draft: two pending changes
// noise(3).colorama(0.2).out(o1)                // a draft for o1, never run
```

* **Draft**: a disabled chain statement.
* **Held**: a playing chain plus a draft aimed at the same output. Editors show the pair as one chain with "N pending";
  editing a held chain edits the draft.
* **Following**: a playing chain with no draft; edits change it and re-run it (today's behaviour, scoped to one chain).
* Pairing needs no marker: a draft pairs with the chain that plays on its output (the last enabled one: later code
  wins). With several drafts for one output, the **nearest** one to the playing chain holds its pending edits (the one
  after it on a tie); the others are alternatives.
* The **follow switch** is the one piece that is not code. It decides where an edit goes (straight to the playing chain,
  or into a new draft copy), never what runs, so it is view state: `sketch.meta[<app>].hold` lists the chains whose
  switch is off (`followsEdits`, `setFollow`). Editors choose their own default (Code: deliberate; Chain Stack, Graph,
  Blocks: follow; Rack: fully live).
* **Hold all** (kit) holds every chain for the page; releasing it runs nothing.

Opening or reloading a sketch runs it all, as Hydra does; drafts don't run because they are comments.

## Core (`packages/core/src/evaluation.ts`)

| function | what it does |
|---|---|
| `outputGroups(sketch)` | per output: the playing chain, shadowed (overridden) chains, drafts, and the pending draft |
| `chainInfo(sketch, id, { follow })` | `following` / `held` / `draft`, its pair and pending changes |
| `chainChanges(playing, draft)` | the pending changes (below) |
| `callPairs(playing, draft)` | playing call id → the same call in the draft (unchanged, edited or moved) |
| `composeChain(playing, draft, selected, keep)` | the chain with some changes applied |
| `runDraft(sketch, draftId)` | **Run**: uncomment the draft, comment out every chain drawing its output (A/B); defs it needs come back on |
| `revertDraft(sketch, draftId)` | **Revert**: delete the draft |
| `applyChanges(sketch, playingId, ids, { keepDraft })` | run some changes: the playing line includes them; the draft goes away when nothing is left (unless `keepDraft`) |
| `discardChanges(sketch, playingId, ids, { keepDraft })` | discard some changes: only the draft is edited |
| `holdCopy(sketch, id)`, `duplicateAsDraft(sketch, id)` | a draft copy right after the chain (hold for editing; "copy chain" for A/B) |
| `editTarget(sketch, id, { follow, holdAll })` | where an edit to a playing chain goes: its draft, a new draft copy, or itself |
| `heldChains(sketch)`, `runAllHeld(sketch)` | **Run all held**: every held chain's draft runs (each as a whole-chain Run) |
| `partialRunSet(sketch, ids)` | what a partial run evaluates (below) |
| `outOfSync(sketch, runtime.playing())` | outputs where the screen differs from the code |

Operations that run something return a `RunPlan`: `{ sketch, run }`, the edited sketch and the statement ids to pass to
`runtime.runPart`.

### Changes

A change is not an edit history: it comes from comparing the playing chain with its draft, one entry per call. The
modifiers are aligned by function (a longest common subsequence that prefers identical calls); then:

* `arg`: one argument of a call present in both has a different value (`rotate: 0.2 → 0.5`);
* `toggle`: a modifier switched off or on;
* `add` / `remove`: a call only in the draft / only in the playing chain;
* `move`: a call that reappears unchanged somewhere else;
* `swap`: in the same place, one function replaced by another (also a different generator).

Ten drags on one argument are one change, and an edit that was undone is none. An added or swapped-in call is one change
with whatever arguments it has, so "an argument edit on a just-added call" is part of that call's change and nothing in
the list depends on anything else: any subset can run on its own. Selecting every change gives exactly the draft, none
gives the playing chain, and each change applied alone removes exactly that change from the list (tested on every case
in `test/evaluation.test.ts`). Calls copied from the draft into the playing chain get fresh ids; calls that stay keep
theirs, so live numbers keep working.

Held changes run at three sizes: **one change** (`applyChanges` with one id: the playing line is edited in place and
re-run; no A/B copy is kept, undo steps back), **one chain** (`runDraft`, which keeps the old version as a draft) and
**every held chain** (`runAllHeld`). Run all is different again: it runs the buffer as it stands, drafts skipped.

Note that after a whole-chain Run the old version *is* the new chain's pending draft, so the chain reads as held with
the differences back to the old version, and Run all held would switch it back. That follows from "the pairing needs no
marker"; Revert drops the old version.

## Runtime

* `runtime.run(sketch, { reset })`: `reset: 'clean'` (the default, unchanged) blacks out all four outputs, sets `render`
  back to o0, `speed` to 1 and `bpm` to 30, clears `update`/`afterUpdate` and changed sources (all with `force`) before
  evaluating, so the screen matches the code. `reset: 'none'` is vanilla Hydra's eval: only the code runs and anything it
  doesn't mention carries on (a deleted chain keeps playing, a source the code stops mentioning keeps showing). The clock
  is never reset either way. **Opening a different sketch should always use `clean`.** Hush + run all is
  `run(sketch, { reset: 'clean', force: true })`.
* `runtime.runPart(sketch, ids, { safe })`: a partial run. It evaluates those statements plus the enabled `def`s they read
  (transitively) and the source statements of sources they read, against the current state, resetting nothing: other
  outputs, sources and globals carry on. Settings (`speed`, `bpm`) and raw code run only when listed. Already initialised
  sources with the same arguments are not re-initialised (as in whole runs). It queues behind any run already asked for.
* `runtime.playing()`: per output, the chain the runtime last ran there (`{ stmt, chain }`, disabled modifiers left out
  and the live table's current numbers applied, so a dragged number is not "out of sync"). `onPlaying(cb)` fires after
  each run, partial run and hush. Compare with `outOfSync(sketch, runtime.playing())`: chains are compared by content,
  so a re-import (new ids) is still in sync. Only chains count; a changed `def` or setting does not show as out of sync.

## Kit (`packages/kit/src/Held.tsx`)

* `<HeldControls id follow? what?>` for a chain's output (the `.out` row, the output node, the hat block): the follow
  switch (⟳ following, ⏸ held), "N pending" (lists the changes, each with ▶ run and ✕ discard), ▶ Run and ↺ Revert. On a
  draft with nothing of it playing, ▶ Run takes over the output. `heldActions(sketch, id, { app, follow })` is the same
  without UI.
* `<SyncBadge>`: "Out of sync · Run all", shown only while `outOfSync` is not empty.
* `<RunBar>`: Run all with the vanilla / clean slate preference beside it, Run all held (n), Hush + run all, Hold all.
* Preferences (per editor, `kitPrefs()`): `runAllMode()` (`vanilla` by default), `liveWhileHeld()` ("numbers stay live
  while held", off: `numberTargets(sketch, callId)` then also returns the playing chain's same call). `holdAll()` is
  page-only.
* `perform(plan)` commits with `{ noRun: true }` and asks the editor for `runPart(sketch, ids)`.

`KitHost` gains two optional members, both going through the editor's runner so its trust gate applies:
`runPart(sketch, ids)` (→ `runtime.runPart(sketch, ids, { safe })`) and `runAll({ reset, force })`. Without them the kit
hides its Run buttons. `commit(next, { noRun: true })` must save an undoable edit without the editor's own re-run.

### Adopting it in an editor (step 09)

1. Implement `runPart`/`runAll` in the kit host and honour `noRun` in `commit`.
2. Run on edit only what the model says: a structural edit to a following chain re-runs that chain
   (`runtime.runPart(sketch, [chainId])` or a whole run in clean mode); an edit to a held chain goes to its draft
   (`editTarget`, then `callPairs` to map a call) and runs nothing; number drags on a following chain stay on `setLive`.
3. Put `<HeldControls>` on each chain's output, `<SyncBadge>` and `<RunBar>` in the bar.
4. Code views: ⌃Enter / ⌥Enter / ⌃⇧Enter run the line, block and everything (⌘ on iPad keyboards) with an Auto toggle
   for today's run-on-parse; the statements under the cursor come from `toCodeWithMap`.

## Proof

* `packages/core/test/evaluation.test.ts`: pairing, the diff, applying and discarding one change at a time on several
  chain shapes, Run/Revert/Run all held as code, partial-run sets, out-of-sync.
* `packages/core/test/runtime.test.ts` ("evaluation model"): vanilla vs clean slate (outputs, `speed`, sources),
  `runPart` leaving another output's shader alone, defs taken and settings not, a held chain's Run, live numbers in
  `playing()`, hush.
* `packages/kit/test/held.test.tsx`: the controls against a fake host.
* `node scripts/e2e-eval.mjs` (in CI): the harness's **Eval** tab in Chromium with real Hydra: vanilla leaves a deleted
  chain playing and shows out of sync, clean slate clears it; one change at a time with o1 untouched; Run as A/B; "Run on
  every edit" off makes edits wait for Run all.
