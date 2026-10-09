// Full-background ("backdrop") preview: the live output fills the whole screen behind the editor, the way hydra.ojack.xyz
// shows code over the running texture. One shared preference for every editor (switching editors keeps it), a veil
// strength for readability, and render-resolution fitting so the texture is not stretched to the screen's aspect.
//
// The stage element is never moved in the DOM (moving an iframe reloads it): the editor marks the element that holds the
// stage with `data-hi-backdrop="stage"` and the CSS below pins it to the viewport, behind everything else, while the
// root carries the `hi-backdrop` class. Editors restyle their own panels with the `--hi-veil` token. See
// docs/FRONTEND_CONTRACT.md §6 "Backdrop".
import { appStorage, type AppStorage } from './storage'
import { injectStyles } from './ui'

export type PreviewPlacement = 'panel' | 'backdrop'
export type VeilStrength = 'light' | 'medium' | 'strong'

export const VEILS: readonly VeilStrength[] = ['light', 'medium', 'strong']
/** alpha of `--hi-veil` (a near-black wash behind text and controls) per strength */
export const VEIL_ALPHA: Record<VeilStrength, number> = { light: 0.35, medium: 0.55, strong: 0.78 }

export interface BackdropState {
  placement: PreviewPlacement
  veil: VeilStrength
}

const KEY_PLACEMENT = 'previewPlacement'
const KEY_VEIL = 'backdropVeil'

/** Shared preference (`hydra-core:` keys), read fresh each time so a switch in another editor or tab is seen. */
export function readBackdropState(store: AppStorage = appStorage('core')): BackdropState {
  const p = store.get<string>(KEY_PLACEMENT)
  const v = store.get<string>(KEY_VEIL)
  return {
    placement: p === 'backdrop' ? 'backdrop' : 'panel',
    veil: VEILS.includes(v as VeilStrength) ? (v as VeilStrength) : 'medium',
  }
}

/**
 * The render resolution for a full-screen backdrop: the viewport's aspect ratio, longest side at most `maxSide`
 * (Hydra itself renders at window size; this keeps the pixel count of a 1280×720 preview's order on a big iPad).
 */
export function fitResolution(viewW: number, viewH: number, maxSide = 1280): { width: number; height: number } {
  const w = Math.max(1, viewW)
  const h = Math.max(1, viewH)
  const s = Math.min(1, maxSide / Math.max(w, h))
  return { width: Math.max(16, Math.round(w * s)), height: Math.max(16, Math.round(h * s)) }
}

export const BACKDROP_CSS = `
html.hi-backdrop{--hi-veil:rgba(8,10,14,var(--hi-veil-a,.55));--hi-veil-line:rgba(255,255,255,.14);--hi-ink-shadow:0 1px 2px rgba(0,0,0,.9),0 0 6px rgba(0,0,0,.6)}
html.hi-backdrop,html.hi-backdrop body{background:#000}
html.hi-backdrop [data-hi-backdrop="stage"]{position:fixed!important;inset:0!important;width:auto!important;height:auto!important;z-index:0!important;pointer-events:none;background:#000;border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important;transform:none!important}
html.hi-backdrop [data-hi-backdrop="hide"]{display:none!important}
html:not(.hi-backdrop) [data-hi-backdrop="only"]{display:none!important}
.hi-veil{background:var(--hi-veil)}
.hi-ink{text-shadow:var(--hi-ink-shadow)}
`

export interface BackdropOptions {
  /** apply a render resolution, usually `(w, h) => runtime.setResolution(w, h)`. Called on enter, on viewport resize while on, and with `base` on leaving. */
  setResolution?: (width: number, height: number) => unknown
  /** the resolution used while the preview is a panel (default 960×540) */
  base?: { width: number; height: number }
  /** longest side of the backdrop resolution (default 1280) */
  maxSide?: number
  /** element that gets the `hi-backdrop` class and `--hi-veil-a` (default `document.documentElement`) */
  root?: HTMLElement
  /** preference store (default `appStorage('core')`, shared by every editor) */
  store?: AppStorage
}

export interface BackdropController {
  readonly state: BackdropState
  readonly on: boolean
  /** the resolution the runtime should have right now (pass it to `createRuntime` when (re)starting one) */
  resolution(): { width: number; height: number }
  setPlacement(p: PreviewPlacement): void
  toggle(): void
  setVeil(v: VeilStrength): void
  /** light → medium → strong → light */
  cycleVeil(): void
  /** re-apply the resolution (after the runtime was restarted) */
  refresh(): void
  subscribe(cb: (s: BackdropState) => void): () => void
  dispose(): void
}

/**
 * One per page. Owns the root class, the veil token and the runtime's resolution; the editor renders its own toggle
 * (`controller.toggle()`) and layout for `html.hi-backdrop`.
 */
export function createBackdrop(opts: BackdropOptions = {}): BackdropController {
  injectStyles('backdrop', BACKDROP_CSS)
  const store = opts.store ?? appStorage('core')
  const root = opts.root ?? (typeof document !== 'undefined' ? document.documentElement : undefined)
  const base = opts.base ?? { width: 960, height: 540 }
  const maxSide = opts.maxSide ?? 1280
  const listeners = new Set<(s: BackdropState) => void>()
  let state = readBackdropState(store)
  let applied = ''
  let timer: ReturnType<typeof setTimeout> | undefined

  const viewport = (): { w: number; h: number } => {
    if (typeof window === 'undefined') return { w: base.width, h: base.height }
    const vv = window.visualViewport
    // the layout viewport, not the keyboard-shrunk visual one: the backdrop must not re-render when the keyboard opens
    return { w: window.innerWidth || vv?.width || base.width, h: window.innerHeight || vv?.height || base.height }
  }
  const resolution = () => {
    if (state.placement !== 'backdrop') return { ...base }
    const v = viewport()
    return fitResolution(v.w, v.h, maxSide)
  }
  const applyResolution = (force = false) => {
    const r = resolution()
    const key = `${r.width}x${r.height}`
    if (!force && key === applied) return
    applied = key
    try {
      const p = opts.setResolution?.(r.width, r.height)
      if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => {})
    } catch {
      /* the runtime may not be ready yet; refresh() re-applies */
    }
  }
  const applyDom = () => {
    if (!root) return
    root.classList.toggle('hi-backdrop', state.placement === 'backdrop')
    root.dataset.hiVeil = state.veil
    root.style.setProperty('--hi-veil-a', String(VEIL_ALPHA[state.veil]))
  }
  const emit = () => {
    for (const cb of [...listeners]) cb(state)
  }
  const update = (next: BackdropState, persist: boolean) => {
    const changed = next.placement !== state.placement || next.veil !== state.veil
    state = next
    if (persist) {
      store.set(KEY_PLACEMENT, state.placement)
      store.set(KEY_VEIL, state.veil)
    }
    applyDom()
    applyResolution()
    if (changed) emit()
  }
  const onResize = () => {
    if (state.placement !== 'backdrop') return
    clearTimeout(timer)
    timer = setTimeout(() => applyResolution(), 150)
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key && !e.key.startsWith(store.prefix)) return
    update(readBackdropState(store), false)
  }

  applyDom()
  // the runtime starts at its own size; only a backdrop needs a different one
  applied = `${base.width}x${base.height}`
  applyResolution()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    window.addEventListener('storage', onStorage)
  }

  return {
    get state() {
      return state
    },
    get on() {
      return state.placement === 'backdrop'
    },
    resolution,
    setPlacement(p) {
      update({ ...state, placement: p }, true)
    },
    toggle() {
      update({ ...state, placement: state.placement === 'backdrop' ? 'panel' : 'backdrop' }, true)
    },
    setVeil(v) {
      update({ ...state, veil: v }, true)
    },
    cycleVeil() {
      update({ ...state, veil: VEILS[(VEILS.indexOf(state.veil) + 1) % VEILS.length] }, true)
    },
    refresh() {
      applyResolution(true)
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    dispose() {
      clearTimeout(timer)
      listeners.clear()
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onResize)
        window.removeEventListener('orientationchange', onResize)
        window.removeEventListener('storage', onStorage)
      }
      root?.classList.remove('hi-backdrop')
    },
  }
}
