// The page: top bar, the mixer, the rack of lanes and trays, the scene column, the mod bay, the code drawer, the floating
// output (or performance mode) and the footer with About / Source.
import { audition, ui, useUi, recallScene, storeScene } from './doc'
import { Banners, FooterAbout } from './kit/Chrome'
import { CodeDrawer, codeBridge } from './kit/CodeDrawer'
import { ctx, history, useCatalogVersion, useRunner, useStore } from './kit/ctx'
import { closeAllOverlays, OverlayHost, useLayout, useShortcuts, useTapGestures } from '@hydra-ipad/kit'
import { freeze, Mixer, ModBay, Pip, Scenes, SLOTS, TopBar } from './ui/Bars'
import { Rack } from './ui/Lanes'

export function App({ stage }: { stage: HTMLElement }) {
  useStore()
  useCatalogVersion()
  const st = useUi()
  const runner = useRunner()
  const layout = useLayout()
  useTapGestures(history)
  useShortcuts(
    history,
    (e, mod) => {
      const k = e.key.toLowerCase()
      if (mod && k === 'e') return ui.set({ code: !ui.state.code }), true
      if (!mod && SLOTS.includes(k)) return recallScene(k), true
      if (!mod && e.shiftKey && /^Digit[1-8]$/.test(e.code)) return storeScene(e.code.slice(5)), true
      if (!mod && k === 'p') return ui.set({ perform: !ui.state.perform }), true
      if (!mod && k === ' ') return freeze(), true
      if (!mod && k === 'escape') {
        if (ui.state.audition) audition(undefined)
        else if (ui.state.perform) ui.set({ perform: false })
        else ui.select(undefined)
        ui.set({ armed: undefined })
        closeAllOverlays()
        return true
      }
      return false
    },
    () => codeBridge.flush(),
  )
  const s = runner.status
  return (
    <div class={`app lay-${layout} ${st.code ? 'code-open' : ''} ${st.perform ? 'performing' : ''} ${st.armed ? 'arming' : ''}`} data-layout={layout} data-testid="app">
      <TopBar />
      <div class="main">
        <Mixer />
        <div class="rack-col">
          <div class="banners-wrap">
            <Banners />
            {!!st.revived && (
              <div class="banners">
                <div class="banner info" role="status" data-testid="revived-note">
                  <span>
                    {st.revived} commented-out chunk{st.revived > 1 ? 's were' : ' was'} revived as disabled. They stay in the code as <code>//</code> comments; tap a module's <code>//</code> to switch it on.
                  </span>
                  <button type="button" class="btn" data-testid="revived-dismiss" onClick={() => ui.set({ revived: undefined })}>
                    OK
                  </button>
                </div>
              </div>
            )}
          </div>
          <Rack />
        </div>
        <Scenes />
        {st.code && (
          <section class="codepane" aria-label="Code">
            <CodeDrawer selected={st.sel ? [st.sel] : []} onClose={() => ui.set({ code: false })} />
          </section>
        )}
      </div>
      <ModBay />
      <footer class="foot">
        <FooterAbout />
        <span class="runinfo" data-testid="runinfo">
          {s.phase === 'ok' ? `${s.recompiled ? 'compiled' : 'numbers only'} · ${s.ms?.toFixed(0)} ms` : s.phase === 'running' ? 'running…' : s.phase === 'error' ? 'error' : ''}
          {runner.trust.pending ? ' · safe mode' : ''}
          {runner.status.fellBack ? ' · last good frame' : ''}
          {st.fading ? ` · fading to ${st.fading}` : ''}
        </span>
      </footer>
      <Pip stage={stage} />
      <OverlayHost />
    </div>
  )
}
