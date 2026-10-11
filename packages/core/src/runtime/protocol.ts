// The ONLY channel between the host page and the Hydra frame. Everything is structured-cloneable plain data.
// Requests carry a numeric `id` and are answered by a `result` with the same id.

import type { CatalogDelta } from '../catalog'
import type { HydraAudioSettings } from '../hydra-audio'

export interface InitMsg {
  t: 'init'
  width: number
  height: number
  precision?: 'lowp' | 'mediump' | 'highp'
  /**
   * A preview runtime (docs/previews-runtime.md): Hydra's own animation loop is off and the frame ticks only when told to
   * (`loop`), sending each frame back as ImageBitmaps. It also gets extra sources (s4…s7) for approximated outputs.
   */
  preview?: { numSources: number }
}

/** What a preview frame sends back: one bitmap per captured output, in the order asked for. Transferred, not copied. */
export interface FrameMsg {
  t: 'frame'
  seq: number
  bitmaps: ImageBitmap[]
  /** Hydra's `time` when the frame was drawn */
  time: number
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
  | { t: 'plugin'; id: number; pluginId: string; name: string; src: string; url?: string }
  | { t: 'catalog'; id: number }
  | { t: 'fetched'; id: number; ok: boolean; text?: string; error?: string }
  | { t: 'audio'; vol: number; specific: number[] }
  | { t: 'audioSettings'; settings: Partial<HydraAudioSettings> }
  | { t: 'mouse'; x: number; y: number; buttons?: number }
  /** MIDI inputs the host can see (real Web MIDI inputs it forwards, and the on-screen "Hydra Touch" controller) */
  | { t: 'midiInputs'; inputs: MidiPortInfo[] }
  /** one MIDI message from input `input` (raw bytes: status, data1, data2) */
  | { t: 'midi'; input: string; data: number[] }
  /** call `<name>.<method>(...args)` on a hydra-motion knob of the running sketch (pads); never coalesced, never evaluated as text */
  | { t: 'invoke'; name: string; method: 'set' | 'to' | 'hold' | 'release'; args: Array<number | string> }
  /**
   * Preview runtimes only: tick at `fps` while `running`, capturing outputs `outputs` (indices) after each tick. `frames`
   * stops after that many frames (1 = a still). The frame keeps at most one frame in flight: it waits for `ack`.
   */
  | { t: 'loop'; running: boolean; fps: number; outputs: number[]; frames?: number }
  /** the host has drawn frame `seq`; the next one may be sent */
  | { t: 'ack'; seq: number }
  /** set Hydra's clock (previews follow the main runtime's `time`) */
  | { t: 'setTime'; time: number }
  /** show `bitmap` in source `slot` (an approximated output or camera); `null` clears it */
  | { t: 'image'; slot: string; bitmap: ImageBitmap | null }
  /** a small copy of output `of` (`o0`…`o3`) or of a source's current picture (`s0`…), answered with an ImageBitmap */
  | { t: 'snapshot'; id: number; of: string; width: number; height: number }
  | { t: 'dispose' }

export interface MidiPortInfo {
  id: string
  name: string
  manufacturer?: string
}

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
  | FrameMsg

export type Transport = {
  /** `transfer`: ImageBitmaps moved, not copied (iframe postMessage transfer list) */
  send(msg: HostToFrame, transfer?: Transferable[]): void
  onMessage(cb: (msg: FrameToHost) => void): void
  dispose(): void
}
