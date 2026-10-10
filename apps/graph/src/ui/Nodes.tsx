// The node cards. Every kind of statement and call has one: calls (with a row per input), outputs, sources, variables,
// modulators, comments (sticky notes), raw JS, settings, sources and render(). Ports are fixed offsets (see geom.ts) so the
// canvas can draw cables without measuring the DOM.
import { DEFAULT, OUT_NAMES, SOURCE_NAMES, newId, num, type DefStmt, type Hint, type Stmt, type Value } from '@hydra-ipad/core'
import { memo } from 'preact/compat'
import { useState } from 'preact/hooks'
import { applyGraph, graphOf, liveIdsFor, posOf, ui } from '../doc'
import { ctx, edit } from '../kit/ctx'
import { fmt, hasLiveSlot, NumSlider, toast } from '@hydra-ipad/kit'
import { openMenu } from '../kit/Menu'
import { defaultSpec, LFO_KINDS, MOD_ICON, MOD_LABEL, modToValue, valueToMod, type ModKind, type ModSpec } from '../kit/mods'
import { updateStmt } from '../kit/model'
import { RawEditor } from '../kit/raw'
import { Meter } from '../kit/Chrome'
import { outId, type GNode, type Port } from '../model'
import { setNodeArg, updateNode } from '../ops'
import { HEAD, ROW, sizeOf } from '../view'
import { openFnPicker } from './Palette'
import { PreviewSlot } from './Preview'

export const TYPE_LABEL: Record<string, string> = { src: 'Source', coord: 'Geometry', color: 'Color', combine: 'Blend', combineCoord: 'Modulate', unknown: 'Unknown', plugin: 'Plugin' }
export const TYPE_ICON: Record<string, string> = { src: '◉', coord: '⤢', color: '◐', combine: '⊕', combineCoord: '≈', unknown: '?', plugin: '✦' }

export function typeOf(fn: string): string {
  const d = ctx.catalog.get(fn)
  if (!d) return 'unknown'
  return d.type
}

export interface NodeProps {
  n: GNode
  x: number
  y: number
  selected: boolean
  /** ports that can take the cable being dragged: `${port}` */
  targets?: string
  dup: number
  error?: string
  shadowed?: boolean
  /** a live preview of the texture at this node is pinned */
  preview?: boolean
}

function Port({ node, port, dir, ok, cls = '' }: { node: string; port: Port | 'out'; dir: 'in' | 'out'; ok?: boolean; cls?: string }) {
  return <span class={`port ${dir} ${ok ? 'ok' : ''} ${cls}`} data-port="1" data-node={node} data-p={String(port)} data-dir={dir} aria-label={`${dir === 'out' ? 'output' : 'input'} ${port}`} />
}

// ---------------------------------------------------------------- number edits on call nodes (all copies follow)

export function setCallNum(nodeId: string, i: number, v: number, phase: 'drag' | 'end' | 'key'): void {
  if (phase === 'end') {
    ctx.store.endGroup()
    return
  }
  for (const id of liveIdsFor(nodeId, i)) ctx.runner.setLive(id, v)
  ctx.store.hold(`num:${nodeId}:${i}`)
  const g0 = graphOf()
  const g = { nodes: g0.nodes, edges: g0.edges }
  setNodeArg(g, nodeId, i, num(v))
  applyGraph(g, { coalesce: `num:${nodeId}:${i}` })
}

/** The live path for a call's number: every compiled copy of the node gets the value, no recompile. */
export function liveFor(nodeId: string, i: number): (v: number) => boolean {
  return (v) => {
    if (!hasLiveSlot(ctx.store.sketch, nodeId, i, ctx.catalog)) return false
    for (const id of liveIdsFor(nodeId, i)) ctx.runner.setLive(id, v)
    return true
  }
}

function setCallValue(nodeId: string, i: number, v: Value): void {
  const g0 = graphOf()
  const g = { nodes: g0.nodes, edges: g0.edges }
  setNodeArg(g, nodeId, i, v)
  applyGraph(g)
}

function promptText(title: string, value: string, apply: (s: string) => void): void {
  // a plain prompt keeps this simple and works with the iPad keyboard and Pencil Scribble
  const s = window.prompt(title, value)
  if (s !== null && s !== value) apply(s)
}

// ---------------------------------------------------------------- call node

function CallCard(p: NodeProps) {
  const { n } = p
  const call = n.call!
  const def = ctx.catalog.get(call.fn)
  const g = graphOf()
  const type = typeOf(call.fn)
  const plugin = def && def.origin.startsWith('plugin:')
  const rows = Math.max(def ? def.inputs.length : call.args.length, call.args.length)
  const wiredFrom = (i: number) => g.edges.find((e) => e.to === n.id && e.port === i)?.from
  const hasIn = def ? def.type !== 'src' : true
  const s = sizeOf(n, ctx.catalog)
  const targets = p.targets ? p.targets.split(',') : []
  return (
    <div
      class={`node call t-${type} ${plugin ? 'plugin' : ''} ${p.selected ? 'sel' : ''} ${n.bypassed ? 'bypassed' : ''} ${p.error ? 'err' : ''} ${p.shadowed ? 'shadowed' : ''} ${!def ? 'unknown' : ''}`}
      style={{ transform: `translate(${p.x}px,${p.y}px)`, width: `${s.w}px`, height: `${s.h}px` }}
      data-node={n.id}
      data-fn={call.fn}
      data-testid="node"
      data-kind="call"
    >
      <div class="nhead" data-drag="1">
        {hasIn && <Port node={n.id} port="in" dir="in" ok={targets.includes('in')} />}
        <span class="ticon" aria-hidden="true">{TYPE_ICON[plugin ? 'plugin' : type]}</span>
        <button
          type="button"
          class="fname"
          data-testid="fn-name"
          onClick={(e) => {
            e.stopPropagation()
            if (!def) return promptText('Function name', call.fn, (fn) => fn.trim() && applyGraph(updateNode(graphOf(), n.id, (x) => ({ ...x, call: { ...x.call!, fn: fn.trim() } }))))
            openFnPicker(e.currentTarget as HTMLElement, n.id)
          }}
        >
          {call.fn}
        </button>
        {p.dup > 1 && (
          <button type="button" class="badge dup" data-testid="dup-badge" title="written more than once in the code" onClick={(e) => (e.stopPropagation(), ui.select([n.id]))}>
            ×{p.dup}
          </button>
        )}
        {n.bypassed && <span class="badge byp">bypassed</span>}
        {p.shadowed && <span class="badge shadow" title="a later chain writes the same output">shadowed</span>}
        <Port node={n.id} port="out" dir="out" />
      </div>
      {p.preview && <PreviewSlot id={n.id} />}
      {p.error && <div class="nerr" role="alert">{p.error}</div>}
      <div class="nbody">
        {Array.from({ length: rows }, (_, i) => {
          const inp = def?.inputs[i]
          const a = call.args[i] ?? DEFAULT
          const from = wiredFrom(i)
          const fromNode = from ? g.nodes.find((x) => x.id === from) : undefined
          const label = inp?.name ?? `arg ${i}`
          const isTex = inp?.type === 'sampler2D'
          const ok = targets.includes(String(i))
          let body
          if (fromNode) {
            const what = fromNode.kind === 'mod' ? (MOD_LABEL[valueToMod(fromNode.value!)?.kind ?? 'expr'] ?? 'mod') : fromNode.kind === 'call' ? fromNode.call!.fn : fromNode.kind === 'def' ? (fromNode.stmt as DefStmt).name : fromNode.name
            body = (
              <span class="wired" data-testid="wired">
                <span class="nl">{label}</span>
                <span class="wfrom">← {what}</span>
              </span>
            )
          } else if (isTex) {
            body = (
              <span class="wired missing" data-testid="tex-missing">
                <span class="nl">{label}</span>
                <span class="wfrom">needs a texture</span>
              </span>
            )
          } else if (a.k === 'num' || a.k === 'default') {
            const d = typeof inp?.default === 'number' ? inp.default : 0
            const hint: Hint = def ? ctx.catalog.hint(call.fn, label) : { min: -1, max: Math.max(2, Math.abs(a.k === 'num' ? a.v : 1) * 4), step: 0.01 }
            body = <NumSlider label={label} value={a.k === 'num' ? a.v : d} def={inp ? d : undefined} dim={a.k === 'default'} hint={hint} testid={`num-${call.fn}-${i}`} onChange={(v, ph) => setCallNum(n.id, i, v, ph)} compact id={`graph:${n.id}:${i}`} live={liveFor(n.id, i)} arg={{ callId: n.id, index: i, fn: call.fn, input: inp?.name }} />
          } else if (a.k === 'vec4') {
            body = (
              <span class="vec">
                <span class="nl">{label}</span>
                {a.v.map((x, k) => (
                  <button type="button" class="vbit" key={k} onClick={(e) => (e.stopPropagation(), promptText(`${label}[${k}]`, fmt(x), (t) => isFinite(Number(t)) && setCallValue(n.id, i, { k: 'vec4', v: a.v.map((y, j) => (j === k ? Number(t) : y)) })))}>
                    {fmt(x)}
                  </button>
                ))}
              </span>
            )
          } else {
            const text = a.k === 'js' ? a.src : a.k === 'var' ? a.name : a.k === 'ref' ? a.name : JSON.stringify(a)
            body = (
              <button type="button" class="jsval" data-testid="js-value" onClick={(e) => (e.stopPropagation(), promptText(label, text, (t) => setCallValue(n.id, i, { k: 'js', src: t })))}>
                <span class="nl">{label}</span>
                <code>{text}</code>
              </button>
            )
          }
          return (
            <div class={`nrow ${isTex ? 'tex' : ''}`} key={i} style={{ height: `${ROW}px` }}>
              <Port node={n.id} port={i} dir="in" ok={ok} cls={isTex ? 'texp' : 'nump'} />
              {body}
            </div>
          )
        })}
        {!def && (
          <button type="button" class="addarg" onClick={(e) => (e.stopPropagation(), setCallValue(n.id, call.args.length, num(0)))}>
            ＋ argument
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- outputs, sources

function OutCard(p: NodeProps) {
  const { n } = p
  const g = graphOf()
  const writers = g.edges.filter((e) => e.to === n.id && e.port === 'in').length
  const readers = g.edges.filter((e) => e.from === n.id).length
  const s = sizeOf(n, ctx.catalog)
  const targets = p.targets ? p.targets.split(',') : []
  const used = writers + readers > 0
  return (
    <div class={`node out ${p.selected ? 'sel' : ''} ${used ? '' : 'unused'}`} style={{ transform: `translate(${p.x}px,${p.y}px)`, width: `${s.w}px`, height: `${s.h}px` }} data-node={n.id} data-testid="node" data-kind="out">
      <Port node={n.id} port="in" dir="in" ok={targets.includes('in')} />
      <div class="nhead" data-drag="1">
        <b>{n.name}</b>
        <small>output</small>
      </div>
      <div class="osub">{writers > 1 ? `${writers} writers, last wins` : writers ? 'written' : 'not written'}</div>
      <button
        type="button"
        class="btn sm render-btn"
        data-testid="render-out"
        onClick={(e) => {
          e.stopPropagation()
          setRender(n.name as string)
        }}
      >
        show
      </button>
      <Port node={n.id} port="out" dir="out" cls="read" />
    </div>
  )
}

export function setRender(target: string): void {
  const sk = ctx.store.sketch
  const renders = sk.stmts.filter((s) => s.k === 'render')
  const t = target as 'o0' | 'all'
  if (renders.length) {
    const last = renders[renders.length - 1]
    edit((s) => updateStmt(s, last.id, (x) => (x.k === 'render' ? { ...x, target: t } : x)))
  } else edit((s) => ({ ...s, stmts: [...s.stmts, { id: newId('s'), k: 'render', target: t } as Stmt] }))
  toast(target === 'all' ? 'Showing all four outputs' : `Showing ${target}`)
}

function SrcCard(p: NodeProps) {
  const { n } = p
  const sk = ctx.store.sketch
  const init = [...sk.stmts].reverse().find((s) => s.k === 'source' && s.slot === n.name)
  const s = sizeOf(n, ctx.catalog)
  return (
    <div class={`node srcn ${p.selected ? 'sel' : ''}`} style={{ transform: `translate(${p.x}px,${p.y}px)`, width: `${s.w}px`, height: `${s.h}px` }} data-node={n.id} data-testid="node" data-kind="src">
      <div class="nhead" data-drag="1">
        <b>{n.name}</b>
        <small>{init && init.k === 'source' ? init.init.kind : 'not set up'}</small>
      </div>
      <Port node={n.id} port="out" dir="out" />
    </div>
  )
}

// ---------------------------------------------------------------- modulators

const MOD_HINTS: Record<string, Hint> = {
  rate: { min: 0, max: 10, step: 0.01 },
  amp: { min: -4, max: 4, step: 0.01 },
  off: { min: -4, max: 4, step: 0.01 },
  bin: { min: 0, max: 15, step: 1, integer: true },
}

export function setModSpec(nodeId: string, spec: ModSpec, coalesce?: string): void {
  applyGraph(updateNode(graphOf(), nodeId, (x) => ({ ...x, value: modToValue(spec) })), { coalesce })
}

export function ModBody({ spec, set, id }: { spec: ModSpec; set: (s: ModSpec, coalesce?: string) => void; id: string }) {
  const k = spec.kind
  const sl = (key: 'rate' | 'amp' | 'off' | 'bin', label: string) => (
    <div class="nrow" style={{ height: `${ROW}px` }}>
      <NumSlider
        label={label}
        value={(spec[key] as number) ?? 0}
        hint={MOD_HINTS[key]}
        compact
        testid={`mod-${key}`}
        onChange={(v, ph) => (ph === 'end' ? ctx.store.endGroup() : set({ ...spec, [key]: v }, `mod:${id}:${key}`))}
      />
    </div>
  )
  if (k === 'expr')
    return (
      <div class="nbody">
        <button type="button" class="jsval tall" data-testid="mod-expr" onClick={(e) => (e.stopPropagation(), promptText('Expression (an arrow function)', spec.src ?? '', (t) => set({ ...spec, src: t })))}>
          <code>{spec.src}</code>
        </button>
      </div>
    )
  if (k === 'steps') return <StepStrip spec={spec} set={set} />
  return (
    <div class="nbody">
      {k === 'audio' && sl('bin', 'bin')}
      {(LFO_KINDS as string[]).includes(k) && sl('rate', 'rate')}
      {sl('amp', k === 'audio' || k === 'vol' ? 'scale' : k === 'time' ? 'speed' : 'amount')}
      {sl('off', 'offset')}
      {k === 'audio' && <Meter bin={spec.bin ?? 0} />}
      {k === 'vol' && <Meter bin={-1} />}
    </div>
  )
}

export function StepStrip({ spec, set }: { spec: ModSpec; set: (s: ModSpec, coalesce?: string) => void }) {
  const steps = spec.steps ?? [0]
  const max = Math.max(1, ...steps.map((x) => Math.abs(x)))
  const mods = spec.mods ?? {}
  return (
    <div class="nbody steps" data-testid="step-strip">
      <div class="bars">
        {steps.map((v, i) => (
          <button
            type="button"
            class="bar"
            key={i}
            data-testid="step"
            aria-label={`step ${i + 1}: ${fmt(v)}`}
            onClick={(e) => (e.stopPropagation(), promptText(`step ${i + 1}`, fmt(v), (t) => isFinite(Number(t)) && set({ ...spec, steps: steps.map((x, j) => (j === i ? Number(t) : x)) })))}
          >
            <i style={{ height: `${Math.round((Math.abs(v) / max) * 100)}%` }} />
            <small>{fmt(v)}</small>
          </button>
        ))}
      </div>
      <div class="steptools">
        <button type="button" class="btn sm" aria-label="remove a step" disabled={steps.length < 2} onClick={(e) => (e.stopPropagation(), set({ ...spec, steps: steps.slice(0, -1) }))}>
          −
        </button>
        <button type="button" class="btn sm" aria-label="add a step" data-testid="step-add" onClick={(e) => (e.stopPropagation(), set({ ...spec, steps: [...steps, steps[steps.length - 1] ?? 0] }))}>
          ＋
        </button>
        <button type="button" class={`btn sm ${mods.fast !== undefined ? 'on' : ''}`} data-testid="step-fast" onClick={(e) => (e.stopPropagation(), promptText('fast ×', String(mods.fast ?? 1), (t) => isFinite(Number(t)) && set({ ...spec, mods: { ...mods, fast: Number(t) } })))}>
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
      </div>
    </div>
  )
}

function ModCard(p: NodeProps) {
  const { n } = p
  const spec = valueToMod(n.value!) ?? defaultSpec('expr')
  const s = sizeOf(n, ctx.catalog)
  return (
    <div class={`node mod ${p.selected ? 'sel' : ''}`} style={{ transform: `translate(${p.x}px,${p.y}px)`, width: `${s.w}px`, height: `${s.h}px` }} data-node={n.id} data-testid="node" data-kind="mod" data-mod={spec.kind}>
      <div class="nhead" data-drag="1">
        <span class="ticon">{MOD_ICON[spec.kind]}</span>
        <button
          type="button"
          class="fname"
          data-testid="mod-kind"
          onClick={(e) => {
            e.stopPropagation()
            const kinds: ModKind[] = ['sine', 'saw', 'tri', 'square', 'rnd', 'time', 'mouseX', 'mouseY', 'audio', 'vol', 'steps', 'expr']
            openMenu(
              e.currentTarget as HTMLElement,
              kinds.map((k) => ({ label: `${MOD_ICON[k]} ${MOD_LABEL[k]}`, run: () => setModSpec(n.id, { ...defaultSpec(k, spec.off, Math.max(0.5, Math.abs(spec.amp) * 2)), ...(LFO_KINDS.includes(k) && LFO_KINDS.includes(spec.kind) ? { amp: spec.amp, off: spec.off } : {}) }) })),
              'Modulator',
            )
          }}
        >
          {MOD_LABEL[spec.kind]}
        </button>
        <Port node={n.id} port="out" dir="out" />
      </div>
      <ModBody spec={spec} id={n.id} set={(sp, c) => setModSpec(n.id, sp, c)} />
    </div>
  )
}

// ---------------------------------------------------------------- statements

function DefCard(p: NodeProps) {
  const { n } = p
  const st = n.stmt as DefStmt
  const s = sizeOf(n, ctx.catalog)
  const g = graphOf()
  const fed = g.edges.some((e) => e.to === n.id && e.port === 'in')
  const uses = g.edges.filter((e) => e.from === n.id).length
  const v = st.value
  const setValue = (value: Value, coalesce?: string) => edit((sk) => updateStmt(sk, st.id, (x) => (x.k === 'def' ? { ...x, value } : x)), { coalesce })
  const spec = valueToMod(v)
  const targets = p.targets ? p.targets.split(',') : []
  return (
    <div class={`node def ${p.selected ? 'sel' : ''}`} style={{ transform: `translate(${p.x}px,${p.y}px)`, width: `${s.w}px`, height: `${s.h}px` }} data-node={n.id} data-testid="node" data-kind="def">
      <div class="nhead" data-drag="1">
        {(fed || v.k === 'default' || v.k === 'tex' || v.k === 'var') && <Port node={n.id} port="in" dir="in" ok={targets.includes('in')} />}
        <span class="ticon">𝑥</span>
        <button
          type="button"
          class="fname"
          data-testid="def-name"
          onClick={(e) => (e.stopPropagation(), promptText('Variable name', st.name, (t) => /^[A-Za-z_$][\w$]*$/.test(t) && edit((sk) => updateStmt(sk, st.id, (x) => (x.k === 'def' ? { ...x, name: t } : x)))))}
        >
          {st.decl === 'bare' ? '' : `${st.decl} `}
          {st.name}
        </button>
        <span class="badge">used {uses}×</span>
        <Port node={n.id} port="out" dir="out" />
      </div>
      {!fed && v.k === 'num' && (
        <div class="nbody">
          <div class="nrow" style={{ height: `${ROW}px` }}>
            <NumSlider label="value" value={v.v} hint={{ min: Math.min(0, v.v * 2), max: Math.max(1, Math.abs(v.v) * 2), step: 0.01 }} compact testid="def-num" onChange={(x, ph) => (ph === 'end' ? ctx.store.endGroup() : setValue(num(x), `def:${st.id}`))} />
          </div>
        </div>
      )}
      {!fed && spec && v.k !== 'num' && <ModBody spec={spec} id={st.id} set={(sp, c) => setValue(modToValue(sp), c)} />}
      {!fed && (v.k === 'js' || v.k === 'ref' || v.k === 'vec4') && (
        <div class="nbody">
          <button type="button" class="jsval tall" onClick={(e) => (e.stopPropagation(), promptText(st.name, v.k === 'js' ? v.src : JSON.stringify(v), (t) => setValue({ k: 'js', src: t })))}>
            <code>{v.k === 'js' ? v.src : v.k === 'ref' ? v.name : `[${v.v.join(', ')}]`}</code>
          </button>
        </div>
      )}
    </div>
  )
}

function NoteCard(p: NodeProps) {
  const { n } = p
  const st = n.stmt as Extract<Stmt, { k: 'comment' }>
  const s = sizeOf(n, ctx.catalog)
  return (
    <div class={`node note ${p.selected ? 'sel' : ''}`} style={{ transform: `translate(${p.x}px,${p.y}px)`, width: `${s.w}px`, height: `${s.h}px` }} data-node={n.id} data-testid="node" data-kind="comment">
      <div class="nhead" data-drag="1">
        <small>{st.block ? '/* note */' : '// note'}</small>
      </div>
      <button type="button" class="notetext" data-testid="note-text" onClick={(e) => (e.stopPropagation(), promptText('Comment', st.text, (t) => edit((sk) => updateStmt(sk, st.id, (x) => (x.k === 'comment' ? { ...x, text: t } : x)))))}>
        {st.text}
      </button>
    </div>
  )
}

function RawCard(p: NodeProps) {
  const { n } = p
  const st = n.stmt as Extract<Stmt, { k: 'raw' }>
  const s = sizeOf(n, ctx.catalog)
  return (
    <div class={`node raw ${p.selected ? 'sel' : ''}`} style={{ transform: `translate(${p.x}px,${p.y}px)`, width: `${s.w}px`, height: `${s.h}px` }} data-node={n.id} data-testid="node" data-kind="raw">
      <div class="nhead" data-drag="1">
        <b>JS</b>
        <small>runs as written</small>
      </div>
      <RawEditor stmt={st} rows={8} />
    </div>
  )
}

function SetupCard(p: NodeProps) {
  const { n } = p
  const st = n.stmt!
  const s = sizeOf(n, ctx.catalog)
  const set = (f: (x: Stmt) => Stmt, coalesce?: string) => edit((sk) => updateStmt(sk, st.id, f), { coalesce })
  let body
  if (st.k === 'setting') {
    const hint: Hint = st.name === 'bpm' ? { min: 20, max: 300, step: 1, integer: true } : { min: 0, max: 4, step: 0.01 }
    body = <NumSlider label={st.name} value={st.v} hint={hint} compact testid={`setting-${st.name}`} onChange={(v, ph) => (ph === 'end' ? ctx.store.endGroup() : set((x) => (x.k === 'setting' ? { ...x, v } : x), `set:${st.id}`))} />
  } else if (st.k === 'render') {
    body = (
      <div class="seg small">
        {(['all', ...OUT_NAMES] as const).map((t) => (
          <button type="button" key={t} class={st.target === t ? 'on' : ''} onClick={(e) => (e.stopPropagation(), set((x) => (x.k === 'render' ? { ...x, target: t } : x)))}>
            {t === 'all' ? 'all' : t}
          </button>
        ))}
      </div>
    )
  } else if (st.k === 'source') {
    body = (
      <div class="srcbody">
        <div class="seg small">
          {SOURCE_NAMES.map((sl) => (
            <button type="button" key={sl} class={st.slot === sl ? 'on' : ''} onClick={(e) => (e.stopPropagation(), set((x) => (x.k === 'source' ? { ...x, slot: sl } : x)))}>
              {sl}
            </button>
          ))}
        </div>
        <div class="seg small">
          {(['cam', 'image', 'video', 'screen'] as const).map((k) => (
            <button type="button" key={k} class={st.init.kind === k ? 'on' : ''} onClick={(e) => (e.stopPropagation(), set((x) => (x.k === 'source' ? { ...x, init: { kind: k, ...(k === 'image' || k === 'video' ? { arg: x.init.arg ?? '' } : {}) } } : x)))}>
              {k}
            </button>
          ))}
        </div>
        {(st.init.kind === 'image' || st.init.kind === 'video') && (
          <button type="button" class="jsval" onClick={(e) => (e.stopPropagation(), promptText('URL', st.init.arg ?? '', (t) => set((x) => (x.k === 'source' ? { ...x, init: { ...x.init, arg: t, argsSrc: undefined } } : x))))}>
            <code>{st.init.argsSrc ?? st.init.arg ?? 'url…'}</code>
          </button>
        )}
      </div>
    )
  }
  return (
    <div class={`node setup ${p.selected ? 'sel' : ''}`} style={{ transform: `translate(${p.x}px,${p.y}px)`, width: `${s.w}px`, height: `${s.h}px` }} data-node={n.id} data-testid="node" data-kind={st.k}>
      <div class="nhead" data-drag="1">
        <b>{st.k === 'setting' ? st.name : st.k === 'render' ? 'render' : 'source'}</b>
        <small>setup</small>
      </div>
      <div class="nbody pad">{body}</div>
    </div>
  )
}

function NodeCardImpl(p: NodeProps) {
  switch (p.n.kind) {
    case 'call': return <CallCard {...p} />
    case 'out': return <OutCard {...p} />
    case 'src': return <SrcCard {...p} />
    case 'mod': return <ModCard {...p} />
    case 'def': return <DefCard {...p} />
    case 'comment': return <NoteCard {...p} />
    case 'raw': return <RawCard {...p} />
    default: return <SetupCard {...p} />
  }
}
export const NodeCard = memo(NodeCardImpl)

// ---------------------------------------------------------------- not-rendered terminal

export function Terminal({ end, x, y }: { end: string; x: number; y: number }) {
  const [busy, setBusy] = useState(false)
  const g = graphOf()
  const free = OUT_NAMES.find((o) => !g.edges.some((e) => e.to === outId(o) && e.port === 'in')) ?? 'o0'
  return (
    <div class="term" style={{ transform: `translate(${x}px,${y}px)` }} data-testid="terminal" data-end={end}>
      <small>not rendered</small>
      <button
        type="button"
        class="btn sm"
        data-testid="term-send"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          setBusy(true)
          const g2 = { nodes: g.nodes, edges: [...g.edges, { from: end, to: outId(free), port: 'in' as const }] }
          applyGraph(g2)
        }}
      >
        → {free}
      </button>
    </div>
  )
}

/** First input row a modulator can go into (for drops on a node body). */
export function firstNumberPort(n: GNode): number | undefined {
  if (n.kind !== 'call') return undefined
  const ins = ctx.catalog.inputs(n.call!.fn)
  const g = graphOf()
  for (let i = 0; i < ins.length; i++) if (ins[i].type === 'float' && !g.edges.some((e) => e.to === n.id && e.port === i)) return i
  return undefined
}

export { HEAD, posOf }
