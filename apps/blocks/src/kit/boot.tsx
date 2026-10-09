// Startup shared by the editors: pick the sketch from the route (contract §1), build the default view for a sketch this app
// has never seen (§3), autosave (§2), run the preview with the trust gate (§6), follow `hashchange`, flush on pagehide.
import * as core from '@hydra-ipad/core'
import { applyAppBase, getAudioEngine, getLibrary, injectStyles, mountUpdateToast, parseRoute, routeHash, withMeta, type Sketch } from '@hydra-ipad/core'
import { render, type ComponentType } from 'preact'
import { APP } from '../app'
import { codeBridge } from './CodeDrawer'
import { ctx } from './ctx'
import { Runner } from './runner'
import { Store } from './store'
import { BASE_CSS } from './styles'

export interface BootOptions {
  /** the app's default view for a sketch without `meta[APP]` (pure) */
  autoView: (s: Sketch) => object
  /** is the stored view usable (right version)? */
  hasView: (s: Sketch) => boolean
  App: ComponentType<{ stage: HTMLElement }>
  css: string
  /** extra handles for tests/e2e on window.__app */
  expose?: Record<string, unknown>
  /** called after a sketch is loaded (first open and hashchange) */
  onLoad?: (s: Sketch) => void
  starterCode?: string
}

export function withView(s: Sketch, o: Pick<BootOptions, 'autoView' | 'hasView'>): { sketch: Sketch; created: boolean } {
  if (o.hasView(s)) return { sketch: s, created: false }
  return { sketch: withMeta(s, APP, o.autoView(s) as Record<string, unknown>), created: true }
}

export async function boot(o: BootOptions): Promise<void> {
  applyAppBase()
  document.documentElement.dataset.theme = 'dark'
  injectStyles(`${APP}-base`, BASE_CSS)
  injectStyles(APP, o.css)
  const lib = getLibrary()

  await lib.seedIfEmpty()
  const id = parseRoute(location.hash).sketchId
  let picked = id ? await lib.get(id) : undefined
  if (!picked) picked = await lib.mostRecent()
  if (!picked) picked = await lib.create('Untitled', o.starterCode ?? 'osc(20, 0.1, 0.8).out()\n')
  if (location.hash !== routeHash(picked.id)) history.replaceState(null, '', routeHash(picked.id))
  const first = withView(picked, o)
  if (first.created) void lib.put(first.sketch, { touch: false })

  const stage = document.createElement('div')
  stage.className = 'stage'
  stage.dataset.testid = 'stage'
  const store = new Store(first.sketch)
  const runner = new Runner(stage)
  ctx.store = store
  ctx.runner = runner
  ctx.lib = lib
  ctx.audio = getAudioEngine()

  let viewTimer: ReturnType<typeof setTimeout> | undefined
  let thumbTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleThumb = (ms = 4000) => {
    clearTimeout(thumbTimer)
    thumbTimer = setTimeout(async () => {
      const sid = store.sketch.id
      const t = await runner.thumbnail(160)
      if (t && sid === store.sketch.id && runner.status.phase === 'ok') await lib.setThumbnail(sid, t)
    }, ms)
  }
  store.onChange(({ sketch, opts }) => {
    if (opts.source === 'load') return
    if (opts.view) {
      // view state is saved but does not reorder the library or re-run the sketch
      if (lib.hasPending()) lib.autosave(sketch)
      else {
        clearTimeout(viewTimer)
        viewTimer = setTimeout(() => void lib.put(store.sketch, { touch: false }), 300)
      }
      return
    }
    lib.autosave(sketch)
    if (opts.noRun) runner.track(sketch)
    else runner.run(false, sketch)
    scheduleThumb()
  })
  runner.subscribe(() => {
    if (runner.status.phase === 'ok') scheduleThumb(5000)
  })

  async function load(s: Sketch) {
    const v = withView(s, o)
    if (v.created) void lib.put(v.sketch, { touch: false })
    runner.resetTrust()
    store.load(v.sketch)
    o.onLoad?.(v.sketch)
    runner.run(true, v.sketch)
    scheduleThumb(2500)
  }

  window.addEventListener('hashchange', async () => {
    const nid = parseRoute(location.hash).sketchId
    if (!nid || nid === store.sketch.id) return
    codeBridge.flush()
    await lib.flush()
    const s = await lib.get(nid)
    if (s) await load(s)
  })
  const flush = () => {
    codeBridge.flush()
    void lib.flush()
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())

  mountUpdateToast({ onBeforeReload: () => lib.flush() })
  const App = o.App
  render(<App stage={stage} />, document.getElementById('app')!)
  const handles = { store, runner, lib, audio: ctx.audio, ctx, core, ...(o.expose ?? {}) }
  ;(window as unknown as Record<string, unknown>).__app = handles
  ;(window as unknown as Record<string, unknown>)[`__${APP}`] = handles
  o.onLoad?.(first.sketch)

  await runner.start()
  runner.run(true, first.sketch)
  scheduleThumb(3000)
}
