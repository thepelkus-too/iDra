// The blocks. Every statement is a script on the workspace: a chain is a hat (the generator), stack blocks (one per call) and a
// cap (`show on o0`); a def is "set name to ⟨value⟩"; comments are bubbles; settings, sources and render() are setup blocks;
// raw statements are "advanced JS" blocks. Inputs are round slots (numbers and reporters) or square sockets (textures: a
// whole stack, an output, a source or a variable). Row heights come from view.ts so the layout is exact.
//
// Each draggable part carries a payload (drag.ts) and each place that takes something carries `data-drop`.
import { DEFAULT, OUT_NAMES, SOURCE_NAMES, num, type Call, type Chain, type Hint, type InputDef, type Stmt, type Value } from '@hydra-ipad/core'
import type { JSX } from 'preact'
import { setValue, ui } from '../doc'
import { pressToDrag, refAttr, type Payload } from '../drag'
import { ctx, edit } from '../kit/ctx'
import { fmt, NumSlider } from '@hydra-ipad/kit'
import { Meter } from '../kit/Chrome'
import { openMenu } from '../kit/Menu'
import { LFO_KINDS, MOD_ICON, MOD_LABEL, modToValue, valueToMod, type ModSpec } from '../kit/mods'
import { renameDef, setArg, setOut, updateCall, updateStmt, type ArgRef } from '../kit/model'
import { RawEditor } from '../kit/raw'
import { OP_LABEL, setAt, srcToMath, mathToSrc, type MathNode, type MathPath } from '../math'
import { CAP_H, HAT_H, rowH, scriptSize, socketH, type LooseStack } from '../view'

export const TYPE_LABEL: Record<string, string> = { src: 'Source', coord: 'Geometry', color: 'Color', combine: 'Blend', combineCoord: 'Modulate', unknown: 'Unknown', plugin: 'Plugin' }
export const TYPE_ICON: Record<string, string> = { src: '◉', coord: '⤢', color: '◐', combine: '⊕', combineCoord: '≈', unknown: '?', plugin: '✦' }

export function typeOf(fn: string): string {
  const d = ctx.catalog.get(fn)
  if (!d) return 'unknown'
  return d.origin.startsWith('plugin:') ? 'plugin' : d.type
}

export function promptText(title: string, value: string, apply: (s: string) => void): void {
  // a plain prompt works with the iPad keyboard and Pencil Scribble
  const s = window.prompt(title, value)
  if (s !== null && s !== value) apply(s)
}

/** what the renderer needs to know about the sketch as a whole */
export interface Look {
  sel?: string
  /** statements whose output a later script overwrites */
  shadowed: Set<string>
  /** call or statement id → error message */
  errors: Record<string, string>
}

const numEnd = (ph: 'drag' | 'end' | 'key') => ph === 'end' && (ctx.store.endGroup(), true)

// ---------------------------------------------------------------- scripts

export function Script({ s, x, y, collapsed, look }: { s: Stmt; x: number; y: number; collapsed: boolean; look: Look }) {
  const style = { transform: `translate(${x}px,${y}px)` }
  const sel = look.sel === s.id
  const err = look.errors[s.id]
  switch (s.k) {
    case 'chain':
      return (
        <div class={`script chain ${s.chain.out === null ? 'unplugged' : ''} ${look.shadowed.has(s.id) ? 'shadowed' : ''} ${collapsed ? 'folded' : ''}`} style={style} data-stmt={s.id} data-testid="script" data-kind="chain">
          {look.shadowed.has(s.id) && <span class="badge shadow" title="a later script shows on the same output">shadowed</span>}
          {collapsed ? <FoldedHat chain={s.chain} stmtId={s.id} look={look} /> : <Stack chain={s.chain} top stmtId={s.id} look={look} />}
          <Cap stmtId={s.id} chain={s.chain} />
        </div>
      )
    case 'def':
      return <DefBlock s={s} style={style} sel={sel} look={look} />
    case 'comment':
      return (
        <div class={`script bubble ${sel ? 'sel' : ''}`} style={{ ...style, ...box(s) }} data-stmt={s.id} data-testid="script" data-kind="comment" onPointerDown={drag(() => ({ t: 'script', stmtId: s.id }), () => ui.select(s.id))}>
          <button type="button" class="bubtext" data-testid="comment-text" onClick={(e) => (e.stopPropagation(), promptText('Comment', s.text, (t) => edit((sk) => updateStmt(sk, s.id, (x) => (x.k === 'comment' ? { ...x, text: t } : x)))))}>
            {s.text}
          </button>
        </div>
      )
    case 'raw':
      return (
        <div class={`script rawblk ${sel ? 'sel' : ''} ${err ? 'err' : ''}`} style={{ ...style, ...box(s) }} data-stmt={s.id} data-testid="script" data-kind="raw" onPointerDown={drag(() => ({ t: 'script', stmtId: s.id }), () => ui.select(s.id))}>
          <div class="bhead">
            <span class="ticon">{'{ }'}</span>
            <b>advanced JS</b>
            <small>runs as written</small>
          </div>
          <RawEditor stmt={s} rows={8} />
        </div>
      )
    default:
      return <SetupBlock s={s} style={style} sel={sel} />
  }
}

const box = (s: Stmt) => {
  const z = scriptSize(s, ctx.catalog)
  return { width: `${z.w}px`, height: `${z.h}px` }
}
const drag = (p: () => Payload | undefined, tap?: () => void) => pressToDrag(p, tap) as unknown as JSX.PointerEventHandler<HTMLElement>

// ---------------------------------------------------------------- stacks (a chain: hat + blocks)

export function Stack({ chain, top, stmtId, socket, look }: { chain: Chain; top: boolean; stmtId: string; socket?: ArgRef; look: Look }) {
  return (
    <div class="stack" data-chain={chain.id}>
      <Block call={chain.gen} index={-1} chain={chain} top={top} stmtId={stmtId} socket={socket} look={look} />
      {chain.mods.map((m, i) => (
        <Block key={m.id} call={m} index={i} chain={chain} top={top} stmtId={stmtId} look={look} />
      ))}
    </div>
  )
}

function FoldedHat({ chain, stmtId, look }: { chain: Chain; stmtId: string; look: Look }) {
  const type = typeOf(chain.gen.fn)
  return (
    <div
      class={`block hat t-${type} ${look.sel === chain.gen.id ? 'sel' : ''}`}
      style={{ height: `${HAT_H}px` }}
      data-drop="after"
      data-chain={chain.id}
      data-index={-1}
      data-top="1"
      data-stmt={stmtId}
      data-testid="block"
      data-fn={chain.gen.fn}
      onPointerDown={drag(() => ({ t: 'script', stmtId }), () => ui.select(chain.gen.id, stmtId))}
    >
      <span class="ticon">{TYPE_ICON[type]}</span>
      <b class="fname">{chain.gen.fn}</b>
      <span class="folded-n">
        … {chain.mods.length} block{chain.mods.length === 1 ? '' : 's'}
      </span>
      <button type="button" class="btn sm" data-testid="unfold" onClick={(e) => (e.stopPropagation(), toggleFold(stmtId))}>
        unfold
      </button>
    </div>
  )
}

export function toggleFold(stmtId: string): void {
  const m = ctx.store.sketch.meta?.blocks as { collapsed?: string[] } | undefined
  const c = m?.collapsed ?? []
  ctx.store.setView({ collapsed: c.includes(stmtId) ? c.filter((x) => x !== stmtId) : [...c, stmtId] })
}

function Block({ call, index, chain, top, stmtId, socket, look }: { call: Call; index: number; chain: Chain; top: boolean; stmtId: string; socket?: ArgRef; look: Look }) {
  const hat = index < 0
  const def = ctx.catalog.get(call.fn)
  const type = typeOf(call.fn)
  const inputs = def?.inputs ?? []
  const n = Math.max(inputs.length, call.args.length)
  const payload = (): Payload | undefined => {
    if (!hat) return { t: 'stack', chainId: chain.id, from: index, calls: chain.mods.slice(index) }
    if (top) return { t: 'script', stmtId }
    if (socket) return { t: 'nested', from: socket }
    return undefined
  }
  return (
    <div
      class={`block ${hat ? 'hat' : 'stk'} t-${type} ${look.sel === call.id ? 'sel' : ''} ${look.errors[call.id] ? 'err' : ''} ${!def ? 'unknown' : ''}`}
      style={{ height: `${rowH(call, hat, ctx.catalog)}px` }}
      data-drop="after"
      data-chain={chain.id}
      data-index={index}
      data-top={top ? '1' : '0'}
      data-stmt={top ? stmtId : undefined}
      data-call={call.id}
      data-fn={call.fn}
      data-testid="block"
      title={look.errors[call.id]}
      onPointerDown={drag(payload, () => ui.select(call.id, stmtId))}
    >
      <span class="ticon" aria-label={TYPE_LABEL[type]}>
        {TYPE_ICON[type]}
      </span>
      {def ? (
        <b class="fname">{call.fn}</b>
      ) : (
        <button type="button" class="fname unknown-name" data-testid="unknown-name" title="not in the catalog (a plugin that has not loaded?)" onClick={(e) => (e.stopPropagation(), promptText('Function name', call.fn, (fn) => fn.trim() && edit((sk) => updateCall(sk, call.id, (c) => ({ ...c, fn: fn.trim() })))))}>
          {call.fn} ?
        </button>
      )}
      {Array.from({ length: n }, (_, i) => (
        <Arg key={i} call={call} i={i} inp={inputs[i]} look={look} stmtId={stmtId} />
      ))}
      {!def && (
        <button type="button" class="btn sm addarg" onClick={(e) => (e.stopPropagation(), edit((sk) => setArg(sk, { call: call.id, i: call.args.length }, num(0))))}>
          ＋
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- inputs

function Arg({ call, i, inp, look, stmtId }: { call: Call; i: number; inp?: InputDef; look: Look; stmtId: string }) {
  const ref: ArgRef = { call: call.id, i }
  const v = call.args[i] ?? DEFAULT
  const label = inp?.name ?? `arg ${i}`
  if (inp?.type === 'sampler2D' || v.k === 'tex') return <Socket refr={ref} v={v} label={label} look={look} stmtId={stmtId} />
  const d = typeof inp?.default === 'number' ? inp.default : 0
  const hint: Hint = inp ? ctx.catalog.hint(call.fn, label) : { min: -1, max: Math.max(2, Math.abs(v.k === 'num' ? v.v : 1) * 4), step: 0.01 }
  return <Slot refr={ref} v={v} label={label} def={inp ? d : undefined} hint={hint} />
}

/** A round slot: a number, or a reporter dropped into it. */
export function Slot({ refr, v, label, def, hint }: { refr: ArgRef; v: Value; label: string; def?: number; hint: Hint }) {
  const key = refAttr(refr)
  let body
  if (v.k === 'num' || v.k === 'default') {
    body = <NumSlider label={label} value={v.k === 'num' ? v.v : (def ?? 0)} def={def} dim={v.k === 'default'} hint={hint} testid={`num-${key}`} compact onChange={(x, ph) => numEnd(ph) || setValue(refr, num(x), `num:${key}`)} />
  } else {
    body = (
      <>
        <span class="nl">{label}</span>
        <Reporter refr={refr} v={v} />
      </>
    )
  }
  return (
    <span class="slot" data-drop="slot" data-ref={key} data-testid="slot">
      {body}
    </span>
  )
}

/** A square socket: takes a stack (hat + blocks), an output, a source or a variable. */
function Socket({ refr, v, label, look, stmtId }: { refr: ArgRef; v: Value; label: string; look: Look; stmtId: string }) {
  const key = refAttr(refr)
  let body
  if (v.k === 'tex') body = <Stack chain={v.chain} top={false} stmtId={stmtId} socket={refr} look={look} />
  else if (v.k === 'default') body = <span class="empty-socket">drop a picture here</span>
  else body = <Reporter refr={refr} v={v} />
  return (
    <span class="socket" data-drop="socket" data-ref={key} data-testid="socket" style={{ minHeight: `${socketH(v, ctx.catalog)}px`, padding: v.k === 'tex' ? undefined : '0 8px' }}>
      <span class="slabel">{label}</span>
      {body}
    </span>
  )
}

// ---------------------------------------------------------------- reporters

function Reporter({ refr, v }: { refr: ArgRef; v: Value }) {
  const take = drag(() => ({ t: 'value', from: refr, value: v }))
  const spec = valueToMod(v)
  if (v.k === 'ref' || v.k === 'var') {
    const isOut = v.k === 'ref' && /^o\d$/.test(v.name)
    return (
      <span class={`rep ${v.k === 'var' ? 'r-var' : isOut ? 'r-out' : 'r-src'}`} data-testid="reporter" data-rep={v.name} onPointerDown={take}>
        {v.k === 'var' ? '𝑥 ' : isOut ? '▣ ' : '◎ '}
        {v.name}
      </span>
    )
  }
  // math first: `() => time * 0.5` is both a math reporter and a time modulator, and it was written by the math blocks
  if (v.k === 'fn') {
    const tree = srcToMath(v.src)
    if (tree) return <MathRep refr={refr} tree={tree} take={take} />
  }
  if (spec && spec.kind === 'steps') return <Pattern refr={refr} spec={spec} take={take} />
  if (spec && spec.kind !== 'expr') return <Wave refr={refr} spec={spec} take={take} />
  const text = v.k === 'fn' || v.k === 'js' ? v.src : v.k === 'vec4' || v.k === 'arr' ? `[${v.v.join(', ')}]` : JSON.stringify(v)
  return (
    <span class="rep r-js" data-testid="reporter" data-rep="js" onPointerDown={take}>
      <span class="ticon">ƒ</span>
      <button type="button" class="jstext" data-testid="js-text" onClick={(e) => (e.stopPropagation(), promptText('JavaScript', text, (t) => setValue(refr, v.k === 'fn' && t.trim().startsWith('(') ? { k: 'fn', src: t } : { k: 'js', src: t })))}>
        {text}
      </button>
    </span>
  )
}

const MOD_HINTS: Record<string, Hint> = {
  rate: { min: 0, max: 10, step: 0.01 },
  amp: { min: -4, max: 4, step: 0.01 },
  off: { min: -4, max: 4, step: 0.01 },
  bin: { min: 0, max: 15, step: 1, integer: true },
}

function Wave({ refr, spec, take }: { refr: ArgRef; spec: ModSpec; take: JSX.PointerEventHandler<HTMLElement> }) {
  const k = spec.kind
  const key = refAttr(refr)
  const set = (patch: Partial<ModSpec>, ph: 'drag' | 'end' | 'key', part: string) => numEnd(ph) || setValue(refr, modToValue({ ...spec, ...patch }), `mod:${key}:${part}`)
  const sl = (part: 'rate' | 'amp' | 'off' | 'bin', label: string) => <NumSlider label={label} value={(spec[part] as number) ?? 0} hint={MOD_HINTS[part]} compact testid={`wave-${part}`} onChange={(x, ph) => set({ [part]: x }, ph, part)} />
  return (
    <span class={`rep r-wave k-${k}`} data-testid="reporter" data-rep={k} onPointerDown={take}>
      <span class="rname">
        {MOD_ICON[k]} {k === 'sine' ? 'sine wave' : k === 'audio' ? 'audio bin' : MOD_LABEL[k].toLowerCase()}
      </span>
      {k === 'audio' && sl('bin', 'bin')}
      {(LFO_KINDS as string[]).includes(k) && sl('rate', 'freq')}
      {sl('amp', k === 'audio' || k === 'vol' ? 'scale' : k === 'time' ? 'speed' : 'amount')}
      {sl('off', 'offset')}
      {k === 'audio' && <Meter bin={spec.bin ?? 0} />}
      {k === 'vol' && <Meter bin={-1} />}
    </span>
  )
}

/** A step sequencer in a pill: tap a step to type it, drag it up or down to set it; ± steps, speed ×, smooth. */
function Pattern({ refr, spec, take }: { refr: ArgRef; spec: ModSpec; take: JSX.PointerEventHandler<HTMLElement> }) {
  const steps = spec.steps ?? [0]
  const mods = spec.mods ?? {}
  const max = Math.max(1, ...steps.map((x) => Math.abs(x)))
  const key = refAttr(refr)
  const set = (s: ModSpec, coalesce?: string) => setValue(refr, modToValue(s), coalesce)
  return (
    <span class="rep r-pattern" data-testid="reporter" data-rep="steps" onPointerDown={take}>
      <span class="rname">▥ pattern</span>
      <span class="bars">
        {steps.map((v, i) => (
          <span
            class="bar"
            key={i}
            role="button"
            data-testid="step"
            aria-label={`step ${i + 1}: ${fmt(v)}`}
            onPointerDown={(e) => {
              e.stopPropagation()
              const el = e.currentTarget as HTMLElement
              el.setPointerCapture?.(e.pointerId)
              const y0 = e.clientY
              let moved = false
              const move = (ev: PointerEvent) => {
                const dy = y0 - ev.clientY
                if (!moved && Math.abs(dy) < 6) return
                moved = true
                const nv = +(v + (dy / 40) * Math.max(1, max / 2)).toFixed(2)
                set({ ...spec, steps: steps.map((x, j) => (j === i ? nv : x)) }, `steps:${key}:${i}`)
              }
              const up = () => {
                el.removeEventListener('pointermove', move)
                el.removeEventListener('pointerup', up)
                el.removeEventListener('pointercancel', up)
                if (moved) return void ctx.store.endGroup()
                promptText(`step ${i + 1}`, fmt(v), (t) => isFinite(Number(t)) && set({ ...spec, steps: steps.map((x, j) => (j === i ? Number(t) : x)) }))
              }
              el.addEventListener('pointermove', move)
              el.addEventListener('pointerup', up)
              el.addEventListener('pointercancel', up)
            }}
          >
            <i style={{ height: `${Math.round((Math.abs(v) / max) * 100)}%` }} />
            <small>{fmt(v)}</small>
          </span>
        ))}
      </span>
      <button type="button" class="btn sm" aria-label="remove a step" disabled={steps.length < 2} onClick={(e) => (e.stopPropagation(), set({ ...spec, steps: steps.slice(0, -1) }))}>
        −
      </button>
      <button type="button" class="btn sm" aria-label="add a step" data-testid="step-add" onClick={(e) => (e.stopPropagation(), set({ ...spec, steps: [...steps, steps[steps.length - 1] ?? 0] }))}>
        ＋
      </button>
      <button type="button" class={`btn sm ${mods.fast !== undefined ? 'on' : ''}`} data-testid="step-fast" onClick={(e) => (e.stopPropagation(), promptText('speed ×', String(mods.fast ?? 1), (t) => isFinite(Number(t)) && set({ ...spec, mods: { ...mods, fast: Number(t) } })))}>
        ×{mods.fast ?? 1}
      </button>
      <button
        type="button"
        class={`btn sm ${mods.smooth !== undefined ? 'on' : ''}`}
        data-testid="step-smooth"
        onClick={(e) => {
          e.stopPropagation()
          const m = { ...mods }
          if (m.smooth !== undefined) delete m.smooth
          else m.smooth = 1
          set({ ...spec, mods: m })
        }}
      >
        smooth
      </button>
    </span>
  )
}

/** Nested math reporters: every part is a hole that takes another reporter. */
function MathRep({ refr, tree, take }: { refr: ArgRef; tree: MathNode; take: JSX.PointerEventHandler<HTMLElement> }) {
  const key = refAttr(refr)
  const put = (path: MathPath, n: MathNode, coalesce?: string) => setValue(refr, { k: 'fn', src: mathToSrc(setAt(tree, path, n)) }, coalesce)
  const part = (n: MathNode, path: MathPath): JSX.Element => {
    const hole = { 'data-drop': 'math', 'data-ref': key, 'data-path': path.join('') }
    switch (n.t) {
      case 'num':
        return (
          <span class="mhole" {...hole}>
            <NumSlider label="" value={n.v} hint={{ min: -4, max: 4, step: 0.01 }} compact testid={`math-num-${path.join('')}`} onChange={(x, ph) => numEnd(ph) || put(path, { t: 'num', v: x }, `math:${key}:${path.join('')}`)} />
          </span>
        )
      case 'time':
      case 'mouseX':
      case 'mouseY':
      case 'random':
        return (
          <span class="mhole leaf" {...hole}>
            {n.t === 'time' ? 'time' : n.t === 'mouseX' ? 'mouse x' : n.t === 'mouseY' ? 'mouse y' : 'random'}
          </span>
        )
      case 'fn':
        return (
          <span class="mhole mfn" {...hole}>
            {n.fn} ( {part(n.a, [...path, 'a'])} )
          </span>
        )
      case 'op':
        return (
          <span class="mhole mop" {...hole}>
            ( {part(n.a, [...path, 'a'])} {OP_LABEL[n.op]} {part(n.b, [...path, 'b'])} )
          </span>
        )
    }
  }
  return (
    <span class="rep r-math" data-testid="reporter" data-rep="math" onPointerDown={take}>
      {part(tree, [])}
    </span>
  )
}

// ---------------------------------------------------------------- cap: `.out()`

function Cap({ stmtId, chain }: { stmtId: string; chain: Chain }) {
  const last = chain.mods.length - 1
  const target = { 'data-drop': 'after', 'data-chain': chain.id, 'data-index': last, 'data-top': '1', 'data-stmt': stmtId }
  if (chain.out === null)
    return (
      <div class="cap open" style={{ height: `${CAP_H}px` }} {...target} data-testid="cap" data-out="none">
        <span class="nr">not rendered</span>
        <button type="button" class="btn sm" data-testid="show-o0" onClick={(e) => (e.stopPropagation(), edit((sk) => setOut(sk, chain.id, 'o0')))}>
          show on o0
        </button>
      </div>
    )
  const out = chain.out ?? 'o0'
  return (
    <div class="cap" style={{ height: `${CAP_H}px` }} {...target} data-testid="cap" data-out={out}>
      <span>show on</span>
      <button
        type="button"
        class="btn sm outpick"
        data-testid="out-pick"
        onClick={(e) => {
          e.stopPropagation()
          openMenu(
            e.currentTarget as HTMLElement,
            [...OUT_NAMES.map((o) => ({ label: o, run: () => edit((sk) => setOut(sk, chain.id, o)), testid: `out-${o}` })), { label: 'unplug (not rendered)', run: () => edit((sk) => setOut(sk, chain.id, null)), testid: 'out-none' }],
            'Show on',
            200,
          )
        }}
      >
        {out} ▾
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- set [name] to ⟨value⟩

function DefBlock({ s, style, sel, look }: { s: Extract<Stmt, { k: 'def' }>; style: Record<string, string>; sel: boolean; look: Look }) {
  const z = scriptSize(s, ctx.catalog)
  const ref: ArgRef = { def: s.id }
  const v = s.value
  const tex = v.k === 'tex' || v.k === 'ref'
  return (
    <div class={`script defblk ${sel ? 'sel' : ''}`} style={{ ...style, minWidth: `${z.w}px`, height: `${z.h}px` }} data-stmt={s.id} data-testid="script" data-kind="def" onPointerDown={drag(() => ({ t: 'script', stmtId: s.id }), () => ui.select(s.id))}>
      <span class="ticon">𝑥</span>
      <span>set</span>
      <button type="button" class="btn sm defname" data-testid="def-name" onClick={(e) => (e.stopPropagation(), promptText('Variable name', s.name, (t) => /^[A-Za-z_$][\w$]*$/.test(t) && edit((sk) => renameDef(sk, s.id, t))))}>
        {s.name}
      </button>
      <span>to</span>
      {tex ? <Socket refr={ref} v={v} label="" look={look} stmtId={s.id} /> : <Slot refr={ref} v={v} label="" hint={{ min: Math.min(0, v.k === 'num' ? v.v * 2 : 0), max: Math.max(1, Math.abs(v.k === 'num' ? v.v : 1) * 2), step: 0.01 }} />}
    </div>
  )
}

// ---------------------------------------------------------------- setup blocks

function SetupBlock({ s, style, sel }: { s: Stmt; style: Record<string, string>; sel: boolean }) {
  const set = (f: (x: Stmt) => Stmt, coalesce?: string) => edit((sk) => updateStmt(sk, s.id, f), { coalesce })
  let body
  if (s.k === 'setting') {
    const hint: Hint = s.name === 'bpm' ? { min: 20, max: 300, step: 1, integer: true } : { min: 0, max: 4, step: 0.01 }
    body = (
      <>
        <b>{s.name}</b>
        <span class="slot">
          <NumSlider label={s.name} value={s.v} hint={hint} compact testid={`setting-${s.name}`} onChange={(v, ph) => numEnd(ph) || set((x) => (x.k === 'setting' ? { ...x, v } : x), `set:${s.id}`)} />
        </span>
      </>
    )
  } else if (s.k === 'render') {
    body = (
      <>
        <b>show</b>
        <button
          type="button"
          class="btn sm"
          data-testid="render-pick"
          onClick={(e) => (e.stopPropagation(), openMenu(e.currentTarget as HTMLElement, (['all', ...OUT_NAMES] as const).map((t) => ({ label: t === 'all' ? 'all outputs' : t, run: () => set((x) => (x.k === 'render' ? { ...x, target: t } : x)) })), 'Show', 200))}
        >
          {s.target === 'all' ? 'all outputs' : s.target} ▾
        </button>
      </>
    )
  } else if (s.k === 'source') {
    const kinds = ['cam', 'image', 'video', 'screen'] as const
    body = (
      <>
        <button type="button" class="btn sm" data-testid="src-kind" onClick={(e) => (e.stopPropagation(), openMenu(e.currentTarget as HTMLElement, kinds.map((k) => ({ label: k === 'cam' ? 'camera' : k, run: () => set((x) => (x.k === 'source' ? { ...x, init: { kind: k, ...(k === 'image' || k === 'video' ? { arg: x.init.arg ?? '' } : {}) } } : x)) })), 'Source', 200))}>
          {s.init.kind === 'cam' ? 'camera' : s.init.kind} ▾
        </button>
        {(s.init.kind === 'image' || s.init.kind === 'video') && (
          <button type="button" class="jsval" data-testid="src-url" onClick={(e) => (e.stopPropagation(), promptText('URL', s.init.arg ?? '', (t) => set((x) => (x.k === 'source' ? { ...x, init: { ...x.init, arg: t, argsSrc: undefined } } : x))))}>
            <code>{s.init.argsSrc ?? s.init.arg ?? 'url…'}</code>
          </button>
        )}
        <span>→</span>
        <button type="button" class="btn sm" data-testid="src-slot" onClick={(e) => (e.stopPropagation(), openMenu(e.currentTarget as HTMLElement, SOURCE_NAMES.map((sl) => ({ label: sl, run: () => set((x) => (x.k === 'source' ? { ...x, slot: sl } : x)) })), 'Into', 200))}>
          {s.slot} ▾
        </button>
      </>
    )
  } else {
    body = <code>{JSON.stringify(s)}</code>
  }
  const z = scriptSize(s, ctx.catalog)
  return (
    <div class={`script setup ${sel ? 'sel' : ''}`} style={{ ...style, minWidth: `${z.w}px`, height: `${z.h}px` }} data-stmt={s.id} data-testid="script" data-kind={s.k} onPointerDown={drag(() => ({ t: 'script', stmtId: s.id }), () => ui.select(s.id))}>
      <span class="ticon">⚙</span>
      {body}
    </div>
  )
}

// ---------------------------------------------------------------- loose blocks (dragged off, not in the code)

export function Loose({ l }: { l: LooseStack }) {
  return (
    <div class="script loose" style={{ transform: `translate(${l.x}px,${l.y}px)` }} data-testid="loose" data-loose={l.id} onPointerDown={drag(() => ({ t: 'loose', id: l.id }))}>
      <span class="loose-tag">not in the code: snap under a script</span>
      {l.calls.map((c) => {
        const type = typeOf(c.fn)
        return (
          <div key={c.id} class={`block stk t-${type}`} style={{ height: `${rowH(c, false, ctx.catalog)}px` }}>
            <span class="ticon">{TYPE_ICON[type]}</span>
            <b class="fname">{c.fn}</b>
            <span class="argtext">{c.args.map((a) => (a.k === 'num' ? fmt(a.v) : a.k === 'default' ? '·' : a.k === 'tex' ? '▢' : '…')).join(', ')}</span>
          </div>
        )
      })}
    </div>
  )
}
