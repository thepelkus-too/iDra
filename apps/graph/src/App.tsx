// The page: top bar, the canvas (with the code drawer beside or below it), the palette drawer, the selection bar, the floating
// output (picture-in-picture, or full screen in performance mode) and the footer with About / Source.
import { useEffect } from 'preact/hooks'
import { ui, useUi } from './doc'
import { Banners, FooterAbout } from './kit/Chrome'
import { CodeDrawer, codeBridge } from './kit/CodeDrawer'
import { ctx, useRunner, useStore } from './kit/ctx'
import { useLayout, useShortcuts, useTapGestures } from './kit/gestures'
import { closeAllOverlays, OverlayHost } from './kit/overlay'
import { deleteSelection, duplicateSelection, Pip, SelectionBar, TopBar } from './ui/Bars'
import { Canvas } from './ui/Canvas'
import { canvasApi, Palette } from './ui/Palette'

export function App({ stage }: { stage: HTMLElement }) {
  useStore()
  const st = useUi()
  const runner = useRunner()
  const layout = useLayout()
  useTapGestures()
  useShortcuts(
    (e, mod) => {
      const k = e.key.toLowerCase()
      if (mod && k === 'd') return duplicateSelection(), true
      if (mod && k === 'k') return ui.set({ palette: !ui.state.palette }), true
      if (!mod && (k === 'backspace' || k === 'delete') && (ui.state.sel.length || ui.state.cable)) return deleteSelection(), true
      if (!mod && k === 'escape') {
        if (ui.state.perform) ui.set({ perform: false })
        else ui.select([])
        closeAllOverlays()
        return true
      }
      if (mod && k === 'a') return ui.select(ctx.store.sketch ? [...document.querySelectorAll<HTMLElement>('.canvas .node[data-node]')].map((n) => n.dataset.node!) : []), true
      return false
    },
    () => codeBridge.flush(),
  )
  // a new sketch: clear the selection
  useEffect(() => ui.select([]), [ctx.store.sketch.id])
  const s = runner.status
  return (
    <div class={`app lay-${layout} ${st.code ? 'code-open' : ''} ${st.palette ? 'pal-open' : ''}`} data-layout={layout} data-testid="app">
      <TopBar />
      <div class="main">
        <div class="canvas-col">
          <Canvas />
          <div class="banners-wrap">
            <Banners />
          </div>
          <Palette onDragItem={(item, e) => canvasApi.dragItem(item, e)} />
          <SelectionBar />
          <Pip stage={stage} />
        </div>
        {st.code && (
          <section class="codepane" aria-label="Code">
            <CodeDrawer selected={st.sel} onClose={() => ui.set({ code: false })} />
          </section>
        )}
      </div>
      <footer class="foot">
        <FooterAbout />
        <span class="runinfo" data-testid="runinfo">
          {s.phase === 'ok' ? `${s.recompiled ? 'compiled' : 'numbers only'} · ${s.ms?.toFixed(0)} ms` : s.phase === 'running' ? 'running…' : s.phase === 'error' ? 'error' : ''}
          {runner.trust.pending ? ' · safe mode' : ''}
        </span>
      </footer>
      <OverlayHost />
    </div>
  )
}
