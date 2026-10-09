// Entry point of the IIFE bundle that runs INSIDE the sandboxed iframe (opaque origin).
// Built by scripts/build-frame.mjs → dist-frame/hydra-frame.js. Talks to the host only via postMessage.
import Hydra from 'hydra-synth'
import { Bridge } from './bridge'
import type { HostToFrame } from './protocol'

const parentWin = window.parent
const bridge = new Bridge({
  win: window,
  container: document.body,
  post: (msg) => parentWin.postMessage(msg, '*'),
  Hydra: Hydra as any,
})
window.addEventListener('message', (ev: MessageEvent) => {
  // only the embedding page may drive us
  if (ev.source !== parentWin) return
  bridge.handle(ev.data as HostToFrame)
})
parentWin.postMessage({ t: 'hello' }, '*')
