// The number editor: what tapping any number opens, in every editor. Three tabs, the last one used remembered per editor:
//   Keypad  the keypad as before, plus Glide (typed numbers and nudges become targets the value glides to) and
//           "Loop between values" (writes `[a, b].smooth(1).ease('…').fast(n)`)
//   Ladder  the long-press ladder as a panel (drag on it, or ← → ↑ ↓ on a keyboard)
//   Pad     bind the parameter to a hydra-motion knob played from a pad
import { arr, setArg, type Sketch } from '@hydra-ipad/core'
import { useEffect, useRef, useState } from 'preact/hooks'
import { fmt } from './conv'
import { EASE_PRESETS, easeLabel, easePath } from './easing'
import { glideBack, glideField, glideOf, returnValue, type NumberField } from './field'
import { DEFAULT_BPM, parseDuration, subscribeGlides } from './glide'
import { kitHost, kitPrefs, useHost } from './host'
import { Keypad } from './Keypad'
import { LadderPanel } from './Ladder'
import { closePopover, openPopover, toast } from './overlay'
import { PadTab } from './PadDock'

export type NumberTab = 'keypad' | 'ladder' | 'pad'
const TABS: Array<{ id: NumberTab; label: string }> = [
  { id: 'keypad', label: 'Keypad' },
  { id: 'ladder', label: 'Ladder' },
  { id: 'pad', label: 'Pad' },
]

export interface GlidePrefs {
  on: boolean
  /** as typed: "1", "0.5s", "2b" */
  dur: string
  ease: string
}

export function glidePrefs(): GlidePrefs {
  const p = kitPrefs()
  return { on: p.get<boolean>('glideOn') ?? false, dur: p.get<string>('glideDur') ?? '1', ease: p.get<string>('glideEase') ?? 'easeInOutCubic' }
}
function saveGlide(g: Partial<GlidePrefs>): void {
  const p = kitPrefs()
  if (g.on !== undefined) p.set('glideOn', g.on)
  if (g.dur !== undefined) p.set('glideDur', g.dur)
  if (g.ease !== undefined) p.set('glideEase', g.ease)
}

/** Hydra's bpm in the open sketch (a `bpm = …` setting), else Hydra's default. */
export function sketchBpm(sk: Sketch | undefined): number {
  const st = sk?.stmts.find((s) => s.k === 'setting' && s.name === 'bpm')
  return st && st.k === 'setting' && st.v > 0 ? st.v : DEFAULT_BPM
}

/** `[a, b].smooth(1).ease(name).fast(n)`: each value lasts `seconds` (Hydra steps arrays at bpm / 60 × fast per second). */
export function loopValue(a: number, b: number, seconds: number, easeName: string, bpm = DEFAULT_BPM) {
  const fast = seconds > 0 ? +(60 / (bpm * seconds)).toPrecision(4) : 1
  return arr([a, b], { smooth: 1, ease: easeName, fast })
}

function useGlides(): void {
  const [, set] = useState(0)
  useEffect(() => subscribeGlides(() => set((n) => n + 1)), [])
}

export function NumberEditor({ field, tab: initial }: { field: NumberField; tab?: NumberTab }) {
  const [tab, setTab] = useState<NumberTab>(() => initial ?? kitPrefs().get<NumberTab>('numberTab') ?? 'keypad')
  const pick = (t: NumberTab) => {
    setTab(t)
    kitPrefs().set('numberTab', t)
  }
  return (
    <div class="numed" data-testid="number-editor" data-tab={tab}>
      <div class="numed-tabs seg" role="tablist" aria-label={`${field.label}: how to edit`}>
        {TABS.map((t) => (
          <button type="button" role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} data-testid={`numed-tab-${t.id}`} key={t.id} onClick={() => pick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'keypad' && <KeypadTab field={field} />}
      {tab === 'ladder' && <LadderPanel field={field} />}
      {tab === 'pad' && <PadTab field={field} />}
    </div>
  )
}

function KeypadTab({ field }: { field: NumberField }) {
  useGlides()
  const host = useHost()
  const [g, setG] = useState<GlidePrefs>(glidePrefs)
  const set = (p: Partial<GlidePrefs>) => {
    saveGlide(p)
    setG((x) => ({ ...x, ...p }))
  }
  const bpm = sketchBpm(host?.sketch())
  const seconds = parseDuration(g.dur, bpm)
  const opts = () => ({ seconds: seconds ?? 1, ease: g.ease })
  const running = glideOf(field.id)
  const back = returnValue(field.id)
  const durRef = useRef<HTMLInputElement>(null)
  return (
    <Keypad
      title={field.label}
      value={field.get()}
      def={field.def}
      hint={field.hint}
      current={() => glideOf(field.id)?.value ?? field.get()}
      onChange={(v) => field.onChange(field.hint.integer ? Math.round(v) : v, 'key')}
      onTarget={g.on ? (v) => void glideField(field, v, opts()) : undefined}
      onClose={() => {
        endUnlessGliding(field)
        closePopover()
      }}
    >
      <div class={`glide ${g.on ? 'on' : ''}`} data-testid="glide">
        <div class="glide-row">
          <label class="switch">
            <input type="checkbox" data-testid="glide-toggle" checked={g.on} onChange={(e) => set({ on: (e.currentTarget as HTMLInputElement).checked })} />
            Glide
          </label>
          {g.on && (
            <>
              <input
                ref={durRef}
                class={`glide-dur ${seconds === undefined ? 'bad' : ''}`}
                data-testid="glide-dur"
                type="text"
                inputMode="decimal"
                autocapitalize="off"
                autocorrect="off"
                spellcheck={false}
                aria-label="Glide duration: seconds, or beats with b (2b)"
                value={g.dur}
                onInput={(e) => set({ dur: (e.currentTarget as HTMLInputElement).value })}
              />
              <small class="glide-sec">{seconds === undefined ? 'e.g. 1, 0.5s, 2b' : g.dur.trim().toLowerCase().endsWith('b') ? `${fmt(seconds)} s at ${fmt(bpm)} bpm` : 's'}</small>
            </>
          )}
        </div>
        {g.on && (
          <>
            <div class="glide-durs">
              {['0.25', '0.5', '1', '2', '4', '1b', '2b', '4b'].map((d) => (
                <button type="button" key={d} class={`chip ${g.dur === d ? 'on' : ''}`} data-dur={d} onClick={() => set({ dur: d })}>
                  {d}
                </button>
              ))}
            </div>
            <div class="curves" role="radiogroup" aria-label="Glide curve">
              {EASE_PRESETS.map((name) => (
                <button type="button" role="radio" aria-checked={g.ease === name} key={name} class={`curve ${g.ease === name ? 'on' : ''}`} data-ease={name} title={easeLabel(name)} aria-label={easeLabel(name)} onClick={() => set({ ease: name })}>
                  <svg width="28" height="20" viewBox="-1 -1 30 22" aria-hidden="true">
                    <path d={easePath(name)} />
                  </svg>
                </button>
              ))}
            </div>
            <div class="glide-row">
              <span class="glide-status" data-testid="glide-status">
                {running ? `gliding ${fmt(running.value)} → ${fmt(running.spec.to)}` : `${easeLabel(g.ease)} · ${seconds === undefined ? '?' : fmt(seconds)} s`}
              </span>
              <button type="button" class="btn sm" data-testid="glide-return" disabled={back === undefined} onClick={() => glideBack(field, opts())}>
                ↩ {back === undefined ? 'return' : fmt(back)}
              </button>
            </div>
            {field.arg && (
              <button
                type="button"
                class="btn wide"
                data-testid="glide-loop"
                onClick={() => {
                  const h = kitHost()
                  if (!h || !field.arg) return
                  const a = back ?? field.get()
                  const b = running ? running.spec.to : field.get()
                  if (a === b) return toast('Glide to another value first: the loop goes between the value before the glide and after it')
                  const v = loopValue(a, b, seconds ?? 1, g.ease, bpm)
                  h.commit(setArg(h.sketch(), field.arg.callId, field.arg.index, v))
                  closePopover()
                  toast(`${field.label} now loops between ${fmt(a)} and ${fmt(b)}`)
                }}
              >
                Loop between {fmt(back ?? field.get())} and {fmt(running ? running.spec.to : field.get())}
              </button>
            )}
          </>
        )}
      </div>
    </Keypad>
  )
}

export interface OpenNumberOpts {
  tab?: NumberTab
  /** opened from another popover (an array or function editor): sit on top of it */
  stack?: boolean
  width?: number
}

/** Tap on a number: the tabbed editor as a popover next to it. */
export function openNumberEditor(anchor: Element | { left: number; top: number; right: number; bottom: number; width: number; height: number }, field: NumberField, o: OpenNumberOpts = {}): void {
  openPopover(anchor, () => <NumberEditor field={field} tab={o.tab} />, {
    width: o.width ?? 300,
    label: `${field.label} keypad`,
    stack: o.stack,
    onClose: () => endUnlessGliding(field),
  })
}

/** Closing the editor closes the number's undo step, except mid-glide: the glide commits its own single step when it lands. */
function endUnlessGliding(field: NumberField): void {
  if (!glideOf(field.id)) field.onChange(field.get(), 'end')
}
