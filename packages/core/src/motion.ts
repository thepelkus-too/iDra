// hydra-motion in iDra, the parts that need the network or the DOM: the self-contained export and the compat badge.
// IR helpers and the inlined-block format live in motion-core.ts; docs/motion.md describes both.

import { toCode } from './codegen'
import { compat, type Compat, type CompatOptions } from './compat'
import type { Sketch } from './ir'
import { activePrelude, findMotionPlugin, motionPrelude, MOTION_PLUGIN_ID } from './motion-core'
import { getScriptCache, verifyIntegrity, type ScriptCache } from './runtime/script-cache'
import { sriSync } from './sha256'
import { h, injectStyles, TOKENS_CSS } from './ui'

export * from './motion-core'
export { compat, type Compat, type CompatOptions } from './compat'

export interface PreludeOptions {
  /** the plugin text to inline (default: the sketch's own pasted copy, else fetched through the offline script cache) */
  source?: string
  scriptCache?: ScriptCache
}

/**
 * "Make this sketch self-contained": the exported text with hydra-motion's source inlined at the top, between delimiters
 * that carry its name, version, SRI and MIT notice, instead of an `await loadScript(…)` line. Paste it into
 * hydra.ojack.xyz and it runs with no network. Other plugins keep their `loadScript` lines; a sketch without
 * hydra-motion exports as plain `toCode`. Importing the result gives back the plugin (not raw code), so this is idempotent.
 */
export async function exportWithPrelude(sketch: Sketch, opts: PreludeOptions = {}): Promise<string> {
  const ref = findMotionPlugin(sketch)
  if (!ref || activePrelude(sketch)) return toCode(sketch)
  let source = opts.source ?? ref.src
  if (source === undefined) {
    if (!ref.url) throw new Error('hydra-motion has neither a URL nor its code in this sketch')
    source = (await (opts.scriptCache ?? getScriptCache()).get(ref.url)).text
  }
  if (ref.integrity && !(await verifyIntegrity(source, ref.integrity))) throw new Error('the hydra-motion file does not match the version this sketch was made with (integrity check failed)')
  const integrity = ref.integrity ?? sriSync(source)
  const version = ref.version ?? /hydra-motion v(\d+\.\d+\.\d+\S*)/.exec(source)?.[1] ?? 'unknown'
  const head = motionPrelude(source, version, integrity)
  const plugins = (sketch.plugins ?? []).map((p) => (p.id === MOTION_PLUGIN_ID ? { ...p, integrity } : p))
  const src = sketch.src ? { ...sketch.src, head } : { tail: sketch.stmts.length ? '\n' : '', semi: false, head }
  return toCode({ ...sketch, plugins, src })
}

// ------------------------------------------------------------------ compat badge

const CSS = `${TOKENS_CSS}
.hi-compat{display:inline-block;position:relative;font:13px/1.3 system-ui,-apple-system,sans-serif;color:var(--hi-text)}
.hi-compat>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 12px;border-radius:22px;border:1px solid var(--hi-line);background:var(--hi-panel);-webkit-user-select:none;user-select:none}
.hi-compat>summary::-webkit-details-marker{display:none}
.hi-compat .dot{width:10px;height:10px;border-radius:50%;background:var(--hi-accent)}
.hi-compat[data-level="with-plugin"] .dot{background:var(--hi-warn)}
.hi-compat[data-level="no"] .dot{background:var(--hi-bad)}
.hi-compat .body{position:absolute;z-index:50;right:0;top:calc(100% + 6px);width:min(360px,86vw);padding:10px 12px;border-radius:var(--hi-r);background:var(--hi-panel);border:1px solid var(--hi-line);box-shadow:0 8px 24px rgba(0,0,0,.35)}
.hi-compat .body ul{margin:6px 0 0;padding-left:18px}
.hi-compat .body code{word-break:break-all;font-size:12px}
`

const LABELS: Record<Compat['vanilla'], string> = { yes: 'Plain Hydra', 'with-plugin': 'Hydra + plugin', no: 'Needs iDra' }
const TITLES: Record<Compat['vanilla'], string> = {
  yes: 'The exported text runs as it is in vanilla Hydra (hydra.ojack.xyz).',
  'with-plugin': 'Runs in vanilla Hydra; it loads these plugins:',
  no: 'Parts of this sketch only work in iDra:',
}

export interface CompatBadgeOptions extends CompatOptions {
  /** an audio engine (getAudioEngine()) to read the current source from, instead of `audioSource` */
  audio?: { source?: { kind?: string } }
}
export interface CompatBadgeHandle {
  element: HTMLDetailsElement
  readonly compat: Compat
  update(sketch: Sketch): void
  destroy(): void
}

/** A tappable "Plain Hydra / Hydra + plugin / Needs iDra" chip for next to Export; tap it for the list. */
export function mountCompatBadge(el: HTMLElement, sketch: Sketch, opts: CompatBadgeOptions = {}): CompatBadgeHandle {
  injectStyles('compat-badge', CSS)
  const root = h('details', { class: 'hi-compat' }) as HTMLDetailsElement
  const label = h('span', { class: 'label' })
  root.append(h('summary', { 'aria-label': 'Vanilla Hydra compatibility' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), label))
  const body = h('div', { class: 'body' })
  root.append(body)
  let current: Compat = { vanilla: 'yes', needs: [], reasons: [] }
  const update = (s: Sketch) => {
    current = compat(s, { ...opts, audioSource: opts.audioSource ?? opts.audio?.source?.kind })
    root.dataset.level = current.vanilla
    label.textContent = LABELS[current.vanilla]
    body.textContent = ''
    body.append(h('div', {}, TITLES[current.vanilla]))
    if (current.needs.length) body.append(h('ul', {}, ...current.needs.map((n) => h('li', {}, h('code', {}, n)))))
    if (current.reasons.length) body.append(h('ul', { class: 'reasons' }, ...current.reasons.map((r) => h('li', {}, r))))
  }
  update(sketch)
  el.appendChild(root)
  return {
    element: root,
    get compat() {
      return current
    },
    update,
    destroy: () => root.remove(),
  }
}
