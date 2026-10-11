// A small live picture of one chunk: "everything up to here" for a call, or a before/after pair for a modifier. The pictures
// come from core's preview pool (small hidden runtimes, docs/previews-runtime.md); the main output is never touched.
import { createPreviewPool, onPreviewMode, previewMode, type PreviewHandle, type PreviewPool, type PreviewPoolOptions, type PreviewSpec, type Sketch } from '@hydra-ipad/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import { kitHost, useHost } from './host'

let shared: PreviewPool | undefined

/** The editor's one preview pool, made on first use (following the kit host's main runtime). */
export function kitPreviewPool(options: PreviewPoolOptions = {}): PreviewPool {
  shared ??= createPreviewPool({ main: () => kitHost()?.runtime?.(), ...options })
  return shared
}

/** Drop the shared pool (an editor tearing down, tests). */
export function disposeKitPreviewPool(): void {
  shared?.dispose()
  shared = undefined
}

export interface PreviewPeekProps {
  spec: PreviewSpec
  /** defaults to `kitPreviewPool()` */
  pool?: PreviewPool
  /** default: the kit host's sketch and trust */
  sketch?: Sketch
  trusted?: boolean
  /** what is previewed, for the accessible name ("osc → rotate") */
  label?: string
  class?: string
}

const specKey = (s: PreviewSpec) => (s.kind === 'prefix' ? `p:${s.chainId}:${s.upToCallId ?? ''}` : `d:${s.callId}`)

/** what the peek says instead of a picture, or undefined while it has (or is about to get) one */
export function peekMessage(h: Pick<PreviewHandle, 'state' | 'reason'>): string | undefined {
  switch (h.state) {
    case 'off':
      return 'Previews are off'
    case 'untrusted':
      return 'Runs once you run the sketch'
    case 'refused':
      return h.reason ?? 'Can’t be previewed on its own'
    case 'error':
      return h.reason ?? 'The preview failed'
    default:
      return undefined
  }
}

/**
 * A thumbnail (128×72 CSS px) of the chunk. Tap: it expands to the full preview size and animates, even when previews are
 * "on demand"; tap again to fold it. A diff spec shows "after" and, expanded, an A/B toggle between before and after.
 * "≈" marks an approximate preview (it reads another output, prev() or a camera, seen through a copy of the main picture
 * about once a second); its title lists why. Offscreen peeks pause. Renders nothing while previews are off.
 */
export function PreviewPeek({ spec, pool, sketch, trusted, label, class: cls }: PreviewPeekProps) {
  const host = useHost()
  const sk = sketch ?? host?.sketch()
  const tr = trusted ?? host?.trusted() ?? false
  const canvas = useRef<HTMLCanvasElement>(null)
  const handle = useRef<PreviewHandle>()
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<'a' | 'b'>('b')
  const sideRef = useRef(side)
  sideRef.current = side
  const [, bump] = useState(0)
  const [mode, setMode] = useState(previewMode())
  useEffect(() => onPreviewMode(setMode), [])
  const key = specKey(spec)

  useEffect(() => {
    if (!sk) return
    const p = pool ?? kitPreviewPool()
    const h = p.open(spec, { sketch: sk, trusted: tr })
    handle.current = h
    const offs = [
      h.onState(() => bump((v) => v + 1)),
      h.onFrame((f) => {
        const c = canvas.current
        const bmp = f.b && sideRef.current === 'b' ? f.b : f.a
        if (!c) return
        if (c.width !== bmp.width || c.height !== bmp.height) {
          c.width = bmp.width
          c.height = bmp.height
        }
        c.getContext('2d')?.drawImage(bmp, 0, 0)
      }),
    ]
    let io: IntersectionObserver | undefined
    if (typeof IntersectionObserver === 'function' && canvas.current) {
      io = new IntersectionObserver((es) => es.forEach((e) => h.setVisible(e.isIntersecting)))
      io.observe(canvas.current)
    } else h.setVisible(true)
    bump((v) => v + 1)
    return () => {
      io?.disconnect()
      offs.forEach((f) => f())
      h.close()
      handle.current = undefined
    }
    // the sketch and trust follow through update() below; a new spec or pool is a new preview
  }, [key, pool, !!sk])
  useEffect(() => handle.current?.update({ sketch: sk, trusted: tr }), [sk, tr])
  useEffect(() => handle.current?.setActive(open), [open])

  if (mode === 'off') return null
  const h = handle.current
  const msg = h ? peekMessage(h) : undefined
  const isDiff = spec.kind === 'diff'
  const why = h?.approximate ? `Approximate: ${h.notes.join(' ')}` : undefined
  return (
    <div class={`preview-peek${open ? ' open' : ''}${h?.approximate ? ' approximate' : ''}${msg ? ' empty' : ''}${cls ? ` ${cls}` : ''}`} data-state={h?.state}>
      <button type="button" class="peek-pic" aria-expanded={open} aria-label={`${open ? 'Fold' : 'Expand'} preview${label ? ` of ${label}` : ''}`} title={why} onClick={() => setOpen(!open)}>
        <canvas ref={canvas} width={256} height={144} />
        {msg && <span class="peek-msg">{msg}</span>}
        {h?.approximate && <span class="peek-badge" aria-label="approximate">≈</span>}
        {h && /^(waiting|starting)$/.test(h.state) && <span class="peek-spin" aria-hidden="true" />}
      </button>
      {isDiff && open && (
        <div class="peek-ab" role="group" aria-label="Before or after">
          <button type="button" aria-pressed={side === 'a'} onClick={() => setSide('a')}>A · before</button>
          <button type="button" aria-pressed={side === 'b'} onClick={() => setSide('b')}>B · after</button>
        </div>
      )}
      {open && why && <div class="peek-note">{why}</div>}
    </div>
  )
}
