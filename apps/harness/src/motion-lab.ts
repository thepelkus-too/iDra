import { h, importText, MOTION_EASINGS, withMotion, type Runtime, type Sketch } from '@hydra-ipad/core'

// Motion lab: try hydra-motion on the iPad before any editor uses it. Every control calls the same method a person could
// type in the sketch (k.set / k.to / k.hold / k.release) through runtime.invoke; nothing here is iDra-only behaviour.

const LAB_BODY = `// p pauses Hydra's clock (the lab's Pause button sets it to 0)
p = knob(1, { clock: 'wall' })
update = () => { speed = p() }
osc(30, 0.08, 1.2)
  .color(k, 0.35, () => 1 - k())
  .rotate(() => k() * 0.6)
  .out()
`

/** The lab sketch: knob `k` (Hydra clock or wall clock), pause knob `p`, and a chain that shows k clearly. */
export function labSketch(clock: 'hydra' | 'wall', base?: Sketch): Sketch {
  // the hydra-clock form is exactly what knobDef('k', 0.5) produces
  const head = clock === 'wall' ? `k = knob(0.5, { clock: 'wall' })\n` : 'k = knob(0.5)\n'
  const s = importText(`// Motion lab: the controls move the knob k\n${head}${LAB_BODY}`, { name: 'Motion lab' }).sketch
  return withMotion({ ...s, id: base?.id ?? s.id, createdAt: base?.createdAt ?? s.createdAt, meta: base?.meta })
}

export interface MotionLabDeps {
  runtime: () => Runtime
  /** replace the open sketch with this one, trust it (the owner tapped the button) and run it */
  load: (s: Sketch) => Promise<void>
}

export function mountMotionLab(el: HTMLElement, deps: MotionLabDeps): void {
  const status = h('div', { class: 'status', id: 'motion-status', 'aria-live': 'polite' }, 'Load the lab sketch, then use the controls. Two fingers on two pads: the most recent pad wins.')
  const say = (t: string) => (status.textContent = t)
  const call = (method: 'set' | 'to' | 'hold' | 'release', args: Array<number | string>, name = 'k') => {
    const ok = deps.runtime().invoke(name, method, args)
    say(ok ? `${name}.${method}(${args.map((a) => JSON.stringify(a)).join(', ')})` : `${name}.${method} was refused: load the lab sketch first`)
  }
  const select = (id: string, label: string, opts: string[], value: string) =>
    h('label', { class: 'lab-field' }, label, h('select', { id, 'aria-label': label }, ...opts.map((o) => h('option', { value: o, selected: o === value }, o)))) as HTMLLabelElement
  const val = (id: string) => (el.querySelector(`#${id}`) as HTMLSelectElement | HTMLInputElement).value
  const dur = (id: string) => (/^[\d.]+$/.test(val(id)) ? Number(val(id)) : val(id))

  let clock: 'hydra' | 'wall' = 'hydra'
  const clockSel = select('lab-clock', 'Clock', ['hydra', 'wall'], 'hydra')
  const loadBtn = h('button', { type: 'button', class: 'primary', id: 'lab-load' }, 'Load lab sketch')
  loadBtn.addEventListener('click', () => {
    clock = val('lab-clock') as 'hydra' | 'wall'
    void deps.load(labSketch(clock)).then(() => say(`Lab sketch running (k on the ${clock} clock).`))
  })

  const slider = h('input', { type: 'range', id: 'lab-slider', min: 0, max: 1, step: 0.001, value: 0.5, 'aria-label': 'Knob k' }) as HTMLInputElement
  slider.addEventListener('input', () => call('set', [Number(slider.value)]))

  const glideRow = h('div', { class: 'row', id: 'lab-glides' })
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    const b = h('button', { type: 'button', 'data-to': v }, `→ ${v}`)
    b.addEventListener('click', () => {
      call('to', [v, dur('lab-dur'), val('lab-ease')])
      slider.value = String(v)
    })
    glideRow.append(b)
  }

  const pad = (id: string, label: string, value: number) => {
    const p = h('div', { class: 'lab-pad', id, role: 'button', tabindex: 0, 'aria-label': `${label}: hold for ${value}` }, h('strong', {}, label), h('span', {}, `hold → ${value}`))
    let pointer: number | undefined
    const down = (ev: PointerEvent) => {
      if (pointer !== undefined) return
      pointer = ev.pointerId
      try {
        p.setPointerCapture(ev.pointerId)
      } catch {
        /* synthetic events */
      }
      p.classList.add('on')
      call('hold', [value, dur('lab-attack'), val('lab-ease'), id])
      ev.preventDefault()
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return
      pointer = undefined
      p.classList.remove('on')
      call('release', [dur('lab-release'), val('lab-ease'), id])
    }
    p.addEventListener('pointerdown', down)
    p.addEventListener('pointerup', up)
    p.addEventListener('pointercancel', up)
    p.addEventListener('lostpointercapture', up)
    p.addEventListener('contextmenu', (e) => e.preventDefault())
    return p
  }

  let paused = false
  const pauseBtn = h('button', { type: 'button', id: 'lab-pause', 'aria-pressed': 'false' }, 'Pause (speed = 0)')
  pauseBtn.addEventListener('click', () => {
    paused = !paused
    pauseBtn.setAttribute('aria-pressed', String(paused))
    pauseBtn.textContent = paused ? 'Resume (speed = 1)' : 'Pause (speed = 0)'
    call('set', [paused ? 0 : 1], 'p')
  })

  el.append(
    h('p', { class: 'status' }, 'hydra-motion (MIT) adds knob() values that glide, jump and hold. The lab sketch binds the oscillator to the knob k; each control below runs k.set / k.to / k.hold / k.release in the preview, exactly what you could type.'),
    h('div', { class: 'row' }, loadBtn, clockSel, pauseBtn),
    h('div', { class: 'knob' }, h('label', { for: 'lab-slider' }, 'k.set (slider)'), slider, h('span', {})),
    h('div', { class: 'row' }, select('lab-dur', 'Glide', ['0.25', '0.5', '1', '2', '1b', '4b'], '1'), select('lab-ease', 'Curve', [...MOTION_EASINGS], 'easeInOutCubic')),
    glideRow,
    h('div', { class: 'row' }, select('lab-attack', 'Attack', ['0', '0.05', '0.2', '1b'], '0'), select('lab-release', 'Release', ['0', '0.15', '0.5', '2b'], '0.15')),
    h('div', { class: 'lab-pads' }, pad('A', 'Pad A', 1), pad('B', 'Pad B', 0)),
    status,
  )
}
