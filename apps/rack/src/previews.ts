// The pool the rack's previews use: the kit's shared pool, with one workaround. Core's pool compares preview plans by
// object identity while a runtime starts (`h.plan !== plan` in preview.ts `start()`), and `handle.update()` always makes
// a new plan object, even when nothing changed. PreviewPeek calls update() right after opening and on every store change,
// so a preview that was starting gave up and stayed "starting" for good (runs 0, frames 0). Until core compares
// `plan.key` (see the README's core change requests), updates wait while a handle is starting and are applied, merged,
// as soon as it leaves that state.
//
// The rack also holds module stills while numbers are moving (a knob turn, a glide, a scene fade): on demand, core
// refreshes every visible still after each burst of live numbers, and each refresh runs the chunk again in a preview
// runtime, which cost the main output frames while two knobs were turned (acceptance check 10). Stills catch up once the
// numbers have rested for `REST_MS`; an expanded preview keeps animating.
import type { PreviewHandle, PreviewPool, PreviewSpec, Sketch } from '@hydra-ipad/core'
import { kitPreviewPool } from '@hydra-ipad/kit'

type Update = Parameters<PreviewHandle['update']>[0]

const REST_MS = 400
let moving = false
let restTimer: ReturnType<typeof setTimeout> | undefined
const gates = new Set<() => void>()

/** Numbers are moving on the live path (call on every live push): module stills wait until they rest. */
export function liveActivity(): void {
  clearTimeout(restTimer)
  restTimer = setTimeout(() => {
    moving = false
    gates.forEach((g) => g())
  }, REST_MS)
  if (moving) return
  moving = true
  gates.forEach((g) => g())
}

/** A handle whose `update()` is held back while the underlying handle is starting. */
export function patientHandle(h: PreviewHandle): PreviewHandle {
  let pending: Update | undefined
  let seen = false
  let active = false
  const gate = () => h.setVisible(seen && (active || !moving))
  gates.add(gate)
  const unsub = h.onState(() => {
    if (!pending || h.state === 'starting') return
    const next = pending
    pending = undefined
    h.update(next)
  })
  const api: PreviewHandle = {
    get spec() {
      return h.spec
    },
    get state() {
      return h.state
    },
    get approximate() {
      return h.approximate
    },
    get notes() {
      return h.notes
    },
    get reason() {
      return h.reason
    },
    update(next) {
      if (h.state === 'starting') pending = { ...pending, ...next }
      else h.update(next)
    },
    setVisible(v) {
      seen = v
      gate()
    },
    setActive(a) {
      active = a
      h.setActive(a)
      gate()
    },
    setFps: (f) => h.setFps(f),
    onFrame: (cb) => h.onFrame(cb),
    onState: (cb) => h.onState(() => cb(api)),
    close() {
      unsub()
      gates.delete(gate)
      h.close()
    },
  }
  return api
}

let wrapped: PreviewPool | undefined

/** The rack's preview pool (the kit's shared pool, opened through `patientHandle`). */
export function rackPreviewPool(): PreviewPool {
  if (wrapped) return wrapped
  const pool = kitPreviewPool()
  wrapped = {
    open: (spec: PreviewSpec, c: { sketch: Sketch; trusted: boolean }) => patientHandle(pool.open(spec, c)),
    get stats() {
      return pool.stats
    },
    get mode() {
      return pool.mode
    },
    setMode: (m) => pool.setMode(m),
    dispose: () => pool.dispose(),
  }
  return wrapped
}
