// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import RealHydraAudio from '@hydra-src/lib/audio.js'
import Meyda from 'meyda'
import { HydraAudio, AudioEngine, audioChip, parseAudioChip, installSilentBypass, silentWav, MicSource, FileSource } from '../src/audio'
import { importText } from '../src/parse'

const bands = (seed: number) => Array.from({ length: 24 }, (_, i) => Math.abs(Math.sin(seed * 1.7 + i * 0.9)) * 6 + (i < 8 ? 3 : 0))

describe('HydraAudio mirrors hydra-synth Audio (real class, same inputs)', () => {
  for (const bins of [4, 6, 8, 3]) {
    test(`bins=${bins}: vol, bins and fft match frame by frame, with settings changes`, () => {
      const real: any = new RealHydraAudio({ numBins: 4, parentEl: document.body })
      // keep the real class away from window.a0… collisions: it writes window['a'+i]; ours goes to a private target
      const target: Record<string, unknown> = {}
      const mine = new HydraAudio({ numBins: 4, target })
      real.setBins(bins)
      mine.setBins(bins)
      for (let f = 0; f < 40; f++) {
        if (f === 10) {
          real.setCutoff(3); mine.setCutoff(3)
          real.setScale(7); mine.setScale(7)
          real.setSmooth(0.2); mine.setSmooth(0.2)
        }
        const specific = bands(f)
        const total = specific.reduce((a, b) => a + b, 0)
        real.meyda = { get: () => ({ loudness: { total, specific } }) }
        real.tick()
        mine.feed(specific, total)
        expect(mine.vol).toBe(real.vol)
        expect(mine.bins).toEqual(real.bins)
        expect(mine.fft).toEqual(real.fft)
      }
      // like Hydra, helpers created for a larger bin count are never removed
      expect(Object.keys(target).sort()).toEqual(Array.from({ length: Math.max(4, bins) }, (_, i) => 'a' + i).sort())
    })
  }

  test('setBins creates a0…aN helpers returning () => fft[i]*scale+offset', () => {
    const target: Record<string, any> = {}
    const a = new HydraAudio({ numBins: 3, target })
    a.fft = [0.5, 1, 2]
    expect(target.a0()()).toBe(0.5)
    expect(target.a1(10, 1)()).toBe(11)
    expect(target.a2(2)()).toBe(4)
    expect(target.a3).toBeUndefined()
    a.setBins(5)
    expect(target.a4).toBeTypeOf('function')
  })

  test('the formula, spelled out: fft = max(0, (bin - cutoff) / scale), bin smoothed by settings.smooth', () => {
    const a = new HydraAudio({ numBins: 2, cutoff: 2, scale: 10, smooth: 0.5, target: false })
    a.feed(Array(24).fill(1), 24) // spacing 12 → each bin sums 12 bands
    expect(a.bins[0]).toBeCloseTo(12 * 0.5) // smooth 0.5 with prev 0
    expect(a.fft[0]).toBeCloseTo((6 - 2) / 10)
    a.feed(Array(24).fill(1), 24)
    expect(a.bins[0]).toBeCloseTo(12 * 0.5 + 6 * 0.5)
  })

  test('host settings sync does not echo back; sketch-side changes are reported', () => {
    const seen: any[] = []
    const a = new HydraAudio({ numBins: 4, target: false, onSettings: (s) => seen.push(s) })
    a.applySettings({ cutoff: 5, bins: 6 })
    expect(seen).toHaveLength(0)
    expect(a.cutoff).toBe(5)
    expect(a.bins).toHaveLength(6)
    a.setScale(3)
    expect(seen).toEqual([{ bins: 6, cutoff: 5, scale: 3, smooth: 0.4 }])
  })
})

describe('audioChip', () => {
  test('builds the fn Value and parses it back', () => {
    expect(audioChip(0)).toEqual({ k: 'fn', src: '() => a.fft[0]' })
    expect(audioChip(2, 3)).toEqual({ k: 'fn', src: '() => a.fft[2] * 3' })
    expect((audioChip(1, 0.5, -0.25) as { src: string }).src).toBe('() => a.fft[1] * 0.5 - 0.25')
    for (const [bin, scale, offset] of [[0, 1, 0], [3, 2.5, 0.1], [1, -2, -1], [7, 1, 4]]) {
      expect(parseAudioChip(audioChip(bin, scale, offset))).toEqual({ bin, scale, offset })
    }
    expect(parseAudioChip({ k: 'fn', src: '() => Math.sin(time)' })).toBeUndefined()
    expect(parseAudioChip({ k: 'num', v: 1 })).toBeUndefined()
  })
  test('the imported sketch contains the same Value an editor would build', () => {
    const { sketch } = importText('osc(() => a.fft[1] * 4 + 2, 0.1).out()')
    const arg: any = (sketch.stmts[0] as any).chain.gen.args[0]
    expect(parseAudioChip(arg)).toEqual({ bin: 1, scale: 4, offset: 2 })
    expect(arg).toEqual(audioChip(1, 4, 2))
  })
})

// ------------------------------------------------------------------ engine with a mocked AudioContext

function mockContext() {
  const listeners: Record<string, Array<() => void>> = {}
  const nodes: any[] = []
  const mkNode = (extra: object = {}) => {
    const n: any = { connected: [] as any[], connect(x: any) { n.connected.push(x); return x }, disconnect() { n.connected = [] }, ...extra }
    nodes.push(n)
    return n
  }
  const ctx: any = {
    state: 'suspended',
    sampleRate: 44100,
    destination: mkNode({ name: 'destination' }),
    resumeCalls: 0,
    async resume() { ctx.resumeCalls++; ctx.state = 'running'; (listeners.statechange || []).forEach((f) => f()) },
    async close() { ctx.state = 'closed' },
    addEventListener(e: string, f: () => void) { (listeners[e] ||= []).push(f) },
    createMediaStreamSource: (s: any) => mkNode({ kind: 'stream', stream: s }),
    createMediaElementSource: (el: any) => mkNode({ kind: 'element', el }),
    createGain: () => mkNode({ gain: { value: 1 } }),
    createAnalyser: () => mkNode({ fftSize: 0, getFloatTimeDomainData(buf: Float32Array) { for (let i = 0; i < buf.length; i++) buf[i] = Math.sin(i * 0.3) * 0.4 } }),
    fire: (state: string) => { ctx.state = state; (listeners.statechange || []).forEach((f) => f()) },
    nodes,
  }
  return ctx
}

describe('AudioEngine', () => {
  const run = async (src: any, ctx = mockContext()) => {
    const frames: any[] = []
    const engine = new AudioEngine({ contextFactory: () => ctx, scheduler: () => () => {}, silentBypass: false })
    engine.setSource(src)
    engine.onFrame((f) => frames.push(f))
    await engine.start()
    return { engine, ctx, frames }
  }
  const fakeStream = { getTracks: () => [{ stop: vi.fn() }] }

  test('mic: starts only after resume, analyses with Meyda loudness and mirrors Hydra bins', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => fakeStream) } })
    const { engine, ctx } = await run(new MicSource())
    expect(ctx.resumeCalls).toBeGreaterThan(0)
    expect(engine.state).toBe('running')
    const f = engine.pump()
    const buf = new Float32Array(512).map((_, i) => Math.sin(i * 0.3) * 0.4)
    Meyda.bufferSize = 512
    Meyda.sampleRate = 44100
    const expected = (Meyda.extract('loudness', buf) as any)
    expect(f.vol).toBeCloseTo(expected.total, 6)
    expect(f.specific).toHaveLength(24)
    expect(f.bins).toHaveLength(4)
    expect(f.fft.every((x) => x >= 0)).toBe(true)
    const gum = (navigator as any).mediaDevices.getUserMedia
    expect(gum).toHaveBeenCalledWith({ audio: expect.objectContaining({ echoCancellation: false }), video: false })
    // monitor is muted for the mic by default (feedback), file sources are audible
    expect(engine.monitorState.muted).toBe(true)
    engine.stop()
    expect(fakeStream.getTracks()[0].stop).toBeDefined()
    vi.unstubAllGlobals()
  })

  test('re-resumes after an iOS "interrupted" state change', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: async () => fakeStream } })
    const { engine, ctx } = await run(new MicSource())
    const before = ctx.resumeCalls
    ctx.fire('interrupted')
    await new Promise((r) => setTimeout(r, 0))
    expect(ctx.resumeCalls).toBe(before + 1)
    expect(ctx.state).toBe('running')
    engine.stop()
    vi.unstubAllGlobals()
  })

  test('monitor gain and mute drive the gain node', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: async () => fakeStream } })
    const { engine, ctx } = await run(new MicSource())
    const gain = ctx.nodes.find((n: any) => n.gain)
    expect(gain.gain.value).toBe(0) // muted mic
    engine.setMonitorMuted(false)
    engine.setMonitorGain(0.4)
    expect(gain.gain.value).toBeCloseTo(0.4)
    engine.setMonitorMuted(true)
    expect(gain.gain.value).toBe(0)
    engine.stop()
    vi.unstubAllGlobals()
  })

  test('file source exposes a transport and starts audible', async () => {
    const play = vi.fn(async () => {})
    class FakeAudio { loop = false; crossOrigin = ''; preload = ''; src = ''; paused = true; currentTime = 0; duration = 12; play = play; pause = vi.fn(); setAttribute() {} }
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }))
    const { engine } = await run(new FileSource(new Blob(['x']), 'loop.wav'))
    expect(engine.source!.transport!.duration).toBe(12)
    expect(play).toHaveBeenCalled()
    expect(engine.monitorState.muted).toBe(false)
    engine.pause()
    expect(engine.state).toBe('paused')
    await engine.resume()
    expect(engine.state).toBe('running')
    engine.stop()
    vi.unstubAllGlobals()
  })

  test('a failing source puts the engine in the error state and rethrows', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: async () => { throw new Error('NotAllowedError') } } })
    const engine = new AudioEngine({ contextFactory: () => mockContext(), scheduler: () => () => {}, silentBypass: false })
    engine.setSource(new MicSource())
    await expect(engine.start()).rejects.toThrow('NotAllowedError')
    expect(engine.state).toBe('error')
    expect(engine.error).toMatch(/NotAllowed/)
    vi.unstubAllGlobals()
  })

  test('settings changes reach the host mirror and listeners', () => {
    const engine = new AudioEngine({ contextFactory: () => mockContext(), scheduler: () => () => {} })
    const seen: any[] = []
    engine.onSettings((s) => seen.push(s))
    engine.setSettings({ bins: 8, cutoff: 3 })
    expect(engine.getFrame().bins).toHaveLength(8)
    expect(seen[0]).toMatchObject({ bins: 8, cutoff: 3 })
  })

  test('the silent-switch bypass sets audioSession and loops a generated silent wav', async () => {
    const play = vi.fn(async () => {})
    let created: any
    class FakeAudio { loop = false; volume = 1; preload = ''; src = ''; play = play; pause = vi.fn(); setAttribute() {}; constructor() { created = this } }
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('navigator', { audioSession: { type: 'auto' } })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:silent', revokeObjectURL: () => {} }))
    const h = installSilentBypass()
    expect((navigator as any).audioSession.type).toBe('playback')
    expect(created.loop).toBe(true)
    expect(play).toHaveBeenCalled()
    h.stop()
    expect(created.pause).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  test('silentWav is a valid 1 s mono WAV of silence', async () => {
    const b = silentWav()
    const buf = await new Promise<ArrayBuffer>((res) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.readAsArrayBuffer(b) })
    const v = new DataView(buf)
    expect(String.fromCharCode(...new Uint8Array(buf, 0, 4))).toBe('RIFF')
    expect(v.getUint32(24, true)).toBe(8000)
    expect(buf.byteLength).toBe(44 + 8000)
    expect(new Uint8Array(buf, 44).every((x) => x === 128)).toBe(true)
  })
})
