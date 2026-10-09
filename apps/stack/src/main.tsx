import * as core from '@hydra-ipad/core'
import { applyAppBase, createBackdrop, getAudioEngine, getLibrary, injectStyles, mountUpdateToast, parseRoute, routeHash, withMeta, type Sketch } from '@hydra-ipad/core'
import { render } from 'preact'
import { App } from './App'
import { ctx } from './ctx'
import { Runner } from './runner'
import { Store } from './store'
import { CSS } from './styles'
import { thumbs } from './thumbs'
import { codeBridge } from './ui/CodeView'
import { APP, autoView, metaOf } from './view'

applyAppBase()
document.documentElement.dataset.theme = 'dark'
injectStyles('stack', CSS)

const lib = getLibrary()

async function pickSketch(): Promise<Sketch> {
  await lib.seedIfEmpty()
  const id = parseRoute(location.hash).sketchId
  let s = id ? await lib.get(id) : undefined
  if (!s) s = await lib.mostRecent()
  if (!s) s = await lib.create('Untitled', 'osc(20, 0.1, 0.8).out()\n')
  if (location.hash !== routeHash(s.id)) history.replaceState(null, '', routeHash(s.id))
  return s
}

/** First open: build the default view (meta.stack) from the sketch; never touches another app's meta. */
function withView(s: Sketch): { sketch: Sketch; created: boolean } {
  if (metaOf(s)) return { sketch: s, created: false }
  return { sketch: withMeta(s, APP, autoView(s) as unknown as Record<string, unknown>), created: true }
}

async function boot() {
  const picked = await pickSketch()
  const first = withView(picked)
  if (first.created) void lib.put(first.sketch, { touch: false })

  const stage = document.createElement('div')
  stage.className = 'stage'
  stage.dataset.testid = 'stage'
  const store = new Store(first.sketch)
  const runner = new Runner(stage)
  // full-background preview: one preference shared by every editor; the runtime renders at the screen's aspect while it is on
  const backdrop = createBackdrop({ base: { width: 960, height: 540 }, setResolution: (w, h) => runner.rt?.setResolution(w, h) })
  runner.size = () => backdrop.resolution()
  runner.onStarted = () => backdrop.refresh()
  ctx.store = store
  ctx.runner = runner
  ctx.backdrop = backdrop
  ctx.lib = lib
  ctx.audio = getAudioEngine()

  // ------------------------------------------------------------ persistence + running
  let viewTimer: ReturnType<typeof setTimeout> | undefined
  let thumbTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleThumb = (ms = 4000) => {
    clearTimeout(thumbTimer)
    thumbTimer = setTimeout(async () => {
      const id = store.sketch.id
      const t = await runner.thumbnail(160)
      if (t && id === store.sketch.id && runner.status.phase === 'ok') await lib.setThumbnail(id, t)
    }, ms)
  }
  store.onChange(({ sketch, opts }) => {
    if (opts.source === 'load') return
    if (opts.view) {
      // view state (mode, active chain, rename) is saved but does not reorder the library or re-run the sketch
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
    // thumbnails after a run settles
    if (runner.status.phase === 'ok') scheduleThumb(5000)
  })

  async function load(s: Sketch) {
    const v = withView(s)
    if (v.created) void lib.put(v.sketch, { touch: false })
    runner.resetTrust()
    store.load(v.sketch)
    runner.run(true, v.sketch)
    scheduleThumb(2500)
  }

  window.addEventListener('hashchange', async () => {
    const id = parseRoute(location.hash).sketchId
    if (!id || id === store.sketch.id) return
    codeBridge.flush()
    await lib.flush()
    const s = await lib.get(id)
    if (s) await load(s)
  })
  const flush = () => {
    codeBridge.flush()
    void lib.flush()
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())

  mountUpdateToast({ onBeforeReload: () => lib.flush() })
  render(<App stage={stage} />, document.getElementById('app')!)
  ;(window as unknown as Record<string, unknown>).__stack = { store, runner, backdrop, lib, audio: ctx.audio, thumbs, ctx, core }

  await runner.start()
  runner.run(true, first.sketch)
  scheduleThumb(3000)
}

void boot()
