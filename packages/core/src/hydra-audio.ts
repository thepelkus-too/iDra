// An `a`-compatible audio object that mirrors hydra-synth/src/lib/audio.js (v1.4.0) but is fed analysis data
// instead of owning a microphone: Hydra's own class calls getUserMedia in its constructor and cannot take a stream.
// The formulas in `feed()` are a line-for-line port of `tick()`; test/audio.test.ts compares both on identical input.
//
// Runs inside the sandboxed frame (and in tests). No imports from the rest of core so the frame bundle stays small.

export interface HydraAudioSettings {
  bins: number
  cutoff: number
  scale: number
  smooth: number
}

export interface HydraAudioOptions {
  numBins?: number
  cutoff?: number
  smooth?: number
  max?: number
  scale?: number
  isDrawing?: boolean
  /** where the `a0…aN` helpers are installed (the sketch's global object); `false` to skip */
  target?: Record<string, unknown> | false
  /** parent element for the optional meter canvas shown by a.show() */
  parentEl?: HTMLElement | null
  /** called when the sketch changes settings, so the host panel can follow */
  onSettings?: (s: HydraAudioSettings) => void
}

export class HydraAudio {
  vol = 0
  scale: number
  max: number
  cutoff: number
  smooth: number
  bins: number[] = []
  prevBins: number[] = []
  fft: number[] = []
  settings: Array<{ cutoff: number; scale: number; smooth: number }> = []
  isDrawing: boolean
  beat = { holdFrames: 20, threshold: 40, _cutoff: 0, decay: 0.98, _framesSinceBeat: 0 }
  onBeat: () => void = () => {}
  canvas?: HTMLCanvasElement
  ctx?: CanvasRenderingContext2D | null
  private target: Record<string, unknown> | false
  private onSettings?: (s: HydraAudioSettings) => void

  constructor({ numBins = 4, cutoff = 2, smooth = 0.4, max = 15, scale = 10, isDrawing = false, target, parentEl, onSettings }: HydraAudioOptions = {}) {
    this.scale = scale
    this.max = max
    this.cutoff = cutoff
    this.smooth = smooth
    this.isDrawing = isDrawing
    this.target = target === undefined ? ((globalThis as unknown) as Record<string, unknown>) : target
    this.onSettings = onSettings
    this.setBins(numBins, true)
    if (parentEl && typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas')
      this.canvas.width = 100
      this.canvas.height = 80
      this.canvas.style.cssText = 'width:100px;height:80px;position:absolute;right:0;bottom:0;display:none'
      parentEl.appendChild(this.canvas)
      this.ctx = this.canvas.getContext('2d')
      if (this.ctx) {
        this.ctx.fillStyle = '#DFFFFF'
        this.ctx.strokeStyle = '#0ff'
        this.ctx.lineWidth = 0.5
      }
    }
  }

  /** Same maths as Audio.tick(): `specific` is Meyda's loudness.specific (24 Bark bands), `total` its loudness.total. */
  feed(specific: ArrayLike<number>, total: number): void {
    this.vol = total
    if (!this.bins.length) return
    const reducer = (acc: number, cur: number) => acc + cur
    const spacing = Math.floor(specific.length / this.bins.length)
    const spec = Array.prototype.slice.call(specific) as number[]
    this.prevBins = this.bins.slice(0)
    this.bins = this.bins
      .map((_bin, index) => spec.slice(index * spacing, (index + 1) * spacing).reduce(reducer, 0))
      .map((bin, index) => bin * (1.0 - this.settings[index].smooth) + this.prevBins[index] * this.settings[index].smooth)
    this.fft = this.bins.map((bin, index) => Math.max(0, (bin - this.settings[index].cutoff) / this.settings[index].scale))
    if (this.isDrawing) this.draw()
  }

  /** Hydra calls this each tick; analysis is pushed through feed() instead. */
  tick(): void {}

  private changed() {
    this.onSettings?.({ bins: this.bins.length, cutoff: this.cutoff, scale: this.scale, smooth: this.smooth })
  }

  setCutoff(cutoff: number) {
    this.cutoff = cutoff
    this.settings = this.settings.map((el) => ((el.cutoff = cutoff), el))
    this.changed()
  }
  setSmooth(smooth: number) {
    this.smooth = smooth
    this.settings = this.settings.map((el) => ((el.smooth = smooth), el))
    this.changed()
  }
  setScale(scale: number) {
    this.scale = scale
    this.settings = this.settings.map((el) => ((el.scale = scale), el))
    this.changed()
  }
  setMax(max: number) {
    this.max = max
  }
  setBins(numBins: number, quiet = false) {
    this.bins = Array(numBins).fill(0)
    this.prevBins = Array(numBins).fill(0)
    this.fft = Array(numBins).fill(0)
    this.settings = Array(numBins)
      .fill(0)
      .map(() => ({ cutoff: this.cutoff, scale: this.scale, smooth: this.smooth }))
    if (this.target) {
      const t = this.target
      this.bins.forEach((_bin, index) => {
        t['a' + index] = (scale = 1, offset = 0) => () => this.fft[index] * scale + offset
      })
    }
    if (!quiet) this.changed()
  }
  hide() {
    this.isDrawing = false
    if (this.canvas) this.canvas.style.display = 'none'
  }
  show() {
    this.isDrawing = true
    if (this.canvas) this.canvas.style.display = 'block'
  }
  draw() {
    const ctx = this.ctx
    if (!ctx || !this.canvas) return
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    const spacing = this.canvas.width / this.bins.length
    const scale = this.canvas.height / (this.max * 2)
    this.bins.forEach((bin, index) => {
      const height = bin * scale
      ctx.fillRect(index * spacing, this.canvas!.height - height, spacing, height)
      const y = this.canvas!.height - scale * this.settings[index].cutoff
      ctx.beginPath()
      ctx.moveTo(index * spacing, y)
      ctx.lineTo((index + 1) * spacing, y)
      ctx.stroke()
      const yMax = this.canvas!.height - scale * (this.settings[index].scale + this.settings[index].cutoff)
      ctx.beginPath()
      ctx.moveTo(index * spacing, yMax)
      ctx.lineTo((index + 1) * spacing, yMax)
      ctx.stroke()
    })
  }

  getSettings(): HydraAudioSettings {
    return { bins: this.bins.length, cutoff: this.cutoff, scale: this.scale, smooth: this.smooth }
  }
  /** Host → frame settings sync (does not echo back). */
  applySettings(s: Partial<HydraAudioSettings>) {
    if (s.cutoff !== undefined) {
      this.cutoff = s.cutoff
      this.settings.forEach((x) => (x.cutoff = s.cutoff!))
    }
    if (s.scale !== undefined) {
      this.scale = s.scale
      this.settings.forEach((x) => (x.scale = s.scale!))
    }
    if (s.smooth !== undefined) {
      this.smooth = s.smooth
      this.settings.forEach((x) => (x.smooth = s.smooth!))
    }
    if (s.bins !== undefined && s.bins !== this.bins.length) this.setBins(s.bins, true)
  }
}
