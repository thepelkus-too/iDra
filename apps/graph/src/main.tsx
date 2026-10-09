import { boot } from './kit/boot'
import { thumbs } from './kit/thumbs'
import { App } from './App'
import { compileOf, graphOf, ui } from './doc'
import * as model from './model'
import * as ops from './ops'
import { CSS } from './styles'
import { autoView, metaOf } from './view'
import { ctx } from './kit/ctx'
import { canvasApi } from './ui/Palette'

void boot({
  autoView: (s) => autoView(s, ctx.catalog),
  hasView: (s) => !!metaOf(s),
  App,
  css: CSS,
  expose: { thumbs, ui, graphOf, compileOf, model, ops, canvasApi },
})
