// Function picker (grouped by type, searchable, 64×64 live thumbnails) and the o0…o3 / s0…s3 reference picker.
import { OUT_NAMES, SOURCE_NAMES, type FnDef, type RefName } from '@hydra-ipad/core'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { signature } from '../conv'
import { ctx } from '../ctx'
import { thumbs } from '../thumbs'

export function useCatalogVersion(): number {
  const [v, set] = useState(ctx.catalog.version)
  useEffect(() => ctx.catalog.subscribe(() => set(ctx.catalog.version)), [])
  return v
}

export interface FnGroup {
  title: string
  plugin?: boolean
  fns: FnDef[]
}

/** The groups the picker shows for a generator or a modifier slot. Plugin functions get their own "Plugins" group. */
export function groupsFor(position: 'gen' | 'mod', cat = ctx.catalog): FnGroup[] {
  const all = cat.list(position)
  const builtin = all.filter((f) => !f.origin.startsWith('plugin:'))
  const plugin = all.filter((f) => f.origin.startsWith('plugin:'))
  const by = (t: FnDef['type']) => builtin.filter((f) => f.type === t).sort((a, b) => a.name.localeCompare(b.name))
  const out: FnGroup[] =
    position === 'gen'
      ? [{ title: 'Generators', fns: by('src') }]
      : [
          { title: 'Geometry', fns: by('coord') },
          { title: 'Color', fns: by('color') },
          { title: 'Blend', fns: by('combine') },
          { title: 'Modulate', fns: by('combineCoord') },
        ]
  if (plugin.length) out.push({ title: 'Plugins', plugin: true, fns: plugin.sort((a, b) => a.name.localeCompare(b.name)) })
  return out.filter((g) => g.fns.length)
}

function Thumb({ name }: { name: string }) {
  const [url, setUrl] = useState<string | undefined>(thumbs.peek(name))
  const [gone, setGone] = useState(thumbs.has(name) && !thumbs.peek(name))
  const el = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (url || gone) return
    let cancelled = false
    const start = () => {
      void thumbs.get(name).then((u) => {
        if (cancelled) return
        if (u) setUrl(u)
        else setGone(true)
      })
    }
    if (typeof IntersectionObserver === 'undefined' || !el.current) {
      start()
      return () => void (cancelled = true)
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect()
          start()
        }
      },
      { rootMargin: '120px' },
    )
    io.observe(el.current)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [name])
  return (
    <span class="thumb" ref={el} data-testid="thumb" data-ready={url ? '1' : '0'}>
      {url ? <img src={url} alt="" width={64} height={64} draggable={false} /> : <span class="glyph">{gone ? 'ƒ' : '…'}</span>}
    </span>
  )
}

export interface FnPickerProps {
  position: 'gen' | 'mod'
  current?: string
  /** unknown functions can be renamed to free text (a plugin that has not loaded yet) */
  allowCustom?: boolean
  onPick: (name: string) => void
  onClose: () => void
}

export function FnPicker({ position, current, allowCustom, onPick, onClose }: FnPickerProps) {
  useCatalogVersion()
  const [q, setQ] = useState('')
  const groups = useMemo(() => groupsFor(position), [position, ctx.catalog.version])
  const term = q.trim().toLowerCase()
  const shown = groups.map((g) => ({ ...g, fns: term ? g.fns.filter((f) => f.name.toLowerCase().includes(term)) : g.fns })).filter((g) => g.fns.length)
  const custom = allowCustom && /^[A-Za-z_$][\w$]*$/.test(q.trim()) && !ctx.catalog.has(q.trim()) ? q.trim() : undefined
  return (
    <div class="picker" data-testid="fn-picker">
      <div class="picker-search">
        <input
          type="search"
          data-testid="fn-search"
          placeholder={position === 'gen' ? 'Search generators' : 'Search functions'}
          autocapitalize="off"
          autocorrect="off"
          autocomplete="off"
          spellcheck={false}
          value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
          aria-label="Search functions"
        />
      </div>
      <div class="picker-scroll">
        {custom && (
          <button type="button" class="fcard custom" onClick={() => (onPick(custom), onClose())}>
            Use “{custom}” as the name
          </button>
        )}
        {shown.map((g) => (
          <section key={g.title} data-group={g.title}>
            <h4>{g.title}</h4>
            <div class="fgrid">
              {g.fns.map((f) => (
                <button
                  type="button"
                  class={`fcard ${f.name === current ? 'on' : ''}`}
                  key={f.name}
                  data-pick={f.name}
                  title={signature(f)}
                  onClick={() => {
                    onPick(f.name)
                    onClose()
                  }}
                >
                  <Thumb name={f.name} />
                  <span class="fname">{f.name}</span>
                  {g.plugin && <small>{f.origin.replace('plugin:', '')}</small>}
                </button>
              ))}
            </div>
          </section>
        ))}
        {!shown.length && !custom && <div class="empty">Nothing called “{q}”.</div>}
      </div>
    </div>
  )
}

export interface RefPickerProps {
  current?: RefName | null
  /** which families to offer */
  outs?: boolean
  sources?: boolean
  /** adds a "none" choice (an unrendered chain) */
  none?: boolean
  onPick: (name: RefName | null) => void
  onClose: () => void
}

export function RefPicker({ current, outs = true, sources = true, none, onPick, onClose }: RefPickerProps) {
  const btn = (n: RefName) => (
    <button type="button" class={`chip ref ${current === n ? 'on' : ''}`} key={n} data-ref={n} onClick={() => (onPick(n), onClose())}>
      {n}
    </button>
  )
  return (
    <div class="ref-picker" data-testid="ref-picker">
      {outs && (
        <div class="refrow">
          <span class="lbl">outputs</span>
          {OUT_NAMES.map(btn)}
        </div>
      )}
      {sources && (
        <div class="refrow">
          <span class="lbl">sources</span>
          {SOURCE_NAMES.map(btn)}
        </div>
      )}
      {none && (
        <button type="button" class={`chip ${current === null ? 'on' : ''}`} data-ref="none" onClick={() => (onPick(null), onClose())}>
          no output (not rendered)
        </button>
      )}
    </div>
  )
}
