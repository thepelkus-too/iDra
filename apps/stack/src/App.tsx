// The page: top bar, chain strip, the stack (or the code) and the live preview. Landscape: stack left, preview right.
// Portrait / Split View / Slide Over: preview on top, collapsible to a floating picture-in-picture handle.
// Backdrop (any size): the preview fills the screen behind everything and the stack takes the whole area over it.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ctx, edit, history, useBackdrop, useRunner, useStore } from './ctx'
import { duplicateMod, findCallDeep, stmtOf } from './model'
import { OverlayHost, closeAllOverlays, toast, useLayout, useShortcuts, useTapGestures } from '@hydra-ipad/kit'
import { makeViewState } from './viewstate'
import { appPrefs } from './prefs'
import { metaOf } from './view'
import { AddBar, Banners, ChainStrip, FooterAbout, TopBar, openAudioSheet } from './ui/Chrome'
import { CodeView, codeBridge } from './ui/CodeView'
import { useCatalogVersion } from './ui/Picker'
import { StatementList, duplicateStatement, type ViewState } from './ui/Rows'

function duplicateSelection(): void {
  const sel = ctx.store.selection
  if (!sel) return toast('Tap a row first, then duplicate it')
  const sk = ctx.store.sketch
  const found = findCallDeep(sk, sel)
  if (found && found.chain.mods.some((m) => m.id === sel)) {
    edit((s) => duplicateMod(s, found.chain.id, sel))
    toast('Duplicated row', { label: 'Undo', run: () => ctx.store.undo() })
    return
  }
  const st = stmtOf(sk, sel)
  if (st) duplicateStatement(st.id)
}

export function App({ stage }: { stage: HTMLElement }) {
  useStore()
  const runner = useRunner()
  const catVersion = useCatalogVersion()
  const layout = useLayout()
  const backdrop = useBackdrop().placement === 'backdrop'
  useShortcuts(
    history,
    (e, mod) => {
      if (!mod || e.key.toLowerCase() !== 'd') return false
      duplicateSelection()
      return true
    },
    () => codeBridge.flush(),
  )
  useTapGestures(history)
  const sk = ctx.store.sketch
  const meta = metaOf(sk)
  const mode = meta?.mode ?? 'blocks'
  const [collapsed, setCollapsed] = useState<boolean>(() => appPrefs.get<boolean>('previewCollapsed') ?? false)
  const slot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (slot.current && stage.parentElement !== slot.current) slot.current.appendChild(stage)
  }, [stage])

  const setMode = (m: 'blocks' | 'code') => {
    if (m === mode) return
    if (mode === 'code' && !codeBridge.flush()) return void toast('Fix the syntax error before going back to blocks')
    closeAllOverlays()
    ctx.store.setView({ mode: m })
  }
  const toggleCollapsed = () => {
    const v = !collapsed
    setCollapsed(v)
    appPrefs.set('previewCollapsed', v)
  }

  const errors = runner.currentErrors()
  const view = useMemo<ViewState>(() => makeViewState(sk, errors, ctx.store.selection), [sk, errors.length, catVersion, ctx.store.selection])

  const st = runner.status
  return (
    <div class={`app ${layout} ${backdrop ? 'backdrop' : collapsed ? 'pip' : ''} mode-${mode}`} data-layout={layout} data-preview={backdrop ? 'backdrop' : collapsed ? 'pip' : 'panel'} data-testid="app">
      <TopBar mode={mode} setMode={setMode} onToggleAudio={openAudioSheet} />
      <ChainStrip />
      <div class="body">
        <section class="pane stack-pane" aria-label="Stack">
          <Banners />
          <div class="scroll" data-testid="stack-scroll">
            {mode === 'blocks' ? (
              <>
                <StatementList view={view} />
                <AddBar />
              </>
            ) : (
              <CodeView active />
            )}
          </div>
          <div class="foot">
            <FooterAbout />
            <span class="runinfo" data-testid="runinfo">
              {st.phase === 'ok' ? `${st.recompiled ? 'compiled' : 'numbers only'} · ${st.ms?.toFixed(0)} ms` : st.phase === 'running' ? 'running…' : st.phase === 'error' ? 'error' : ''}
              {runner.trust.pending ? ' · safe mode' : ''}
              {backdrop && st.fellBack ? ' · last good frame' : ''}
            </span>
          </div>
        </section>
        <section class="pane preview-pane" aria-label="Live preview" data-testid="preview-pane" data-hi-backdrop="stage">
          <div class="stage-slot" ref={slot} data-testid="stage-slot" />
          <div class="preview-tools" data-hi-backdrop="hide">
            {runner.trust.pending && <span class="pill warn">safe mode</span>}
            {st.fellBack && <span class="pill err">last good frame</span>}
            <button type="button" class="icon small" data-testid="preview-toggle" aria-label={collapsed ? 'Show preview' : 'Shrink preview'} aria-pressed={collapsed} onClick={toggleCollapsed}>
              {collapsed ? '⤢' : '⤡'}
            </button>
          </div>
          {collapsed && !backdrop && <button type="button" class="pip-hit" aria-label="Show preview" onClick={toggleCollapsed} />}
        </section>
      </div>
      <OverlayHost />
    </div>
  )
}

