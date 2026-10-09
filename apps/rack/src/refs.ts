// What a control is bound to: an argument of a call (`callId:i`) or the value of a variable (`d:defId`), with the label,
// range and default its knob shows. Pure.
import type { Catalog, Hint, InputDef, Sketch } from '@hydra-ipad/core'
import { findCallDeep, getArg, refKey, type ArgRef } from './kit/model'
import { valueToMod } from './kit/mods'
import { isInteger } from './panel'

export { refKey, type ArgRef }

export function parseKey(k: string): ArgRef {
  if (k.startsWith('d:')) return { def: k.slice(2) }
  const j = k.lastIndexOf(':')
  return { call: k.slice(0, j), i: Number(k.slice(j + 1)) }
}

export interface RefInfo {
  label: string
  /** the function and input (calls only) */
  fn?: string
  inp?: InputDef
  hint: Hint
  def?: number
  exists: boolean
}

export function refInfo(sk: Sketch, ref: ArgRef, cat: Catalog): RefInfo {
  const v = getArg(sk, ref)
  const n = v?.k === 'num' ? v.v : (v && valueToMod(v)?.off) ?? 0
  const loose: Hint = { min: Math.min(0, n * 2), max: Math.max(1, Math.abs(n) * 2) }
  if ('def' in ref) {
    const s = sk.stmts.find((x) => x.id === ref.def)
    return { label: s?.k === 'def' ? s.name : '?', hint: loose, exists: s?.k === 'def' }
  }
  const found = findCallDeep(sk, ref.call)
  const fn = found?.call.fn
  if (!fn || !cat.has(fn)) return { label: `${fn ?? '?'} ${ref.i + 1}`, fn, hint: loose, exists: !!found }
  const inp = cat.inputs(fn)[ref.i]
  if (!inp) return { label: `${fn} ${ref.i + 1}`, fn, hint: loose, exists: true }
  const h = cat.hint(fn, inp.name)
  const hint = isInteger(fn, inp.name, cat) ? { ...h, integer: true } : h
  return { label: inp.name, fn, inp, hint, def: typeof inp.default === 'number' ? inp.default : undefined, exists: true }
}
