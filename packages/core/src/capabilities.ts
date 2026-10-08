import { isStandalone } from './library'

// Live feature detection for the Diagnostics page. Nothing here is assumed: every line is computed in the browser
// the owner is holding, so results can be read off the iPad and pasted into an issue.

export type CapStatus = 'yes' | 'no' | 'partial' | 'unknown'
export interface CapItem {
  id: string
  label: string
  status: CapStatus
  detail: string
}
export interface CapabilityReport {
  when: string
  userAgent: string
  isolation: string
  items: CapItem[]
}

const item = (id: string, label: string, status: CapStatus, detail = ''): CapItem => ({ id, label, status, detail })

export function webglInfo(): { v1: boolean; v2: boolean; renderer?: string; vendor?: string; floatTex: boolean; halfFloat: boolean; colorBufferFloat: boolean; maxTex?: number; software: boolean } {
  const out = { v1: false, v2: false, renderer: undefined as string | undefined, vendor: undefined as string | undefined, floatTex: false, halfFloat: false, colorBufferFloat: false, maxTex: undefined as number | undefined, software: false }
  try {
    const c2 = document.createElement('canvas')
    const gl2 = c2.getContext('webgl2') as WebGL2RenderingContext | null
    out.v2 = !!gl2
    const c1 = document.createElement('canvas')
    const gl = (gl2 ?? c1.getContext('webgl') ?? c1.getContext('experimental-webgl')) as WebGLRenderingContext | null
    out.v1 = !!(c1.getContext('webgl') ?? gl)
    if (gl) {
      out.floatTex = !!gl.getExtension('OES_texture_float') || !!gl2
      out.halfFloat = !!gl.getExtension('OES_texture_half_float') || !!gl2
      out.colorBufferFloat = !!gl.getExtension('WEBGL_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_float')
      out.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE)
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      if (dbg) {
        out.renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
        out.vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL))
        out.software = /swiftshader|llvmpipe|software/i.test(out.renderer)
      }
    }
  } catch {
    /* leave defaults */
  }
  return out
}

async function idbPersistence(): Promise<CapItem> {
  try {
    if (!('indexedDB' in globalThis)) return item('idb', 'IndexedDB', 'no', 'not available; the library falls back to localStorage / memory')
    const persisted = await navigator.storage?.persisted?.()
    const est = await navigator.storage?.estimate?.()
    const mb = est?.quota ? `${Math.round((est.usage ?? 0) / 1048576)} MB used of ${Math.round(est.quota / 1048576)} MB` : 'quota unknown'
    return item('idb', 'IndexedDB + persistence', persisted ? 'yes' : 'partial', `${persisted ? 'persistent' : 'best-effort (may be evicted)'}; ${mb}`)
  } catch (e) {
    return item('idb', 'IndexedDB + persistence', 'unknown', String((e as Error).message))
  }
}

/** Run a probe inside a sandbox="allow-scripts" iframe, exactly as the runtime frame is configured. */
export function probeSandboxedFrame(opts: { camera?: boolean; timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.setAttribute('allow', 'camera *')
    iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0'
    const done = (v: Record<string, unknown>) => {
      window.removeEventListener('message', on)
      clearTimeout(t)
      iframe.remove()
      resolve(v)
    }
    const on = (ev: MessageEvent) => {
      if (ev.source === iframe.contentWindow && ev.data && ev.data.t === 'probe') done(ev.data.r)
    }
    const t = setTimeout(() => done({ error: 'frame did not answer' }), opts.timeoutMs ?? 8000)
    window.addEventListener('message', on)
    const script = `(async()=>{const r={};const T=(f)=>{try{return f()}catch(e){return 'throws: '+e.name}};
r.origin=T(()=>String(location.origin));r.secureContext=self.isSecureContext;
r.localStorage=T(()=>{localStorage.length;return 'accessible'});
r.indexedDB=T(()=>{indexedDB.open('x');return 'accessible'});
r.parentDom=T(()=>{parent.document.title;return 'accessible'});
r.mediaDevices=!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia);
r.webgl=T(()=>!!document.createElement('canvas').getContext('webgl'));
${opts.camera ? "try{const s=await navigator.mediaDevices.getUserMedia({video:true});r.camera='granted ('+s.getVideoTracks().length+' track)';s.getTracks().forEach(t=>t.stop())}catch(e){r.camera='denied: '+e.name}" : ''}
parent.postMessage({t:'probe',r},'*')})()`
    iframe.srcdoc = `<!doctype html><script>${script}<\/script>`
    document.body.appendChild(iframe)
  })
}

export async function checkStreamCors(url: string): Promise<{ ok: boolean; cors: boolean; status?: number; contentType?: string; error?: string }> {
  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors', headers: { Range: 'bytes=0-1' } })
    return { ok: res.ok || res.status === 206, cors: true, status: res.status, contentType: res.headers.get('content-type') ?? undefined }
  } catch (e) {
    // a CORS failure and a network failure look the same to fetch(); try no-cors to tell them apart
    try {
      await fetch(url, { method: 'GET', mode: 'no-cors' })
      return { ok: false, cors: false, error: 'server reachable but sends no CORS headers: Web Audio cannot analyse it' }
    } catch (e2) {
      return { ok: false, cors: false, error: `unreachable: ${(e2 as Error).message}` }
    }
  }
}

export async function detectMidi(request = false): Promise<CapItem> {
  const nav = navigator as any
  if (typeof nav.requestMIDIAccess !== 'function') return item('midi', 'Web MIDI', 'no', 'navigator.requestMIDIAccess does not exist in this browser (iOS Safari has no Web MIDI)')
  if (!request) return item('midi', 'Web MIDI', 'yes', 'API present; press "Request MIDI access" to list devices')
  try {
    const access = await nav.requestMIDIAccess()
    const ins = [...access.inputs.values()].map((i: any) => i.name)
    return item('midi', 'Web MIDI', 'yes', ins.length ? `inputs: ${ins.join(', ')}` : 'API works, no inputs connected')
  } catch (e) {
    return item('midi', 'Web MIDI', 'partial', `API present but access failed: ${(e as Error).name}`)
  }
}

export interface DetectOptions {
  isolation?: string
  /** also run the (permission-prompting) camera probe in the sandboxed frame */
  probeCamera?: boolean
  requestMidi?: boolean
}

export async function detectCapabilities(opts: DetectOptions = {}): Promise<CapabilityReport> {
  const items: CapItem[] = []
  const nav = navigator as any
  items.push(item('standalone', 'Installed (standalone) vs browser tab', 'unknown', isStandalone() ? 'running as an installed home-screen app' : 'running in a browser tab'))
  items.push(item('https', 'HTTPS / secure context', window.isSecureContext ? 'yes' : 'no', `${location.protocol} · isSecureContext=${window.isSecureContext} (service workers, camera, mic and Add to Home Screen need this)`))
  let sw: CapItem
  if (!('serviceWorker' in navigator)) sw = item('sw', 'Service worker', 'no', 'not supported here')
  else {
    const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined)
    sw = item('sw', 'Service worker', reg ? 'yes' : 'partial', reg ? `registered, scope ${reg.scope}, controlling this page: ${!!navigator.serviceWorker.controller}` : 'supported, not registered on this page (only the shell registers one)')
  }
  items.push(sw)
  const gl = webglInfo()
  items.push(item('webgl', 'WebGL 1 / 2', gl.v2 ? 'yes' : gl.v1 ? 'partial' : 'no', `webgl1=${gl.v1} webgl2=${gl.v2}${gl.maxTex ? ` maxTexture=${gl.maxTex}` : ''}${gl.renderer ? ` · ${gl.renderer}` : ''}${gl.software ? ' · SOFTWARE RENDERER (timings are not device performance)' : ''}`))
  items.push(item('floattex', 'Float textures', gl.floatTex || gl.halfFloat ? 'yes' : 'no', `float=${gl.floatTex} halfFloat=${gl.halfFloat} colorBufferFloat=${gl.colorBufferFloat}`))
  const md = nav.mediaDevices
  items.push(item('gum', 'getUserMedia', md?.getUserMedia ? 'yes' : 'no', md?.getUserMedia ? 'audio and video capture available (needs a user gesture and permission)' : 'navigator.mediaDevices.getUserMedia missing'))
  let devices = 'enumerateDevices unavailable'
  if (md?.enumerateDevices) {
    try {
      const d: MediaDeviceInfo[] = await md.enumerateDevices()
      const n = (k: string) => d.filter((x) => x.kind === k).length
      devices = `audioinput=${n('audioinput')} videoinput=${n('videoinput')} audiooutput=${n('audiooutput')}${d.some((x) => x.label) ? '' : ' (labels hidden until permission is granted)'}`
    } catch (e) {
      devices = `failed: ${(e as Error).name}`
    }
  }
  items.push(item('enumerate', 'enumerateDevices', md?.enumerateDevices ? 'yes' : 'no', devices))
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext
  let acDetail = 'AudioContext missing'
  if (AC) {
    try {
      const ctx = new AC()
      acDetail = `state=${ctx.state} sampleRate=${ctx.sampleRate} (starts "suspended" until a user gesture)`
      void ctx.close?.()
    } catch (e) {
      acDetail = `constructor failed: ${(e as Error).name}`
    }
  }
  items.push(item('audiocontext', 'AudioContext', AC ? 'yes' : 'no', acDetail))
  items.push(item('audiosession', 'navigator.audioSession (silent-switch bypass)', nav.audioSession ? 'yes' : 'no', nav.audioSession ? `type=${nav.audioSession.type}` : 'absent: the silent <audio> element fallback is used'))
  const gdm = md?.getDisplayMedia
  items.push(item('displaymedia', 'getDisplayMedia', gdm ? 'partial' : 'no', gdm ? 'API present; whether it offers audio is only known after a prompt (iOS Safari does not support it)' : 'not available'))
  items.push(item('midi', 'Web MIDI', (await detectMidi(opts.requestMidi)).status, (await detectMidi(opts.requestMidi)).detail))
  items.push(item('bc', 'BroadcastChannel', typeof BroadcastChannel !== 'undefined' ? 'yes' : 'no', typeof BroadcastChannel !== 'undefined' ? 'cross-app library notifications' : 'falls back to storage events'))
  items.push(await idbPersistence())
  items.push(item('captureStream', 'canvas.captureStream', typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype ? 'yes' : 'no', 'not used by the app (unsupported on iOS)'))
  const probe = await probeSandboxedFrame({ camera: !!opts.probeCamera })
  const sbStatus: CapStatus = probe.error ? 'unknown' : probe.localStorage === 'accessible' || probe.parentDom === 'accessible' ? 'no' : 'yes'
  items.push(item('sandbox', 'Sandboxed frame is isolated', sbStatus, probe.error ? String(probe.error) : `origin=${probe.origin} · localStorage=${probe.localStorage} · indexedDB=${probe.indexedDB} · parent DOM=${probe.parentDom} · secureContext=${probe.secureContext}`))
  items.push(item('sandboxmedia', 'Mic/camera inside the sandboxed frame', probe.mediaDevices ? 'partial' : 'no', probe.mediaDevices ? `mediaDevices present in frame${probe.camera ? ` · camera: ${probe.camera}` : ' · camera not requested (use "Probe camera")'}; the mic is never given to the frame` : 'navigator.mediaDevices is not available inside the frame: use inline mode for camera sources'))
  items.push(item('isolation', 'Isolation mode in use', 'unknown', opts.isolation ?? 'n/a'))
  return { when: new Date().toISOString(), userAgent: navigator.userAgent, isolation: opts.isolation ?? 'n/a', items }
}

export function formatReport(r: CapabilityReport): string {
  const sym: Record<CapStatus, string> = { yes: '[yes]    ', no: '[no]     ', partial: '[partial]', unknown: '[?]      ' }
  return [`Hydra iPad diagnostics · ${r.when}`, r.userAgent, `isolation: ${r.isolation}`, '', ...r.items.map((i) => `${sym[i.status]} ${i.label}${i.detail ? ' — ' + i.detail : ''}`)].join('\n')
}
