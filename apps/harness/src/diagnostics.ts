import { checkStreamCors, detectCapabilities, detectMidi, formatReport, h, mountAudioPanel, probeSandboxedFrame, type CapabilityReport } from '@hydra-ipad/core'

/** Diagnostics tab: every row is computed live in this browser; the report is copyable. */
export function mountDiagnostics(el: HTMLElement, getIsolation: () => string): void {
  const out = h('div', {})
  const report = h('pre', { class: 'report', hidden: true })
  let last: CapabilityReport | undefined
  const run = async (opts: { probeCamera?: boolean; requestMidi?: boolean } = {}) => {
    out.textContent = 'Detecting…'
    last = await detectCapabilities({ isolation: getIsolation(), ...opts })
    const table = h('table', { class: 'caps' })
    for (const i of last.items) table.append(h('tr', {}, h('td', {}, i.label), h('td', { class: `st-${i.status}` }, i.status), h('td', {}, i.detail)))
    out.textContent = ''
    out.append(table)
    report.textContent = formatReport(last)
    report.hidden = false
  }
  const copy = async () => {
    if (!last) await run()
    const text = formatReport(last!)
    try {
      await navigator.clipboard.writeText(text)
      copyBtn.textContent = 'Copied ✓'
    } catch {
      const range = document.createRange()
      range.selectNodeContents(report)
      const sel = getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      copyBtn.textContent = 'Selected: press Copy'
    }
    setTimeout(() => (copyBtn.textContent = 'Copy report'), 2500)
  }
  const copyBtn = h('button', { type: 'button' }, 'Copy report')
  copyBtn.addEventListener('click', () => void copy())
  el.append(
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'primary', id: 'diag-run', onclick: () => void run() }, 'Run diagnostics'),
      copyBtn,
      h('button', { type: 'button', id: 'diag-camera', onclick: () => void run({ probeCamera: true }) }, 'Probe camera in frame'),
      h('button', { type: 'button', id: 'diag-midi', onclick: () => void run({ requestMidi: true }) }, 'Request MIDI access'),
    ),
    out,
    report,
  )
  void run()
  void detectMidi
  void probeSandboxedFrame
}

/** Audio lab tab: mic, file, stream URL (CORS check), meters, monitor, notes. */
export function mountAudioLab(el: HTMLElement): void {
  const url = h('input', { type: 'text', placeholder: 'https://…/stream.mp3', 'aria-label': 'Stream URL', style: 'flex:1;min-width:200px' })
  const result = h('div', { class: 'status' })
  const panelHost = h('div', { id: 'audio-panel-host' })
  el.append(panelHost)
  mountAudioPanel(panelHost)
  el.append(
    h('h3', {}, 'Stream URL'),
    h('div', { class: 'row' }, url, h('button', { type: 'button', id: 'stream-check', onclick: async () => {
      result.textContent = 'Checking…'
      const r = await checkStreamCors(url.value.trim())
      result.textContent = r.ok ? `OK: HTTP ${r.status}, ${r.contentType ?? 'unknown type'}, CORS allowed: Web Audio can analyse it.` : `Not usable for analysis: ${r.error ?? `HTTP ${r.status}`}`
    } }, 'Check CORS')),
    result,
    h('h3', {}, 'Notes'),
    h('ul', { class: 'status' },
      h('li', {}, 'The hardware silent switch mutes Web Audio output on iOS. The app plays a silent loop and sets audioSession to “playback” to get around that; verify on your device.'),
      h('li', {}, 'While the microphone is active iOS may route playback to the earpiece or lower its volume.'),
      h('li', {}, 'Audio from other apps cannot be captured by a web page. Use the mic (acoustic pickup) or a USB-C audio interface with a loopback or line-in.'),
      h('li', {}, 'Streams need CORS headers (Access-Control-Allow-Origin) or Web Audio refuses to analyse them. Streaming playback itself arrives in a later change.'),
    ),
  )
}
