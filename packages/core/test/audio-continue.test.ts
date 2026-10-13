// Node environment: fake-indexeddb keeps Node's Blobs intact (jsdom's Blob does not survive its structured clone).
import { describe, expect, test } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { AUDIO_CONTINUE_KEY, AUDIO_CONTINUE_MAX_AGE_MS, audioContinueRecord, readAudioContinue, sourceFromContinue, type AudioContinueRecord } from '../src/audio-continue'
import { AudioAssets } from '../src/audio-assets'
import { FileSource, MicSource, StreamSource, type AudioSource } from '../src/audio-sources'
import type { AudioEngine } from '../src/audio'

const engineWith = (source: AudioSource | undefined, state = 'running') => ({ source, state }) as unknown as AudioEngine
const memStorage = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage
}

describe('continuing audio on the next page', () => {
  test('a playing URL stream is kept with its place, speed and name; a blob: URL without a ref is not', () => {
    const s = new StreamSource('https://cdn.example/ep.mp3', { name: 'Ep 1', rate: 1.5 })
    Object.defineProperty(s.transport, 'currentTime', { get: () => 42 })
    expect(audioContinueRecord(engineWith(s), 1000)).toEqual({ kind: 'stream', ref: { url: 'https://cdn.example/ep.mp3' }, name: 'Ep 1', position: 42, rate: 1.5, loop: false, playOnly: false, savedAt: 1000 })
    expect(audioContinueRecord(engineWith(new StreamSource('blob:https://x/1')))).toBeUndefined()
  })

  test('nothing is kept when stopped, for the mic, or for a picked file that was not kept on the device', () => {
    expect(audioContinueRecord(engineWith(new StreamSource('https://a.example/x.mp3'), 'idle'))).toBeUndefined()
    expect(audioContinueRecord(engineWith(new MicSource()))).toBeUndefined()
    expect(audioContinueRecord(engineWith(new FileSource(new Blob([new Uint8Array(4)]), 'x.wav')))).toBeUndefined()
    expect(audioContinueRecord(engineWith(new FileSource(new Blob([new Uint8Array(4)]), 'x.wav', { ref: { assetId: 'a1' } })))?.ref).toEqual({ assetId: 'a1' })
  })

  test('a record older than the limit, or malformed, is ignored', () => {
    const st = memStorage()
    const r: AudioContinueRecord = { kind: 'stream', ref: { url: 'https://a.example/x.mp3' }, name: 'x', position: 3, rate: 1, loop: false, playOnly: false, savedAt: 0 }
    st.setItem(AUDIO_CONTINUE_KEY, JSON.stringify(r))
    expect(readAudioContinue(st, 10)).toEqual(r)
    expect(readAudioContinue(st, AUDIO_CONTINUE_MAX_AGE_MS + 1)).toBeUndefined()
    st.setItem(AUDIO_CONTINUE_KEY, '{nope')
    expect(readAudioContinue(st, 10)).toBeUndefined()
  })

  test('sources come back: a kept file from the device, a download as a stream from the device, else the URL', async () => {
    const assets = new AudioAssets({ indexedDB: new IDBFactory() })
    const a = await assets.add(new Blob([new Uint8Array(8)], { type: 'audio/wav' }), 'beats.wav')
    const base = { name: 'n', position: 12, rate: 1.25, loop: true, playOnly: false, savedAt: 0 }
    const file = await sourceFromContinue({ ...base, kind: 'file', ref: { assetId: a.id } }, { assets })
    expect(file).toBeInstanceOf(FileSource)
    expect(file?.resumeRef).toEqual({ assetId: a.id })
    const dl = await sourceFromContinue({ ...base, kind: 'stream', ref: { assetId: a.id, url: 'https://cdn.example/ep.mp3' } }, { assets })
    expect(dl).toBeInstanceOf(StreamSource)
    expect((dl as StreamSource).url).toMatch(/^blob:/)
    // deleted from the device: the URL is used instead
    await assets.remove(a.id)
    const gone = await sourceFromContinue({ ...base, kind: 'stream', ref: { assetId: a.id, url: 'https://cdn.example/ep.mp3' } }, { assets, proxy: null })
    expect((gone as StreamSource).url).toBe('https://cdn.example/ep.mp3')
    expect(await sourceFromContinue({ ...base, kind: 'file', ref: { assetId: a.id } }, { assets })).toBeUndefined()
  })
})
