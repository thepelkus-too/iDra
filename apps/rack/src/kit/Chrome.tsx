// Chrome every editor mounts: switcher, About/Source (AGPL), banners (trust gate, camera, MIDI, errors), the audio panel,
// and the sheets to open / import / export sketches.
import { describe, detectMidi, mountAbout, mountAudioPanel, mountSwitcher, riskyParts, toCode, type CapItem, type LibraryEntry } from '@hydra-ipad/core'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { APP, APP_TITLE } from '../app'
import { duplicateCurrent, exportFile, importAsNew, newBlankSketch, openSketch, copyCode } from './actions'
import { ctx, useBackdrop, useRunner, useStore } from './ctx'
import { openMenu, type MenuItem } from './Menu'
import { openSheet, toast } from '@hydra-ipad/kit'

declare const __COMMIT__: string

export function Switcher() {
  useStore()
  const sw = useRef<HTMLSpanElement>(null)
  const handle = useRef<ReturnType<typeof mountSwitcher>>()
  const id = ctx.store.sketch.id
  useEffect(() => {
    if (!sw.current) return
    handle.current = mountSwitcher(sw.current, { current: APP, sketchId: ctx.store.sketch.id })
    return () => handle.current?.destroy()
  }, [])
  useEffect(() => handle.current?.refresh(id), [id])
  return <span ref={sw} class="switch-slot" data-testid="switcher" />
}

export function FooterAbout() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    host.current.textContent = ''
    mountAbout(host.current, { build: typeof __COMMIT__ === 'string' && __COMMIT__ ? `commit ${__COMMIT__.slice(0, 7)}` : 'local build' })
  }, [])
  return <div ref={host} class="about-slot" data-testid="about" />
}

export function SketchName() {
  useStore()
  const sk = ctx.store.sketch
  return (
    <input
      class="name"
      type="text"
      value={sk.name}
      aria-label="Sketch name"
      data-testid="sketch-name"
      autocapitalize="off"
      autocorrect="off"
      spellcheck={false}
      onChange={(e) => ctx.store.commit({ ...ctx.store.sketch, name: (e.currentTarget as HTMLInputElement).value.trim() || sk.name }, { view: true })}
    />
  )
}

export function UndoRedo() {
  const store = useStore()
  return (
    <>
      <button type="button" class="icon" data-testid="undo" aria-label="Undo" title="Undo (⌘Z, or two-finger tap)" disabled={!store.canUndo} onClick={() => store.undo()}>
        ↶
      </button>
      <button type="button" class="icon" data-testid="redo" aria-label="Redo" title="Redo (⇧⌘Z, or three-finger tap)" disabled={!store.canRedo} onClick={() => store.redo()}>
        ↷
      </button>
    </>
  )
}

/** The full-background toggle for the top bar, and the veil strength while it is on (contract §6 Backdrop). */
export function BackdropButtons() {
  const bd = useBackdrop()
  if (!ctx.backdrop) return null
  const on = bd.placement === 'backdrop'
  return (
    <>
      <button
        type="button"
        class={`icon ${on ? 'on' : ''}`}
        data-testid="backdrop-toggle"
        aria-label="Full background preview"
        aria-pressed={on}
        title={on ? 'Preview: full background (tap for a floating window)' : 'Preview: floating window (tap to fill the background)'}
        onClick={() => ctx.backdrop?.toggle()}
      >
        {on ? '▣' : '◧'}
      </button>
      {on && (
        <button type="button" class="icon veil-btn" data-testid="veil" data-veil={bd.veil} aria-label={`Text backing: ${bd.veil}. Tap to change.`} title={`Text backing: ${bd.veil}`} onClick={() => ctx.backdrop?.cycleVeil()}>
          <i class={`veil-swatch ${bd.veil}`} />
        </button>
      )}
    </>
  )
}

/** The ⋯ menu: document actions first, then whatever the editor adds. */
export function openMoreMenu(el: HTMLElement, extra: MenuItem[] = []): void {
  openMenu(
    el,
    [
      { label: 'Open another sketch…', run: () => openOpenSheet(), testid: 'menu-open' },
      { label: 'New sketch', run: () => void newBlankSketch() },
      { label: 'Duplicate this sketch', run: () => void duplicateCurrent() },
      { label: 'Import .js / .json…', sep: true, run: () => openImportSheet(), testid: 'menu-import' },
      { label: 'Export .js', run: () => void exportFile('js').then((r) => r === 'downloaded' && toast('Saved to Downloads')), testid: 'menu-export' },
      { label: 'Export .json (with layout)', run: () => void exportFile('json').then((r) => r === 'downloaded' && toast('Saved to Downloads')), testid: 'menu-export-json' },
      { label: 'Copy code', run: () => void copyCode(), testid: 'menu-copy' },
      ...extra.map((x, i) => (i === 0 ? { ...x, sep: true } : x)),
      ...(ctx.backdrop
        ? [{ label: ctx.backdrop.on ? 'Preview: full background' : 'Preview: floating window', hint: ctx.backdrop.on ? 'tap for a window' : 'tap to fill', run: () => ctx.backdrop?.toggle(), testid: 'menu-backdrop' }]
        : []),
      { label: 'Audio…', sep: true, run: () => openAudioSheet(), testid: 'menu-audio' },
      { label: 'About / Source', run: () => openAbout() },
    ],
    'Sketch',
    300,
  )
}

export function openAbout(): void {
  openSheet('About', () => (
    <div class="about">
      <p>
        <b>{APP_TITLE}</b> is one of the iDra editors for <b>Hydra</b>. It reads and writes the shared sketch format; the code panel shows exactly what you export.
      </p>
      <p>
        <a href="https://github.com/ojack/hydra" target="_blank" rel="noopener">
          Hydra by Olivia Jack
        </a>{' '}
        is the engine (AGPL-3.0).
      </p>
      <FooterAbout />
    </div>
  ))
}

// ---------------------------------------------------------------- banners

let midiProbe: Promise<CapItem> | undefined

export function Banners() {
  useStore()
  const runner = useRunner()
  const sk = ctx.store.sketch
  const trust = runner.trust
  const [showParts, setShowParts] = useState(false)
  const [midi, setMidi] = useState<CapItem | undefined>()
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})
  const usesMidi = useMemo(() => /requestMIDIAccess|\bmidi\b/i.test(toCode(sk)), [sk])
  useEffect(() => {
    if (!usesMidi) return setMidi(undefined)
    midiProbe ??= detectMidi(false)
    void midiProbe.then((m) => setMidi(m.status === 'no' ? m : undefined))
  }, [usesMidi])
  const d = useMemo(() => describe(sk), [sk])
  const st = runner.status
  const errs = runner.currentErrors()
  return (
    <div class="banners" data-testid="banners">
      {trust.pending && (
        <div class="banner trust" role="alert" data-testid="trust-banner">
          <div>
            <strong>This sketch runs code. Run it?</strong>
            <span class="sub">Until you say yes the preview runs in safe mode: only recognised chains, settings and sources.</span>
            <button type="button" class="linkish" onClick={() => setShowParts(!showParts)}>
              {showParts ? 'Hide' : 'What runs?'}
            </button>
          </div>
          {showParts && (
            <ul class="parts">
              {riskyParts(sk).map((p, i) => (
                <li key={i}>
                  <b>{p.kind}</b> <code>{p.excerpt}</code>
                </li>
              ))}
            </ul>
          )}
          <div class="actions">
            <button type="button" class="btn" data-testid="trust-once" onClick={() => runner.approveOnce()}>
              Run it once
            </button>
            <button type="button" class="btn primary" data-testid="trust-always" onClick={() => void runner.approveAlways()}>
              Always for this sketch
            </button>
          </div>
        </div>
      )}
      {d.usesCamera && runner.isolation === 'iframe' && !trust.pending && !dismissed.cam && (
        <div class="banner warn" role="status" data-testid="camera-banner">
          <div>
            <strong>Camera / screen sources can't run in the sandboxed preview.</strong>
            <span class="sub">Inline mode runs the sketch without isolation, so only use it for sketches you trust.</span>
          </div>
          <div class="actions">
            <button type="button" class="btn" onClick={() => setDismissed({ ...dismissed, cam: true })}>
              Not now
            </button>
            <button type="button" class="btn" data-testid="camera-inline" onClick={() => void runner.setIsolation('inline')}>
              Switch to inline
            </button>
          </div>
        </div>
      )}
      {runner.isolation === 'inline' && (
        <div class="banner warn" data-testid="inline-banner">
          <span>Inline mode: this sketch runs without isolation.</span>
          <button type="button" class="btn" onClick={() => void runner.setIsolation('iframe')}>
            Back to sandbox
          </button>
        </div>
      )}
      {midi && !dismissed.midi && (
        <div class="banner info" role="status" data-testid="midi-banner">
          <span>
            <strong>Web MIDI isn't available</strong> in this browser; MIDI code in this sketch will not find any device.
          </span>
          <button type="button" class="btn" onClick={() => setDismissed({ ...dismissed, midi: true })}>
            Dismiss
          </button>
        </div>
      )}
      {st.phase === 'error' && (
        <div class="banner err" role="alert" data-testid="error-banner">
          <div>
            <strong>{st.fellBack ? 'Showing the last good frame.' : 'The sketch has an error.'}</strong>
            <span class="sub" data-testid="error-text">
              {(errs.length ? errs[errs.length - 1].message : st.message) ?? ''}
            </span>
          </div>
          <button type="button" class="btn" onClick={() => runner.clearErrors()}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- sheets

export function openOpenSheet(): void {
  openSheet('Open a sketch', (close) => <OpenSheet close={close} />, { wide: true })
}

function OpenSheet({ close }: { close: () => void }) {
  const [list, setList] = useState<LibraryEntry[] | undefined>()
  const load = () => void ctx.lib.list().then(setList)
  useEffect(() => {
    load()
    return ctx.lib.subscribe(load)
  }, [])
  return (
    <div class="open-sheet" data-testid="open-sheet">
      <div class="open-actions">
        <button type="button" class="btn" onClick={() => (void newBlankSketch(), close())}>
          ＋ New sketch
        </button>
        <button type="button" class="btn" onClick={() => (close(), openImportSheet())}>
          Import…
        </button>
      </div>
      {!list && <div class="empty">Loading…</div>}
      <div class="cards" role="list">
        {list?.map((e) => (
          <button
            type="button"
            role="listitem"
            class={`card ${e.id === ctx.store.sketch.id ? 'on' : ''}`}
            key={e.id}
            data-sketch={e.id}
            onClick={() => {
              close()
              if (e.id !== ctx.store.sketch.id) openSketch(e.id)
            }}
          >
            <span class="cthumb">{e.thumbnail ? <img src={e.thumbnail} alt="" /> : <i>{e.name.slice(0, 1)}</i>}</span>
            <span class="cname">{e.name}</span>
            <small>{new Date(e.modifiedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</small>
          </button>
        ))}
      </div>
    </div>
  )
}

export function openImportSheet(): void {
  openSheet('Import', (close) => <ImportSheet close={close} />, { wide: true })
}

function ImportSheet({ close }: { close: () => void }) {
  const [text, setText] = useState('')
  const [name, setName] = useState('Imported sketch')
  const file = useRef<HTMLInputElement>(null)
  return (
    <div class="import-sheet">
      <p class="sub">Paste Hydra code or a sketch .json, or choose a file. It is added to your library as a new sketch and opened here; code the editor can't show as nodes stays as editable text.</p>
      <input class="name-in" type="text" aria-label="Name" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} autocapitalize="off" autocorrect="off" spellcheck={false} />
      <textarea
        class="code-edit big"
        data-testid="import-text"
        placeholder="osc(20, 0.1, 0.8).out()"
        autocapitalize="off"
        autocorrect="off"
        autocomplete="off"
        spellcheck={false}
        rows={10}
        value={text}
        onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
      />
      <input
        ref={file}
        type="file"
        accept=".js,.mjs,.json,.txt,text/javascript,application/json,text/plain"
        style="display:none"
        data-testid="import-file"
        onChange={async (e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0]
          if (!f) return
          setText(await f.text())
          setName(f.name.replace(/\.[^.]+$/, ''))
        }}
      />
      <div class="actions">
        <button type="button" class="btn" onClick={() => file.current?.click()}>
          Choose file…
        </button>
        <button
          type="button"
          class="btn primary"
          data-testid="import-go"
          disabled={!text.trim()}
          onClick={async () => {
            close()
            await importAsNew(name, text)
          }}
        >
          Import
        </button>
      </div>
    </div>
  )
}

export function AudioMount({ onDone }: { onDone?: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    host.current.textContent = ''
    const h = mountAudioPanel(host.current, { engine: ctx.audio })
    return () => h.destroy()
  }, [])
  return (
    <div>
      <div ref={host} data-testid="audio-panel" />
      {onDone && (
        <button type="button" class="btn wide" onClick={onDone}>
          Done
        </button>
      )}
    </div>
  )
}

export function openAudioSheet(): void {
  openSheet('Audio', (close) => <AudioMount onDone={close} />)
}

/** Live level of one fft bin (or the volume when bin < 0), for meters on nodes/blocks/tiles. */
export function useAudioLevel(bin: number): number {
  const [v, set] = useState(0)
  useEffect(() => {
    let last = 0
    return ctx.audio.onFrame((f) => {
      const n = bin < 0 ? f.vol : (f.fft[bin] ?? 0)
      const now = performance.now()
      if (now - last < 60) return
      last = now
      set(n)
    })
  }, [bin])
  return v
}

export function Meter({ bin }: { bin: number }) {
  const v = useAudioLevel(bin)
  return (
    <span class="meter" data-testid="audio-meter" aria-label={`level ${v.toFixed(2)}`}>
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` }} />
    </span>
  )
}
