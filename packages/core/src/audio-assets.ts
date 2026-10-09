// Opt-in "keep this audio file on this device" store. Audio is never embedded in sketches: a sketch is code, and the
// file the owner plays to it is a separate, local asset. Files are kept only when the owner ticks the box, within caps.

import { openSimpleStore, type SimpleStore } from './idb-store'

export interface AudioAsset {
  id: string
  name: string
  type: string
  size: number
  addedAt: number
}
// Bytes are stored as an ArrayBuffer rather than a Blob: older iOS versions could not keep Blobs in IndexedDB.
interface Row extends AudioAsset {
  data: ArrayBuffer
}

export const AUDIO_ASSET_LIMITS = {
  /** largest single file kept (bytes) */
  maxFile: 60 * 1024 * 1024,
  /** total kept (bytes); the oldest files are NOT evicted automatically: the owner chooses what to remove */
  maxTotal: 250 * 1024 * 1024,
}

export class AudioAssetError extends Error {}

function blobBytes(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer()
  return new Promise((ok, bad) => {
    const r = new FileReader()
    r.onload = () => ok(r.result as ArrayBuffer)
    r.onerror = () => bad(r.error)
    r.readAsArrayBuffer(b)
  })
}

export class AudioAssets {
  private storeP: Promise<SimpleStore<Row>> | undefined
  constructor(private opts: { indexedDB?: IDBFactory; limits?: Partial<typeof AUDIO_ASSET_LIMITS> } = {}) {}
  private store() {
    return (this.storeP ??= openSimpleStore<Row>('hydra-ipad-audio', 'files', this.opts.indexedDB ?? (globalThis as any).indexedDB))
  }
  get limits() {
    return { ...AUDIO_ASSET_LIMITS, ...this.opts.limits }
  }
  async list(): Promise<AudioAsset[]> {
    const rows = await (await this.store()).all()
    return rows.map(({ data: _d, ...meta }) => meta).sort((a, b) => b.addedAt - a.addedAt)
  }
  async usage(): Promise<number> {
    return (await this.list()).reduce((n, a) => n + a.size, 0)
  }
  /** Keep a file. Throws AudioAssetError when it is over the per-file or total cap. Same name + size → replaced. */
  async add(file: Blob, name = (file as File).name || 'audio'): Promise<AudioAsset> {
    const { maxFile, maxTotal } = this.limits
    const mb = (n: number) => `${Math.round(n / 1048576)} MB`
    if (file.size > maxFile) throw new AudioAssetError(`“${name}” is ${mb(file.size)}; files over ${mb(maxFile)} are not kept on the device.`)
    const existing = (await this.list()).find((a) => a.name === name && a.size === file.size)
    const used = (await this.usage()) - (existing?.size ?? 0)
    if (used + file.size > maxTotal) throw new AudioAssetError(`Keeping “${name}” would use more than ${mb(maxTotal)}. Remove a kept file first.`)
    const meta: AudioAsset = { id: existing?.id ?? `au${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, type: file.type || 'audio/*', size: file.size, addedAt: Date.now() }
    await (await this.store()).put(meta.id, { ...meta, data: await blobBytes(file) })
    return meta
  }
  async get(id: string): Promise<{ meta: AudioAsset; blob: Blob } | undefined> {
    const r = await (await this.store()).get(id)
    if (!r) return undefined
    const { data, ...meta } = r
    return { meta, blob: new Blob([data], { type: meta.type }) }
  }
  async remove(id: string): Promise<void> {
    await (await this.store()).delete(id)
  }
}

let shared: AudioAssets | undefined
export function getAudioAssets(): AudioAssets {
  return (shared ??= new AudioAssets())
}
