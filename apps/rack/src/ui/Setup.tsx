// Setup statements: bpm and speed (the top bar's tempo controls), sources S0–S3 (camera, image, video, screen) and render().
import { OUT_NAMES, SOURCE_NAMES, newId, type Hint, type SourceName, type Stmt } from '@hydra-ipad/core'
import { commit } from '../doc'
import { ctx } from '../kit/ctx'
import { openMenu } from '../kit/Menu'
import { insertStmt, removeStmt, setupInsertIndex, updateStmt } from '../kit/model'
import { NumSlider } from '../kit/NumSlider'
import { openSheet } from '../kit/overlay'

export const SETTING_HINT: Record<'bpm' | 'speed', Hint> = { bpm: { min: 20, max: 300, step: 1, integer: true }, speed: { min: 0, max: 4, step: 0.01 } }
export const SETTING_DEFAULT = { bpm: 30, speed: 1 }

export function settingOf(name: 'bpm' | 'speed'): Extract<Stmt, { k: 'setting' }> | undefined {
  return [...ctx.store.sketch.stmts].reverse().find((s): s is Extract<Stmt, { k: 'setting' }> => s.k === 'setting' && s.name === name)
}

/** Set bpm or speed: edits the last such statement, or adds one with the other setup statements. */
export function setSetting(name: 'bpm' | 'speed', v: number, coalesce?: string): void {
  const sk = ctx.store.sketch
  const cur = settingOf(name)
  if (coalesce) ctx.store.hold(coalesce)
  if (cur) return commit(updateStmt(sk, cur.id, (s) => (s.k === 'setting' ? { ...s, v } : s)), {}, { coalesce })
  commit(insertStmt(sk, setupInsertIndex(sk), { id: newId('s'), k: 'setting', name, v }), {}, { coalesce })
}

const KINDS = ['cam', 'image', 'video', 'screen'] as const
const KIND_LABEL: Record<string, string> = { cam: 'camera', image: 'image', video: 'video', screen: 'screen', clear: 'clear' }

function setSource(slot: SourceName, kind: (typeof KINDS)[number]): void {
  const sk = ctx.store.sketch
  const cur = sk.stmts.find((s) => s.k === 'source' && s.slot === slot)
  const ask = kind === 'image' || kind === 'video' ? window.prompt(`${kind} URL`, cur?.k === 'source' ? (cur.init.arg ?? '') : '') : undefined
  if (ask === null) return
  const init = { kind, ...(ask !== undefined ? { arg: ask } : {}) }
  if (cur) return commit(updateStmt(sk, cur.id, (s) => (s.k === 'source' ? { ...s, init } : s)))
  commit(insertStmt(sk, setupInsertIndex(sk), { id: newId('s'), k: 'source', slot, init }))
}

export function openSources(): void {
  openSheet('Sources S0–S3', () => {
    const sk = ctx.store.sketch
    return (
      <div class="sources" data-testid="sources">
        {SOURCE_NAMES.map((slot) => {
          const s = sk.stmts.find((x): x is Extract<Stmt, { k: 'source' }> => x.k === 'source' && x.slot === slot)
          return (
            <div key={slot} class="srcrow">
              <b>{slot.toUpperCase()}</b>
              <span class="grow">{s ? `${KIND_LABEL[s.init.kind]}${s.init.arg ? ` · ${s.init.arg}` : s.init.argsSrc ? ` · ${s.init.argsSrc}` : ''}` : 'empty'}</span>
              <button type="button" class="btn sm" data-testid={`src-${slot}`} onClick={(e) => openMenu(e.currentTarget, [...KINDS.map((k) => ({ label: KIND_LABEL[k], run: () => setSource(slot, k) })), ...(s ? [{ label: 'Remove', danger: true, sep: true, run: () => commit(removeStmt(ctx.store.sketch, s.id)) }] : [])], slot.toUpperCase(), 200)}>
                {s ? 'change' : 'set'} ▾
              </button>
            </div>
          )
        })}
        <p class="note">Camera and screen ask for permission the first time they run.</p>
      </div>
    )
  })
}

/** One setup statement in the Setup tray, editable in place. */
export function SetupItem({ s }: { s: Stmt }) {
  const set = (f: (x: Stmt) => Stmt, coalesce?: string) => commit(updateStmt(ctx.store.sketch, s.id, f), {}, { coalesce })
  let body
  if (s.k === 'setting') {
    body = (
      <NumSlider
        compact
        label={s.name}
        value={s.v}
        hint={SETTING_HINT[s.name]}
        testid={`setup-${s.name}`}
        onChange={(v, ph) => (ph === 'end' ? ctx.store.endGroup() : (ctx.store.hold(`set:${s.id}`), set((x) => (x.k === 'setting' ? { ...x, v } : x), `set:${s.id}`)))}
      />
    )
  } else if (s.k === 'render') {
    body = (
      <button type="button" class="btn sm" onClick={(e) => openMenu(e.currentTarget, (['all', ...OUT_NAMES] as const).map((t) => ({ label: t === 'all' ? 'all four' : t.toUpperCase(), run: () => set((x) => (x.k === 'render' ? { ...x, target: t } : x)) })), 'render', 180)}>
        render({s.target === 'all' ? '' : s.target}) ▾
      </button>
    )
  } else if (s.k === 'source') {
    body = (
      <button type="button" class="btn sm" onClick={openSources}>
        {s.slot.toUpperCase()} ← {KIND_LABEL[s.init.kind]}
        {s.init.arg ? ` ${s.init.arg.slice(0, 28)}` : ''}
      </button>
    )
  } else body = <code>{s.k}</code>
  return (
    <div class="setupitem" data-stmt={s.id} data-testid="setup" data-kind={s.k}>
      {body}
    </div>
  )
}
