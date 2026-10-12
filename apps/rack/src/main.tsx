import { boot } from './kit/boot'
import { ctx } from './kit/ctx'
import { App } from './App'
import { disabledNodes } from '@hydra-ipad/core'
import { audition, commit, fader, metaNow, recallScene, setValue, storeScene, toggleOff, ui } from './doc'
import { dragHooks } from './drag'
import * as fade from './fade'
import * as ops from './ops'
import { migrateBypass } from './ops'
import { liveActivity } from './previews'
import * as panel from './panel'
import { parseKey } from './refs'
import { CSS } from './styles'
import { assignTo } from './ui/Knob'
import { autoView, layoutOf, metaOf } from './view'
import type { ModKind } from './kit/mods'

dragHooks.onDrop = (p, target) => {
  const key = target.dataset.ref
  if (!key) return
  const r = parseKey(key)
  if (p.t === 'mod') assignTo(r, p.kind as ModKind, p.bin)
  else if ('call' in r) setValue(r, { k: 'ref', name: p.name as 'o0' })
}

void boot({
  autoView,
  hasView: (s) => !!metaOf(s),
  App,
  css: CSS,
  migrate: migrateBypass,
  onLoad: (s, { created }) => {
    ctx.runner.onLive = liveActivity
    fader.cancel()
    if (ui.state.audition) audition(undefined)
    // a sketch this editor has never opened: say once if commented-out code in it came back as switched-off chunks
    const d = disabledNodes(s)
    const revived = created ? d.stmts.length + d.calls.length : 0
    ui.set({ sel: undefined, armed: undefined, fading: undefined, revived: revived || undefined })
    // stored scenes, pins, locks and the fade length are not edits: undo leaves them as they are
    ctx.store.keepOnUndo = ['scenes', 'pins', 'frozen', 'fade', 'open']
  },
  expose: { ui, metaNow, commit, setValue, recallScene, storeScene, toggleOff, audition, fader, fade, ops, panel, layoutOf, dragHooks },
})
