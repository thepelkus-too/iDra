// The page: top bar, chain strip, the stack (or the code) and the live preview. Landscape: stack left, preview right.
// Portrait / Split View / Slide Over: preview on top, collapsible to a floating picture-in-picture handle.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ctx, edit, useRunner, useStore } from './ctx'
import { duplicateMod, findCallDeep, stmtOf } from './model'
import { OverlayHost, closeAllOverlays, toast } from './overlay'
import { makeViewState } from './viewstate'
import { appPrefs } from './prefs'
import { metaOf } from './view'
import { AddBar, Banners, ChainStrip, FooterAbout, TopBar, openAudioSheet } from './ui/Chrome'
import { CodeView, codeBridge } from './ui/CodeView'
import { useCatalogVersion } from './ui/Picker'
import { StatementList, duplicateStatement, type ViewState } from './ui/Rows'

type Layout = 'land' | 'port'

function useLayout(): Layout {
  const calc = (): Layout => (window.innerWidth >= 700 && window.innerWidth > window.innerHeight * 1.05 ? 'land' : 'port')
  const [l, setL] = useState<Layout>(calc)
  useEffect(() => {
    const on = () => setL(calc())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    window.visualViewport?.addEventListener('resize', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
      window.visualViewport?.removeEventListener('resize', on)
    }
  }, [])
  return l
}

const isTextTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  if (!el || !el.closest) return false
  return !!el.closest('input:not([type=range]),textarea,[contenteditable="true"],.cm-editor')
}

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

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'enter') {
        e.preventDefault()
        codeBridge.flush()
        ctx.runner.run(true)
        return
      }
      if (isTextTarget(e.target)) return
      if (k === 'z') {
        e.preventDefault()
        if (e.shiftKey) ctx.store.redo()
        else ctx.store.undo()
      } else if (k === 'y') {
        e.preventDefault()
        ctx.store.redo()
      } else if (k === 'd') {
        e.preventDefault()
        duplicateSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Two-finger tap = undo, three-finger tap = redo (the iPadOS convention). A tap, not a drag, not a long hold. */
function useTapGestures(): void {
  useEffect(() => {
    let t0 = 0
    let max = 0
    let moved = false
    let start: Array<{ x: number; y: number }> = []
    const onStart = (e: TouchEvent) => {
      // all current touches are new: a gesture begins (two fingers often land in the same event)
      if (e.touches.length === e.changedTouches.length) {
        t0 = Date.now()
        max = 0
        moved = false
        start = []
      }
      max = Math.max(max, e.touches.length)
      if (e.touches.length >= 2) start = Array.from(e.touches).map((t) => ({ x: t.clientX, y: t.clientY }))
    }
    const onMove = (e: TouchEvent) => {
      if (!start.length) return
      const now = Array.from(e.touches)
      for (let i = 0; i < Math.min(now.length, start.length); i++) if (Math.hypot(now[i].clientX - start[i].x, now[i].clientY - start[i].y) > 14) moved = true
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return
      const quick = Date.now() - t0 < 380
      const n = max
      max = 0
      if (n < 2 || moved || !quick || isTextTarget(e.target)) return
      if (n === 2) {
        if (ctx.store.undo()) toast('Undo')
      } else if (n === 3) {
        if (ctx.store.redo()) toast('Redo')
      }
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
    }
  }, [])
}

export function App({ stage }: { stage: HTMLElement }) {
  useStore()
  const runner = useRunner()
  const catVersion = useCatalogVersion()
  const layout = useLayout()
  useShortcuts()
  useTapGestures()
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
    <div class={`app ${layout} ${collapsed ? 'pip' : ''} mode-${mode}`} data-layout={layout} data-testid="app">
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
            </span>
          </div>
        </section>
        <section class="pane preview-pane" aria-label="Live preview" data-testid="preview-pane">
          <div class="stage-slot" ref={slot} data-testid="stage-slot" />
          <div class="preview-tools">
            {runner.trust.pending && <span class="pill warn">safe mode</span>}
            {st.fellBack && <span class="pill err">last good frame</span>}
            <button type="button" class="icon small" data-testid="preview-toggle" aria-label={collapsed ? 'Show preview' : 'Shrink preview'} aria-pressed={collapsed} onClick={toggleCollapsed}>
              {collapsed ? '⤢' : '⤡'}
            </button>
          </div>
          {collapsed && <button type="button" class="pip-hit" aria-label="Show preview" onClick={toggleCollapsed} />}
        </section>
      </div>
      <OverlayHost />
    </div>
  )
}

