# MIDI

Sketches use MIDI through the [hydra-midi](https://github.com/arnoson/hydra-midi) plugin (`midi.start()`, `cc(n)`, `note(n)`;
see docs/plugins.md to add it). Two facts shape how it works here:

* **iPadOS Safari has no Web MIDI** (`navigator.requestMIDIAccess` does not exist), and nothing in the app assumes it does:
  `webMidiAvailable()` checks the live API every time.
* **The sandboxed preview frame can never use Web MIDI**, even on desktop: it has an opaque origin and no `midi` permission.

So the host page owns MIDI and forwards it:

```
real Web MIDI inputs (desktop, after "Use MIDI devices too")  ─┐
on-screen controller "Hydra Touch" (CC faders, keys, pads)     ─┼─► MidiHub (host) ─► {t:'midi', input, data} ─► frame shim ─► hydra-midi
                                                                ┘   {t:'midiInputs', inputs}             navigator.requestMIDIAccess()
```

The frame shim (`src/runtime/midi-shim.ts`) gives code in the frame a `navigator.requestMIDIAccess()` that resolves to an access
object with an `inputs` map, `statechange` events and `midimessage` events carrying `Uint8Array` data, written against
hydra-midi 0.4.6's use of the API. hydra-midi runs unmodified (a test drives the vendored 0.4.6 build through it).

## When MIDI isn't there

Never silent. When a sketch uses MIDI (`usesMidi`: a hydra-midi plugin, `midi.start/show/…`, or `cc(…)` / `note(…)` calls) and
the browser has no Web MIDI:

* the runtime reports a warning once per sketch: *"Web MIDI isn't available in this browser, so MIDI inputs won't respond; the
  on-screen controller (⇄ menu › MIDI controller) still sends MIDI. Diagnostics shows what this browser supports."*
* `midiBanner(sketch)` returns the banner *"Web MIDI isn't available in this browser, so MIDI inputs won't respond."* with a
  **Diagnostics** link (`diagnosticsHref()` → the harness's Diagnostics tab, `?tab=diag`) and, optionally, a button that opens
  the on-screen controller. The harness shows it above the code.
* Diagnostics → Web MIDI says `no` and why (the frame shim is never counted as Web MIDI).

## On-screen controller ("Hydra Touch")

`mountMidiController(el)` (harness MIDI tab) and `openMidiSheet()` (⇄ menu › MIDI controller… in every editor): 8 faders sending
CC 1–8, a 13-key keyboard from C3 (48; hydra-midi names C4 = 60), 8 pads on notes 36–43, a channel picker, and on browsers with
Web MIDI a "Use MIDI devices too" button that forwards hardware controllers as well. Faders use pointer capture, so a finger can
slide off the fader and keep control; several fingers work at once.

In a sketch:

```js
await midi.start({ input: '*', channel: '*' })
osc(cc(1).range(4, 60), 0.1, cc(2)).out()
```

## MIDI chips

`midiChip({ kind, index, channel?, min?, max? })` builds the IR value an editor binds to a parameter, and `parseMidiChip` reads it
back. **Deviation from the brief:** the brief sketched `() => cc(1)…` (an `fn`), but hydra-midi's `cc(n)` / `note(n)` already
return functions Hydra calls every frame, so the value is the expression itself, a `js` value such as `cc(1).range(0, 1)`; that is also
exactly what importing that text produces. Wrapping it in `() =>` would hand Hydra a function that returns a function.

## API

```ts
import { getMidiHub, webMidiAvailable, usesMidi, midiChip, parseMidiChip, mountMidiController, openMidiSheet, midiBanner } from '@hydra-ipad/core'
const hub = getMidiHub()                 // page-wide; createRuntime forwards it by default (midi: null turns that off)
hub.cc(1, 0.5) · hub.noteOn(60, 0.8) · hub.noteOff(60) · hub.send([0xb0, 7, 100])
await hub.enableWebMidi()                // from a tap; 'granted' | 'denied' | 'unavailable' in hub.webMidi
```
