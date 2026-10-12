// Performance-mode pins (`meta.rack.pins`): what each key stands for and whether it is still in the sketch. Pure.
import { locate, walkChains, type Catalog, type Sketch } from '@hydra-ipad/core'
import { parseKey, refInfo, type ArgRef } from './refs'

/** The pin key of the kit's pad strip (a pinnable element, not a knob). */
export const PADS_PIN = 'kit:pads'

export type Pin =
  | { t: 'knob'; ref: ArgRef }
  /** a module's or statement's on/off switch */
  | { t: 'off'; id: string }
  /** the preview of a chain up to a call */
  | { t: 'peek'; chainId: string; callId: string }
  | { t: 'pads' }

export const offPin = (id: string) => `off:${id}`
export const peekPin = (chainId: string, callId: string) => `pv:${chainId}:${callId}`

export function parsePin(k: string): Pin {
  if (k === PADS_PIN) return { t: 'pads' }
  if (k.startsWith('off:')) return { t: 'off', id: k.slice(4) }
  if (k.startsWith('pv:')) {
    const [chainId, callId] = k.slice(3).split(':')
    return { t: 'peek', chainId, callId }
  }
  return { t: 'knob', ref: parseKey(k) }
}

/** The pin still points at something in the sketch (pins of deleted modules are skipped, not shown broken). */
export function pinExists(sk: Sketch, k: string, cat: Catalog): boolean {
  const p = parsePin(k)
  switch (p.t) {
    case 'pads':
      return true
    case 'knob':
      return refInfo(sk, p.ref, cat).exists
    case 'off':
      return !!locate(sk, p.id)
    case 'peek':
      for (const x of walkChains(sk)) if (x.chain.id === p.chainId) return x.chain.gen.id === p.callId || x.chain.mods.some((m) => m.id === p.callId)
      return false
  }
}
