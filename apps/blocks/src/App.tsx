// The page: top bar, the workspace (with the code view beside or below it), the palette, the selection bar, the floating
// output (picture-in-picture, or full screen) and the footer with About / Source.
import { useEffect } from 'preact/hooks'
import { trackHistory, ui, useUi } from './doc'
import { Banners, FooterAbout } from './kit/Chrome'
import { CodeDrawer, codeBridge } from './kit/CodeDrawer'
import { ctx, useRunner, useStore } from './kit/ctx'
import { useLayout, useShortcuts, useTapGestures } from './kit/gestures'
import { closeAllOverlays, OverlayHost } from './kit/overlay'
import { deleteSel, duplicateSel } from './ops'
import { Pip, SelectionBar, TopBar } from './ui/Bars'
import { Palette } from './ui/Palette'
import { Workspace } from './ui/Workspace'

export function App({ stage }: { stage: HTMLElement }) {
  useStore()
  const st = useUi()
  const runner = useRunner()
  const layout = useLayout()
  useTapGestures()
  useEffect(() => trackHistory(), [])
  useShortcuts(
    (e, mod) => {
      const k = e.key.toLowerCase()
      if (mod && k === 'd') return duplicateSel(), true
      if (mod && k === 'k') return ui.set({ palette: !ui.state.palette }), true
      if (!mod && (k === 'backspace' || k === 'delete') && ui.state.sel) return deleteSel(), true
      if (!mod && k === 'escape') {
        if (ui.state.perform) ui.set({ perform: false })
        else ui.select(undefined)
        closeAllOverlays()
        return true
      }
      return false
    },
    () => codeBridge.flush(),
  )
  // a new sketch: clear the selection
  useEffect(() => ui.select(undefined), [ctx.store.sketch.id])
  const s = runner.status
  return (
    <div class={`app lay-${layout} ${st.code ? 'code-open' : ''} ${st.palette ? 'pal-open' : ''}`} data-layout={layout} data-testid="app">
      <TopBar />
      <div class="main">
        <div class="ws-col">
          <Workspace />
          <div class="banners-wrap">
            <Banners />
          </div>
          <Palette />
          <SelectionBar />
          <Pip stage={stage} />
        </div>
        {st.code && (
          <section class="codepane" aria-label="Code">
            <CodeDrawer selected={st.sel ? [st.sel] : []} onClose={() => ui.set({ code: false })} />
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
