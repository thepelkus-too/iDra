// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import RealHydraAudio from '@hydra-src/lib/audio.js'
import Meyda from 'meyda'
import {
  AudioEngine,
  AudioStartError,
  DeviceSource,
  HydraAudio,
  StreamSource,
  audioChip,
  audioChipSmooth,
  audioChipThreshold,
  audioSignalChip,
  isAudioChipSource,
  parseAudioBinding,
  parseAudioChip,
  saveAudioInput,
  savedAudioInput,
  micError,
  analysisConstraints,
} from '../src/audio'
import { AudioAssets, AudioAssetError } from '../src/audio-assets'
import { audioBindings } from '../src/audio-bindings'
import { importText } from '../src/parse'
import { toCode } from '../src/codegen'
import { isSafeExpression } from '../src/safe-expr'
import { needsTrustPrompt } from '../src/trust'
import { setArg } from '../src/ir'

// ------------------------------------------------------------------ fixed WAV vs hydra-synth's own Audio class

function readWav(path: string): { rate: number; samples: Float32Array } {
  const b = readFileSync(path)
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  expect(b.toString('ascii', 0, 4)).toBe('RIFF')
  const rate = v.getUint32(24, true)
  const bits = v.getUint16(34, true)
  expect(bits).toBe(16)
  const n = v.getUint32(40, true) / 2
  const samples = new Float32Array(n)
  for (let i = 0; i < n; i++) samples[i] = v.getInt16(44 + i * 2, true) / 32768
  return { rate, samples }
}

describe('fixed WAV regression: Meyda loudness → HydraAudio equals hydra-synth/src/lib/audio.js', () => {
  const wav = readWav(resolve(__dirname, 'fixtures/beats.wav'))
  const frames = () => {
    Meyda.bufferSize = 512
    Meyda.sampleRate = wav.rate
    const out: Array<{ total: number; specific: number[] }> = []
    for (let i = 0; i + 512 <= wav.samples.length; i += 512) {
      const r: any = Meyda.extract('loudness', wav.samples.slice(i, i + 512))
      out.push({ total: r.total, specific: Array.from(r.specific) })
    }
    return out
  }

  test.each([
    { bins: 4, cutoff: 2, scale: 10, smooth: 0.4 },
    { bins: 6, cutoff: 0.5, scale: 4, smooth: 0.1 },
    { bins: 2, cutoff: 5, scale: 20, smooth: 0.8 },
  ])('every frame of beats.wav, %o: vol, bins, fft and beats are identical', (s) => {
    const real: any = new RealHydraAudio({ numBins: s.bins, cutoff: s.cutoff, scale: s.scale, smooth: s.smooth, parentEl: document.body })
    const mine = new HydraAudio({ numBins: s.bins, cutoff: s.cutoff, scale: s.scale, smooth: s.smooth, target: false })
    // a beat threshold the fixture crosses (Hydra's default 40 is for a loud room); the detector itself is unchanged
    real.beat.threshold = mine.beat.threshold = 6
    let realBeats = 0
    let myBeats = 0
    real.onBeat = () => realBeats++
    mine.onBeat = () => myBeats++
    const fs = frames()
    expect(fs.length).toBeGreaterThan(50)
    for (const f of fs) {
      real.meyda = { get: () => ({ loudness: f }) }
      real.tick()
      mine.feed(f.specific, f.total)
      expect(mine.vol).toBe(real.vol)
      expect(mine.bins).toEqual(real.bins)
      expect(mine.fft).toEqual(real.fft)
      expect(mine.beat).toEqual(real.beat)
    }
    expect(myBeats).toBe(realBeats)
    // the kicks in the fixture make the (unchanged) detector fire
    expect(myBeats).toBeGreaterThanOrEqual(2)
  })

  test('the analysed signal is not trivial (kicks drive fft[0])', () => {
    const mine = new HydraAudio({ numBins: 4, target: false })
    let max = 0
    for (const f of frames()) {
      mine.feed(f.specific, f.total)
      max = Math.max(max, mine.fft[0])
    }
    expect(max).toBeGreaterThan(0.2)
  })
})

// ------------------------------------------------------------------ chips

describe('audio chip variants', () => {
  test('plain, smoothed and gated chips round-trip through text and are recognised', () => {
    const vals = [audioChip(1, 4, 0.5), audioChipSmooth(0, 0.8, 4), audioChipThreshold(2, 0.5, 2, -1), audioSignalChip({ kind: 'vol' }, { scale: 0.1 }), audioSignalChip({ kind: 'vol' }, { smooth: 0.5 })]
    expect(vals.map((v: any) => v.src)).toEqual([
      '() => a.fft[1] * 4 + 0.5',
      '((v) => () => (v = v * 0.8 + a.fft[0] * 0.2) * 4)(0)',
      '() => (a.fft[2] > 0.5 ? 1 : 0) * 2 - 1',
      '() => a.vol * 0.1',
      '((v) => () => (v = v * 0.5 + a.vol * 0.5))(0)',
    ])
    let sk = importText('osc(10, 0.1, 1).color(1, 1, 1).out()').sketch
    const chain: any = sk.stmts[0]
    sk = setArg(sk, chain.chain.gen.id, 0, vals[0])
    sk = setArg(sk, chain.chain.gen.id, 1, vals[1])
    sk = setArg(sk, chain.chain.mods[0].id, 0, vals[2])
    sk = setArg(sk, chain.chain.mods[0].id, 1, vals[3])
    sk = setArg(sk, chain.chain.mods[0].id, 2, vals[4])
    const code = toCode(sk)
    const back: any = importText(code).sketch.stmts[0]
    const args = [...back.chain.gen.args.slice(0, 2), ...back.chain.mods[0].args]
    expect(args).toEqual(vals)
    expect(parseAudioChip(args[1])).toEqual({ bin: 0, scale: 4, offset: 0, smooth: 0.8 })
    expect(parseAudioChip(args[2])).toEqual({ bin: 2, scale: 2, offset: -1, threshold: 0.5 })
    expect(parseAudioChip(args[3])).toBeUndefined()
    expect(parseAudioBinding(args[3])).toEqual({ signal: { kind: 'vol' }, scale: 0.1, offset: 0 })
    // only-reads-`a` chips do not trip the trust gate
    for (const v of vals) expect(isAudioChipSource((v as any).src)).toBe(true)
    expect(isSafeExpression('((v) => () => (v = v * 0.8 + a.fft[0] * 0.2))(0)')).toBe(true)
    expect(isSafeExpression('((v) => () => (v = fetch(x)))(0)')).toBe(false)
    expect(needsTrustPrompt(importText(code).sketch)).toBe(false)
  })

  test('smoothed chips really smooth when Hydra evaluates them', () => {
    const a = { fft: [1], vol: 0 }
    const f = new Function('a', `return ${(audioChipSmooth(0, 0.5) as any).src}`)(a)
    expect([f(), f(), f()]).toEqual([0.5, 0.75, 0.875])
    const g = new Function('a', `return ${(audioChipThreshold(0, 0.9, 3) as any).src}`)(a)
    expect(g()).toBe(3)
  })
})

describe('AudioBindings', () => {
  test('lists fft bins + vol + beat (meter only), builds and identifies chips, throttles live values', () => {
    const engine = new AudioEngine({ contextFactory: () => ({}) as any, scheduler: () => () => {} })
    const b = audioBindings(engine)
    expect(b.list().map((x) => x.id)).toEqual(['fft0', 'fft1', 'fft2', 'fft3', 'vol', 'beat'])
    expect(b.list().find((x) => x.id === 'beat')!.bindable).toBe(false)
    let changed = 0
    b.onChange(() => changed++)
    engine.setSettings({ bins: 6 })
    expect(changed).toBe(1)
    expect(b.list().filter((x) => x.kind === 'fft')).toHaveLength(6)
    expect(b.chip('fft2', { scale: 3 })).toEqual(audioChip(2, 3))
    expect(b.chip('beat')).toBeUndefined()
    expect(b.identify(audioChipThreshold(1, 0.4))).toEqual({ id: 'fft1', opts: { scale: 1, offset: 0, threshold: 0.4 } })
    expect(b.identify({ k: 'fn', src: '() => time' })).toBeUndefined()
  })

  test('subscribe delivers a throttled value and holds a beat until the next delivery', () => {
    const engine = new AudioEngine({ contextFactory: () => ({}) as any, scheduler: () => () => {} })
    const listeners: any[] = []
    ;(engine as any).onFrame = (cb: any) => (listeners.push(cb), () => {})
    const b = audioBindings(engine)
    const got: number[] = []
    const beats: number[] = []
    b.subscribe('fft0', (v) => got.push(v), { fps: 1e9 })
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    b.subscribe('beat', (v) => beats.push(v), { fps: 10 })
    const frame = (fft0: number, beat = false) => ({ vol: 1, specific: [], bins: [], fft: [fft0], beat })
    listeners.forEach((l) => l(frame(0.3)))
    t = 10
    listeners.forEach((l) => l(frame(0.4, true))) // beat between two deliveries of the 10 fps subscriber
    t = 150
    listeners.forEach((l) => l(frame(0.5)))
    expect(got).toEqual([0.3, 0.4, 0.5])
    expect(beats).toEqual([0, 1])
    vi.restoreAllMocks()
  })
})

// ------------------------------------------------------------------ sources

/** A scriptable fake <audio>: `behaviour` decides which events fire after src is set. */
function fakeElements(plan: (el: any, n: number) => 'ok' | 'error' | 'never') {
  const made: any[] = []
  const factory = () => {
    const ls: Record<string, Array<() => void>> = {}
    const el: any = {
      crossOrigin: null, muted: false, preload: '', loop: false, paused: true, ended: false, currentTime: 0, duration: NaN, readyState: 0,
      addEventListener: (e: string, f: () => void) => (ls[e] ||= []).push(f),
      removeEventListener: (e: string, f: () => void) => (ls[e] = (ls[e] || []).filter((x) => x !== f)),
      removeAttribute: () => {},
      load: () => {},
      play: vi.fn(async () => { el.paused = false }),
      pause: vi.fn(() => { el.paused = true }),
      set src(v: string) {
        el._src = v
        const r = plan(el, made.indexOf(el))
        if (r !== 'never') setTimeout(() => (ls[r === 'ok' ? 'canplay' : 'error'] || []).forEach((f) => f()), 0)
      },
      get src() { return el._src },
    }
    made.push(el)
    return el
  }
  return { factory, made }
}

const ctx = () => {
  const nodes: any[] = []
  const mk = (x: object = {}) => { const n: any = { connect: () => n, disconnect: () => {}, ...x }; nodes.push(n); return n }
  return {
    state: 'running', sampleRate: 44100, destination: mk(), nodes,
    resume: async () => {}, addEventListener: () => {},
    createMediaElementSource: (el: any) => mk({ el }),
    createMediaStreamSource: (s: any) => mk({ s }),
    createGain: () => mk({ gain: { value: 1 } }),
    createAnalyser: () => mk({ fftSize: 0, getFloatTimeDomainData: (b: Float32Array) => b.fill(0) }),
  } as any
}

describe('StreamSource: CORS detection', () => {
  test('a CORS-enabled stream loads with crossOrigin=anonymous and is analysed', async () => {
    const { factory, made } = fakeElements(() => 'ok')
    const s = new StreamSource('https://radio.example/live.mp3', { createElement: factory })
    const node: any = await s.start(ctx())
    expect(made[0].crossOrigin).toBe('anonymous')
    expect(node.el).toBe(made[0])
    expect(s.label).toBe('radio.example/live.mp3')
  })
  test('without CORS: the anonymous load fails, a plain probe plays → "plays but doesn\'t allow analysis", play-only offered', async () => {
    const { factory, made } = fakeElements((el) => (el.crossOrigin === 'anonymous' ? 'error' : 'ok'))
    const s = new StreamSource('https://radio.example/nocors.mp3', { createElement: factory })
    const err = await s.start(ctx()).catch((e) => e)
    expect(err).toBeInstanceOf(AudioStartError)
    expect(err.code).toBe('no-cors')
    expect(err.canPlayOnly).toBe(true)
    expect(err.message).toMatch(/plays but doesn't allow analysis/)
    expect(made[1].crossOrigin).toBeNull()
    expect(made[1].muted).toBe(true)
  })
  test('unreachable: both loads fail', async () => {
    const { factory } = fakeElements(() => 'error')
    const err = await new StreamSource('https://nowhere.example/x.mp3', { createElement: factory }).start(ctx()).catch((e) => e)
    expect(err.code).toBe('unreachable')
    expect(err.canPlayOnly).toBe(false)
  })
  test('play-only mode plays outside Web Audio and gives the analyser silence', async () => {
    const { factory, made } = fakeElements(() => 'ok')
    const c = ctx()
    const s = new StreamSource('https://radio.example/nocors.mp3', { createElement: factory, playOnly: true })
    const node: any = await s.start(c)
    expect(made[0].crossOrigin).toBeNull()
    expect(made[0].play).toHaveBeenCalled()
    expect(node.gain).toBeDefined() // an input-less gain node: silence
    expect(c.nodes.some((n: any) => n.el)).toBe(false) // never wired through createMediaElementSource
  })
  test('HLS without native support is explained, not attempted', async () => {
    const err = await new StreamSource('https://radio.example/live.m3u8', { createElement: fakeElements(() => 'ok').factory }).start(ctx()).catch((e) => e)
    expect(err.code).toBe('unsupported')
    expect(err.message).toMatch(/HLS/)
  })

  test('engine: a playing stream that delivers only zeros is reported as blocked (analysis), and recovers on signal', async () => {
    const { factory } = fakeElements(() => 'ok')
    const c = ctx()
    let level = 0
    c.createAnalyser = () => ({ connect() {}, disconnect() {}, fftSize: 0, getFloatTimeDomainData: (b: Float32Array) => b.fill(level) })
    const engine = new AudioEngine({ contextFactory: () => c, scheduler: () => () => {}, silentBypass: false, silentFramesLimit: 5, analyze: () => ({ total: 0, specific: new Array(24).fill(0) }) })
    engine.setSource(new StreamSource('https://radio.example/a.mp3', { createElement: factory }))
    await engine.start()
    expect(engine.analysis).toBe('waiting')
    for (let i = 0; i < 6; i++) engine.pump()
    expect(engine.analysis).toBe('blocked')
    level = 0.1
    engine.pump()
    expect(engine.analysis).toBe('ok')
    engine.stop()
    expect(engine.analysis).toBe('off')
  })
})

describe('microphone, devices, hints', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => localStorage.clear())

  test('analysis constraints turn processing off; permission errors become plain advice', () => {
    expect(analysisConstraints('abc')).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: { exact: 'abc' } })
    const e = micError(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    expect(e.code).toBe('denied')
    expect(e.message).toMatch(/denied/)
    expect(micError(Object.assign(new Error('x'), { name: 'NotFoundError' })).code).toBe('not-found')
  })

  test('device choice persists, and a changed device id falls back to the same label', async () => {
    saveAudioInput({ deviceId: 'old-id', label: 'USB Audio Interface' })
    expect(savedAudioInput()).toEqual({ deviceId: 'old-id', label: 'USB Audio Interface' })
    const gum = vi.fn(async (c: any) => {
      if (c.audio.deviceId.exact === 'old-id') throw Object.assign(new Error('gone'), { name: 'OverconstrainedError' })
      return { getTracks: () => [{ stop() {} }] }
    })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum, enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'new-id', label: 'USB Audio Interface', groupId: 'g' }] } })
    const s = new DeviceSource('old-id', 'USB Audio Interface')
    await s.start(ctx())
    expect(gum).toHaveBeenCalledTimes(2)
    expect(gum.mock.calls[1][0].audio.deviceId).toEqual({ exact: 'new-id' })
    expect(savedAudioInput()?.deviceId).toBe('new-id')
  })

  test('feedback hint while mic + unmuted speakers; needsResume after an interruption', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } })
    const listeners: Array<() => void> = []
    const c = ctx()
    c.addEventListener = (_e: string, f: () => void) => listeners.push(f)
    c.resume = async () => {}
    const engine = new AudioEngine({ contextFactory: () => c, scheduler: () => () => {}, silentBypass: false })
    engine.setSource({ kind: 'mic' })
    await engine.start()
    expect(engine.hint).toBeUndefined() // mic starts muted
    engine.setMonitorMuted(false)
    expect(engine.hint).toMatch(/feed back/)
    expect(engine.needsResume).toBe(false)
    c.state = 'interrupted'
    listeners.forEach((f) => f())
    expect(engine.needsResume).toBe(true)
    c.resume = async () => void (c.state = 'running')
    await engine.resumeFromGesture()
    expect(engine.needsResume).toBe(false)
    engine.stop()
  })
})

describe('AudioAssets (opt-in kept files)', () => {
  test('keeps, lists, returns and removes files within the caps', async () => {
    const assets = new AudioAssets({ limits: { maxFile: 1000, maxTotal: 1500 } })
    const a = await assets.add(new Blob([new Uint8Array(800)], { type: 'audio/wav' }), 'a.wav')
    expect((await assets.list()).map((x) => x.name)).toEqual(['a.wav'])
    await expect(assets.add(new Blob([new Uint8Array(1200)]), 'big.wav')).rejects.toBeInstanceOf(AudioAssetError)
    await expect(assets.add(new Blob([new Uint8Array(900)]), 'b.wav')).rejects.toThrow(/more than/)
    const again = await assets.add(new Blob([new Uint8Array(800)]), 'a.wav') // same name+size replaces
    expect(again.id).toBe(a.id)
    const got = await assets.get(a.id)
    expect(got!.blob.size).toBe(800)
    await assets.remove(a.id)
    expect(await assets.list()).toEqual([])
  })
})
