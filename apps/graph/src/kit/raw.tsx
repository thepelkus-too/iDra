// Raw JS statements: an editable monospace body with a parse-status dot. When an edit turns into code the editor
// recognises, it is replaced by the recognised statements (contract §4); otherwise it stays raw, byte for byte.
import { importText, type Sketch, type Stmt } from '@hydra-ipad/core'
import { useRef, useState } from 'preact/hooks'
import { ctx, edit } from './ctx'
import { updateStmt } from './model'

const statusCache = new Map<string, RawStatus>()
export interface RawStatus {
  state: 'code' | 'blocks' | 'error'
  message: string
  stmts?: Stmt[]
}

/** What would importing this text do? Recognised → becomes editor nodes; syntax error; or stays code. Memoised. */
export function rawStatus(code: string): RawStatus {
  const hit = statusCache.get(code)
  if (hit) return hit
  const r = importText(code, { catalog: ctx.catalog })
  let st: RawStatus
  if (r.report.parseFailed) st = { state: 'error', message: r.warnings[0] ?? 'syntax error' }
  else if (r.report.statements > 0 && r.report.raw === 0) st = { state: 'blocks', message: `recognised: ${r.report.statements} statement(s)`, stmts: r.sketch.stmts }
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

export function commitRaw(stmtId: string, code: string, final: boolean): void {
  const s = rawStatus(code)
  if (s.state === 'blocks' && s.stmts && final) {
    edit((sk) => replaceStmtWith(sk, stmtId, s.stmts!), { coalesce: `raw:${stmtId}` })
    return
  }
  edit((sk) => updateStmt(sk, stmtId, (x) => (x.k === 'raw' ? { ...x, code } : x)), { coalesce: `raw:${stmtId}` })
}

export function StatusDot({ code }: { code: string }) {
  const st = rawStatus(code)
  return <span class={`status-dot ${st.state}`} data-testid="raw-status" data-state={st.state} title={st.message} aria-label={st.message} />
}

/** Tap to edit; the first lines are always visible. */
export function RawEditor({ stmt, rows = 4 }: { stmt: Extract<Stmt, { k: 'raw' }>; rows?: number }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(stmt.code)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const lines = stmt.code.split('\n')
  if (!open)
    return (
      <div class="raw-body" data-testid="raw-body">
        <StatusDot code={stmt.code} />
        <button
          type="button"
          class="raw-text"
          data-testid="raw-open"
          onClick={(e) => {
            e.stopPropagation()
            setText(stmt.code)
            setOpen(true)
          }}
        >
          <code>{lines.slice(0, rows).join('\n') || '(empty)'}</code>
          {lines.length > rows && <em> … {lines.length} lines</em>}
        </button>
      </div>
    )
  return (
    <div class="raw-body open" onPointerDown={(e) => e.stopPropagation()}>
      <StatusDot code={text} />
      <textarea
        class="code-edit"
        data-testid="raw-edit"
        rows={Math.min(14, Math.max(3, text.split('\n').length))}
        autocapitalize="off"
        autocorrect="off"
        autocomplete="off"
        spellcheck={false}
        value={text}
        ref={(el) => el && document.activeElement !== el && !el.dataset.focused && ((el.dataset.focused = '1'), el.focus())}
        onInput={(e) => {
          const v = (e.currentTarget as HTMLTextAreaElement).value
          setText(v)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => commitRaw(stmt.id, v, false), 350)
        }}
        onBlur={() => {
          clearTimeout(timer.current)
          if (text !== stmt.code || rawStatus(stmt.code).state === 'blocks') commitRaw(stmt.id, text, true)
          ctx.store.endGroup()
          setOpen(false)
        }}
      />
      <div class={`rawnote ${rawStatus(text).state}`}>{rawStatus(text).message}</div>
    </div>
  )
}
