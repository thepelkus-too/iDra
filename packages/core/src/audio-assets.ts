// Opt-in "keep this audio file on this device" store. Audio is never embedded in sketches: a sketch is code, and the
// file the owner plays to it is a separate, local asset. Files are kept only when the owner ticks the box, within caps.

import { openSimpleStore, type SimpleStore } from './idb-store'

/** Where a downloaded podcast episode came from (absent for files the owner picked). */
export interface AudioAssetOrigin {
  /** the episode's audio URL (also the key for its saved position) */
  url: string
  title: string
  feedUrl?: string
  feedTitle?: string
  /** seconds, from the feed */
  duration?: number
  date?: number
}

export interface AudioAsset {
  id: string
  name: string
  type: string
  size: number
  addedAt: number
  /** set on downloaded podcast episodes */
  origin?: AudioAssetOrigin
}
// Picked files are stored as an ArrayBuffer (older iOS versions could not keep Blobs in IndexedDB). Downloaded episodes
// are stored as a Blob instead: they can be hundreds of MB, and a Blob lets the browser keep them on disk rather than
// copying them into one buffer (IndexedDB keeps Blobs on iOS 14+, the oldest Safari the build targets).
interface Row extends AudioAsset {
  data?: ArrayBuffer
  blob?: Blob
}

export const AUDIO_ASSET_LIMITS = {
  /** largest single picked file kept (bytes); stored as a Blob like downloads, so a long podcast MP3 fits */
  maxFile: 400 * 1024 * 1024,
  /** largest single downloaded episode (bytes) */
  maxDownload: 400 * 1024 * 1024,
  /** total kept, files and downloads together (bytes); nothing is evicted automatically: the owner chooses what to remove */
  maxTotal: 1024 * 1024 * 1024,
}

export class AudioAssetError extends Error {}

const mb = (n: number) => `${Math.round(n / 1048576)} MB`
const newId = () => `au${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

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
    return rows.map(({ data: _d, blob: _b, ...meta }) => meta).sort((a, b) => b.addedAt - a.addedAt)
  }
  async usage(): Promise<number> {
    return (await this.list()).reduce((n, a) => n + a.size, 0)
  }
  /** Keep a file. Throws AudioAssetError when it is over the per-file or total cap. Same name + size → replaced. */
  async add(file: Blob, name = (file as File).name || 'audio'): Promise<AudioAsset> {
    const { maxFile, maxTotal } = this.limits
    if (file.size > maxFile) throw new AudioAssetError(`“${name}” is ${mb(file.size)}; files over ${mb(maxFile)} are not kept on the device.`)
    const existing = (await this.list()).find((a) => a.name === name && a.size === file.size)
    const used = (await this.usage()) - (existing?.size ?? 0)
    if (used + file.size > maxTotal) throw new AudioAssetError(`Keeping “${name}” would use more than ${mb(maxTotal)}. Remove a kept file first.`)
    const meta: AudioAsset = { id: existing?.id ?? newId(), name, type: file.type || 'audio/*', size: file.size, addedAt: Date.now() }
    // a Blob, not its bytes: IndexedDB keeps it on disk without copying a long file into one buffer
    await (await this.store()).put(meta.id, { ...meta, blob: file.slice(0, file.size, file.type) })
    return meta
  }
  /** Throws AudioAssetError when a download of `size` bytes (or unknown size) would not fit. */
  async checkDownload(size: number | undefined, name: string): Promise<void> {
    const { maxDownload, maxTotal } = this.limits
    if (size !== undefined && size > maxDownload) throw new AudioAssetError(`“${name}” is ${mb(size)}; downloads over ${mb(maxDownload)} are not kept on the device.`)
    const used = await this.usage()
    if (used + (size ?? 0) > maxTotal) throw new AudioAssetError(`Downloading “${name}” would use more than ${mb(maxTotal)}. Delete a download or a kept file first (${mb(used)} used).`)
  }
  /** Keep a downloaded episode (stored as a Blob). The same episode URL replaces its earlier download. */
  async addDownload(blob: Blob, origin: AudioAssetOrigin, name = origin.title): Promise<AudioAsset> {
    const existing = (await this.list()).find((a) => a.origin?.url === origin.url)
    const { maxDownload, maxTotal } = this.limits
    if (blob.size > maxDownload) throw new AudioAssetError(`“${name}” is ${mb(blob.size)}; downloads over ${mb(maxDownload)} are not kept on the device.`)
    const used = (await this.usage()) - (existing?.size ?? 0)
    if (used + blob.size > maxTotal) throw new AudioAssetError(`Keeping “${name}” would use more than ${mb(maxTotal)}. Delete a download or a kept file first.`)
    const meta: AudioAsset = { id: existing?.id ?? newId(), name, type: blob.type || 'audio/*', size: blob.size, addedAt: Date.now(), origin }
    await (await this.store()).put(meta.id, { ...meta, blob })
    return meta
  }
  /** Downloaded episodes, newest first. */
  async downloads(): Promise<AudioAsset[]> {
    return (await this.list()).filter((a) => !!a.origin)
  }
  async findDownload(url: string): Promise<AudioAsset | undefined> {
    return (await this.list()).find((a) => a.origin?.url === url)
  }
  async get(id: string): Promise<{ meta: AudioAsset; blob: Blob } | undefined> {
    const r = await (await this.store()).get(id)
    if (!r) return undefined
    const { data, blob, ...meta } = r
    return { meta, blob: blob ?? new Blob([data ?? new ArrayBuffer(0)], { type: meta.type }) }
  }
  async remove(id: string): Promise<void> {
    await (await this.store()).delete(id)
  }
}

let shared: AudioAssets | undefined
export function getAudioAssets(): AudioAssets {
  return (shared ??= new AudioAssets())
}
