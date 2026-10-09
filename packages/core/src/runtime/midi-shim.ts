// Frame-side Web MIDI stand-in. The sandboxed frame has an opaque origin and no `midi` permission, so it can never use
// Web MIDI itself (and iOS Safari has no Web MIDI at all). Instead the host page owns MIDI (real inputs where the browser
// has them, plus the on-screen "Hydra Touch" controller) and forwards raw messages; this shim gives sketch code and
// plugins such as hydra-midi a `navigator.requestMIDIAccess()` that behaves like the real API for inputs:
//   access.inputs (Map) · access.outputs (empty Map) · 'statechange' on access with {port}
//   input.open() (statechange fires asynchronously, as in browsers) · 'midimessage' events with {data: Uint8Array}
// Written against hydra-midi 0.4.6's use of the API (dist/index.js: setup(), handleMessage()). No hydra-midi changes needed.

import type { MidiPortInfo } from './protocol'

type Win = any

class ShimInput extends EventTarget {
  readonly type = 'input'
  state: 'connected' | 'disconnected' = 'connected'
  connection: 'open' | 'closed' | 'pending' = 'closed'
  onmidimessage: ((e: Event) => void) | null = null
  onstatechange: ((e: Event) => void) | null = null
  readonly version = ''
  constructor(readonly id: string, readonly name: string, readonly manufacturer: string, private access: ShimAccess) {
    super()
  }
  open(): Promise<ShimInput> {
    if (this.connection !== 'open') {
      this.connection = 'open'
      // browsers fire this after open() returns; hydra-midi attaches its listener right after calling open()
      setTimeout(() => this.access.fire(this), 0)
    }
    return Promise.resolve(this)
  }
  close(): Promise<ShimInput> {
    this.connection = 'closed'
    return Promise.resolve(this)
  }
  deliver(data: number[]) {
    if (this.state !== 'connected') return
    if (this.connection !== 'open') this.connection = 'open' // implicit open on first message, as in browsers
    const ev = new Event('midimessage') as Event & { data: Uint8Array; receivedTime: number }
    Object.defineProperty(ev, 'data', { value: new Uint8Array(data), enumerable: true })
    Object.defineProperty(ev, 'receivedTime', { value: performance.now(), enumerable: true })
    this.dispatchEvent(ev)
    try {
      this.onmidimessage?.(ev)
    } catch {
      /* sketch error */
    }
  }
}

class ShimAccess extends EventTarget {
  readonly inputs = new Map<string, ShimInput>()
  readonly outputs = new Map<string, never>()
  readonly sysexEnabled = false
  onstatechange: ((e: Event) => void) | null = null
  fire(port: ShimInput) {
    const ev = new Event('statechange') as Event & { port: ShimInput }
    Object.defineProperty(ev, 'port', { value: port, enumerable: true })
    this.dispatchEvent(ev)
    try {
      this.onstatechange?.(ev)
    } catch {
      /* ignore */
    }
    try {
      port.onstatechange?.(ev)
    } catch {
      /* ignore */
    }
  }
}

export class MidiShim {
  readonly access = new ShimAccess()
  private installed = false
  constructor(private win: Win, opts: { install?: boolean } = {}) {
    // Only inside the sandboxed frame. In inline mode the bridge runs in the host page, whose navigator stays untouched.
    const inFrame = (() => {
      try {
        return win.parent !== win
      } catch {
        return true
      }
    })()
    if (opts.install ?? inFrame) this.install()
  }
  install() {
    const nav = this.win.navigator
    if (!nav || this.installed) return
    const access = this.access
    const request = () => Promise.resolve(access)
    ;(request as any).__hydraTouchShim = true
    try {
      Object.defineProperty(nav, 'requestMIDIAccess', { value: request, configurable: true, writable: true })
      this.installed = true
    } catch {
      /* navigator not writable: leave it */
    }
  }
  setInputs(list: MidiPortInfo[]) {
    const ids = new Set(list.map((p) => p.id))
    for (const [id, inp] of this.access.inputs) {
      if (!ids.has(id) && inp.state === 'connected') {
        inp.state = 'disconnected'
        this.access.fire(inp)
      }
    }
    for (const p of list) {
      let inp = this.access.inputs.get(p.id)
      if (inp && inp.state === 'connected') continue
      if (!inp) {
        inp = new ShimInput(p.id, p.name, p.manufacturer ?? '', this.access)
        this.access.inputs.set(p.id, inp)
      }
      inp.state = 'connected'
      const port = inp
      setTimeout(() => this.access.fire(port), 0)
    }
  }
  receive(input: string, data: number[]) {
    this.access.inputs.get(input)?.deliver(data)
  }
  dispose() {
    this.access.inputs.clear()
  }
}
