// Code mode: the sketch as text (toCode) in CodeMirror 6 with Hydra-aware completion. Edits are parsed back on a pause or on blur;
// the selection is shared with the blocks through core's source map.
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Annotation, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, highlightActiveLine, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { importText, toCodeWithMap, type CodeMap } from '@hydra-ipad/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import { signature } from '../conv'
import { ctx, useStore } from '../ctx'
import { reconcile } from '../view'

const external = Annotation.define<boolean>()
const setMark = StateEffect.define<{ from: number; to: number } | null>()

const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setMark)) deco = e.value && e.value.to > e.value.from ? Decoration.set([Decoration.mark({ class: 'cm-sel-node' }).range(e.value.from, e.value.to)]) : Decoration.none
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
    '&': { height: '100%', backgroundColor: 'var(--hi-bg)', color: 'var(--hi-text)', fontSize: '15px' },
    '.cm-scroller': { fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', lineHeight: '1.55', overscrollBehavior: 'contain' },
    '.cm-content': { caretColor: 'var(--hi-accent)', padding: '10px 4px 80px' },
    '.cm-gutters': { backgroundColor: 'var(--hi-bg)', color: '#566074', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(90,200,200,.06)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--hi-text)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-sel-node': { backgroundColor: 'rgba(90,200,200,.22)', borderRadius: '3px', boxShadow: '0 0 0 1px rgba(90,200,200,.5)' },
    '.cm-tooltip': { backgroundColor: 'var(--hi-panel)', border: '1px solid var(--hi-line)', borderRadius: '8px' },
    '.cm-tooltip-autocomplete ul li': { padding: '8px 10px', minHeight: '36px' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'rgba(90,200,200,.2)', color: 'var(--hi-text)' },
    '.cm-completionDetail': { color: 'var(--hi-dim)', marginLeft: '8px', fontStyle: 'normal' },
  },
  { dark: true },
)

// ---------------------------------------------------------------- completion

const GLOBALS = ['time', 'mouse', 'a', 'bpm', 'speed', 'width', 'height', 'Math', 'o0', 'o1', 'o2', 'o3', 's0', 's1', 's2', 's3', 'render', 'hush']
const AUDIO_MEMBERS = ['fft', 'bins', 'vol', 'setBins', 'setCutoff', 'setScale', 'setSmooth', 'show', 'hide']
const MATH_MEMBERS = ['sin', 'cos', 'abs', 'floor', 'round', 'min', 'max', 'pow', 'sqrt', 'PI', 'random', 'atan2']

function fnCompletion(f: { name: string; inputs: Array<{ name: string; type: string; default?: unknown }>; origin: string }, member: boolean): Completion {
  return {
    label: f.name,
    type: 'function',
    detail: signature(f as never).slice(f.name.length),
    boost: f.origin.startsWith('plugin:') ? 0 : 1,
    apply: (view, _c, from, to) => {
      const text = `${f.name}()`
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + f.name.length + 1 } })
    },
    info: member ? undefined : undefined,
  }
}

export function hydraCompletion(cx: CompletionContext): CompletionResult | null {
  const m = cx.matchBefore(/\.?[\w$]*/)
  if (!m || (m.from === m.to && !cx.explicit)) return null
  const doc = cx.state.doc
  const dot = m.text.startsWith('.')
  const from = dot ? m.from + 1 : m.from
  if (dot) {
    const before = doc.sliceString(Math.max(0, m.from - 24), m.from)
    if (/\)\s*$/.test(before) || /\n\s*$/.test(before)) {
      return { from, options: ctx.catalog.list('mod').map((f) => fnCompletion(f, true)).concat([{ label: 'out', type: 'function', apply: 'out()' } as Completion]), validFor: /^[\w$]*$/ }
    }
    if (/\ba$/.test(before)) return { from, options: AUDIO_MEMBERS.map((label) => ({ label, type: 'property' })), validFor: /^[\w$]*$/ }
    if (/\bMath$/.test(before)) return { from, options: MATH_MEMBERS.map((label) => ({ label, type: 'property' })), validFor: /^[\w$]*$/ }
    if (/\bmouse$/.test(before)) return { from, options: ['x', 'y'].map((label) => ({ label, type: 'property' })), validFor: /^[\w$]*$/ }
    if (/\bs[0-3]$/.test(before)) return { from, options: ['initCam', 'initImage', 'initVideo', 'initScreen', 'clear'].map((label) => ({ label, type: 'function', apply: `${label}()` })), validFor: /^[\w$]*$/ }
    return null
  }
  const options: Completion[] = [
    ...ctx.catalog.list('gen').map((f) => fnCompletion(f, false)),
    ...GLOBALS.map((label): Completion => ({ label, type: 'variable', boost: -1 })),
  ]
  return { from, options, validFor: /^[\w$]*$/ }
}

// ---------------------------------------------------------------- component

export function CodeView({ active }: { active: boolean }) {
  useStore()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>()
  const map = useRef<CodeMap>({})
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const lastSelection = useRef<string | undefined>()
  const [status, setStatus] = useState<{ ok: boolean; text: string }>({ ok: true, text: '' })

  const apply = () => {
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
      setStatus({ ok: false, text: `Syntax error: ${imp.warnings[0]?.replace(/^could not parse the sketch \(/, '').replace(/\); kept verbatim.*$/, '') ?? 'cannot parse'}. The blocks keep the last good version.` })
      return false
    }
    dirty.current = false
    const next = reconcile(sk, imp.sketch)
    ctx.store.commit(next, { source: 'code', coalesce: 'code' })
    setStatus({ ok: true, text: imp.warnings.length ? imp.warnings[0] : '' })
    return true
  }

  // create the editor once
  useEffect(() => {
    if (!host.current) return
    const { code, map: m } = toCodeWithMap(ctx.store.sketch)
    map.current = m
    const exts: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      keymap.of([
        {
          key: 'Mod-z',
          run: () => (apply(), ctx.store.undo(), true),
        },
        { key: 'Mod-Shift-z', run: () => (apply(), ctx.store.redo(), true) },
        { key: 'Mod-Enter', run: () => (apply(), ctx.runner.run(true), true) },
        indentWithTab,
        ...defaultKeymap,
      ]),
      javascript(),
      syntaxHighlighting(highlight),
      autocompletion({ override: [hydraCompletion], activateOnTyping: true, maxRenderedOptions: 40 }),
      EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Hydra code', 'data-testid': 'code-content' }),
      markField,
      theme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external))) {
          dirty.current = true
          clearTimeout(timer.current)
          timer.current = setTimeout(apply, 700)
        }
        if (u.selectionSet && !dirty.current && !u.transactions.some((tr) => tr.annotation(external))) {
          const pos = u.state.selection.main.head
          let best: string | undefined
          let size = Infinity
          for (const [id, r] of Object.entries(map.current)) {
            if (pos >= r.from && pos <= r.to && r.to - r.from < size) {
              best = id
              size = r.to - r.from
            }
          }
          if (best && best !== ctx.store.selection) {
            lastSelection.current = best
            ctx.store.select(best)
          }
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

  // follow the sketch (undo, dice, edits made in the blocks)
  const sk = ctx.store.sketch
  const lastId = useRef(sk.id)
  useEffect(() => {
    const v = view.current
    if (!v) return
    // another sketch was opened: whatever was half typed belongs to the old one
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

  // show the selected block's text
  const sel = ctx.store.selection
  useEffect(() => {
    const v = view.current
    if (!v) return
    // ranges belong to the sketch's text: only meaningful while the editor still shows exactly that text
    const r = sel && !dirty.current ? map.current[sel] : undefined
    const ok = r && r.to <= v.state.doc.length ? r : undefined
    v.dispatch({ effects: setMark.of(ok ?? null), annotations: external.of(true) })
    if (ok && sel !== lastSelection.current && active) v.dispatch({ effects: EditorView.scrollIntoView(ok.from, { y: 'center' }), annotations: external.of(true) })
    lastSelection.current = undefined
  }, [sel, sk, active])

  useEffect(() => {
    if (!active) apply()
  }, [active])

  return (
    <div class="codeview" data-testid="codeview">
      <div class="cm-host" ref={host} />
      {status.text && (
        <div class={`code-status ${status.ok ? 'info' : 'err'}`} role="status" data-testid="code-status">
          {status.text}
        </div>
      )}
    </div>
  )
}

/** CodeView registers here so the app can flush pending text before leaving Code mode. Returns false when it does not parse. */
export const codeBridge = { flush: (): boolean => true }
