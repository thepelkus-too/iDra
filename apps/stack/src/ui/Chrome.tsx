// Top bar, chain strip, banners and the sheets (open another sketch, import, setup, menu).
import { describe, detectMidi, mountAbout, mountSwitcher, riskyParts, type CapItem, type LibraryEntry, type Stmt } from '@hydra-ipad/core'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  codeOf,
  copyCode,
  currentSeed,
  duplicateCurrent,
  exportJs,
  fileNameFor,
  importAsNew,
  mutateActive,
  newBlankSketch,
  openSketch,
  rollDice,
} from '../actions'
import { ctx, edit, useRunner, useStore } from '../ctx'
import { usePress } from '../gestures'
import { setOut, updateStmt } from '../model'
import { closePopover, closeSheet, openPopover, openSheet, toast } from '../overlay'
import { appPrefs } from '../prefs'
import { autoView, stripOf, type StackMeta, APP, metaOf } from '../view'
import { focusNode } from '../nav'
import { AudioMount } from './FnEditor'
import { Keypad } from './Keypad'
import { openMenu } from './Menu'
import { addStatement } from './Rows'

declare const __COMMIT__: string

// ---------------------------------------------------------------- top bar

export function TopBar({ mode, setMode, onToggleAudio }: { mode: 'blocks' | 'code'; setMode: (m: 'blocks' | 'code') => void; onToggleAudio: () => void }) {
  useStore()
  const store = ctx.store
  const sk = store.sketch
  const sw = useRef<HTMLSpanElement>(null)
  const handle = useRef<ReturnType<typeof mountSwitcher>>()
  useEffect(() => {
    if (!sw.current) return
    handle.current = mountSwitcher(sw.current, { current: 'stack', sketchId: ctx.store.sketch.id })
    return () => handle.current?.destroy()
  }, [])
  useEffect(() => handle.current?.refresh(sk.id), [sk.id])

  const [seed, setSeed] = useState(() => currentSeed())
  const dicePress = usePress({
    onTap: () => setSeed(rollDice(currentSeed()) + 1),
    onLong: (_e, el) => {
      openMenu(
        el,
        [
          { label: 'Mutate this chain (gentle)', run: () => mutateActive(0.5), testid: 'dice-mutate-gentle' },
          { label: 'Mutate this chain', run: () => mutateActive(1), testid: 'dice-mutate' },
          { label: 'Mutate this chain (bold)', run: () => mutateActive(2) },
          { label: `Roll again from seed ${seed - 1}`, sep: true, run: () => rollDice(seed - 1) },
          {
            label: 'Choose a seed…',
            run: () =>
              openPopover(el, (close) => <Keypad title="seed" value={seed} hint={{ min: 0, max: 99999, step: 1, integer: true }} onChange={(n) => setSeed(Math.max(0, Math.round(n)))} onClose={() => (appPrefs.set('seed', seed), close())} />, { width: 268 }),
          },
          { label: 'Add a random chain', run: () => addStatement('chain') },
        ],
        'Dice',
      )
    },
  })
  return (
    <header class="topbar" data-testid="topbar">
      <span ref={sw} class="switch-slot" />
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
      <div class="seg" role="tablist" aria-label="View">
        <button type="button" role="tab" aria-selected={mode === 'blocks'} class={mode === 'blocks' ? 'on' : ''} data-testid="mode-blocks" onClick={() => setMode('blocks')}>
          Blocks
        </button>
        <button type="button" role="tab" aria-selected={mode === 'code'} class={mode === 'code' ? 'on' : ''} data-testid="mode-code" onClick={() => setMode('code')}>
          Code
        </button>
      </div>
      <button type="button" class="icon" data-testid="undo" aria-label="Undo" title="Undo (⌘Z, or two-finger tap)" disabled={!store.canUndo} onClick={() => store.undo()}>
        ↶
      </button>
      <button type="button" class="icon" data-testid="redo" aria-label="Redo" title="Redo (⇧⌘Z, or three-finger tap)" disabled={!store.canRedo} onClick={() => store.redo()}>
        ↷
      </button>
      <button type="button" class="icon" data-testid="run" aria-label="Run again" title="Run again (⌘Enter)" onClick={() => ctx.runner.run(true)}>
        ▶
      </button>
      <button type="button" class="dice" data-testid="dice" aria-label={`Dice, next seed ${seed}. Hold for options.`} {...dicePress}>
        🎲 <span class="seedno">{seed}</span>
      </button>
      <button type="button" class="icon" data-testid="audio-btn" aria-label="Audio" title="Audio panel" onClick={onToggleAudio}>
        🎚
      </button>
      <button type="button" class="icon" data-testid="more" aria-label="More" onClick={(e) => openMoreMenu(e.currentTarget as HTMLElement)}>
        ⋯
      </button>
    </header>
  )
}

function openMoreMenu(el: HTMLElement) {
  openMenu(
    el,
    [
      { label: 'Open another sketch…', run: () => openOpenSheet(), testid: 'menu-open' },
      { label: 'New sketch', run: () => void newBlankSketch() },
      { label: 'Duplicate this sketch', run: () => void duplicateCurrent() },
      { label: 'Import code…', sep: true, run: () => openImportSheet(), testid: 'menu-import' },
      { label: 'Export .js', run: () => void exportJs().then((r) => r === 'downloaded' && toast('Saved to Downloads')), testid: 'menu-export' },
      { label: 'Copy code', run: () => void copyCode(), testid: 'menu-copy' },
      { label: 'Arrange: rebuild the default view', sep: true, run: () => arrange(), testid: 'menu-arrange' },
      { label: appPrefs.get<boolean>('penPressure') ? 'Pencil pressure: on' : 'Pencil pressure: off', run: () => appPrefs.set('penPressure', !appPrefs.get<boolean>('penPressure')), hint: 'finer when pressing' },
      { label: 'About / Source', run: () => openAbout() },
    ],
    'Sketch',
    300,
  )
}

export function arrange(): void {
  const meta = autoView(ctx.store.sketch)
  const cur = metaOf(ctx.store.sketch)
  ctx.store.setView({ ...meta, mode: cur?.mode ?? 'blocks' })
  toast('View rebuilt from the sketch')
}

function openAbout() {
  openSheet('About', () => (
    <div class="about">
      <p>
        Chain Stack is a text-shaped, touch-first editor for <b>Hydra</b>. It reads and writes the shared sketch format; the code you see in Code mode is what you export.
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

export function FooterAbout() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    host.current.textContent = ''
    mountAbout(host.current, { build: typeof __COMMIT__ === 'string' && __COMMIT__ ? `commit ${__COMMIT__.slice(0, 7)}` : 'local build' })
  }, [])
  return <div ref={host} class="about-slot" data-testid="about" />
}

// ---------------------------------------------------------------- chain strip

export function ChainStrip() {
  useStore()
  const sk = ctx.store.sketch
  const items = useMemo(() => stripOf(sk), [sk])
  const d = useMemo(() => describe(sk), [sk])
  const meta = metaOf(sk)
  const active = meta?.active
  const all = d.activeRender === 'all'
  const setRender = (mode: 'single' | 'all') => {
    const renders = sk.stmts.filter((s) => s.k === 'render')
    const activeItem = items.find((i) => i.stmtId === active) ?? items.find((i) => i.out)
    const target = mode === 'all' ? 'all' : (activeItem?.out ?? 'o0')
    if (renders.length) {
      const last = renders[renders.length - 1]
      edit((s) => updateStmt(s, last.id, (x) => (x.k === 'render' ? { ...x, target } : x)))
    } else if (mode === 'all' || target !== 'o0') {
      edit((s) => ({ ...s, stmts: [...s.stmts, { id: `s${Math.random().toString(36).slice(2, 8)}`, k: 'render', target } as Stmt] }))
    }
    ctx.store.setView({ renderMode: mode })
  }
  return (
    <nav class="strip" data-testid="strip" aria-label="Chains">
      <button type="button" class="chipbtn setup" data-testid="setup-chip" onClick={() => openSetup()}>
        Setup
      </button>
      <div class="chips-scroll">
        {items.map((it, i) => (
          <span class="chipwrap" key={it.stmtId}>
            <button
              type="button"
              class={`chipbtn chain ${it.stmtId === active ? 'on' : ''} ${it.flag ?? ''}`}
              data-testid={`strip-chip-${i}`}
              data-chain-chip={it.stmtId}
              data-flag={it.flag ?? ''}
              onClick={() => {
                ctx.store.setView({ active: it.stmtId })
                ctx.store.select(it.stmtId)
                focusNode(it.stmtId)
              }}
            >
              <b>{it.label}</b>
              <small>{it.gen}</small>
              {it.flag === 'shadowed' && <i class="tag">shadowed</i>}
              {it.flag === 'not-rendered' && <i class="tag">not rendered</i>}
            </button>
            {it.flag === 'not-rendered' && (
              <button
                type="button"
                class="chipbtn act"
                data-testid={`strip-send-${i}`}
                onClick={() => {
                  const target = !d.outputs.o0.writers.length ? 'o0' : (['o1', 'o2', 'o3'] as const).find((o) => !d.outputs[o].writers.length) ?? 'o0'
                  edit((s) => setOut(s, it.chainId, target))
                }}
              >
                send to {!d.outputs.o0.writers.length ? 'o0' : (['o1', 'o2', 'o3'] as const).find((o) => !d.outputs[o].writers.length) ?? 'o0'}
              </button>
            )}
          </span>
        ))}
        <button type="button" class="chipbtn plus" data-testid="strip-add" aria-label="Add a chain" onClick={() => addStatement('chain')}>
          ＋
        </button>
      </div>
      <div class="seg small" role="group" aria-label="render target">
        <button type="button" class={!all ? 'on' : ''} data-testid="render-single" aria-pressed={!all} onClick={() => setRender('single')}>
          One
        </button>
        <button type="button" class={all ? 'on' : ''} data-testid="render-all" aria-pressed={all} onClick={() => setRender('all')}>
          All 4
        </button>
      </div>
    </nav>
  )
}

// ---------------------------------------------------------------- add bar

export function AddBar() {
  const press = (e: MouseEvent) =>
    openMenu(
      e.currentTarget as HTMLElement,
      [
        { label: 'Chain', run: () => addStatement('chain'), testid: 'add-chain' },
        { label: 'Variable: number', run: () => addStatement('var-number') },
        { label: 'Variable: function', run: () => addStatement('var-function') },
        { label: 'Variable: array', run: () => addStatement('var-array') },
        { label: 'Variable: texture chain', run: () => addStatement('var-chain') },
        { label: 'Source: camera', sep: true, run: () => addStatement('source-cam') },
        { label: 'Source: image', run: () => addStatement('source-image') },
        { label: 'Source: video', run: () => addStatement('source-video') },
        { label: 'bpm', run: () => addStatement('bpm') },
        { label: 'speed', run: () => addStatement('speed') },
        { label: 'render()', run: () => addStatement('render') },
        { label: 'Comment', sep: true, run: () => addStatement('comment') },
        { label: 'Code (raw text)', run: () => addStatement('raw') },
      ],
      'Add to the sketch',
    )
  return (
    <div class="addbar">
      <button type="button" class="btn wide" data-testid="add-stmt" onClick={press}>
        ＋ Add
      </button>
    </div>
  )
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
  const usesMidi = useMemo(() => /requestMIDIAccess|\bmidi\b/i.test(sk.stmts.map((s) => (s.k === 'raw' ? s.code : '')).join('\n')), [sk])
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
      {!trust.pending && st.skipped > 0 && (
        <div class="banner info" data-testid="skipped-banner">
          {st.skipped} statement(s) were skipped in safe mode.
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
    <div class="open-sheet">
      <div class="open-actions">
        <button type="button" class="btn" onClick={() => (void newBlankSketch(), close())}>
          ＋ New sketch
        </button>
        <button type="button" class="btn" onClick={() => (close(), openImportSheet())}>
          Import code…
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
  openSheet('Import code', (close) => <ImportSheet close={close} />, { wide: true })
}

function ImportSheet({ close }: { close: () => void }) {
  const [text, setText] = useState('')
  const [name, setName] = useState('Imported sketch')
  const file = useRef<HTMLInputElement>(null)
  return (
    <div class="import-sheet">
      <p class="sub">Paste Hydra code, or choose a .js file. It is added to your library as a new sketch and opened here; nothing is lost, code the editor can't show as blocks stays as editable text.</p>
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
        accept=".js,.mjs,.txt,text/javascript,text/plain"
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

export function openSetup(): void {
  openSheet('Setup', () => <SetupSheet />, { wide: true })
}

function SetupSheet() {
  useStore()
  const sk = ctx.store.sketch
  const stmts = sk.stmts.filter((s) => s.k === 'source' || s.k === 'setting' || s.k === 'render')
  return (
    <div class="setup" data-testid="setup-sheet">
      <p class="sub">Sources, tempo and the render target. They are also rows in the stack, in source order.</p>
      <div class="setup-list">
        {stmts.length === 0 && <div class="empty">Nothing set up yet.</div>}
        {stmts.map((s) => (
          <button
            type="button"
            class="setup-item"
            key={s.id}
            onClick={() => {
              closeSheet()
              focusNode(s.id)
            }}
          >
            <code>{summaryOf(s)}</code>
            <small>show in stack</small>
          </button>
        ))}
      </div>
      <div class="actions wrap">
        <button type="button" class="btn" onClick={() => addStatement('source-cam')}>
          ＋ s0.initCam()
        </button>
        <button type="button" class="btn" onClick={() => addStatement('source-image')}>
          ＋ initImage(url)
        </button>
        <button type="button" class="btn" onClick={() => addStatement('source-video')}>
          ＋ initVideo(url)
        </button>
        <button type="button" class="btn" onClick={() => addStatement('bpm')}>
          ＋ bpm
        </button>
        <button type="button" class="btn" onClick={() => addStatement('speed')}>
          ＋ speed
        </button>
      </div>
    </div>
  )
}

function summaryOf(s: Stmt): string {
  if (s.k === 'source') return `${s.slot}.${s.init.kind === 'cam' ? 'initCam' : s.init.kind === 'image' ? 'initImage' : s.init.kind === 'video' ? 'initVideo' : s.init.kind === 'screen' ? 'initScreen' : 'clear'}(${s.init.argsSrc ?? s.init.arg ?? ''})`
  if (s.k === 'setting') return `${s.name} = ${s.v}`
  if (s.k === 'render') return `render(${s.target === 'all' ? '' : s.target})`
  return ''
}

export function openAudioSheet(): void {
  openSheet('Audio', (close) => <AudioMount onDone={close} />)
}

void closePopover
void codeOf
void fileNameFor
void ({} as StackMeta)
void APP
