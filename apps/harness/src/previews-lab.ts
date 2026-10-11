import { createPreviewPool, h, onPreviewMode, previewMode, setPreviewMode, walkChains, type PreviewHandle, type PreviewMode, type PreviewPool, type PreviewSpec, type Runtime, type Sketch } from '@hydra-ipad/core'

// Previews lab: every chain of the open sketch as "everything up to here" thumbnails, one per call, plus a before/after
// pair for the call picked in the list. Shows the pool at work (runtimes alive, frames, copied pictures) so its cost can
// be watched on the iPad. Nothing here is editor UI; the editors get PreviewPeek from the kit (docs/kit.md).

export interface PreviewsLabDeps {
  runtime: () => Runtime
  sketch: () => Sketch
  /** the sketch may run without asking (the same gate as the main runtime) */
  trusted: () => Promise<boolean>
  frameUrl?: string
}

export interface PreviewsLab {
  /** the open sketch changed (edited, replaced) */
  refresh(): void
  /** the lab tab is shown or hidden */
  setShown(on: boolean): void
  pool: PreviewPool
  handles: () => Array<{ spec: PreviewSpec; handle: PreviewHandle; canvas: HTMLCanvasElement }>
}

export function mountPreviewsLab(el: HTMLElement, deps: PreviewsLabDeps): PreviewsLab {
  const pool = createPreviewPool({ main: deps.runtime, size: 2, runtime: deps.frameUrl ? { frameUrl: deps.frameUrl } : undefined })
  const modeSel = h('select', { id: 'pv-mode', 'aria-label': 'Previews' }, ...(['off', 'demand', 'live'] as const).map((m) => h('option', { value: m, selected: m === previewMode() }, m === 'demand' ? 'on demand' : m))) as HTMLSelectElement
  modeSel.addEventListener('change', () => setPreviewMode(modeSel.value as PreviewMode))
  onPreviewMode((m) => (modeSel.value = m))
  const stats = h('div', { class: 'status', id: 'pv-stats', 'aria-live': 'polite' })
  const list = h('div', { id: 'pv-list' })
  const diffHost = h('div', { id: 'pv-diff' })
  el.append(
    h('p', { class: 'status' }, 'Each thumbnail runs the chain up to that call in a small hidden runtime (at most two at once). On demand: a still picture; tap one to animate it. Live: every visible thumbnail animates (costs GPU and battery). Approximate (≈): the chunk reads another output, prev() or a camera, shown from a copy of the main picture refreshed about once a second.'),
    h('div', { class: 'row' }, h('label', { class: 'lab-field' }, 'Previews', modeSel)),
    stats,
    diffHost,
    list,
  )

  let items: Array<{ spec: PreviewSpec; handle: PreviewHandle; canvas: HTMLCanvasElement; off: Array<() => void> }> = []
  let diff: { handle: PreviewHandle; a: HTMLCanvasElement; b: HTMLCanvasElement; off: Array<() => void> } | undefined
  let shown = false
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    for (const e of entries) items.find((i) => i.canvas === e.target)?.handle.setVisible(shown && e.isIntersecting)
  }) : undefined

  const draw = (c: HTMLCanvasElement, bmp: ImageBitmap) => {
    if (c.width !== bmp.width || c.height !== bmp.height) {
      c.width = bmp.width
      c.height = bmp.height
    }
    c.getContext('2d')?.drawImage(bmp, 0, 0)
  }
  const badge = (hd: PreviewHandle) => `${hd.state}${hd.approximate ? ' ≈' : ''}${hd.reason ? `: ${hd.reason}` : ''}`

  function clear() {
    for (const it of items) {
      it.off.forEach((f) => f())
      it.handle.close()
      io?.unobserve(it.canvas)
    }
    items = []
    list.textContent = ''
    diff?.off.forEach((f) => f())
    diff?.handle.close()
    diff = undefined
    diffHost.textContent = ''
  }

  async function build() {
    clear()
    const sketch = deps.sketch()
    const trusted = await deps.trusted()
    for (const { chain, nested, stmt } of walkChains(sketch)) {
      if (nested) continue
      const row = h('div', { class: 'pv-row' })
      const label = stmt?.k === 'def' ? `${stmt.name} =` : `${chain.out ?? '—'}${stmt?.disabled ? ' (off)' : ''}`
      list.append(h('div', { class: 'pv-chain' }, h('div', { class: 'pv-label' }, label), row))
      for (const call of [chain.gen, ...chain.mods]) {
        const spec: PreviewSpec = { kind: 'prefix', chainId: chain.id, upToCallId: call.id }
        const canvas = h('canvas', { class: 'pv-thumb', width: 256, height: 144, 'data-call': call.id }) as HTMLCanvasElement
        const cap = h('div', { class: 'pv-cap' }, `${call.disabled ? '// ' : ''}${call.fn}`)
        const st = h('div', { class: 'pv-state' })
        const cell = h('button', { type: 'button', class: 'pv-cell', title: 'Tap: animate this one, and compare before/after' }, canvas, cap, st)
        row.append(cell)
        const handle = pool.open(spec, { sketch, trusted })
        const off = [handle.onFrame((f) => draw(canvas, f.a)), handle.onState((hd) => (st.textContent = badge(hd)))]
        st.textContent = badge(handle)
        handle.setVisible(shown)
        cell.addEventListener('click', () => {
          for (const it of items) it.handle.setActive(it.handle === handle && !it.handle.state.startsWith('run'))
          openDiff(call.id)
        })
        items.push({ spec, handle, canvas, off })
        io?.observe(canvas)
      }
    }
    if (!items.length) list.append(h('p', { class: 'status' }, 'This sketch has no chains.'))
  }

  function openDiff(callId: string) {
    diff?.off.forEach((f) => f())
    diff?.handle.close()
    diffHost.textContent = ''
    const a = h('canvas', { class: 'pv-thumb big', id: 'pv-a', width: 256, height: 144 }) as HTMLCanvasElement
    const b = h('canvas', { class: 'pv-thumb big', id: 'pv-b', width: 256, height: 144 }) as HTMLCanvasElement
    const st = h('div', { class: 'pv-state', id: 'pv-diff-state' })
    diffHost.append(h('div', { class: 'pv-row' }, h('figure', {}, a, h('figcaption', {}, 'before')), h('figure', {}, b, h('figcaption', {}, 'after'))), st)
    void deps.trusted().then((trusted) => {
      const handle = pool.open({ kind: 'diff', callId }, { sketch: deps.sketch(), trusted })
      handle.setActive(true)
      handle.setVisible(shown)
      const off = [
        handle.onFrame((f) => {
          draw(a, f.a)
          if (f.b) draw(b, f.b)
        }),
        handle.onState((hd) => (st.textContent = badge(hd))),
      ]
      diff = { handle, a, b, off }
    })
  }

  setInterval(() => {
    const s = pool.stats
    stats.textContent = `runtimes ${s.runtimes} (max ${s.maxRuntimes}) · frames ${s.frames} · runs ${s.runs} · copied pictures ${s.feeds}${s.feeds ? ` (${s.feedMs.toFixed(0)} ms each)` : ''}${s.feedFailures ? ` · ${s.feedFailures} failed` : ''} · mode ${pool.mode}`
  }, 500)

  return {
    refresh() {
      if (shown) void build()
    },
    setShown(on) {
      shown = on
      if (on) void build()
      else clear()
    },
    pool,
    handles: () => items,
  }
}
