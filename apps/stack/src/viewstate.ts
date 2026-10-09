import { describe, type Sketch } from '@hydra-ipad/core'
import { ctx } from './ctx'
import { stmtOf } from './model'
import { problemMap, type ErrorLike } from './problems'
import type { ViewState } from './ui/Rows'

/** Everything the rows need besides the sketch: row problems, the selection and how often each variable is used. */
export function makeViewState(sk: Sketch, errors: ErrorLike[], selection: string | undefined): ViewState {
  const d = describe(sk)
  return {
    sketch: sk,
    problems: problemMap(sk, errors, ctx.catalog),
    selection,
    selectedStmt: selection ? stmtOf(sk, selection)?.id : undefined,
    defUses: new Map(d.defs.map((x) => [x.name, x.uses.length])),
  }
}
