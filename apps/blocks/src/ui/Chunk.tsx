// Switching blocks off and peeking at a chain "up to here". Off is a `//` comment in the code (core's disable.ts), so a
// switched-off block stays where it is, dimmed and striped, with its slots still editable; the kit's DisableToggle and
// disableAction carry the rules (a hat switches its whole script, a def takes the scripts that use it along). Previews come
// from the kit's PreviewPeek in a popover anchored to the block; nothing runs while it is closed.
import { onPreviewMode, previewMode, setPreviewMode, walkChains, type Call, type Chain, type PreviewHandle, type PreviewMode, type PreviewPool, type PreviewSpec, type Sketch } from '@hydra-ipad/core'
import { disableAction, DisableToggle, kitPreviewPool, openPopover, PreviewPeek, toast } from '@hydra-ipad/kit'
import { useEffect, useState } from 'preact/hooks'
import { ctx, useStore } from '../kit/ctx'
import { openMenu, type MenuItem } from '../kit/Menu'
import { appPrefs } from '../prefs'

export function usePreviewMode(): PreviewMode {
  const [m, set] = useState(previewMode())
  useEffect(() => onPreviewMode(set), [])
  return m
}

const MODE_LABEL: Record<PreviewMode, string> = { off: 'off', demand: 'on demand', live: 'live' }
const NEXT_MODE: Record<PreviewMode, PreviewMode> = { off: 'demand', demand: 'live', live: 'off' }

/** The ⋯ menu entry: previews off → on demand → live. */
export function previewModeItem(): MenuItem {
  const m = previewMode()
  return { label: `Block previews: ${MODE_LABEL[m]}`, hint: `tap: ${MODE_LABEL[NEXT_MODE[m]]}`, run: () => setPreviewMode(NEXT_MODE[m]), testid: 'menu-previews' }
}

// ---------------------------------------------------------------- switching off

/** Where a block sits: what its tools and its menu act on. */
export interface BlockAt {
  call: Call
  chain: Chain
  /** -1 for the hat */
  index: number
  stmtId: string
  /** the chain is a script's own (not in a socket) */
  top: boolean
}

/** What the block's `//` switches: a script's hat switches the whole script; anything else switches itself. */
export const switchId = (b: Pick<BlockAt, 'call' | 'index' | 'stmtId' | 'top'>): string => (b.index < 0 && b.top ? b.stmtId : b.call.id)
const switchWhat = (b: BlockAt): string => (b.index < 0 && b.top ? 'this script' : b.call.fn)

/** The id the selection bar's switch acts on: a selected hat of a script means the script. */
export function switchIdOf(sk: Sketch, sel: string): string {
  const s = sk.stmts.find((x) => (x.k === 'chain' && x.chain.gen.id === sel) || (x.k === 'def' && x.value.k === 'tex' && x.value.chain.gen.id === sel))
  return s ? s.id : sel
}

/** Switch `id` off or on with the kit's rules (refusals explain themselves; a cascade says so, with Undo). */
export function toggleSwitch(id: string, what = ''): void {
  const sk = ctx.store.sketch
  const act = disableAction(sk, id, what)
  const r = act.apply()
  if (!r.sketch) {
    const alt = r.instead ? disableAction(sk, r.instead) : undefined
    const run = () => {
      const x = alt!.apply()
      if (x.sketch) ctx.store.commit(x.sketch)
    }
    return void toast(r.note ?? act.check.reason ?? '', alt?.available ? { label: alt.pressed ? 'Switch the whole thing on' : 'Switch the whole thing off', run } : undefined)
  }
  ctx.store.commit(r.sketch)
  if (r.note) toast(r.note, { label: 'Undo', run: () => ctx.store.commit(sk) })
}

/** Is this node switched off now? */
export const isOff = (sk: Sketch, id: string): boolean => disableAction(sk, id).pressed

// ---------------------------------------------------------------- previews

let pool: PreviewPool | undefined
/**
 * The kit's shared pool, with one workaround (see the README's core change requests): core's pool drops a preview that is
 * `starting` when `update()` arrives with the same chunk (a new plan object, same key), and it then stays `starting` for
 * good. PreviewPeek calls `update()` right after opening, and the workspace commits view state (the camera) at any time,
 * so here updates wait until the preview has left `starting`; the latest one wins.
 */
export function blocksPreviewPool(): PreviewPool {
  if (pool) return pool
  const base = kitPreviewPool()
  pool = {
    open(spec, c) {
      const h = base.open(spec, c)
      let pending: Parameters<PreviewHandle['update']>[0] | undefined
      const flush = () => {
        if (!pending || h.state === 'starting') return
        const next = pending
        pending = undefined
        h.update(next)
      }
      h.onState(flush)
      const update = (next: Parameters<PreviewHandle['update']>[0]) => {
        pending = { ...pending, ...next }
        flush()
      }
      return new Proxy(h, {
        get(t, k) {
          if (k === 'update') return update
          const v = Reflect.get(t, k)
          return typeof v === 'function' ? v.bind(t) : v
        },
      })
    },
    get stats() {
      return base.stats
    },
    get mode() {
      return base.mode
    },
    setMode: (m) => base.setMode(m),
    dispose: () => base.dispose(),
  }
  return pool
}

/** "osc → rotate → kaleid": the chain's enabled calls up to `upTo` (the call itself always counts). */
export function chainLabel(chain: Chain, upTo: string): string {
  const out: string[] = []
  for (const c of [chain.gen, ...chain.mods]) {
    if (!c.disabled || c.id === upTo) out.push(c.fn)
    if (c.id === upTo) break
  }
  return out.join(' → ')
}

function PeekPanel({ spec, title }: { spec: PreviewSpec; title: string }) {
  return (
    <div class="peek-pop" data-testid="peek-pop" data-kind={spec.kind}>
      <div class="peek-title">{title}</div>
      <PreviewPeek spec={spec} label={title} pool={blocksPreviewPool()} />
      <small class="peek-hint">{spec.kind === 'diff' ? 'Tap the picture to play it, then A or B.' : 'Tap the picture to play it larger.'}</small>
    </div>
  )
}

/** The peek, anchored to the block: "up to here", or before/after one block. Closing the popover closes the preview. */
export function openPeek(anchor: Element, b: BlockAt, kind: 'prefix' | 'diff' = 'prefix'): void {
  const spec: PreviewSpec = kind === 'prefix' ? { kind: 'prefix', chainId: b.chain.id, upToCallId: b.call.id } : { kind: 'diff', callId: b.call.id }
  const title = kind === 'prefix' ? `Up to here: ${chainLabel(b.chain, b.call.id)}` : `${b.call.fn}: before / after`
  openPopover(anchor, () => <PeekPanel spec={spec} title={title} />, { width: 290, label: title })
}

/** The `//` and the eye at the end of a block. */
export function BlockTools({ b }: { b: BlockAt }) {
  const mode = usePreviewMode()
  return (
    <span class="blk-tools" data-no-undo-tap onPointerDown={(e) => e.stopPropagation()}>
      <DisableToggle id={switchId(b)} what={switchWhat(b)} />
      {mode !== 'off' && (
        <button type="button" class="eye" data-testid="eye" aria-label={`Preview up to ${b.call.fn}`} title="Preview the chain up to here" onClick={(e) => (e.stopPropagation(), openPeek((e.currentTarget as HTMLElement).closest('.block') ?? (e.currentTarget as HTMLElement), b))}>
          👁
        </button>
      )}
    </span>
  )
}

/** Just the `//`, for a whole statement (set, setup blocks). */
export function StmtSwitch({ id, what }: { id: string; what: string }) {
  return (
    <span class="blk-tools" data-no-undo-tap onPointerDown={(e) => e.stopPropagation()}>
      <DisableToggle id={id} what={what} />
    </span>
  )
}

/** Long-press on a block: preview up to here, before/after, switch off or on. */
export function openBlockMenu(el: HTMLElement, b: BlockAt): void {
  const id = switchId(b)
  const act = disableAction(ctx.store.sketch, id, switchWhat(b))
  const items: MenuItem[] = []
  if (previewMode() !== 'off') {
    items.push({ label: 'Preview up to here', run: () => openPeek(el, b), testid: 'menu-peek' })
    if (b.index >= 0) items.push({ label: 'Before / after (A/B)', hint: 'what does this do?', run: () => openPeek(el, b, 'diff'), testid: 'menu-ab' })
  }
  items.push({ label: act.label, hint: '// in the code', run: () => toggleSwitch(id, switchWhat(b)), testid: 'menu-switch', sep: items.length > 0 })
  openMenu(el, items, b.call.fn, 260)
}

/** Long-press on a set / setup block: switch it off or on. */
export function openStmtMenu(el: HTMLElement, id: string, what: string): void {
  const act = disableAction(ctx.store.sketch, id, what)
  if (act.check.kind === 'missing') return
  openMenu(el, [{ label: act.label, hint: '// in the code', run: () => toggleSwitch(id, what), testid: 'menu-switch' }], what, 260)
}

// ---------------------------------------------------------------- revived comments

/** Statements and calls switched off in a sketch. */
export function disabledCount(sk: Sketch): number {
  let n = sk.stmts.filter((s) => s.disabled).length
  for (const { chain } of walkChains(sk)) n += chain.mods.filter((m) => m.disabled).length
  return n
}

const noteKey = (id: string) => `revived:${id}`

/**
 * A sketch fresh from an import (no editor has written view state yet) that already has switched-off parts got them from
 * commented-out code the importer revived. Remember the count until the note is dismissed (outside the sketch, so undo
 * never brings the note back).
 */
export function noteRevived(sk: Sketch): void {
  if (Object.keys(sk.meta ?? {}).length) return
  const n = disabledCount(sk)
  if (n) appPrefs.set(noteKey(sk.id), n)
}

export function RevivedNote() {
  useStore()
  const id = ctx.store.sketch.id
  const [, bump] = useState(0)
  const n = appPrefs.get<number>(noteKey(id))
  if (!n) return null
  return (
    <div class="banner revived" role="status" data-testid="revived-note">
      <span>
        {n} commented-out chunk{n > 1 ? 's were' : ' was'} revived as disabled. A block’s <code>//</code> switches it on.
      </span>
      <button type="button" class="icon" aria-label="Dismiss" data-testid="revived-dismiss" onClick={() => (appPrefs.remove(noteKey(id)), bump((v) => v + 1))}>
        ✕
      </button>
    </div>
  )
}
