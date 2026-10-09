// One argument of a call (or the value of a def) as a touch target, whatever its kind: number, function, array, texture
// pocket, o/s reference, variable, JS, vector or default. Long-press any of them for the kind menu.
import { DEFAULT, liveId, num, type Hint, type InputDef, type Value } from '@hydra-ipad/core'
import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import { asPlainRef, convertValue, defaultNumber, fmt, kindOf, kindsFor, KIND_LABEL, evalNumeric, type Kind } from '../conv'
import { ctx, edit, useStore } from '../ctx'
import { usePress } from '../gestures'
import { defsBefore, getArg, refKey, setArg, type ArgRef } from '../model'
import { closePopover, openPopover } from '../overlay'
import { focusNode } from '../nav'
import { ArrEditor } from './ArrEditor'
import { FnEditor, Meter, fnLabel } from './FnEditor'
import { Keypad } from './Keypad'
import { RefPicker } from './Picker'
import { ChainView } from './Rows'
import { Scrub } from './Scrub'

export interface ArgInfo {
  /** the call that owns this argument (selection target) or the def statement id */
  owner: string
  fn: string
  name: string
  input?: InputDef
  refd: ArgRef
  /** present when a plain number can be pushed live without recompiling */
  liveKey?: string
  hint: Hint
  depth: number
  /** statement that holds this value: `var` pickers only offer defs that come before it */
  stmtId?: string
  /** can be removed from an unknown call */
  removable?: boolean
  onRemove?: () => void
  /** override of the kinds the long-press menu offers (defs have no Default) */
  kinds?: Kind[]
}

const labelOf = (a: ArgInfo) => (a.fn ? `${a.fn}.${a.name}` : a.name)

export function argInfoFor(owner: string, fn: string, index: number, input: InputDef | undefined, stmtId: string | undefined, depth: number, inChain: boolean): ArgInfo {
  const cat = ctx.catalog
  const known = !!cat.get(fn)
  const hint = input ? cat.hint(fn, input.name) : { min: -1, max: 1, step: 0.01 }
  return {
    owner,
    fn,
    name: input?.name ?? `arg${index + 1}`,
    input,
    refd: { call: owner, i: index },
    liveKey: inChain && known && input?.type === 'float' ? liveId(owner, index) : undefined,
    hint,
    depth,
    stmtId,
  }
}

// ---------------------------------------------------------------- committing

export function setValue(a: ArgInfo, v: Value, coalesce?: string): void {
  edit((s) => setArg(s, a.refd, v), coalesce ? { coalesce } : undefined)
}

/** A number changed by dragging, the keypad or the keyboard. Live-capable numbers skip the recompile until the gesture ends. */
export function setNumber(a: ArgInfo, v: number, phase: 'drag' | 'end' | 'key' | 'pad'): void {
  if (phase === 'end') {
    ctx.store.endGroup()
    ctx.runner.run()
    return
  }
  edit((s) => setArg(s, a.refd, num(v)), { coalesce: `num:${refKey(a.refd)}`, noRun: !!a.liveKey })
  if (a.liveKey) ctx.runner.setLive(a.liveKey, v)
}

function select(a: ArgInfo): void {
  ctx.store.select(a.owner)
}

export function openKeypad(el: HTMLElement, a: ArgInfo, value: number, def: number): void {
  openPopover(
    el,
    () => (
      <Keypad
        title={labelOf(a)}
        value={value}
        def={a.input ? defaultNumber(a.input) : def}
        hint={a.hint}
        onChange={(v) => setNumber(a, v, 'pad')}
        onClose={closePopover}
      />
    ),
    { width: 268, label: labelOf(a), onClose: () => setNumber(a, 0, 'end') },
  )
}

export function openFnEditor(el: HTMLElement, a: ArgInfo): void {
  openPopover(el, () => <FnEditor refd={a.refd} title={labelOf(a)} input={a.input} hint={a.hint} />, { width: 392, label: `${labelOf(a)} function`, onClose: () => ctx.store.endGroup() })
}
export function openArrEditor(el: HTMLElement, a: ArgInfo): void {
  openPopover(el, () => <ArrEditor refd={a.refd} title={labelOf(a)} hint={a.hint} def={a.input ? defaultNumber(a.input) : 0} />, { width: 420, label: `${labelOf(a)} array`, onClose: () => ctx.store.endGroup() })
}
function openRefPicker(el: HTMLElement, a: ArgInfo, current: Value): void {
  const cur = current.k === 'ref' ? current.name : undefined
  openPopover(el, (close) => <RefPicker current={cur} onPick={(n) => n && setValue(a, { k: 'ref', name: n })} onClose={close} />, { width: 300, label: 'texture source' })
}
function openJsEditor(el: HTMLElement, a: ArgInfo): void {
  openPopover(el, () => <JsEditor a={a} />, { width: 360, label: 'JavaScript value' })
}

// ---------------------------------------------------------------- kind menu

function afterKind(el: HTMLElement, a: ArgInfo, k: Kind): void {
  if (k === 'function') openFnEditor(el, a)
  else if (k === 'array') openArrEditor(el, a)
}

export function openKindMenu(el: HTMLElement, a: ArgInfo): void {
  openPopover(el, (close) => <KindMenu a={a} anchor={el} close={close} />, { width: 300, label: `${labelOf(a)} options` })
}

function KindMenu({ a, anchor, close }: { a: ArgInfo; anchor: HTMLElement; close: () => void }) {
  useStore()
  const sketch = ctx.store.sketch
  const v = getArg(sketch, a.refd) ?? DEFAULT
  const cur = kindOf(v)
  const kinds = a.kinds ?? kindsFor(a.input)
  // only definitions that fit the slot: texture chains for a texture input, numbers / functions / arrays for a number input
  const defs = defsBefore(sketch, a.stmtId).filter((d) => (a.input?.type === 'sampler2D' ? d.value.k === 'tex' || d.value.k === 'js' : d.value.k !== 'tex'))
  const def = a.input ? defaultNumber(a.input) : undefined
  const isTexInput = a.input?.type === 'sampler2D'
  const plain = asPlainRef(v)
  const pick = (k: Kind) => {
    if (k === 'ref' || k === 'var') return // handled by the sub-pickers below
    const next = convertValue(v, k, a.input, { catalog: ctx.catalog, defNames: defs.map((d) => d.name) })
    setValue(a, next)
    close()
    afterKind(anchor, a, k)
  }
  const active = (k: Kind) => (k === cur || (k === 'ref' && cur === 'texture' && !!plain && false) || (k === 'texture' && cur === 'texture'))
  return (
    <div class="kind-menu" data-testid="kind-menu">
      <div class="km-head">
        <b>{labelOf(a)}</b>
        {def !== undefined ? <small>default {fmt(def)}</small> : a.input?.type === 'sampler2D' ? <small>texture input</small> : null}
      </div>
      <div class="km-kinds" role="group" aria-label="Value kind">
        {kinds
          .filter((k) => k !== 'ref' && k !== 'var')
          .map((k) => (
            <button type="button" class={`kbtn ${active(k) ? 'on' : ''}`} key={k} data-kind={k} onClick={() => pick(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
      </div>
      {isTexInput && (
        <>
          <div class="km-sub">
            <span class="lbl">o / s</span>
            <RefPicker current={v.k === 'ref' ? v.name : plain} onPick={(n) => n && setValue(a, { k: 'ref', name: n })} onClose={close} />
          </div>
          {defs.length > 0 && (
            <div class="km-sub">
              <span class="lbl">variable</span>
              <div class="refrow">
                {defs.map((d) => (
                  <button type="button" class={`chip ${v.k === 'var' && v.name === d.name ? 'on' : ''}`} key={d.id} data-var={d.name} onClick={() => (setValue(a, { k: 'var', name: d.name }), close())}>
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {!isTexInput && defs.length > 0 && (
        <div class="km-sub">
          <span class="lbl">variable</span>
          <div class="refrow">
            {defs.map((d) => (
              <button type="button" class={`chip ${v.k === 'var' && v.name === d.name ? 'on' : ''}`} key={d.id} data-var={d.name} onClick={() => (setValue(a, { k: 'var', name: d.name }), close())}>
                {d.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="km-actions">
        <button type="button" class="btn" data-testid="km-reset" onClick={() => (setValue(a, DEFAULT), close())}>
          Reset to default
        </button>
        {a.removable && (
          <button type="button" class="btn danger" onClick={() => (a.onRemove?.(), close())}>
            Remove argument
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- tokens

function PressTok({ a, cls, children, testid, onTap, onLong }: { a: ArgInfo; cls: string; children: ComponentChildren; testid?: string; onTap: (el: HTMLElement) => void; onLong?: (el: HTMLElement) => void }) {
  const p = usePress({ onTap: (_e, el) => onTap(el), onLong: (_e, el) => (onLong ?? ((x) => openKindMenu(x, a)))(el), onDown: () => select(a) })
  return (
    <span class={`tok ${cls}`} data-token={cls.split(' ')[0]} data-testid={testid} role="button" tabIndex={0} {...p}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onTap(e.currentTarget as HTMLElement)
        }
      }}
    >
      {children}
    </span>
  )
}

function NumTok({ a, value, dim }: { a: ArgInfo; value: number; dim?: boolean }) {
  return (
    <Scrub
      value={value}
      dim={dim}
      hint={a.hint}
      label={labelOf(a)}
      testid={`num-${a.owner}-${a.refd && 'i' in a.refd ? a.refd.i : 'd'}`}
      onStart={() => select(a)}
      onChange={(v, ph) => setNumber(a, v, ph)}
      onTap={(el) => (select(a), openKeypad(el, a, value, defaultNumber(a.input)))}
      onLong={(el) => (select(a), openKindMenu(el, a))}
    />
  )
}

function FnTok({ a, v }: { a: ArgInfo; v: Extract<Value, { k: 'fn' }> }) {
  const l = fnLabel(v.src)
  return (
    <PressTok a={a} cls={`fn ${l.audio ? 'audio' : ''}`} testid="fn-chip" onTap={(el) => openFnEditor(el, a)}>
      <i class="mark">{l.audio ? '♪' : 'ƒ'}</i>
      <span class="txt">{l.text}</span>
      {l.audio && <Meter bin={l.audio.bin} scale={l.audio.scale} offset={l.audio.offset} vertical={false} />}
    </PressTok>
  )
}

function ArrTok({ a, v }: { a: ArgInfo; v: Extract<Value, { k: 'arr' }> }) {
  const vals = v.v
  const lo = Math.min(a.hint.min, ...vals)
  const hi = Math.max(a.hint.max, ...vals)
  const mods = Object.entries(v.mods ?? {})
  return (
    <PressTok a={a} cls="arr" testid="arr-chip" onTap={(el) => openArrEditor(el, a)}>
      <span class="spark" aria-hidden="true">
        {vals.slice(0, 12).map((x, i) => (
          <i key={i} style={{ height: `${Math.max(8, ((x - lo) / (hi - lo || 1)) * 100)}%` }} />
        ))}
      </span>
      <span class="txt">
        [{vals.slice(0, 4).map(fmt).join(' ')}
        {vals.length > 4 ? ' …' : ''}]
        {mods.length > 0 && <em>{mods.map(([k, x]) => (k === 'ease' ? `.${x}` : `.${k}(${typeof x === 'number' ? fmt(x) : x})`)).join('').slice(0, 24)}</em>}
      </span>
    </PressTok>
  )
}

function RefTok({ a, v }: { a: ArgInfo; v: Extract<Value, { k: 'ref' }> }) {
  return (
    <PressTok a={a} cls={`ref ${v.name.startsWith('o') ? 'out' : 'src'}`} testid="ref-chip" onTap={(el) => openRefPicker(el, a, v)}>
      {v.name}
    </PressTok>
  )
}

function VarTok({ a, v }: { a: ArgInfo; v: Extract<Value, { k: 'var' }> }) {
  const def = ctx.store.sketch.stmts.find((s) => s.k === 'def' && s.name === v.name)
  const before = defsBefore(ctx.store.sketch, a.stmtId).some((d) => d.name === v.name)
  return (
    <PressTok
      a={a}
      cls={`var ${def && before ? '' : 'bad'}`}
      testid="var-chip"
      onTap={() => {
        if (def) focusNode(def.id)
        else openKindMenu(document.querySelector(`[data-stmt="${a.stmtId}"]`) as HTMLElement, a)
      }}
    >
      <i class="mark">↪</i>
      {v.name}
    </PressTok>
  )
}

function JsTok({ a, v }: { a: ArgInfo; v: Extract<Value, { k: 'js' }> }) {
  return (
    <PressTok a={a} cls="js" testid="js-chip" onTap={(el) => openJsEditor(el, a)}>
      <span class="txt">{v.src.length > 22 ? v.src.slice(0, 21) + '…' : v.src}</span>
    </PressTok>
  )
}

function JsEditor({ a }: { a: ArgInfo }) {
  useStore()
  const v = getArg(ctx.store.sketch, a.refd)
  if (v?.k !== 'js') return <div class="empty">no longer JS</div>
  const n = evalNumeric(v.src)
  return (
    <div class="js-editor">
      <div class="ed-head">
        <span>{labelOf(a)}</span>
        <small>evaluated once</small>
      </div>
      <input
        class="expr"
        type="text"
        autocapitalize="off"
        autocorrect="off"
        autocomplete="off"
        spellcheck={false}
        value={v.src}
        aria-label="JavaScript expression"
        data-testid="js-input"
        onInput={(e) => setValue(a, { k: 'js', src: (e.currentTarget as HTMLInputElement).value }, `js:${refKey(a.refd)}`)}
      />
      {n !== undefined && (
        <button type="button" class="btn" onClick={() => setValue(a, num(n))}>
          Make it the number {fmt(n)}
        </button>
      )}
    </div>
  )
}

function VecTok({ a, v }: { a: ArgInfo; v: Extract<Value, { k: 'vec4' }> }) {
  return (
    <span class="tok vec" data-token="vec">
      <span class="p">[</span>
      {v.v.map((x, i) => (
        <Scrub
          key={i}
          value={x}
          hint={a.hint}
          label={`${labelOf(a)}[${i}]`}
          onStart={() => select(a)}
          onChange={(n, ph) => {
            if (ph === 'end') return ctx.store.endGroup()
            const cur = getArg(ctx.store.sketch, a.refd)
            if (cur?.k !== 'vec4') return
            const nv = cur.v.slice()
            nv[i] = n
            edit((s) => setArg(s, a.refd, { k: 'vec4', v: nv } as Value), { coalesce: `vec:${refKey(a.refd)}:${i}` })
          }}
          onTap={(el) => openKeypad(el, { ...a, liveKey: undefined, refd: a.refd }, x, 0)}
          onLong={(el) => openKindMenu(el, a)}
        />
      ))}
      <span class="p">]</span>
    </span>
  )
}

function TexMissing({ a }: { a: ArgInfo }) {
  return (
    <PressTok
      a={a}
      cls="texmissing"
      testid="tex-missing"
      onTap={(el) => openKindMenu(el, a)}
    >
      ＋ texture
    </PressTok>
  )
}

/** A texture argument as an inline pocket holding a nested stack, a smaller instance of the same component. */
function Pocket({ a, v }: { a: ArgInfo; v: Extract<Value, { k: 'tex' }> }) {
  const menu = useRef<HTMLButtonElement>(null)
  return (
    <span class="pocket" data-token-box="pocket" data-testid="pocket">
      <ChainView chain={v.chain} stmtId={a.stmtId} nested depth={a.depth + 1} />
      <button type="button" ref={menu} class="pocket-menu" aria-label="Texture options" data-testid="pocket-menu" onClick={(e) => openKindMenu(e.currentTarget as HTMLElement, a)}>
        ⇄
      </button>
    </span>
  )
}

export function ArgView({ value, a }: { value: Value | undefined; a: ArgInfo }) {
  const v = value ?? DEFAULT
  switch (v.k) {
    case 'num':
      return <NumTok a={a} value={v.v} />
    case 'default': {
      if (a.input?.type === 'sampler2D') return <TexMissing a={a} />
      if (a.input && a.input.type.startsWith('vec')) {
        const d = Array.isArray(a.input.default) ? a.input.default : [0, 0, 0, 0]
        return (
          <PressTok a={a} cls="vec dim" onTap={() => setValue(a, { k: 'vec4', v: d.slice() } as Value)}>
            [{d.map(fmt).join(' ')}]
          </PressTok>
        )
      }
      return <NumTok a={a} value={defaultNumber(a.input)} dim />
    }
    case 'fn':
      return <FnTok a={a} v={v} />
    case 'arr':
      return <ArrTok a={a} v={v} />
    case 'ref':
      return <RefTok a={a} v={v} />
    case 'var':
      return <VarTok a={a} v={v} />
    case 'js':
      return <JsTok a={a} v={v} />
    case 'vec4':
      return <VecTok a={a} v={v} />
    case 'tex':
      return <Pocket a={a} v={v} />
  }
}
