// The stack: every statement of the sketch as a row (or a block of rows), in source order. Nothing is hidden.
import {
  commentStmt,
  describe,
  heuristicHint,
  importText,
  makeCall,
  makeChain,
  newId,
  num,
  rawStmt,
  type Call,
  type Chain,
  type DefStmt,
  type Hint,
  type Sketch,
  type SourceName,
  type Stmt,
  type Value,
} from '@hydra-ipad/core'
import { createContext } from 'preact'
import { useContext, useMemo, useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import type { Kind } from '../conv'
import { ctx, edit, useStore } from '../ctx'
import { useHandle, useSwipe } from '../gestures'
import {
  duplicateMod,
  duplicateStmt,
  insertStmt,
  moveMod,
  moveStmt,
  newChainStmt,
  removeMod,
  removeStmt,
  renameDef,
  replaceFn,
  setOut,
  setupInsertIndex,
  stmtOf,
  updateStmt,
  uniqueName,
  updateCall,
} from '../model'
import { DisableToggle, PreviewPeek, closePopover, disableAction, openNumberEditor, openPopover, simpleField, toast, usePress } from '@hydra-ipad/kit'
import { onPreviewMode, previewMode, type PreviewSpec } from '@hydra-ipad/core'
import { useEffect } from 'preact/hooks'
import { focusNode } from '../nav'
import { setPeek, stackPreviewPool, togglePeek, usePeek } from '../peek'
import { setTray } from '../tray'
import { openTrayAt } from './Tray'
import type { RowProblem } from '../problems'
import { ArgView, argInfoFor, type ArgInfo } from './ArgView'
import { openMenu, type MenuItem } from './Menu'
import { FnPicker, RefPicker, useCatalogVersion } from './Picker'
import { Scrub } from './Scrub'

// ---------------------------------------------------------------- shared view state

export interface ViewState {
  problems: Map<string, RowProblem[]>
  selection?: string
  /** the statement that contains the selection */
  selectedStmt?: string
  defUses: Map<string, number>
  sketch: Sketch
}
export const ViewCtx = createContext<ViewState>({ problems: new Map(), defUses: new Map(), sketch: undefined as unknown as Sketch })

function Dot({ list }: { list: RowProblem[] | undefined }) {
  if (!list || !list.length) return null
  const worst = list.some((p) => p.severity === 'error') ? 'err' : 'warn'
  const text = list.map((p) => p.message).join('\n')
  return (
    <button type="button" class={`dot ${worst}`} data-testid="row-dot" data-severity={worst} aria-label={text} title={text} onClick={() => toast(text.split('\n')[0])}>
      <i />
    </button>
  )
}

// ---------------------------------------------------------------- function picker helpers

function openFnPicker(anchor: Element, position: 'gen' | 'mod', current: string | undefined, onPick: (name: string) => void, allowCustom = false): void {
  openPopover(anchor, (close) => <FnPicker position={position} current={current} allowCustom={allowCustom} onPick={onPick} onClose={close} />, { width: 440, label: position === 'gen' ? 'Generators' : 'Functions' })
}

// ---------------------------------------------------------------- switching off, previews, the tray as a delete zone

/** Switch node `id` off or on through the kit's rules (refusals and cascades are said in a toast), as one undo step. */
export function toggleNode(id: string, what = ''): void {
  const before = ctx.store.sketch
  const act = disableAction(before, id, what)
  const r = act.apply()
  if (!r.sketch) {
    if (r.instead) {
      const alt = disableAction(before, r.instead)
      if (alt.available) {
        toast(r.note ?? '', { label: alt.pressed ? 'Switch the whole thing on' : 'Switch the whole thing off', run: () => toggleNode(r.instead!) })
        return
      }
    }
    toast(r.note ?? 'This can’t be switched off on its own.')
    return
  }
  ctx.store.commit(r.sketch)
  toast(r.note ?? (act.pressed ? `Switched on${what ? ` ${what}` : ''}` : `Switched off${what ? ` ${what}` : ''}; it stays in the code as a // comment`), { label: 'Undo', run: () => ctx.store.undo() })
}

/** Is the preview preference on? (off hides every eye and peek) */
function usePreviewsOn(): boolean {
  const [m, setM] = useState(previewMode())
  useEffect(() => onPreviewMode(setM), [])
  return m !== 'off'
}

/** Over the open tray's delete zone, with a margin so a reorder that drifts towards the tray doesn't delete by accident. */
function overTray(x: number, y: number): boolean {
  const el = document.querySelector<HTMLElement>('[data-testid=tray-delete]')
  if (!el) return false
  const r = el.getBoundingClientRect()
  const m = 12
  return x >= r.left + m && x <= r.right - m && y >= r.top + m && y <= r.bottom - m
}

/** Reorder options that also make the tray a delete zone: dropping the dragged row on it calls `del`. */
function trayDeleteZone(del: () => void) {
  return {
    onStart: () => setTray({ rowDrag: true, rowOver: false }),
    onDragOver: (x: number, y: number, release: boolean) => {
      const over = overTray(x, y)
      if (!release) {
        setTray({ rowOver: over })
        return false
      }
      setTray({ rowDrag: false, rowOver: false })
      if (over) del()
      return over
    },
    onEnd: () => setTray({ rowDrag: false, rowOver: false }),
  }
}

// ---------------------------------------------------------------- call rows

interface CallRowProps {
  call: Call
  chainId: string
  index: number
  count: number
  stmtId?: string
  nested: boolean
  depth: number
  rows: RefObject<HTMLDivElement>
}

function CallRow({ call, chainId, index, count, stmtId, nested, depth, rows }: CallRowProps) {
  useCatalogVersion()
  const view = useContext(ViewCtx)
  const pos: 'gen' | 'mod' = index === 0 ? 'gen' : 'mod'
  const def = ctx.catalog.get(call.fn)
  const inputs = def?.inputs ?? []
  const n = def ? Math.max(inputs.length, call.args.length) : call.args.length
  const modIndex = index - 1
  const selected = view.selection === call.id
  const previews = usePreviewsOn()
  const peek = usePeek()
  const peekKind = peek?.callId === call.id ? peek.kind : undefined
  // the gutter toggle: a modifier switches itself; the generator switches its whole statement (chain or def). Pockets have
  // none: a call inside a texture argument is written on one line and switches with the call that takes it.
  const toggleId = nested ? undefined : pos === 'gen' ? stmtId : call.id
  const what = pos === 'gen' ? 'the chain' : `.${call.fn}`
  const label = `${chainGen(view.sketch, chainId) ?? ''}${pos === 'mod' ? ` → ${call.fn}` : ''}`

  const del = () => {
    edit((s) => removeMod(s, chainId, call.id))
    toast(`Deleted .${call.fn}`, { label: 'Undo', run: () => ctx.store.undo() })
  }
  const swipe = useSwipe({ enabled: pos === 'mod', onCommit: del, onRight: toggleId ? () => toggleNode(toggleId, what) : undefined })

  const openRowMenu = (el: HTMLElement) => {
    ctx.store.select(call.id)
    const items: MenuItem[] = []
    if (toggleId) {
      const act = disableAction(ctx.store.sketch, toggleId, what)
      items.push({ label: act.pressed ? `Switch on ${what}` : `Switch off ${what}`, hint: '//', run: () => toggleNode(toggleId, what), testid: 'menu-disable' })
    }
    if (!nested && previews) {
      items.push({ label: 'Preview up to here', run: () => setPeek({ callId: call.id, chainId, kind: 'prefix' }), testid: 'menu-peek' })
      if (pos === 'mod') items.push({ label: 'What does this do? (A/B)', run: () => setPeek({ callId: call.id, chainId, kind: 'diff' }), testid: 'menu-ab' })
    }
    if (pos === 'mod') {
      items.push({ label: 'Duplicate', hint: '⌘D', sep: items.length > 0, run: () => edit((s) => duplicateMod(s, chainId, call.id)), testid: 'menu-duplicate' })
      items.push({ label: 'Move up', disabled: modIndex === 0, run: () => edit((s) => moveMod(s, chainId, modIndex, modIndex - 1)) })
      items.push({ label: 'Move down', disabled: modIndex === count - 2, run: () => edit((s) => moveMod(s, chainId, modIndex, modIndex + 1)) })
    }
    // insertion opens the operator tray with a fixed insertion point (the no-drag path)
    items.push({
      label: 'Insert modifier below…',
      testid: 'menu-insert-below',
      run: () => openTrayAt({ kind: 'gap', chainId, index: pos === 'gen' ? 0 : modIndex + 1 }, `Insert below ${pos === 'gen' ? '' : '.'}${call.fn}`),
    })
    if (pos === 'mod') items.push({ label: 'Insert modifier above…', testid: 'menu-insert-above', run: () => openTrayAt({ kind: 'gap', chainId, index: modIndex }, `Insert above .${call.fn}`) })
    items.push({ label: pos === 'gen' ? 'Change generator…' : 'Change function…', run: () => openFnPicker(el, pos, call.fn, (name) => edit((s) => replaceFn(s, call.id, name, ctx.catalog)), !def) })
    if (pos === 'mod') items.push({ label: 'Delete', danger: true, sep: true, run: del, testid: 'menu-delete' })
    openMenu(el, items, `${pos === 'gen' ? '' : '.'}${call.fn}`)
  }

  const handleProps = useHandle(
    () => ({
      container: () => rows.current,
      index,
      min: 1,
      max: count - 1,
      onMove: (from, to) => edit((s) => moveMod(s, chainId, from - 1, to - 1)),
      ...trayDeleteZone(del),
    }),
    (_e, el) => openRowMenu(el),
  )
  const pinnedProps = usePress({ onTap: (_e, el) => openRowMenu(el) })

  const press = usePress({
    onTap: (_e, el) => {
      ctx.store.select(call.id)
      openFnPicker(el, pos, call.fn, (name) => edit((s) => replaceFn(s, call.id, name, ctx.catalog)), !def)
    },
    // long-press the name: the row menu (switch off, "what does this do?", insert above / below, …)
    onLong: (_e, el) => openRowMenu(el),
    onDown: () => ctx.store.select(call.id),
  })

  const args: Array<{ a: ArgInfo; v: Value | undefined; i: number }> = []
  for (let i = 0; i < n; i++) {
    const a = argInfoFor(call.id, call.fn, i, inputs[i], stmtId, depth, true)
    if (!def || i >= inputs.length) {
      a.removable = true
      a.onRemove = () => edit((s) => removeArg(s, call.id, i))
    }
    args.push({ a, v: call.args[i], i })
  }
  const probs = view.problems.get(call.id)
  const spec: PreviewSpec | undefined = peekKind === 'diff' ? { kind: 'diff', callId: call.id } : peekKind === 'prefix' ? { kind: 'prefix', chainId, upToCallId: call.id } : undefined

  return (
    <>
    <div
      class={`crow ${pos} ${selected ? 'selected' : ''} ${def ? '' : 'unknown'} ${call.disabled ? 'is-disabled' : ''} ${toggleId ? 'has-toggle' : ''}`}
      data-call={call.id}
      data-fn={call.fn}
      data-disabled={call.disabled ? '1' : undefined}
      data-testid={`row-${pos}`}
      {...swipe}
    >
      {toggleId && <DisableToggle id={toggleId} what={what} class="row-toggle" sketch={view.sketch} onChange={(next) => ctx.store.commit(next)} />}
      <Dot list={probs} />
      <span class="tok fname" data-token="fname" role="button" tabIndex={0} aria-label={`${call.fn} function, tap to change`} data-testid="fname" {...press}>
        {pos === 'mod' ? '.' : ''}
        {call.fn}
      </span>
      <span class="p">(</span>
      {args.map(({ a, v, i }) => (
        <>
          {i > 0 && <span class="p comma">,</span>}
          <ArgView value={v} a={a} key={`${call.id}:${i}`} />
        </>
      ))}
      {!def && (
        <button type="button" class="tok addarg" aria-label="Add argument" onClick={() => edit((s) => addArg(s, call.id))}>
          ＋
        </button>
      )}
      <span class="p">)</span>
      {!nested && previews && (
        <button
          type="button"
          class={`eye ${peekKind ? 'on' : ''}`}
          data-testid="eye"
          aria-pressed={!!peekKind}
          aria-label={peekKind ? 'Hide the preview' : 'Preview up to here'}
          title="Preview up to here"
          onClick={(e) => {
            e.stopPropagation()
            togglePeek({ callId: call.id, chainId, kind: peekKind === 'diff' ? 'diff' : 'prefix' })
          }}
        >
          <EyeIcon />
        </button>
      )}
      <button
        type="button"
        class={`handle ${pos === 'gen' ? 'pinned' : ''}`}
        data-testid={pos === 'gen' ? 'handle-gen' : 'handle'}
        aria-label={pos === 'gen' ? 'Generator menu' : 'Row menu; hold and drag to reorder'}
        {...(pos === 'gen' ? pinnedProps : handleProps)}
      >
        {pos === 'gen' ? '⌖' : '⋮⋮'}
      </button>
    </div>
    {spec && previews && (
      <div class="peek-row" data-reorder="skip" data-testid="peek-row" data-kind={spec.kind}>
        <PreviewPeek key={`${spec.kind}:${call.id}`} spec={spec} pool={stackPreviewPool()} sketch={view.sketch} label={label} />
        <button type="button" class="linkish" data-testid="peek-close" onClick={() => setPeek(undefined)}>
          close
        </button>
      </div>
    )}
    </>
  )
}

function chainGen(sketch: Sketch, chainId: string): string | undefined {
  let out: string | undefined
  const look = (c: Chain) => {
    if (c.id === chainId) out = c.gen.fn
    for (const m of [c.gen, ...c.mods]) for (const a of m.args) if (a.k === 'tex') look(a.chain)
  }
  for (const st of sketch.stmts) {
    if (st.k === 'chain') look(st.chain)
    else if (st.k === 'def' && st.value.k === 'tex') look(st.value.chain)
  }
  return out
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.7" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  )
}

function removeArg(s: Sketch, callId: string, i: number): Sketch {
  return edit0(s, callId, (c) => ({ ...c, args: c.args.filter((_, k) => k !== i) }))
}
function addArg(s: Sketch, callId: string): Sketch {
  return edit0(s, callId, (c) => ({ ...c, args: [...c.args, num(0)] }))
}
const edit0 = updateCall

// ---------------------------------------------------------------- chains

function OutRow({ chain, stmtId }: { chain: Chain; stmtId: string }) {
  const out = chain.out
  const press = usePress({
    onTap: (_e, el) => {
      ctx.store.select(stmtId)
      openPopover(el, (close) => <RefPicker current={out ?? null} sources={false} none onPick={(n) => edit((s) => setOut(s, chain.id, (n as never) ?? null))} onClose={close} />, { width: 300, label: 'output' })
    },
  })
  return (
    <div class="crow out" data-reorder="skip" data-testid="row-out">
      <span class="tok fname dim">.out</span>
      <span class="p">(</span>
      <span class={`tok ref out ${out ? '' : 'none'}`} data-token="out" role="button" tabIndex={0} data-testid="out-chip" {...press}>
        {out ?? '—'}
      </span>
      <span class="p">)</span>
    </div>
  )
}

export function ChainView({ chain, stmtId, nested, depth }: { chain: Chain; stmtId?: string; nested: boolean; depth: number }) {
  const rows = useRef<HTMLDivElement>(null)
  const count = 1 + chain.mods.length
  return (
    <div class={`chain ${nested ? 'nested' : ''}`} data-chain={chain.id} data-depth={depth}>
      <div class="rows" ref={rows}>
        <CallRow call={chain.gen} chainId={chain.id} index={0} count={count} stmtId={stmtId} nested={nested} depth={depth} rows={rows} />
        {chain.mods.map((m, i) => (
          <CallRow key={m.id} call={m} chainId={chain.id} index={i + 1} count={count} stmtId={stmtId} nested={nested} depth={depth} rows={rows} />
        ))}
        {!nested && stmtId && <OutRow chain={chain} stmtId={stmtId} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- statement shell

function StmtShell({ stmt, index, total, children, cls = '' }: { stmt: Stmt; index: number; total: number; children: preact.ComponentChildren; cls?: string }) {
  const view = useContext(ViewCtx)
  const list = useRef<HTMLElement | null>(null)
  const selected = view.selectedStmt === stmt.id
  const openMenuFor = (el: HTMLElement) => {
    ctx.store.select(stmt.id)
    const items: MenuItem[] = []
    const act = disableAction(ctx.store.sketch, stmt.id, stmtTitle(stmt))
    if (act.check.kind === 'stmt' && (act.available || SWITCHABLE.has(stmt.k))) {
      items.push({ label: act.pressed ? 'Switch on' : 'Switch off', hint: '//', run: () => toggleNode(stmt.id, stmtTitle(stmt)), testid: 'stmt-disable' })
    }
    items.push(
      { label: 'Duplicate', hint: '⌘D', sep: items.length > 0, run: () => duplicateStatement(stmt.id), testid: 'stmt-duplicate' },
      { label: 'Move up', disabled: index === 0, run: () => edit((s) => moveStmt(s, stmt.id, index - 1)) },
      { label: 'Move down', disabled: index === total - 1, run: () => edit((s) => moveStmt(s, stmt.id, index + 1)) },
    )
    if (stmt.k === 'chain') {
      items.push({ label: 'Add a chain after this one', run: () => edit((s) => insertStmt(s, index + 1, newChainStmt(s))) })
    }
    items.push({ label: 'Delete', danger: true, sep: true, testid: 'stmt-delete', run: () => deleteStatement(stmt.id) })
    openMenu(el, items, stmtTitle(stmt))
  }
  const handle = useHandle(
    () => ({
      container: () => document.querySelector<HTMLElement>('.stack-list'),
      index,
      min: 0,
      max: total - 1,
      onMove: (from, to) => edit((s) => moveStmt(s, s.stmts[from].id, to)),
      ...trayDeleteZone(() => deleteStatement(stmt.id)),
    }),
    (_e, el) => openMenuFor(el),
  )
  return (
    <section
      ref={list as never}
      class={`stmt k-${stmt.k} ${selected ? 'selected' : ''} ${stmt.disabled ? 'is-disabled' : ''} ${cls}`}
      data-stmt={stmt.id}
      data-disabled={stmt.disabled ? '1' : undefined}
      data-testid={`stmt-${stmt.k}`}
      onPointerDown={(e) => {
        const t = e.target as HTMLElement
        if (!t.closest('[data-token],button,input,textarea,.crow,[data-token-box]')) ctx.store.select(stmt.id)
      }}
    >
      <div class="gutter">
        <button type="button" class="handle stmt-handle" data-testid="stmt-handle" aria-label="Statement menu; hold and drag to reorder" {...handle}>
          ⠿
        </button>
        {gutterToggle(stmt) && <DisableToggle id={stmt.id} what={stmtTitle(stmt)} class="stmt-toggle" sketch={view.sketch} onChange={(next) => ctx.store.commit(next)} />}
      </div>
      <div class="stmt-main">{children}</div>
    </section>
  )
}

const SWITCHABLE = new Set<Stmt['k']>(['chain', 'def', 'source', 'setting', 'render'])

/** Statements whose `//` toggle sits in the gutter. A chain's (and a texture def's) is on its generator row instead. */
function gutterToggle(s: Stmt): boolean {
  if (s.k === 'chain') return false
  if (s.k === 'def') return s.value.k !== 'tex'
  return SWITCHABLE.has(s.k)
}

function stmtTitle(s: Stmt): string {
  switch (s.k) {
    case 'chain': return `chain ${s.chain.gen.fn}`
    case 'def': return s.name
    case 'comment': return 'comment'
    case 'raw': return 'code'
    case 'render': return 'render'
    case 'source': return `${s.slot} source`
    case 'setting': return s.name
  }
}

export function duplicateStatement(id: string): void {
  edit((s) => duplicateStmt(s, id))
  toast('Duplicated', { label: 'Undo', run: () => ctx.store.undo() })
}
export function deleteStatement(id: string): void {
  const s = ctx.store.sketch.stmts.find((x) => x.id === id)
  edit((sk) => removeStmt(sk, id))
  toast(`Deleted ${s ? stmtTitle(s) : 'statement'}`, { label: 'Undo', run: () => ctx.store.undo() })
}

function autofocus(el: HTMLElement | null): void {
  if (el && !el.dataset.f) {
    el.dataset.f = '1'
    el.focus()
  }
}

// ---------------------------------------------------------------- statement bodies

function ChainStmtBody({ stmt }: { stmt: Extract<Stmt, { k: 'chain' }> }) {
  const view = useContext(ViewCtx)
  const d = useMemo(() => describe(view.sketch), [view.sketch])
  const facts = d.chains.find((c) => c.stmtId === stmt.id)
  const chain = stmt.chain
  const firstFree = (['o0', 'o1', 'o2', 'o3'] as const).find((o) => !d.outputs[o].writers.length)
  const target = d.outputs.o0.writers.length && firstFree ? firstFree : 'o0'
  const winnerStmt = facts?.shadowed ? view.sketch.stmts.find((s) => s.k === 'chain' && s.chain.id === d.outputs[chain.out!]?.winner) : undefined
  return (
    <>
      {(chain.out === null || facts?.shadowed || facts?.feedback) && (
        <div class="flags">
          {chain.out === null && (
            <>
              <span class="flag warn" data-testid="flag-not-rendered">not rendered</span>
              <button type="button" class="flag act" data-testid="send-to-o0" onClick={() => edit((s) => setOut(s, chain.id, target))}>
                send to {target}
              </button>
            </>
          )}
          {facts?.shadowed && (
            <button type="button" class="flag warn" data-testid="flag-shadowed" onClick={() => winnerStmt && focusNode(winnerStmt.id)}>
              shadowed: a later chain also writes {chain.out}
            </button>
          )}
          {facts?.feedback && <span class="flag info">feedback</span>}
        </div>
      )}
      <ChainView chain={chain} stmtId={stmt.id} nested={false} depth={0} />
    </>
  )
}

const defHint = (v: Value): Hint => heuristicHint(v.k === 'num' ? v.v : undefined)

function DefBody({ stmt }: { stmt: DefStmt }) {
  const view = useContext(ViewCtx)
  const uses = view.defUses.get(stmt.name) ?? 0
  const a: ArgInfo = {
    owner: stmt.id,
    fn: '',
    name: stmt.name,
    refd: { def: stmt.id },
    hint: defHint(stmt.value),
    depth: 0,
    stmtId: stmt.id,
    kinds: ['number', 'function', 'array', 'texture'] as Kind[],
  }
  const rename = (el: HTMLElement) =>
    openPopover(el, (close) => <RenameDef stmt={stmt} close={close} />, { width: 300, label: 'rename variable' })
  const press = usePress({ onTap: (_e, el) => (ctx.store.select(stmt.id), rename(el)) })
  const dot = view.problems.get(stmt.id)
  return (
    <div class={`defrow ${stmt.value.k === 'tex' ? 'block' : ''}`}>
      <Dot list={dot} />
      {stmt.decl !== 'bare' && <span class="decl">{stmt.decl}</span>}
      <span class="tok varname" data-token="varname" role="button" tabIndex={0} data-testid="def-name" {...press}>
        {stmt.name}
      </span>
      <span class="p">=</span>
      <ArgView value={stmt.value} a={a} />
      <span class={`uses ${uses === 0 ? 'none' : ''}`} title="references in this sketch">
        {uses === 0 ? 'unused' : `used ${uses}×`}
      </span>
    </div>
  )
}

function RenameDef({ stmt, close }: { stmt: DefStmt; close: () => void }) {
  const [name, setName] = useState(stmt.name)
  const taken = ctx.store.sketch.stmts.some((s) => s.k === 'def' && s.name === name && s.id !== stmt.id)
  const ok = /^[A-Za-z_$][\w$]*$/.test(name) && !taken
  const apply = () => {
    if (ok && name !== stmt.name) edit((s) => renameDef(s, stmt.id, name))
    close()
  }
  return (
    <div class="rename">
      <div class="ed-head">
        <span>Rename variable</span>
        <small>references in blocks follow; code in raw rows does not</small>
      </div>
      <input
        class="expr"
        data-testid="rename-input"
        type="text"
        autocapitalize="off"
        autocorrect="off"
        autocomplete="off"
        spellcheck={false}
        value={name}
        onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
      />
      {!ok && <div class="note bad">{taken ? 'Another variable has that name.' : 'Use letters, digits, _ and $; not starting with a digit.'}</div>}
      <button type="button" class="btn" disabled={!ok} onClick={apply}>
        Rename
      </button>
    </div>
  )
}

function NoteBody({ stmt }: { stmt: Extract<Stmt, { k: 'comment' }> }) {
  const [editing, setEditing] = useState(false)
  const press = usePress({ onTap: () => (ctx.store.select(stmt.id), setEditing(true)) })
  const set = (text: string) => edit((s) => updateStmt(s, stmt.id, (x) => (x.k === 'comment' ? { ...x, text } : x)), { coalesce: `note:${stmt.id}` })
  return (
    <div class="note-row" data-testid="note-row">
      <span class="slashes">{stmt.block ? '/*' : '//'}</span>
      {editing ? (
        <textarea
          class="note-edit"
          data-testid="note-edit"
          rows={Math.max(1, stmt.text.split('\n').length)}
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          value={stmt.text}
          onInput={(e) => set((e.currentTarget as HTMLTextAreaElement).value)}
          onBlur={() => (setEditing(false), ctx.store.endGroup())}
          ref={autofocus}
        />
      ) : (
        <span class="note-text" role="button" tabIndex={0} data-token="note" {...press}>
          {stmt.text || '(empty comment)'}
        </span>
      )}
      {stmt.block && <span class="slashes">*/</span>}
    </div>
  )
}

// ---------- raw

const statusCache = new Map<string, RawStatus>()
export interface RawStatus {
  state: 'code' | 'blocks' | 'error'
  message: string
  stmts?: Stmt[]
}
/** What would importing this text do? Memoised: recognised → would become blocks; syntax error; or stays code. */
export function rawStatus(code: string): RawStatus {
  const hit = statusCache.get(code)
  if (hit) return hit
  const r = importText(code, { catalog: ctx.catalog })
  let st: RawStatus
  if (r.report.parseFailed) st = { state: 'error', message: r.warnings[0] ?? 'syntax error' }
  else if (r.report.statements > 0 && r.report.raw === 0) st = { state: 'blocks', message: `recognised: ${r.report.statements} statement(s) become blocks`, stmts: r.sketch.stmts }
  else st = { state: 'code', message: 'kept as code' }
  if (statusCache.size > 200) statusCache.clear()
  statusCache.set(code, st)
  return st
}

/** Replace one statement by several, keeping the whitespace that preceded it. */
export function replaceStmtWith(sketch: Sketch, id: string, stmts: Stmt[]): Sketch {
  const i = sketch.stmts.findIndex((s) => s.id === id)
  if (i < 0) return sketch
  const old = sketch.stmts[i]
  const fresh = stmts.map((s, k) => {
    if (k === 0 && s.src) return { ...s, src: { ...s.src, before: old.src?.before ?? s.src.before } } as Stmt
    return s
  })
  const out = sketch.stmts.slice()
  out.splice(i, 1, ...fresh)
  return { ...sketch, stmts: out }
}

function RawBody({ stmt }: { stmt: Extract<Stmt, { k: 'raw' }> }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(stmt.code)
  const st = rawStatus(stmt.code)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const press = usePress({ onTap: () => (ctx.store.select(stmt.id), setOpen(true)) })
  const first = stmt.code.split('\n')[0]
  const lines = stmt.code.split('\n').length
  const commit = (code: string, final: boolean) => {
    const s = rawStatus(code)
    if (s.state === 'blocks' && s.stmts && final) {
      edit((sk) => replaceStmtWith(sk, stmt.id, s.stmts!), { coalesce: `raw:${stmt.id}` })
      return
    }
    edit((sk) => updateStmt(sk, stmt.id, (x) => (x.k === 'raw' ? { ...x, code } : x)), { coalesce: `raw:${stmt.id}` })
  }
  return (
    <div class={`raw-row ${open ? 'open' : ''}`} data-testid="raw-row">
      <span class={`status ${st.state}`} data-testid="raw-status" data-state={st.state} title={st.message} aria-label={st.message} />
      {open ? (
        <div class="raw-edit">
          <textarea
            class="code-edit"
            data-testid="raw-edit"
            rows={Math.min(14, Math.max(2, text.split('\n').length))}
            autocapitalize="off"
            autocorrect="off"
            autocomplete="off"
            spellcheck={false}
            value={text}
            onInput={(e) => {
              const v = (e.currentTarget as HTMLTextAreaElement).value
              setText(v)
              clearTimeout(timer.current)
              timer.current = setTimeout(() => commit(v, false), 350)
            }}
            onBlur={() => {
              clearTimeout(timer.current)
              if (text !== stmt.code || rawStatus(stmt.code).state === 'blocks') commit(text, true)
              ctx.store.endGroup()
              setOpen(false)
            }}
            ref={autofocus}
          />
          <div class={`rawnote ${rawStatus(text).state}`}>{rawStatus(text).message}</div>
        </div>
      ) : (
        <span class="raw-text" role="button" tabIndex={0} data-token="raw" {...press}>
          <code>{first || '(empty)'}</code>
          {lines > 1 && <em> … {lines} lines</em>}
        </span>
      )}
    </div>
  )
}

// ---------- render / source / setting

function RenderBody({ stmt }: { stmt: Extract<Stmt, { k: 'render' }> }) {
  const press = usePress({
    onTap: (_e, el) => {
      ctx.store.select(stmt.id)
      openPopover(
        el,
        (close) => (
          <div class="ref-picker">
            <div class="refrow">
              {(['all', 'o0', 'o1', 'o2', 'o3'] as const).map((t) => (
                <button type="button" class={`chip ${stmt.target === t ? 'on' : ''}`} key={t} data-ref={t} onClick={() => (edit((s) => updateStmt(s, stmt.id, (x) => (x.k === 'render' ? { ...x, target: t } : x))), close())}>
                  {t === 'all' ? 'all four' : t}
                </button>
              ))}
            </div>
          </div>
        ),
        { width: 320, label: 'render target' },
      )
    },
  })
  return (
    <div class="crow plain" data-testid="render-row">
      <span class="tok fname dim">render</span>
      <span class="p">(</span>
      <span class="tok ref out" data-token="render" role="button" tabIndex={0} {...press}>
        {stmt.target === 'all' ? '' : stmt.target}
        {stmt.target === 'all' && <i class="dimtxt">all</i>}
      </span>
      <span class="p">)</span>
    </div>
  )
}

const KINDS: Array<{ kind: Extract<Stmt, { k: 'source' }>['init']['kind']; fn: string }> = [
  { kind: 'cam', fn: 'initCam' },
  { kind: 'image', fn: 'initImage' },
  { kind: 'video', fn: 'initVideo' },
  { kind: 'screen', fn: 'initScreen' },
  { kind: 'clear', fn: 'clear' },
]

function SourceBody({ stmt }: { stmt: Extract<Stmt, { k: 'source' }> }) {
  const init = stmt.init
  const kind = KINDS.find((k) => k.kind === init.kind)!
  const set = (patch: Partial<typeof init>, coalesce?: string) => edit((s) => updateStmt(s, stmt.id, (x) => (x.k === 'source' ? { ...x, init: { ...x.init, ...patch } } : x)), coalesce ? { coalesce } : undefined)
  const argText = init.argsSrc !== undefined ? init.argsSrc : (init.arg ?? '')
  const slotPress = usePress({
    onTap: (_e, el) =>
      openPopover(el, (close) => <RefPicker current={stmt.slot} outs={false} onPick={(n) => n && edit((s) => updateStmt(s, stmt.id, (x) => (x.k === 'source' ? { ...x, slot: n as SourceName } : x)))} onClose={close} />, { width: 300, label: 'source slot' }),
  })
  const kindPress = usePress({
    onTap: (_e, el) =>
      openMenu(
        el,
        KINDS.map((k) => ({ label: `.${k.fn}()`, run: () => set({ kind: k.kind, ...(k.kind === 'clear' || k.kind === 'screen' ? { arg: undefined, argsSrc: undefined } : {}) }) })),
        'source kind',
      ),
  })
  return (
    <div class="crow plain" data-testid="source-row">
      <span class="tok ref src" data-token="slot" role="button" tabIndex={0} data-testid="source-slot" {...slotPress}>
        {stmt.slot}
      </span>
      <span class="p">.</span>
      <span class="tok fname" data-token="source-kind" role="button" tabIndex={0} data-testid="source-kind" {...kindPress}>
        {kind.fn}
      </span>
      <span class="p">(</span>
      {init.kind !== 'clear' && init.kind !== 'screen' && (
        <input
          class="argtext"
          data-testid="source-arg"
          type="text"
          autocapitalize="off"
          autocorrect="off"
          autocomplete="off"
          spellcheck={false}
          value={argText}
          placeholder={init.kind === 'cam' ? 'camera #' : 'url'}
          aria-label={`${kind.fn} argument`}
          onInput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value
            if (init.argsSrc !== undefined) set({ argsSrc: v }, `src:${stmt.id}`)
            else set({ arg: v }, `src:${stmt.id}`)
          }}
          onBlur={() => ctx.store.endGroup()}
        />
      )}
      <span class="p">)</span>
    </div>
  )
}

const SETTING_HINT: Record<string, Hint> = { bpm: { min: 1, max: 240, step: 1, integer: true }, speed: { min: 0, max: 4, step: 0.01 } }

function SettingBody({ stmt }: { stmt: Extract<Stmt, { k: 'setting' }> }) {
  const hint = SETTING_HINT[stmt.name]
  const set = (v: number) => edit((s) => updateStmt(s, stmt.id, (x) => (x.k === 'setting' ? { ...x, v } : x)), { coalesce: `set:${stmt.id}` })
  const field = () =>
    simpleField({
      id: `stack:set:${stmt.id}`,
      label: stmt.name,
      hint,
      def: stmt.name === 'bpm' ? 30 : 1,
      get: () => {
        const x = ctx.store.sketch.stmts.find((y) => y.id === stmt.id)
        return x?.k === 'setting' ? x.v : stmt.v
      },
      set,
      end: () => (ctx.store.endGroup(), ctx.runner.run()),
    })
  return (
    <div class="crow plain" data-testid="setting-row">
      <span class="tok fname">{stmt.name}</span>
      <span class="p">=</span>
      <Scrub
        value={stmt.v}
        hint={hint}
        label={stmt.name}
        testid={`setting-${stmt.name}`}
        onChange={(v, ph) => (ph === 'end' ? (ctx.store.endGroup(), ctx.runner.run()) : set(v))}
        onTap={(el) => openNumberEditor(el, field())}
        field={field}
      />
    </div>
  )
}

// ---------------------------------------------------------------- the list

function StmtBody({ stmt }: { stmt: Stmt }) {
  switch (stmt.k) {
    case 'chain': return <ChainStmtBody stmt={stmt} />
    case 'def': return <DefBody stmt={stmt} />
    case 'comment': return <NoteBody stmt={stmt} />
    case 'raw': return <RawBody stmt={stmt} />
    case 'render': return <RenderBody stmt={stmt} />
    case 'source': return <SourceBody stmt={stmt} />
    case 'setting': return <SettingBody stmt={stmt} />
  }
}

export function StatementList({ view }: { view: ViewState }) {
  useStore()
  const stmts = view.sketch.stmts
  return (
    <ViewCtx.Provider value={view}>
      <div class="stack-list" data-testid="stack-list">
        {stmts.map((s, i) => (
          <StmtShell key={s.id} stmt={s} index={i} total={stmts.length}>
            <StmtBody stmt={s} />
          </StmtShell>
        ))}
      </div>
    </ViewCtx.Provider>
  )
}

// ---------------------------------------------------------------- adding statements

export function addStatement(kind: 'chain' | 'var-number' | 'var-function' | 'var-array' | 'var-chain' | 'comment' | 'source-cam' | 'source-image' | 'source-video' | 'bpm' | 'speed' | 'render' | 'raw'): void {
  const sk = ctx.store.sketch
  const sel = ctx.store.selection ? stmtOf(sk, ctx.store.selection) : undefined
  const selIndex = sel ? sk.stmts.findIndex((s) => s.id === sel.id) : -1
  const firstChain = sk.stmts.findIndex((s) => s.k === 'chain')
  const end = sk.stmts.length
  let at = selIndex >= 0 ? selIndex + 1 : end
  let stmt: Stmt
  switch (kind) {
    case 'chain':
      stmt = newChainStmt(sk)
      break
    case 'var-number':
    case 'var-function':
    case 'var-array':
    case 'var-chain': {
      const name = uniqueName(sk, kind === 'var-number' ? 'amount' : kind === 'var-function' ? 'wave' : kind === 'var-array' ? 'steps' : 'base')
      const value: Value =
        kind === 'var-number' ? num(0.5)
        : kind === 'var-function' ? { k: 'fn', src: '() => Math.sin(time)' }
        : kind === 'var-array' ? { k: 'arr', v: [0.2, 0.8], mods: {} }
        : { k: 'tex', chain: makeChain(makeCall('noise', [num(3)])) }
      stmt = { id: newId('s'), k: 'def', name, decl: 'const', value }
      // a definition must come before its uses: put it in front of the selected chain or the first chain
      at = sel && sel.k === 'chain' ? selIndex : firstChain >= 0 ? firstChain : end
      break
    }
    case 'comment':
      stmt = commentStmt('note')
      break
    case 'source-cam':
    case 'source-image':
    case 'source-video': {
      const used = new Set(sk.stmts.filter((s) => s.k === 'source').map((s) => (s as Extract<Stmt, { k: 'source' }>).slot))
      const slot = (['s0', 's1', 's2', 's3'] as const).find((s) => !used.has(s)) ?? 's0'
      const k = kind === 'source-cam' ? 'cam' : kind === 'source-image' ? 'image' : 'video'
      stmt = { id: newId('s'), k: 'source', slot, init: { kind: k, arg: k === 'cam' ? '0' : '' } }
      at = setupInsertIndex(sk)
      break
    }
    case 'bpm':
    case 'speed':
      stmt = { id: newId('s'), k: 'setting', name: kind, v: kind === 'bpm' ? 120 : 1 }
      at = setupInsertIndex(sk)
      break
    case 'render':
      stmt = { id: newId('s'), k: 'render', target: 'all' }
      at = end
      break
    case 'raw':
      stmt = rawStmt('// code')
      break
  }
  edit((s) => insertStmt(s, at, stmt))
  ctx.store.select(stmt.id)
  setTimeout(() => focusNode(stmt.id), 60)
}

