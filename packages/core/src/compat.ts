// Will this sketch run in vanilla Hydra (https://hydra.ojack.xyz) from its exported text?
//   'yes'          as it is
//   'with-plugin'  once the listed plugin URLs load (the exported text already has their `loadScript` lines)
//   'no'           it relies on something only iDra provides (listed in `reasons`)

import type { PluginRef, Sketch, Value } from './ir'
import { activePrelude, findMotionPlugin, MOTION_PLUGIN_ID, motionRegistryEntry } from './motion-core'
import { loadScriptUrls } from './plugin-id'

export interface Compat {
  vanilla: 'yes' | 'with-plugin' | 'no'
  /** plugin URLs the sketch loads (with-plugin), or what is missing (no) */
  needs: string[]
  /** one plain sentence per finding */
  reasons: string[]
}

export interface CompatOptions {
  /**
   * The audio source the page's engine is using (`getAudioEngine().source?.kind`). Vanilla Hydra's `a` only hears the
   * default microphone, so a sketch that uses audio while fed from a file, stream, input device or tab is iDra-only.
   */
  audioSource?: string
}

const AUDIO_RE = /\ba\.(fft|vol|show|setBins|setCutoff|setScale|setSmooth|hide)\b|\ba\d+\s*\(/
const MOTION_USE_RE = /(^|[^\w.$])(knob|gate)\s*\(|\bhydraMotion\b/

function codeOf(sketch: Sketch): string[] {
  const out: string[] = []
  const val = (v: Value) => {
    if (v.k === 'fn' || v.k === 'js') out.push(v.src)
    else if (v.k === 'tex') for (const c of [v.chain.gen, ...v.chain.mods]) c.args.forEach(val)
  }
  for (const s of sketch.stmts) {
    if (s.k === 'raw') out.push(s.code)
    else if (s.k === 'def') val(s.value)
    else if (s.k === 'chain') for (const c of [s.chain.gen, ...s.chain.mods]) c.args.forEach(val)
  }
  return out
}

const AUDIO_SOURCE_NAMES: Record<string, string> = { file: 'an audio file', stream: 'a stream URL', device: 'a chosen input device', display: 'tab or screen audio', tab: 'tab audio' }

export function compat(sketch: Sketch, opts: CompatOptions = {}): Compat {
  const needs: string[] = []
  const reasons: string[] = []
  let level: Compat['vanilla'] = 'yes'
  const need = (x: string) => !needs.includes(x) && needs.push(x)
  const raise = (to: Compat['vanilla']) => {
    if (to === 'no' || (to === 'with-plugin' && level === 'yes')) level = to
  }
  const code = codeOf(sketch)
  const inlined = !!activePrelude(sketch)

  const loaded = new Set<string>()
  for (const src of code) for (const u of loadScriptUrls(src)) loaded.add(u)
  for (const p of sketch.plugins ?? []) pluginFinding(p)
  for (const u of loaded) {
    if ((sketch.plugins ?? []).some((p) => p.url === u)) continue
    raise('with-plugin')
    need(u)
    reasons.push(`loads ${u} with loadScript`)
  }

  function pluginFinding(p: PluginRef) {
    if (p.id === MOTION_PLUGIN_ID && inlined) {
      reasons.push('hydra-motion is inlined at the top of the exported text (self-contained)')
      return
    }
    if (p.url) {
      raise('with-plugin')
      need(p.url)
      loaded.add(p.url)
      reasons.push(`loads the plugin ${p.name || p.id}${p.id === MOTION_PLUGIN_ID ? ' (or export it self-contained)' : ''}`)
    } else {
      raise('no')
      need(p.name || p.id)
      reasons.push(`plugin ${p.name || p.id} is pasted code saved with the sketch; the exported text cannot carry it`)
    }
  }

  if (!findMotionPlugin(sketch) && code.some((c) => MOTION_USE_RE.test(c)) && ![...loaded].some((u) => /hydra-motion/i.test(u))) {
    raise('with-plugin')
    let url = MOTION_PLUGIN_ID
    try {
      url = motionRegistryEntry().url
    } catch {
      /* registry without the entry */
    }
    need(url)
    reasons.push('uses knob() or gate() but does not load hydra-motion')
  }

  const src = opts.audioSource
  if (src && src !== 'mic' && code.some((c) => AUDIO_RE.test(c))) {
    raise('no')
    need('audio: microphone only in vanilla Hydra')
    reasons.push(`uses audio from ${AUDIO_SOURCE_NAMES[src] ?? src}; vanilla Hydra's a only hears the microphone`)
  }
  return { vanilla: level, needs, reasons }
}
