// Copied from apps/stack (kept app-local per the front-end contract; see the PR's core change requests).
// Which row is responsible for a problem: core's validate() already names nodes; thrown errors are attributed by name when
// the message makes that possible. Everything else stays a banner. Pure and unit-tested.
import { validate, walkCalls, type Catalog, type Sketch } from '@hydra-ipad/core'

export interface RowProblem {
  severity: 'error' | 'warning' | 'info'
  message: string
  code: string
}

export interface ErrorLike {
  kind: string
  message: string
}

export function problemMap(sketch: Sketch, errors: ErrorLike[], cat: Catalog): Map<string, RowProblem[]> {
  const map = new Map<string, RowProblem[]>()
  const add = (id: string, p: RowProblem) => {
    const list = map.get(id)
    if (list) list.push(p)
    else map.set(id, [p])
  }
  for (const p of validate(sketch, cat)) {
    if (p.severity === 'info') continue
    add(p.nodeId, { severity: p.severity, message: p.message, code: p.code })
  }
  for (const e of errors) {
    const id = attribute(sketch, e)
    if (id) add(id, { severity: 'error', message: e.message, code: 'runtime' })
  }
  return map
}

/** `foo is not defined` / `foo is not a function` → the call that uses `foo` (as a function name or inside an expression). */
export function attribute(sketch: Sketch, e: ErrorLike): string | undefined {
  const m = /(?:ReferenceError: |TypeError: )?([A-Za-z_$][\w$.]*) is not (?:defined|a function)/.exec(e.message)
  if (!m) return undefined
  const name = m[1].split('.').pop()!
  const root = m[1].split('.')[0]
  for (const { call } of walkCalls(sketch)) {
    if (call.fn === name || call.fn === root) return call.id
  }
  const word = new RegExp(`(^|[^\\w$.])${root.replace(/\$/g, '\\$')}([^\\w$]|$)`)
  for (const { call } of walkCalls(sketch)) {
    for (const a of call.args) if ((a.k === 'fn' || a.k === 'js') && word.test(a.src)) return call.id
  }
  return undefined
}

/** Errors that no row could take: they go in the banner at the top of the stack. */
export function unattributed(sketch: Sketch, errors: ErrorLike[]): ErrorLike[] {
  return errors.filter((e) => !attribute(sketch, e))
}
