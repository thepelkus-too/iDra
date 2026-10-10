// The palette: a flyout on the left (landscape) or a drawer at the bottom (portrait), with category tabs and a search box.
// Every function block is generated from the catalog (plugins too, live through catalog.subscribe), with a small live
// thumbnail of the function in its default state. Drag a block out to place it; tap to add it where it makes sense; hold
// for a one-line "what does this do?" card. Dropping anything back on the palette deletes it.
import { OUT_NAMES, SOURCE_NAMES, type FnDef } from '@hydra-ipad/core'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ui, useUi } from '../doc'
import { pressToDrag, type PItem } from '../drag'
import { locate } from '../edit'
import { helpFor } from '../help'
import { ctx, useCatalogVersion, useStore } from '../kit/ctx'
import { closePopover, LONG_MS, openPopover, TAP_SLOP, toast } from '@hydra-ipad/kit'
import { MOD_ICON, type ModKind } from '../kit/mods'
import { thumbs } from '../kit/thumbs'
import { MATH_ITEMS } from '../math'
import { appPrefs } from '../prefs'
import { TYPE_ICON, typeOf } from './Blocks'
import { doDrop, wsApi } from './Workspace'

export interface Item {
  key: string
  label: string
  group: string
  item: PItem
  fn?: FnDef
  icon: string
  /** css class for the colour */
  cls: string
  help: string
}

export const GROUPS = ['Sources', 'Geometry', 'Color', 'Blend', 'Modulate', 'Reporters', 'Math', 'Setup', 'Plugins'] as const
const TYPE_GROUP: Record<string, string> = { src: 'Sources', coord: 'Geometry', color: 'Color', combine: 'Blend', combineCoord: 'Modulate' }

const WAVES: Array<[ModKind, string, string]> = [
  ['sine', 'sine wave', 'Moves smoothly up and down, like a swing.'],
  ['saw', 'saw wave', 'Ramps up, then jumps back down.'],
  ['tri', 'triangle wave', 'Ramps up, then ramps back down.'],
  ['square', 'square wave', 'Flips between two values.'],
  ['rnd', 'random steps', 'Jumps to a new random value now and then.'],
  ['time', 'time', 'Keeps counting up: things keep turning.'],
  ['mouseX', 'mouse x', 'Follows the pointer left and right.'],
  ['mouseY', 'mouse y', 'Follows the pointer up and down.'],
  ['audio', 'audio bin [0]', 'Loudness of one band of the microphone.'],
  ['vol', 'volume', 'Overall loudness of the microphone.'],
  ['steps', 'pattern', 'Steps through a list of numbers.'],
  ['expr', 'JS expression', 'Any JavaScript that returns a number.'],
]
const SETUP: Array<[Extract<PItem, { t: 'setup' }>['what'], string, string]> = [
  ['cam', 'camera → s0', 'Use the camera as source s0.'],
  ['image', 'image URL → s0', 'Load a picture from the web into s0.'],
  ['video', 'video URL → s0', 'Load a video from the web into s0.'],
  ['screen', 'screen → s0', 'Share a screen or window into s0.'],
  ['bpm', 'bpm', 'Beats per minute for patterns.'],
  ['speed', 'speed', 'How fast time runs.'],
  ['render', 'show all outputs', 'Show o0–o3 together, or pick one.'],
  ['var-num', 'set a number variable', 'A named number you can use in many places.'],
  ['var-tex', 'set a picture variable', 'A named picture you can use in many sockets.'],
  ['comment', 'comment', 'A note to yourself. Not run.'],
  ['raw', 'advanced JS', 'Any JavaScript, run as written.'],
]

export function allItems(): Item[] {
  const out: Item[] = []
  for (const f of ctx.catalog.list()) {
    const plugin = f.origin.startsWith('plugin:')
    const type = typeOf(f.name)
    out.push({ key: `fn:${f.name}`, label: f.name, group: plugin ? 'Plugins' : (TYPE_GROUP[f.type] ?? 'Plugins'), item: { t: 'fn', fn: f.name }, fn: f, icon: TYPE_ICON[type], cls: `t-${type} ${f.type === 'src' ? 'p-hat' : 'p-stk'}`, help: helpFor(f) })
  }
  for (const [k, label, help] of WAVES) out.push({ key: `mod:${k}`, label, group: 'Reporters', item: { t: 'value', value: { k: 'fn', src: `mod:${k}` }, label }, icon: MOD_ICON[k], cls: 'p-rep r-wave', help })
  for (const o of OUT_NAMES) out.push({ key: `ref:${o}`, label: o, group: 'Reporters', item: { t: 'value', value: { k: 'ref', name: o }, label: o }, icon: '▣', cls: 'p-rep r-out', help: `What output ${o} shows. Into its own script: feedback.` })
  for (const s of SOURCE_NAMES) out.push({ key: `ref:${s}`, label: s, group: 'Reporters', item: { t: 'value', value: { k: 'ref', name: s }, label: s }, icon: '◎', cls: 'p-rep r-src', help: `Source ${s}: a camera, image or video set up first.` })
  for (const s of ctx.store.sketch.stmts) if (s.k === 'def') out.push({ key: `var:${s.name}`, label: s.name, group: 'Reporters', item: { t: 'value', value: { k: 'var', name: s.name }, label: s.name }, icon: '𝑥', cls: 'p-rep r-var', help: `The variable ${s.name}.` })
  for (const m of MATH_ITEMS) out.push({ key: `math:${m.key}`, label: m.label, group: 'Math', item: { t: 'math', node: m.node, label: m.label }, icon: '∑', cls: 'p-rep r-math', help: 'Math on numbers. Drop reporters into its holes.' })
  for (const [k, label] of [['mod:time', 'time'], ['mod:mouseX', 'mouse x'], ['mod:mouseY', 'mouse y']] as const) out.push({ key: `mathv:${k}`, label, group: 'Math', item: { t: 'value', value: { k: 'fn', src: k }, label }, icon: MOD_ICON[k.slice(4) as ModKind], cls: 'p-rep r-wave', help: 'Drop into a math hole (or a slot).' })
  for (const o of OUT_NAMES) out.push({ key: `cap:${o}`, label: `show on ${o}`, group: 'Setup', item: { t: 'cap', out: o }, icon: '▭', cls: 'p-cap', help: `Snap under a script to show it on ${o}.` })
  for (const [w, label, help] of SETUP) out.push({ key: `setup:${w}`, label, group: 'Setup', item: { t: 'setup', what: w }, icon: w === 'raw' ? '{ }' : w === 'comment' ? '💬' : w.startsWith('var') ? '𝑥' : '⚙', cls: `p-setup ${w === 'raw' ? 'p-raw' : ''}`, help })
  return out
}

/** Tap: put the block where it makes sense (a hat as a new script; a block under the selected one; a cap on the selected script). */
export function addByTap(it: Item): void {
  const p = it.item
  const sk = ctx.store.sketch
  const sel = ui.state.sel
  const at = locate(sk, sel ?? '')
  const stmt = sk.stmts.find((s) => s.id === (ui.state.stmt ?? sel))
  const center = wsApi.center()
  if (p.t === 'fn') {
    if (ctx.catalog.get(p.fn)?.type === 'src') return doDrop({ t: 'new', item: p }, { t: 'empty' }, center)
    if (at) return doDrop({ t: 'new', item: p }, { t: 'after', chainId: at.chain.id, index: at.index, top: !at.socket && !at.def, stmtId: at.stmt.id }, center)
    if (stmt?.k === 'chain') return doDrop({ t: 'new', item: p }, { t: 'after', chainId: stmt.chain.id, index: stmt.chain.mods.length - 1, top: true, stmtId: stmt.id }, center)
    return void toast(`Drag ${p.fn} under a block, or select a block first`)
  }
  if (p.t === 'cap') {
    if (stmt?.k !== 'chain') return void toast('Select a script first, or drag this under one')
    return doDrop({ t: 'new', item: p }, { t: 'after', chainId: stmt.chain.id, index: stmt.chain.mods.length - 1, top: true, stmtId: stmt.id }, center)
  }
  if (p.t === 'setup') return doDrop({ t: 'new', item: p }, { t: 'empty' }, center)
  toast('Drag this into a round slot (or a socket) of a block')
}

export function Palette() {
  useCatalogVersion()
  useStore()
  const st = useUi()
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string>(() => appPrefs.get<string>('group') ?? 'Sources')
  const defs = ctx.store.sketch.stmts.filter((s) => s.k === 'def').map((s) => (s.k === 'def' ? s.name : '')).join()
  const items = useMemo(allItems, [ctx.catalog.version, defs])
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase()
    if (ql) return items.filter((i) => i.label.toLowerCase().includes(ql) || i.group.toLowerCase().includes(ql) || i.help.toLowerCase().includes(ql))
    return items.filter((i) => i.group === group)
  }, [q, group, items])
  if (!st.palette) return null
  return (
    <aside class="palette" data-testid="palette" data-drop={st.drag ? 'trash' : undefined} aria-label="Blocks palette">
      <div class="pal-head">
        <input
          class="pal-search"
          type="search"
          placeholder="Search blocks…"
          aria-label="Search"
          data-testid="pal-search"
          value={q}
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="button" class="icon" aria-label="Close palette" data-testid="pal-close" onClick={() => ui.set({ palette: false })}>
          ✕
        </button>
      </div>
      <div class="pal-tabs" role="tablist">
        {GROUPS.filter((g) => g !== 'Plugins' || items.some((i) => i.group === 'Plugins')).map((g) => (
          <button
            type="button"
            role="tab"
            key={g}
            aria-selected={!q && group === g}
            class={`tab g-${g} ${!q && group === g ? 'on' : ''}`}
            data-testid={`pal-tab-${g}`}
            onClick={() => {
              setQ('')
              setGroup(g)
              appPrefs.set('group', g)
            }}
          >
            {g}
          </button>
        ))}
      </div>
      <div class="pal-items">
        {shown.length === 0 && <div class="empty">Nothing matches.</div>}
        {shown.map((it) => (
          <PalItem key={it.key} it={it} />
        ))}
      </div>
      {st.drag && <div class="pal-trash">Drop here to delete</div>}
    </aside>
  )
}

function PalItem({ it }: { it: Item }) {
  const [thumb, setThumb] = useState<string | undefined>(() => (it.fn ? thumbs.peek(it.fn.name) : undefined))
  const ref = useRef<HTMLDivElement>(null)
  // thumbnails are made lazily, only for blocks that scroll into view
  useEffect(() => {
    if (!it.fn || thumb) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return void thumbs.get(it.fn.name).then((u) => u && setThumb(u))
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect()
        void thumbs.get(it.fn!.name).then((u) => u && setThumb(u))
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [it.key])
  const long = useRef<{ timer?: ReturnType<typeof setTimeout>; fired: boolean; x: number; y: number }>({ fired: false, x: 0, y: 0 })
  const press = pressToDrag(
    () => (long.current.fired ? undefined : { t: 'new', item: it.item }),
    () => !long.current.fired && addByTap(it),
  )
  return (
    <div
      ref={ref}
      class={`pal-item ${it.cls}`}
      role="button"
      tabIndex={0}
      data-item={it.key}
      data-testid="pal-item"
      style={{ touchAction: 'none' }}
      aria-label={`${it.label}: ${it.help}`}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), addByTap(it))}
      onPointerDown={(e) => {
        const L = long.current
        L.fired = false
        L.x = e.clientX
        L.y = e.clientY
        clearTimeout(L.timer)
        const el = e.currentTarget as HTMLElement
        L.timer = setTimeout(() => {
          L.fired = true
          showHelp(el, it)
        }, LONG_MS + 80)
        const cancel = (ev: PointerEvent) => {
          if (ev.type === 'pointermove' && Math.hypot(ev.clientX - L.x, ev.clientY - L.y) < TAP_SLOP) return
          clearTimeout(L.timer)
          window.removeEventListener('pointermove', cancel)
          window.removeEventListener('pointerup', cancel)
          window.removeEventListener('pointercancel', cancel)
        }
        window.addEventListener('pointermove', cancel)
        window.addEventListener('pointerup', cancel)
        window.addEventListener('pointercancel', cancel)
        press(e)
      }}
    >
      {it.fn ? <span class="pthumb">{thumb ? <img src={thumb} alt="" /> : <i>{it.icon}</i>}</span> : <span class="ticon">{it.icon}</span>}
      <span class="plabel">{it.label}</span>
    </div>
  )
}

function showHelp(el: HTMLElement, it: Item): void {
  openPopover(
    el,
    () => (
      <div class="helpcard" data-testid="help-card">
        <b>{it.label}</b>
        <p>{it.help.replace(/\s*TODO review$/, '')}</p>
        {it.fn && it.fn.inputs.length > 0 && (
          <small>
            {it.fn.inputs.map((i) => `${i.name}${typeof i.default === 'number' ? ` = ${i.default}` : ''}`).join(' · ')}
          </small>
        )}
        <button type="button" class="btn sm" onClick={() => closePopover()}>
          OK
        </button>
      </div>
    ),
    { width: 280, label: `${it.label}: help` },
  )
}

