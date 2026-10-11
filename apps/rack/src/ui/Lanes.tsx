// The four output lanes (o0–o3), each a row of modules in signal order ending in an output tile, then the trays for
// everything that is not a lane: unplugged chains, variables, raw JS, notes and setup statements. Nothing is hidden.
import { OUT_NAMES, newId, type OutName, type Stmt } from '@hydra-ipad/core'
import { commit, fadeTo, metaNow, setView, ui, useUi } from '../doc'
import { ctx } from '../kit/ctx'
import { openMenu } from '../kit/Menu'
import { insertStmt, removeStmt, renameDef, setOut, updateStmt } from '../kit/model'
import { toast } from '@hydra-ipad/kit'
import { RawEditor } from '../kit/raw'
import { addGenerator, mutateChain, randomLane } from '../ops'
import { layoutOf, type ChainStmt, type Layout, type Row } from '../view'
import { Knob } from './Knob'
import { ChainRow, openFnPicker } from './Module'
import { SetupItem } from './Setup'

export function renderTarget(stmts: Stmt[]): OutName | 'all' {
  let t: OutName | 'all' = 'o0'
  for (const s of stmts) if (s.k === 'render') t = s.target
  return t
}

/** Show a lane (or all four): edit the last `render()` if there is one, otherwise add one at the end. */
export function setRender(t: OutName | 'all'): void {
  const sk = ctx.store.sketch
  const last = [...sk.stmts].reverse().find((s) => s.k === 'render')
  if (last) return commit(updateStmt(sk, last.id, (s) => (s.k === 'render' ? { ...s, target: t } : s)))
  if (t === 'o0') return
  commit(insertStmt(sk, sk.stmts.length, { id: newId('s'), k: 'render', target: t }))
}

export function Rack() {
  useUi()
  const sk = ctx.store.sketch
  const L = layoutOf(sk)
  return (
    <div class="rack" data-testid="rack">
      {OUT_NAMES.map((o) => (
        <Lane key={o} o={o} rows={L.lanes[o]} />
      ))}
      <Trays L={L} />
    </div>
  )
}

function Lane({ o, rows }: { o: OutName; rows: Row[] }) {
  const frozen = (metaNow().frozen ?? []).includes(o)
  const shown = renderTarget(ctx.store.sketch.stmts)
  const onScreen = shown === o || shown === 'all'
  const freeze = () => {
    const f = metaNow().frozen ?? []
    setView({ frozen: frozen ? f.filter((x) => x !== o) : [...f, o] })
  }
  const dice = () => {
    if (frozen) return toast(`Lane ${o.toUpperCase()} is locked`)
    commit(randomLane(ctx.store.sketch, o, ctx.catalog, (Math.random() * 1e9) | 0))
  }
  const morph = () => {
    if (frozen) return toast(`Lane ${o.toUpperCase()} is locked`)
    let next = ctx.store.sketch
    for (const r of rows) next = mutateChain(next, r.stmt.chain.id, ctx.catalog, Math.random, 0.35)
    fadeTo(next.stmts, 8)
  }
  return (
    <section class={`lane ${onScreen ? 'onscreen' : ''} ${frozen ? 'frozen' : ''}`} data-testid={`lane-${o}`} data-lane={o} aria-label={`Lane ${o}`}>
      <div class="lanehead">
        <b class="lname">{o.toUpperCase()}</b>
        <button type="button" class={`icon sm ${frozen ? 'on' : ''}`} data-testid={`freeze-${o}`} aria-pressed={frozen} aria-label="Lock lane" title="Lock: dice and morph leave this lane alone" onClick={freeze}>
          {frozen ? '🔒' : '🔓'}
        </button>
        <button type="button" class="icon sm" data-testid={`lane-dice-${o}`} aria-label="Random chain" title="A random chain for this lane" onClick={dice}>
          ⚄
        </button>
        <button type="button" class="icon sm" data-testid={`lane-morph-${o}`} aria-label="Morph" title="Morph to random values over 8 beats" disabled={!rows.length} onClick={morph}>
          ⤳
        </button>
      </div>
      <div class="lanebody">
        {rows.map((r) => (
          <div key={r.stmt.id} class={`lanerow ${r.shadowed ? 'shadowed' : ''}`} data-stmt={r.stmt.id} data-testid="lanerow">
            {r.shadowed && <span class="tag" title={`A later row also writes ${o}: this one is not seen`}>shadowed</span>}
            <ChainRow chain={r.stmt.chain} />
            <OutTile s={r.stmt} o={o} onScreen={onScreen} />
          </div>
        ))}
        {!rows.length && (
          <button
            type="button"
            class="addgen"
            data-testid={`add-gen-${o}`}
            onClick={(e) =>
              openFnPicker(e.currentTarget, ['src'], (fn) => {
                const r = addGenerator(ctx.store.sketch, o, fn, ctx.catalog)
                commit(r.sketch)
              }, `Generator for ${o.toUpperCase()}`)
            }
          >
            ＋ generator
          </button>
        )}
      </div>
    </section>
  )
}

function OutTile({ s, o, onScreen }: { s: ChainStmt; o: OutName; onScreen: boolean }) {
  return (
    <button
      type="button"
      class={`outtile ${onScreen ? 'on' : ''}`}
      data-testid={`out-${s.id}`}
      title={onScreen ? 'On screen' : 'Not on screen: tap to show this lane'}
      onClick={(e) =>
        openMenu(
          e.currentTarget,
          [
            { label: `Show ${o.toUpperCase()} on screen`, run: () => setRender(o), disabled: renderTarget(ctx.store.sketch.stmts) === o, testid: 'menu-show' },
            ...OUT_NAMES.filter((x) => x !== o).map((x, k) => ({ label: `Move to lane ${x.toUpperCase()}`, sep: k === 0, run: () => commit(setOut(ctx.store.sketch, s.chain.id, x)) })),
            { label: 'Unplug (no .out)', sep: true, run: () => commit(setOut(ctx.store.sketch, s.chain.id, null)), testid: 'menu-unplug' },
            { label: 'Remove this row', danger: true, run: () => commit(removeStmt(ctx.store.sketch, s.id)), testid: 'menu-remove-row' },
          ],
          `Output ${o.toUpperCase()}`,
          240,
        )
      }
    >
      <span class="arrow" aria-hidden="true">
        →
      </span>
      <b>{o.toUpperCase()}</b>
      <small>{onScreen ? 'on screen' : 'show…'}</small>
    </button>
  )
}

// ---------------------------------------------------------------- trays

function Trays({ L }: { L: Layout }) {
  const st = useUi()
  const sk = ctx.store.sketch
  return (
    <div class="trays">
      {L.unplugged.length > 0 && (
        <section class="tray unplugged" data-testid="tray-unplugged" aria-label="Unplugged">
          <h3>Unplugged · not on any output</h3>
          {L.unplugged.map((s) => (
            <div key={s.id} class="lanerow" data-stmt={s.id} data-testid="unplugged">
              <ChainRow chain={s.chain} />
              <button
                type="button"
                class="outtile plug-in"
                data-testid={`patch-${s.id}`}
                onClick={(e) => openMenu(e.currentTarget, OUT_NAMES.map((o) => ({ label: `Patch into ${o.toUpperCase()}`, run: () => commit(setOut(ctx.store.sketch, s.chain.id, o)), testid: `patch-into-${o}` })), 'Patch into a lane', 220)}
              >
                <b>patch</b>
                <small>into a lane</small>
              </button>
            </div>
          ))}
        </section>
      )}
      {L.vars.length > 0 && (
        <section class="tray vars" data-testid="tray-vars" aria-label="Variables">
          <h3>Vars</h3>
          <div class="varrow">
            {L.vars.map((d) => (
              <div key={d.id} class={`var ${st.sel === d.id ? 'sel' : ''}`} data-stmt={d.id} data-testid="var">
                <button
                  type="button"
                  class="vname"
                  onClick={() => {
                    const n = window.prompt('Variable name', d.name)
                    if (n && /^[A-Za-z_$][\w$]*$/.test(n.trim()) && n.trim() !== d.name) commit(renameDef(ctx.store.sketch, d.id, n.trim()))
                  }}
                >
                  {d.decl} {d.name}
                </button>
                {d.value.k === 'tex' ? (
                  <ChainRow chain={d.value.chain} depth={1} />
                ) : d.value.k === 'ref' ? (
                  <code class="chip">{d.value.name}</code>
                ) : d.value.k === 'vec4' ? (
                  <code class="chip">[{d.value.v.join(', ')}]</code>
                ) : (
                  <Knob r={{ def: d.id }} label={d.name} />
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {L.raw.length > 0 && (
        <section class="tray raw" data-testid="tray-raw" aria-label="Raw JS">
          <h3>Raw JS · run as written</h3>
          {L.raw.map((r) => (
            <div key={r.id} class="module rawmod" data-stmt={r.id} data-testid="raw">
              <RawEditor stmt={r} rows={Math.min(6, r.code.split('\n').length + 1)} />
            </div>
          ))}
        </section>
      )}
      {L.notes.length > 0 && (
        <section class="tray notes" data-testid="tray-notes" aria-label="Notes">
          <h3>Notes</h3>
          <div class="noterow">
            {L.notes.map((n) => (
              <button
                type="button"
                key={n.id}
                class="note"
                data-stmt={n.id}
                data-testid="note"
                onClick={() => {
                  const t = window.prompt('Note', n.text)
                  if (t !== null && t !== n.text) commit(updateStmt(ctx.store.sketch, n.id, (s) => (s.k === 'comment' ? { ...s, text: t } : s)))
                }}
              >
                {n.text || '(empty note)'}
              </button>
            ))}
          </div>
        </section>
      )}
      {L.setup.length > 0 && (
        <section class="tray setup" data-testid="tray-setup" aria-label="Setup">
          <h3>Setup</h3>
          <div class="setuprow">
            {L.setup.map((s) => (
              <SetupItem key={s.id} s={s} />
            ))}
          </div>
        </section>
      )}
      {sk.stmts.length === 0 && <p class="empty-rack">An empty sketch: add a generator to lane O0.</p>}
    </div>
  )
}
