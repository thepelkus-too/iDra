// The ONLY channel between the host page and the Hydra frame. Everything is structured-cloneable plain data.
// Requests carry a numeric `id` and are answered by a `result` with the same id.

import type { CatalogDelta } from '../catalog'
import type { HydraAudioSettings } from '../hydra-audio'

export interface InitMsg {
  t: 'init'
  width: number
  height: number
  precision?: 'lowp' | 'mediump' | 'highp'
}
export interface RunMsg {
  t: 'run'
  id: number
  code: string
  /** initial values of the live-parameter table (merged before evaluating) */
  live: Record<string, number>
  /** clear these source slots (s0..s3) and reset outputs before evaluating */
  reset: { clearSources: string[] }
}
export type HostToFrame =
  | InitMsg
  | RunMsg
  | { t: 'live'; table: Record<string, number> }
  | { t: 'hush'; id: number }
  | { t: 'resolution'; id: number; w: number; h: number }
  | { t: 'screenshot'; id: number; type?: string; quality?: number }
  | { t: 'time'; id: number }
  | { t: 'plugin'; id: number; pluginId: string; name: string; src: string }
  | { t: 'catalog'; id: number }
  | { t: 'fetched'; id: number; ok: boolean; text?: string; error?: string }
  | { t: 'audio'; vol: number; specific: number[] }
  | { t: 'audioSettings'; settings: Partial<HydraAudioSettings> }
  | { t: 'mouse'; x: number; y: number; buttons?: number }
  | { t: 'dispose' }

export type ErrorKind = 'eval' | 'shader' | 'runtime' | 'warning' | 'camera'
export type FrameToHost =
  | { t: 'hello' }
  | { t: 'ready'; info: { webgl: boolean; precision: string } }
  | { t: 'result'; id: number; ok: boolean; error?: string; value?: unknown }
  | { t: 'error'; kind: ErrorKind; message: string; count: number }
  | { t: 'catalog'; delta: CatalogDelta[] }
  | { t: 'fetch'; id: number; url: string }
  | { t: 'audioSettings'; settings: HydraAudioSettings }
  | { t: 'fatal'; message: string }

export type Transport = {
  send(msg: HostToFrame): void
  onMessage(cb: (msg: FrameToHost) => void): void
  dispose(): void
}
