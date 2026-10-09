// Lazy 64×64 thumbnails of every function in its default state, rendered one at a time by a second, hidden Hydra runtime.
// Throttled (one every ~140 ms), cached for the session, and entirely optional: without WebGL the picker shows glyphs.
import { createRuntime, catalog, type FnDef, type Runtime } from '@hydra-ipad/core'

const SKIP = new Set(['src', 'prev'])

export function thumbSource(f: FnDef): string | undefined {
  if (SKIP.has(f.name)) return undefined
  // texture inputs get a small noise so combine / modulate functions have something to work on; floats get their defaults
  const args = f.inputs.map((i) => (i.type === 'sampler2D' ? 'noise(3, 0.1)' : i.type === 'float' ? String(typeof i.default === 'number' ? i.default : 0) : undefined))
  if (args.some((a) => a === undefined)) return undefined
  const call = `${f.name}(${(args as string[]).join(', ')})`
  const head = 'speed = 0\n'
  if (f.type === 'src') return `${head}${call}.out()`
  return `${head}osc(8, 0.1, 1).${call}.out()`
}

export class Thumbs {
  private cache = new Map<string, string | null>()
  private waiting = new Map<string, Array<(u: string | undefined) => void>>()
  private queue: string[] = []
  private rt?: Runtime
  private host?: HTMLElement
  private busy = false
  private dead = false
  /** how many thumbnails were produced (for tests) */
  made = 0

  has(name: string): boolean {
    return this.cache.has(name)
  }
  peek(name: string): string | undefined {
    return this.cache.get(name) ?? undefined
  }

  get(name: string): Promise<string | undefined> {
    if (this.cache.has(name)) return Promise.resolve(this.cache.get(name) ?? undefined)
    return new Promise((res) => {
      const w = this.waiting.get(name)
      if (w) w.push(res)
      else {
        this.waiting.set(name, [res])
        this.queue.push(name)
        void this.pump()
      }
    })
  }

  private ensure(): Runtime | undefined {
    if (this.dead) return undefined
    if (this.rt) return this.rt
    try {
      const host = document.createElement('div')
      host.setAttribute('aria-hidden', 'true')
      // off-screen but really laid out, so the canvas keeps rendering
      host.style.cssText = 'position:fixed;left:-300px;top:0;width:128px;height:128px;opacity:0;pointer-events:none;overflow:hidden'
      document.body.appendChild(host)
      this.host = host
      this.rt = createRuntime(host, { isolation: 'iframe', width: 128, height: 128, catalog })
      this.rt.onError(() => {})
      return this.rt
    } catch {
      this.dead = true
      return undefined
    }
  }

  private async pump(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      while (this.queue.length) {
        const name = this.queue.shift()!
        const f = catalog.get(name)
        const src = f && thumbSource(f)
        let url: string | undefined
        if (src) {
          const rt = this.ensure()
          if (rt) {
            try {
              await rt.ready
              const r = await rt.run(src, { force: true })
              if (r.ok) {
                await new Promise((res) => setTimeout(res, 90))
                url = await rt.thumbnail(64)
                this.made++
              }
            } catch {
              this.dead = true
            }
          }
        }
        this.cache.set(name, url ?? null)
        for (const cb of this.waiting.get(name) ?? []) cb(url)
        this.waiting.delete(name)
        await new Promise((res) => setTimeout(res, 140))
        if (this.dead) break
      }
    } finally {
      this.busy = false
      if (this.dead) {
        for (const [n, w] of this.waiting) for (const cb of w) cb(undefined), this.cache.set(n, null)
        this.waiting.clear()
        this.queue = []
      }
    }
  }

  dispose(): void {
    this.dead = true
    this.rt?.dispose()
    this.host?.remove()
  }
}

export const thumbs = new Thumbs()
