// The operator tray: a slim strip along an edge of the stack (bottom in portrait, beside it in landscape) holding the same
// grouped, thumbnailed functions as the picker, plus search, recents and favourites. Drag a chip into the stack (a gap
// between rows, a texture parameter, or between statements for a generator), or tap it to insert after the selected row.
// Collapsible to a thin handle; the ＋ in the top bar toggles it. While a row is being dragged, the open tray is a delete zone.
import { TAP_SLOP, toast } from '@hydra-ipad/kit'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { signature } from '../conv'
import { ctx } from '../ctx'
import { startChipDrag } from '../drag'
import { focusNode } from '../nav'
import { appPrefs } from '../prefs'
import { bumpTray, dropOperator, isGenerator, onTray, pushRecent, setTray, tapTarget, tray, type DropTarget } from '../tray'
import { metaOf } from '../view'
import { openMenu } from './Menu'
import { customName, filterGroups, groupsFor, Thumb, useCatalogVersion, type FnGroup } from './Picker'

export function useTray() {
  const [, bump] = useState(0)
  useEffect(() => onTray(() => bump((v) => v + 1)), [])
  return tray
}

export function toggleTray(open = !tray.open): void {
  setTray({ open, ...(open ? {} : { target: undefined }) })
}

/** Open the tray with a fixed insertion point ("insert above / below" from a row's long-press menu). */
export function openTrayAt(drop: DropTarget, label: string): void {
  setTray({ open: true, target: { drop, label } })
  setTimeout(() => document.querySelector<HTMLInputElement>('[data-testid=tray-search]')?.focus({ preventScroll: true }), 30)
}

const recents = () => appPrefs.get<string[]>('trayRecent') ?? []
const favourites = () => appPrefs.get<string[]>('trayFav') ?? []

/** Insert `fn` at `target` (a drop), else at the tray's fixed target, else after the selected row. */
export function insertOperator(fn: string, target?: DropTarget): boolean {
  const sk = ctx.store.sketch
  const fixed = !target && tray.target ? tray.target.drop : undefined
  const t = target ?? fixed ?? tapTarget(sk, fn, ctx.catalog, ctx.store.selection, metaOf(sk)?.active)
  if (!t) {
    toast('Start with a generator: drag osc, noise or another one into the stack')
    return false
  }
  const r = dropOperator(sk, t, fn, ctx.catalog)
  if (r.refused) {
    toast(r.refused)
    return false
  }
  ctx.store.commit(r.sketch)
  if (r.select) ctx.store.select(r.select)
  appPrefs.set('trayRecent', pushRecent(recents(), fn))
  if (fixed) setTray({ target: undefined })
  const sel = r.select
  if (sel) setTimeout(() => focusNode(sel), 60)
  return true
}

function toggleFavourite(fn: string): void {
  const f = favourites()
  appPrefs.set('trayFav', f.includes(fn) ? f.filter((x) => x !== fn) : [...f, fn])
  bumpTray()
}

/** Pointer handling of one chip: tap inserts; moving across the tray's scroll direction (or any mouse drag) drags it out; a still hold offers favourites. */
function useChip(fn: string, axis: 'x' | 'y') {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const axisRef = useRef(axis)
  axisRef.current = axis
  return useMemo(() => {
    let s: { id: number; x: number; y: number; moved: boolean; long: boolean; dragging: boolean; timer?: ReturnType<typeof setTimeout> } | null = null
    return {
      onPointerDown(e: PointerEvent) {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        const el = e.currentTarget as HTMLElement
        const me = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, long: false, dragging: false } as NonNullable<typeof s>
        s = me
        me.timer = setTimeout(() => {
          if (s !== me || me.moved) return
          me.long = true
          const fav = favourites().includes(fnRef.current)
          openMenu(el, [
            { label: fav ? 'Remove from favourites' : 'Add to favourites', run: () => toggleFavourite(fnRef.current), testid: 'op-fav' },
            { label: 'Insert after the selected row', run: () => void insertOperator(fnRef.current) },
          ], fnRef.current)
        }, 520)
      },
      onPointerMove(e: PointerEvent) {
        if (!s || s.id !== e.pointerId || s.dragging || s.long) return
        const dx = e.clientX - s.x
        const dy = e.clientY - s.y
        if (Math.hypot(dx, dy) <= TAP_SLOP) return
        clearTimeout(s.timer)
        s.moved = true
        const across = axisRef.current === 'x' ? Math.abs(dy) > Math.abs(dx) : Math.abs(dx) > Math.abs(dy)
        if (e.pointerType === 'mouse' || across) {
          s.dragging = true
          const name = fnRef.current
          startChipDrag(e, e.currentTarget as HTMLElement, {
            fn: name,
            generator: isGenerator(name, ctx.catalog),
            onDrop: (t) => {
              s = null
              if (t) insertOperator(name, t)
            },
          })
        } else s = null // the tray is scrolling
      },
      onPointerUp(e: PointerEvent) {
        if (!s || s.id !== e.pointerId) return
        clearTimeout(s.timer)
        const tap = !s.moved && !s.long && !s.dragging
        if (!s.dragging) s = null
        if (tap) insertOperator(fnRef.current)
      },
      onPointerCancel() {
        if (s?.timer) clearTimeout(s.timer)
        if (s && !s.dragging) s = null
      },
      onClick(e: MouseEvent) {
        // the keyboard's Enter / Space arrive as a click with detail 0; pointer taps were handled on pointerup
        if (e.detail === 0) insertOperator(fnRef.current)
      },
      onContextMenu(e: Event) {
        e.preventDefault()
      },
    }
  }, [])
}

function Chip({ fn, axis, plugin }: { fn: string; axis: 'x' | 'y'; plugin?: string }) {
  const h = useChip(fn, axis)
  const def = ctx.catalog.get(fn)
  const gen = def?.type === 'src'
  return (
    <button type="button" class={`op ${gen ? 'gen' : ''}`} data-pick={fn} data-testid="op" title={def ? signature(def) : fn} aria-label={`${fn}: tap to insert after the selected row, or drag into the stack`} {...h}>
      <Thumb name={fn} size={28} />
      <code>
        {gen ? '' : '.'}
        {fn}()
      </code>
      {plugin && <small>{plugin}</small>}
    </button>
  )
}

export function Tray({ side }: { side: boolean }) {
  const t = useTray()
  useCatalogVersion()
  const [q, setQ] = useState('')
  const axis: 'x' | 'y' = side ? 'y' : 'x'
  const fixed = t.target
  const groups = useMemo<FnGroup[]>(() => {
    const mods = groupsFor('mod')
    // a fixed insertion point inside a chain only takes modifiers
    return fixed ? mods : [...mods, ...groupsFor('gen')]
  }, [ctx.catalog.version, !!fixed])
  const known = new Set(groups.flatMap((g) => g.fns.map((f) => f.name)))
  const pick = (names: string[]) => names.filter((n) => known.has(n)).map((n) => ctx.catalog.get(n)!)
  const top: FnGroup[] = q.trim()
    ? []
    : [
        { title: 'Favourites', fns: pick(favourites()) },
        { title: 'Recent', fns: pick(recents()) },
      ].filter((g) => g.fns.length)
  const shown = filterGroups(groups, q)
  const custom = q.trim() ? customName(q) : undefined
  const first = custom ?? shown[0]?.fns[0]?.name

  // closed: only the handle (a row dragged near the edge must never land on a delete zone it can't see)
  if (!t.open) {
    return (
      <aside class={`tray ${side ? 'side' : 'bottom'} closed`} data-tray data-testid="tray" aria-label="Operators">
        <button type="button" class="tray-handle" data-testid="tray-handle" aria-label="Show operators" aria-expanded={false} onClick={() => toggleTray(true)}>
          <i />
        </button>
      </aside>
    )
  }
  return (
    <aside class={`tray ${side ? 'side' : 'bottom'} open ${t.rowDrag ? 'rowdrag' : ''} ${t.rowOver ? 'rowover' : ''}`} data-tray data-testid="tray" aria-label="Operators">
      {t.rowDrag && (
        <div class="tray-delete" data-testid="tray-delete">
          Drop here to delete
        </div>
      )}
      <div class="tray-head">
        <input
          type="search"
          data-testid="tray-search"
          placeholder={fixed ? 'Search modifiers' : 'Search'}
          aria-label="Search operators; Enter inserts the first one after the selected row"
          autocapitalize="off"
          autocorrect="off"
          autocomplete="off"
          spellcheck={false}
          enterKeyHint="go"
          value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && first) {
              e.preventDefault()
              if (insertOperator(first)) setQ('')
            } else if (e.key === 'Escape') {
              if (q) setQ('')
              else toggleTray(false)
            }
          }}
        />
        <button type="button" class="tray-close" data-testid="tray-close" aria-label="Hide operators" onClick={() => toggleTray(false)}>
          {side ? '›' : '⌄'}
        </button>
      </div>
      {fixed && (
        <div class="tray-target" data-testid="tray-target">
          <span>{fixed.label}</span>
          <button type="button" class="linkish" aria-label="Cancel the insertion point" onClick={() => setTray({ target: undefined })}>
            cancel
          </button>
        </div>
      )}
      <div class="tray-scroll" data-testid="tray-scroll">
        {custom && (
          <button type="button" class="op custom" data-testid="op-custom" onClick={() => insertOperator(custom) && setQ('')}>
            Use “{custom}”
          </button>
        )}
        {[...top, ...shown].map((g) => (
          <section key={g.title} data-group={g.title} class="tray-group">
            <h5>{g.title}</h5>
            <div class="ops">
              {g.fns.map((f) => (
                <Chip key={f.name} fn={f.name} axis={axis} plugin={g.plugin ? f.origin.replace('plugin:', '') : undefined} />
              ))}
            </div>
          </section>
        ))}
        {!shown.length && !custom && <div class="empty">Nothing called “{q}”.</div>}
      </div>
    </aside>
  )
}
