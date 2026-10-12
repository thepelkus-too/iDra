// A module is one Hydra call: a title bar (tap the name to swap the function, keeping inputs whose names match; the `//`
// switch; dice; ⋯), a small preview of the chain up to here, and a panel of controls generated from the catalog. Texture
// inputs are patch jacks that take a lane, a source, a picture variable or a mini-module (a nested chain that opens in
// place into a sub-rack, two levels deep at most). A switched-off module stays where it is, greyed out, knobs working.
import { canDisable, makeChain, tex, type Call, type Chain, type FnDef, type FnType, type InputDef, type Value } from '@hydra-ipad/core'
import { useEffect, useRef } from 'preact/hooks'
import { commit, metaNow, setValue, setView, toggleOff, ui, useUi } from '../doc'
import { ctx } from '../kit/ctx'
import { openMenu, type MenuItem } from '../kit/Menu'
import { duplicateMod, getArg, moveMod, newCall, removeMod, replaceFn, setArg, updateCall } from '../kit/model'
import { closePopover, DisableToggle, openPopover, PreviewPeek, toast } from '@hydra-ipad/kit'
import { addModule, randomizeCall, swapFn } from '../ops'
import { panelOf } from '../panel'
import { offPin, peekPin } from '../pins'
import { rackPreviewPool } from '../previews'
import { Rgba, VecField, XYPad } from './Controls'
import { Knob, togglePin } from './Knob'

// ---------------------------------------------------------------- function picker

export const TYPE_LABEL: Record<FnType, string> = { src: 'Sources', coord: 'Geometry', color: 'Colour', combine: 'Blend', combineCoord: 'Modulate' }
export const TYPE_ICON: Record<FnType, string> = { src: '◉', coord: '⤧', color: '◐', combine: '⊕', combineCoord: '≈' }

const isPlugin = (f: FnDef) => f.origin.startsWith('plugin:')

/** A grouped list of catalog functions (plugins in their own group), filtered by type. */
export function openFnPicker(anchor: Element, types: FnType[], onPick: (fn: string) => void, title: string, current?: string): void {
  openPopover(
    anchor,
    () => {
      const all = ctx.catalog.list().filter((f) => types.includes(f.type))
      const groups: Array<[string, FnDef[]]> = types.map((t) => [TYPE_LABEL[t], all.filter((f) => f.type === t && !isPlugin(f))])
      const plugins = all.filter(isPlugin)
      if (plugins.length) groups.push(['Plugins', plugins])
      return (
        <div class="picker" data-testid="fn-picker">
          <div class="menu-title">{title}</div>
          {groups
            .filter(([, fs]) => fs.length)
            .map(([label, fs]) => (
              <section key={label}>
                <h4>{label}</h4>
                <div class="pick-grid">
                  {fs.map((f) => (
                    <button
                      type="button"
                      key={f.name}
                      class={`pick t-${f.type} ${f.name === current ? 'on' : ''}`}
                      data-testid={`pick-${f.name}`}
                      onClick={() => {
                        closePopover()
                        onPick(f.name)
                      }}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )
    },
    { width: 340, label: title },
  )
}

export const MOD_TYPES: FnType[] = ['coord', 'color', 'combine', 'combineCoord']

// ---------------------------------------------------------------- a chain as a row of modules

/**
 * `owner`: the statement whose chain this is (a lane row, an unplugged chain or a picture variable), so the generator's
 * switch turns the whole statement off; nested chains (mini-modules) have none.
 */
export function ChainRow({ chain, depth = 0, testid, owner }: { chain: Chain; depth?: number; testid?: string; owner?: string }) {
  return (
    <div class={`chainrow d${depth}`} data-chain={chain.id} data-testid={testid}>
      <Module call={chain.gen} chain={chain} index={-1} depth={depth} owner={owner} />
      {chain.mods.map((m, i) => (
        <Module key={m.id} call={m} chain={chain} index={i} depth={depth} />
      ))}
      <button
        type="button"
        class="addmod"
        data-testid={`add-mod-${chain.id}`}
        aria-label="Add a module"
        onClick={(e) =>
          openFnPicker(e.currentTarget, MOD_TYPES, (fn) => {
            const r = addModule(ctx.store.sketch, chain.id, chain.mods.length - 1, fn, ctx.catalog)
            commit(r.sketch)
            ui.select(r.call.id)
          }, 'Add a module')
        }
      >
        ＋<small>module</small>
      </button>
    </div>
  )
}

/** Before / after one module, in a popover (opened at once, so A/B is one tap away). */
export function openDiff(anchor: Element, call: Call): void {
  openPopover(anchor, () => <DiffPeek callId={call.id} label={call.fn} />, { width: 290, label: `What ${call.fn} does` })
}

function DiffPeek({ callId, label }: { callId: string; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  // the kit's peek starts folded; a before/after is only useful open
  useEffect(() => box.current?.querySelector<HTMLButtonElement>('.peek-pic[aria-expanded=false]')?.click(), [])
  return (
    <div class="diffpeek" ref={box} data-testid="diff-peek">
      <div class="menu-title">What {label} does</div>
      <PreviewPeek pool={rackPreviewPool()} spec={{ kind: 'diff', callId }} label={label} />
    </div>
  )
}

// ---------------------------------------------------------------- a module

export function Module({ call, chain, index, depth, owner }: { call: Call; chain: Chain; index: number; depth: number; owner?: string }) {
  const st = useUi()
  // the generator's switch is its statement's (a chain starts with its generator); everything else switches itself
  const offId = index < 0 && owner ? owner : call.id
  const offWhat = index < 0 && owner ? 'the whole row' : call.fn
  const off = canDisable(ctx.store.sketch, offId)
  const known = ctx.catalog.get(call.fn)
  const isGen = index < 0
  const controls = panelOf(call.fn, call.args.length, ctx.catalog)
  const sel = st.sel === call.id
  const cls = known ? `t-${known.type}${isPlugin(known) ? ' plugin' : ''}` : 'unknown'
  const swap = (el: Element) => {
    if (!known) {
      const name = window.prompt('Function name (a plugin function that has not loaded yet)', call.fn)
      if (name && /^[A-Za-z_$][\w$]*$/.test(name.trim())) commit(updateCall(ctx.store.sketch, call.id, (c) => ({ ...c, fn: name.trim() })))
      return
    }
    openFnPicker(el, isGen ? ['src'] : [known.type], (fn) => commit(swapFn(ctx.store.sketch, call.id, fn, ctx.catalog)), `Swap ${call.fn} for…`, call.fn)
  }
  const menu = (el: Element) => {
    const pins = metaNow().pins ?? []
    const items: MenuItem[] = [
      { label: 'Randomise its knobs', run: () => commit(randomizeCall(ctx.store.sketch, call.id, ctx.catalog, Math.random)), testid: 'menu-dice' },
      { label: 'Swap function…', run: () => swap(el) },
      { label: off.disabled ? `Switch on ${offWhat}` : `Switch off ${offWhat}`, hint: '//', sep: true, run: () => toggleOff(offId, offWhat), testid: 'menu-off' },
      ...(isGen ? [] : [{ label: 'Before / after…', hint: 'A/B', run: () => openDiff(el, call), testid: 'menu-ab' }]),
      { label: pins.includes(offPin(offId)) ? 'Unpin the switch from performance' : 'Pin the switch to performance', run: () => togglePin(offPin(offId)), testid: 'menu-pin-off' },
      { label: pins.includes(peekPin(chain.id, call.id)) ? 'Unpin the preview from performance' : 'Pin the preview to performance', run: () => togglePin(peekPin(chain.id, call.id)), testid: 'menu-pin-peek' },
    ]
    if (!isGen) {
      items.push(
        { label: 'Move left', sep: true, disabled: index === 0, run: () => commit(moveMod(ctx.store.sketch, chain.id, index, index - 1)) },
        { label: 'Move right', disabled: index === chain.mods.length - 1, run: () => commit(moveMod(ctx.store.sketch, chain.id, index, index + 1)) },
        { label: 'Duplicate', run: () => commit(duplicateMod(ctx.store.sketch, chain.id, call.id)) },
        {
          label: 'Remove',
          danger: true,
          sep: true,
          testid: 'menu-remove',
          run: () => {
            commit(removeMod(ctx.store.sketch, chain.id, call.id))
            toast(`${call.fn} removed`, { label: 'Undo', run: () => ctx.store.undo() })
          },
        },
      )
    } else if (known) {
      items.push({ label: 'Replace with a fresh generator…', run: () => openFnPicker(el, ['src'], (fn) => commit(replaceFn(ctx.store.sketch, call.id, fn, ctx.catalog)), 'New generator') })
    }
    openMenu(el, items, call.fn, 240)
  }
  return (
    <div
      class={`module ${cls} ${sel ? 'sel' : ''} ${isGen ? 'gen' : ''} ${call.disabled ? 'is-disabled' : ''}`}
      data-testid="module"
      data-call={call.id}
      data-fn={call.fn}
      data-depth={depth}
      title={known ? undefined : 'Not in the catalog: a plugin function that has not loaded yet (kept as written)'}
    >
      <div class="mhead">
        <span class="ticon" aria-hidden="true">
          {known ? TYPE_ICON[known.type] : '?'}
        </span>
        <button
          type="button"
          class="mname"
          data-testid="module-name"
          onClick={(e) => {
            if (!sel) return ui.select(call.id)
            swap(e.currentTarget)
          }}
        >
          {call.fn}
        </button>
        <DisableToggle id={offId} what={offWhat} onChange={(next) => commit(next)} class="moff" />
        <button type="button" class="icon sm" data-testid="module-dice" aria-label="Randomise" title="Random values for this module" onClick={() => commit(randomizeCall(ctx.store.sketch, call.id, ctx.catalog, Math.random))}>
          ⚄
        </button>
        <button type="button" class="icon sm" data-testid="module-more" aria-label="Module menu" onClick={(e) => menu(e.currentTarget)}>
          ⋯
        </button>
      </div>
      {!st.perform && !st.audition && <PreviewPeek pool={rackPreviewPool()} spec={{ kind: 'prefix', chainId: chain.id, upToCallId: call.id }} label={`up to ${call.fn}`} class="mpeek" />}
      <div class="mbody">
        {controls.map((c) => {
          switch (c.t) {
            case 'knob':
              return <Knob key={`k${c.i}`} r={{ call: call.id, i: c.i }} />
            case 'xy':
              return <XYPad key={`xy${c.x}`} call={call.id} c={c} />
            case 'rgba':
              return <Rgba key="rgba" call={call.id} c={c} />
            case 'vec':
              return <VecField key={`v${c.i}`} call={call.id} c={c} />
            case 'jack':
              return <Jack key={`j${c.i}`} call={call.id} i={c.i} inp={c.inp} depth={depth} />
          }
        })}
        {!controls.length && <small class="noknobs">no inputs</small>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- patch jacks

const COMMON_GENS = ['noise', 'osc', 'shape', 'voronoi', 'gradient', 'solid']

export function jackItems(call: string, i: number): MenuItem[] {
  const set = (v: Value) => setValue({ call, i }, v)
  const sk = ctx.store.sketch
  const vars = sk.stmts.flatMap((s) => (s.k === 'def' && (s.value.k === 'tex' || s.value.k === 'ref') ? [s.name] : []))
  const items: MenuItem[] = [
    ...(['o0', 'o1', 'o2', 'o3'] as const).map((o, k) => ({ label: `Lane ${o.toUpperCase()}`, sep: k === 0, run: () => set({ k: 'ref', name: o }), testid: `jack-${o}` })),
    ...(['s0', 's1', 's2', 's3'] as const).map((s, k) => ({ label: `Source ${s.toUpperCase()}`, sep: k === 0, run: () => set({ k: 'ref', name: s }), testid: `jack-${s}` })),
    ...vars.map((name, k) => ({ label: `Variable ${name}`, sep: k === 0, run: () => set({ k: 'var', name }) })),
    ...COMMON_GENS.filter((g) => ctx.catalog.has(g)).map((g, k) => ({
      label: `New mini-module: ${g}`,
      sep: k === 0,
      testid: `jack-new-${g}`,
      run: () => {
        const nc = newCall(g, ctx.catalog)
        const key = `${call}:${i}`
        const open = metaNow().open ?? []
        commit(setArg(ctx.store.sketch, { call, i }, tex(makeChain(nc))), { open: open.includes(key) ? open : [...open, key] })
      },
    })),
  ]
  return items
}

export function Jack({ call, i, inp, depth }: { call: string; i: number; inp: InputDef; depth: number }) {
  const v = getArg(ctx.store.sketch, { call, i })
  const key = `${call}:${i}`
  const open = (metaNow().open ?? []).includes(key)
  const pick = (el: Element) => openMenu(el, jackItems(call, i), `${inp.name}: patch in…`, 260)
  const toggle = () => {
    const o = metaNow().open ?? []
    setView({ open: o.includes(key) ? o.filter((k) => k !== key) : [...o, key] })
  }
  let face
  if (v?.k === 'tex') {
    const c = v.chain
    face = (
      <div class={`mini ${open ? 'open' : ''}`}>
        <div class="minihead">
          <button type="button" class="minibtn" data-testid={`mini-${key}`} aria-expanded={open} onClick={toggle}>
            {open ? '▾' : '▸'} {c.gen.fn}
            {c.mods.length ? <small> +{c.mods.length}</small> : null}
          </button>
          <button type="button" class="icon sm" data-testid={`jack-${key}`} aria-label="Patch something else in" onClick={(e) => pick(e.currentTarget)}>
            ⇄
          </button>
        </div>
        {open && (depth < 2 ? <ChainRow chain={c} depth={depth + 1} /> : <small class="deep">nested deeper than two levels: edit it in the code drawer</small>)}
      </div>
    )
  } else {
    const label = !v || v.k === 'default' ? 'empty' : v.k === 'ref' ? v.name.toUpperCase() : v.k === 'var' ? v.name : v.k === 'js' || v.k === 'fn' ? 'ƒ' : v.k
    face = (
      <button type="button" class={`plug ${!v || v.k === 'default' ? 'empty' : ''}`} data-testid={`jack-${key}`} onClick={(e) => pick(e.currentTarget)}>
        <i class="hole" aria-hidden="true" />
        {label}
      </button>
    )
  }
  return (
    <div class="jack" data-drop="jack" data-ref={key} data-value={v?.k ?? 'default'}>
      <small class="jl">{inp.name}</small>
      {face}
    </div>
  )
}
