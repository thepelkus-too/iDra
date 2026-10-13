// Node previews: the node's 👁 pins a thumbnail of "everything up to here" (its chain's generator and enabled modifiers up to
// this node) above it; on a modifier, A/B turns that thumbnail into a before/after pair. The pictures come from the kit's
// <PreviewPeek> and core's preview pool: a few small hidden runtimes, shared by all thumbnails (at most the pool's size run
// at once; the others keep their last still). The main output is never touched, and nothing runs offscreen.
import { PreviewPeek, toast } from '@hydra-ipad/kit'
import { graphOf, metaNow, ui, useUi } from '../doc'
import { ctx, useStore } from '../kit/ctx'
import { nodeById } from '../model'
import { previewSpecFor } from '../peek'

export { previewSpecFor }

/** Pin or unpin a node's thumbnail. */
export function togglePreview(id: string): void {
  const cur = metaNow().previews ?? []
  if (cur.includes(id)) {
    if (ui.state.ab === id) ui.set({ ab: undefined })
    return ctx.store.setView({ previews: cur.filter((x) => x !== id) })
  }
  const n = nodeById(graphOf(), id)
  if (!n || !previewSpecFor(ctx.store.sketch, n)) return void toast(n?.kind === 'out' ? 'Nothing writes this output yet' : 'Previews show a chain node or an output')
  ctx.store.setView({ previews: [...cur, id] })
}

/** A/B on a modifier: pin it if needed and show its before/after. */
export function toggleAB(id: string): void {
  if (ui.state.ab === id) return ui.set({ ab: undefined })
  if (!(metaNow().previews ?? []).includes(id)) togglePreview(id)
  ui.set({ ab: id })
}

/**
 * The pinned thumbnails, each above its node. Drawn beside the cards rather than inside them, so a switched-off node's
 * dimming does not dim its preview, and taps on a thumbnail never start a node drag.
 */
export function NodePeeks({ pos, hidden }: { pos: (id: string) => { x: number; y: number }; hidden: (id: string) => boolean }) {
  useStore()
  const st = useUi()
  if (st.perform) return null
  const sk = ctx.store.sketch
  const g = graphOf(sk)
  const ids = (metaNow(sk).previews ?? []).filter((id) => !hidden(id))
  return (
    <>
      {ids.map((id) => {
        const n = nodeById(g, id)
        const p = n && previewSpecFor(sk, n, st.ab === id)
        if (!n || !p) return null
        const at = pos(id)
        return (
          <div key={id} class="gpeek" style={{ transform: `translate(${at.x}px,${at.y}px)` }} data-testid="node-preview" data-node-peek={id} data-no-undo-tap>
            <div class="gpeek-in">
            <PreviewPeek key={`${id}:${p.spec.kind}`} spec={p.spec} label={p.label} />
            <div class="gpeek-tools">
              {p.mod && (
                <button type="button" class={`btn sm ${st.ab === id ? 'on' : ''}`} data-testid="peek-ab" aria-pressed={st.ab === id} title="Before and after this node" onClick={() => toggleAB(id)}>
                  A/B
                </button>
              )}
              <button type="button" class="btn sm" data-testid="peek-close" aria-label="Unpin this preview" onClick={() => togglePreview(id)}>
                ✕
              </button>
            </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
