// A GL-free stand-in for hydra-synth's HydraRenderer that runs the REAL pure-JS parts:
// generator-factory → glsl-source → generate-glsl → format-arguments, the real EvalSandbox and the real array utils.
// Only regl/Output are replaced, so `osc(...).rotate(...).out()` produces real shader strings and uniform closures.
// @ts-nocheck
import Generator from '@hydra-src/generator-factory.js'
import EvalSandbox from '@hydra-src/eval-sandbox.js'
import ArrayUtils from '@hydra-src/lib/array-utils.js'

class MockOutput {
  constructor(label, id) {
    this.label = label
    this.id = id
    this.precision = 'mediump'
    this.uniforms = { time: () => 0, resolution: () => [1, 1] }
    this.passes = undefined
    this.renders = 0
  }
  render(passes) {
    this.passes = passes
    this.renders++
  }
  getTexture() {
    return { fake: this.label }
  }
}

class MockSource {
  constructor(label) {
    this.label = label
    this.log = []
  }
  initCam(i) { this.log.push(['cam', i]) }
  initImage(u) { this.log.push(['image', u]) }
  initVideo(u) { this.log.push(['video', u]) }
  initScreen(i) { this.log.push(['screen', i]) }
  clear() { this.log.push(['clear']) }
  getTexture() { return { fake: this.label } }
}

export class MockHydra {
  static instances = []
  constructor(opts = {}) {
    MockHydra.instances.push(this)
    ArrayUtils.init()
    this.opts = opts
    this.width = opts.width ?? 1280
    this.height = opts.height ?? 720
    this.precision = 'mediump'
    this.canvas = opts.canvas
    this.o = [0, 1, 2, 3].map((i) => new MockOutput('o' + i, i))
    this.s = [0, 1, 2, 3].map((i) => new MockSource('s' + i))
    this.rendered = 'o0'
    this.screens = 0
    this.synth = {
      time: 0, bpm: 30, width: this.width, height: this.height, fps: undefined, stats: { fps: 0 }, speed: 1,
      mouse: { x: 0, y: 0 },
      render: (o) => { this.rendered = o ? o.label : 'all' },
      setResolution: (w, h) => this.setResolution(w, h),
      update: () => {}, afterUpdate: () => {},
      hush: () => this.hush(), tick: () => {},
    }
    this.o.forEach((o, i) => (this.synth['o' + i] = o))
    this.s.forEach((s, i) => (this.synth['s' + i] = s))
    this.generator = new Generator({
      defaultOutput: this.o[0],
      defaultUniforms: this.o[0].uniforms,
      extendTransforms: {},
      changeListener: ({ type, method, synth }) => {
        if (type === 'add') {
          this.synth[method] = synth.generators[method]
          if (this.sandbox) this.sandbox.add(method)
        }
      },
    })
    this.synth.setFunction = this.generator.setFunction.bind(this.generator)
    this.sandbox = new EvalSandbox(this.synth, opts.makeGlobal !== false, ['speed', 'update', 'afterUpdate', 'bpm', 'fps'])
  }
  eval(code) { this.sandbox.eval(code) }
  hush() {
    this.s.forEach((s) => s.clear())
    this.o.forEach((o) => this.synth.solid(0, 0, 0, 0).out(o))
    this.synth.render(this.o[0])
    this.sandbox.set('update', () => {})
    this.sandbox.set('afterUpdate', () => {})
  }
  setResolution(w, h) { this.width = w; this.height = h; this.canvas && (this.canvas.width = w, this.canvas.height = h) }
  getScreenImage(cb) { this.screens++; setTimeout(() => cb(new Blob(['x'], { type: 'image/png' })), 0) }
  /** evaluate every function-valued uniform of an output's shader, like regl would each frame */
  frame(outIndex = 0, props = { time: 1, bpm: 30 }) {
    const pass = this.o[outIndex].passes?.[0]
    if (!pass) return undefined
    const values = {}
    for (const [k, v] of Object.entries(pass.uniforms)) if (typeof v === 'function' && k !== 'prevBuffer' && k !== 'time' && k !== 'resolution') values[k] = v({}, props, 0)
    return { frag: pass.frag, values }
  }
}

export function resetMock() {
  MockHydra.instances.length = 0
}
