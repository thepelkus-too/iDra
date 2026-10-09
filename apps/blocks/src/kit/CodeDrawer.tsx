// The code panel every editor shares: `toCode` of the sketch in CodeMirror 6, read-only until "Edit" is switched on.
// Edits parse back on a pause or on blur (unrecognised text becomes raw statements, never dropped); ids survive through
// `reconcile`. The selected node's text is highlighted through core's source map.
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Annotation, Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { importText, toCodeWithMap, type CodeMap } from '@hydra-ipad/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import { copyCode } from './actions'
import { ctx, useStore } from './ctx'
import { reconcile } from './reconcile'

const external = Annotation.define<boolean>()
const setMarks = StateEffect.define<Array<{ from: number; to: number }>>()

const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setMarks)) {
        const rs = e.value.filter((r) => r.to > r.from).sort((a, b) => a.from - b.from)
        deco = rs.length ? Decoration.set(rs.map((r) => Decoration.mark({ class: 'cm-sel-node' }).range(r.from, r.to))) : Decoration.none
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c792ea' },
  { tag: [t.number, t.bool, t.null], color: '#f2a65a' },
  { tag: [t.string, t.special(t.string)], color: '#a6da95' },
  { tag: t.comment, color: '#6b7587', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#5ac8c8' },
  { tag: t.propertyName, color: '#8ab4f8' },
  { tag: t.operator, color: '#9aa3b2' },
])

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'var(--hi-bg)', color: 'var(--hi-text)', fontSize: '14px' },
    '.cm-scroller': { fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', lineHeight: '1.55', overscrollBehavior: 'contain' },
    '.cm-content': { caretColor: 'var(--hi-accent)', padding: '8px 4px 60px' },
    '.cm-gutters': { backgroundColor: 'var(--hi-bg)', color: '#566074', border: 'none' },
    '&.cm-focused': { outline: 'none' },
    '.cm-sel-node': { backgroundColor: 'rgba(90,200,200,.22)', borderRadius: '3px', boxShadow: '0 0 0 1px rgba(90,200,200,.5)' },
  },
  { dark: true },
)

/** CodeDrawer registers here so the app can flush pending text before leaving. Returns false when it does not parse. */
export const codeBridge = { flush: (): boolean => true }

export function CodeDrawer({ selected = [], onClose }: { selected?: string[]; onClose?: () => void }) {
  useStore()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>()
  const map = useRef<CodeMap>({})
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const ro = useRef(new Compartment())
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string }>({ ok: true, text: '' })

  const apply = (): boolean => {
    clearTimeout(timer.current)
    const v = view.current
    if (!v || !dirty.current) return true
    const text = v.state.doc.toString()
    const sk = ctx.store.sketch
    const { code } = toCodeWithMap(sk)
    if (text === code) {
      dirty.current = false
      setStatus({ ok: true, text: '' })
      return true
    }
    const imp = importText(text, { id: sk.id, name: sk.name, catalog: ctx.catalog })
    if (imp.report.parseFailed) {
      setStatus({ ok: false, text: 'Syntax error: the editor keeps the last version that parsed.' })
      return false
    }
    dirty.current = false
    ctx.store.commit(reconcile(sk, imp.sketch), { source: 'code', coalesce: 'code' })
    setStatus({ ok: true, text: imp.warnings[0] ?? '' })
    return true
  }

  useEffect(() => {
    if (!host.current) return
    const { code, map: m } = toCodeWithMap(ctx.store.sketch)
    map.current = m
    const exts: Extension[] = [
      lineNumbers(),
      keymap.of([{ key: 'Mod-Enter', run: () => (apply(), ctx.runner.run(true), true) }, indentWithTab, ...defaultKeymap]),
      javascript(),
      syntaxHighlighting(highlight),
      ro.current.of([EditorState.readOnly.of(true), EditorView.editable.of(false)]),
      EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Hydra code', 'data-testid': 'code-content' }),
      markField,
      theme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external))) {
          dirty.current = true
          clearTimeout(timer.current)
          timer.current = setTimeout(apply, 800)
        }
      }),
      EditorView.domEventHandlers({ blur: () => void apply() }),
      EditorState.tabSize.of(2),
    ]
    const v = new EditorView({ state: EditorState.create({ doc: code, extensions: exts }), parent: host.current })
    view.current = v
    codeBridge.flush = apply
    ;(window as unknown as { __cm?: EditorView }).__cm = v
    return () => {
      apply()
      codeBridge.flush = () => true
      v.destroy()
    }
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(editing ? [] : [EditorState.readOnly.of(true), EditorView.editable.of(false)]) })
    if (!editing) apply()
  }, [editing])

  // follow the sketch
  const sk = ctx.store.sketch
  const lastId = useRef(sk.id)
  useEffect(() => {
    const v = view.current
    if (!v) return
    if (lastId.current !== sk.id) {
      lastId.current = sk.id
      dirty.current = false
      clearTimeout(timer.current)
    }
    const { code, map: m } = toCodeWithMap(sk)
    map.current = m
    const cur = v.state.doc.toString()
    if (cur !== code && !dirty.current) {
      v.dispatch({ changes: { from: 0, to: cur.length, insert: code }, annotations: external.of(true), selection: { anchor: Math.min(v.state.selection.main.head, code.length) } })
      setStatus({ ok: true, text: '' })
    }
  }, [sk])

  const selKey = selected.join(',')
  useEffect(() => {
    const v = view.current
    if (!v) return
    const rs = dirty.current ? [] : selected.map((id) => map.current[id]).filter((r): r is { from: number; to: number } => !!r && r.to <= v.state.doc.length)
    v.dispatch({ effects: setMarks.of(rs), annotations: external.of(true) })
    if (rs.length) v.dispatch({ effects: EditorView.scrollIntoView(rs[0].from, { y: 'center' }), annotations: external.of(true) })
  }, [selKey, sk])

  return (
    <div class="codedrawer" data-testid="code-drawer">
      <div class="cd-head">
        <strong>Code</strong>
        <label class="switch">
          <input type="checkbox" data-testid="code-edit" checked={editing} onChange={(e) => setEditing((e.currentTarget as HTMLInputElement).checked)} />
          <span>Edit</span>
        </label>
        <button type="button" class="btn sm" data-testid="code-copy" onClick={() => void copyCode()}>
          Copy
        </button>
        {onClose && (
          <button type="button" class="icon" aria-label="Close code" data-testid="code-close" onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      <div class="cm-host" ref={host} />
      {status.text && (
        <div class={`code-status ${status.ok ? 'info' : 'err'}`} role="status" data-testid="code-status">
          {status.text}
        </div>
      )}
    </div>
  )
}
