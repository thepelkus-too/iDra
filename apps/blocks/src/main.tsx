import { boot } from './kit/boot'
import { ctx } from './kit/ctx'
import { thumbs } from './kit/thumbs'
import { App } from './App'
import { commit, metaNow, ui } from './doc'
import { dragHooks, kinds } from './drag'
import { applyDrop } from './drop'
import * as edit from './edit'
import * as help from './help'
import * as ops from './ops'
import { CSS } from './styles'
import { autoView, metaOf } from './view'
import { doDrop, wsApi } from './ui/Workspace'

kinds.isGen = (fn) => ctx.catalog.get(fn)?.type === 'src'
kinds.texVar = (name) => ctx.store.sketch.stmts.some((s) => s.k === 'def' && s.name === name && (s.value.k === 'tex' || s.value.k === 'ref'))

void boot({
  autoView: (s) => autoView(s, ctx.catalog),
  hasView: (s) => !!metaOf(s),
  App,
  css: CSS,
  expose: { thumbs, ui, metaNow, commit, applyDrop, doDrop, dragHooks, wsApi, edit, ops, help },
})
