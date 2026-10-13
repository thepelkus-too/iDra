// The pool the rack's previews use: the kit's shared pool, with module stills held while numbers move.
//
// The rack holds module stills while numbers are moving (a knob turn, a glide, a scene fade): on demand, core
// refreshes every visible still after each burst of live numbers, and each refresh runs the chunk again in a preview
// runtime, which cost the main output frames while two knobs were turned (acceptance check 10). Stills catch up once the
// numbers have rested for `REST_MS`; an expanded preview keeps animating.
import type { PreviewHandle, PreviewPool, PreviewSpec, Sketch } from '@hydra-ipad/core'
import { kitPreviewPool } from '@hydra-ipad/kit'

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

/** A handle whose still waits while numbers are moving, unless it is expanded. */
export function patientHandle(h: PreviewHandle): PreviewHandle {
  let seen = false
  let active = false
  const gate = () => h.setVisible(seen && (active || !moving))
  gates.add(gate)
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
    update: (next) => h.update(next),
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
