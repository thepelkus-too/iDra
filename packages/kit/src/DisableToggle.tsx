// Switch a chunk off and on again without deleting it. Off = ordinary `//` comments in the code (core's disable.ts), so the
// exported sketch still runs in vanilla Hydra. The editor shows the node dimmed and striped (`.is-disabled`), never hidden.
import { canDisable, setDisabled, type DisableCheck, type Sketch } from '@hydra-ipad/core'
import { usePress } from './gestures'
import { kitHost, useHost } from './host'
import { toast } from './overlay'

export interface DisableAction {
  check: DisableCheck
  /** a tap does something: the node switches alone (`check.ok`) or together with its `check.cascade` */
  available: boolean
  /** the toggle's accessible name: "Switch off" / "Switch on" (+ what) */
  label: string
  /** the node is off now */
  pressed: boolean
  /** what a tap does: the next sketch and a note to show (a cascade, a refusal), or no sketch when nothing can change */
  apply(): { sketch?: Sketch; note?: string; instead?: string }
}

/**
 * What the toggle for `id` does, without any UI: editors that draw their own control (a context-menu entry, a swipe) use
 * this and get the same rules: refusals come with a reason and, where it helps, the node to switch instead; switching a
 * `def` that other statements still use switches those too (and says so); switching a statement on switches on the defs
 * it needs.
 */
export function disableAction(sketch: Sketch, id: string, what = ''): DisableAction {
  const check = canDisable(sketch, id)
  const pressed = check.disabled
  const label = `${pressed ? 'Switch on' : 'Switch off'}${what ? ` ${what}` : ''}`
  const cascade = check.ok ? [] : (check.cascade ?? [])
  const available = check.ok || cascade.length > 0
  return {
    check,
    available,
    label,
    pressed,
    apply() {
      if (!available) return { note: check.reason ?? 'This can’t be switched off on its own.', instead: check.instead }
      const next = setDisabled(sketch, id, !pressed, { cascade: cascade.length > 0 })
      const n = cascade.length
      const note = n ? (pressed ? `Also switched on ${n} definition${n > 1 ? 's' : ''} it needs.` : `Also switched off ${n} statement${n > 1 ? 's' : ''} that use${n > 1 ? '' : 's'} it.`) : undefined
      return { sketch: next, note }
    },
  }
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

export interface DisableToggleProps {
  /** the statement or call id */
  id: string
  /** what the node is, for the accessible name and the tooltip ("rotate", "the o1 chain") */
  what?: string
  /** defaults to the kit host's sketch and commit */
  sketch?: Sketch
  onChange?: (next: Sketch) => void
  class?: string
}

/**
 * A small `//` button that switches a node off and on. When the node can't be switched off on its own the button stays,
 * marked unavailable: hover shows the reason (title), and a tap or a long-press shows it as a toast, with a button to switch
 * the enclosing statement or call instead when there is one.
 */
export function DisableToggle({ id, what, sketch, onChange, class: cls }: DisableToggleProps) {
  const host = useHost()
  const sk = sketch ?? host?.sketch()
  const commit = (next: Sketch) => (onChange ? onChange(next) : kitHost()?.commit(next))
  const act = sk ? disableAction(sk, id, what) : undefined
  const explain = () => {
    if (!act) return
    const r = act.apply()
    if (r.instead && sk) {
      const alt = disableAction(sk, r.instead)
      toast(r.note ?? '', alt.available ? { label: alt.pressed ? 'Switch the whole thing on' : 'Switch the whole thing off', run: () => { const x = alt.apply(); if (x.sketch) commit(x.sketch) } } : undefined)
    } else toast(r.note ?? act.check.reason ?? '')
  }
  const run = () => {
    if (!act) return
    if (!act.available) return explain()
    const r = act.apply()
    if (!r.sketch) return
    const before = sk!
    commit(r.sketch)
    if (r.note) toast(r.note, { label: 'Undo', run: () => commit(before) })
  }
  // a tap switches; a long-press explains (iPad has no hover); the keyboard's Enter/Space arrive as a click with detail 0
  const press = usePress({ onTap: run, onLong: explain })
  if (!act || act.check.kind === 'missing') return null
  const ok = act.available
  const n = act.check.ok ? 0 : (act.check.cascade?.length ?? 0)
  return (
    <button
      type="button"
      class={`disable-toggle${act.pressed ? ' off' : ''}${ok ? '' : ' unavailable'}${cls ? ` ${cls}` : ''}`}
      aria-pressed={act.pressed}
      aria-disabled={!ok}
      aria-label={act.label}
      title={ok ? `${act.label}; it stays in the code as a // comment.${n ? ` ${cap(act.check.reason ?? '')}; ${n > 1 ? 'those switch' : 'that switches'} with it.` : ''}` : act.check.reason}
      data-no-undo-tap
      {...press}
      onClick={(e) => {
        e.stopPropagation()
        if (e.detail === 0) run()
      }}
    >
      //
    </button>
  )
}
