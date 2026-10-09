# Audio

## Architecture

```
mic / file ──► AudioContext (HOST page) ──► AnalyserNode ──► Meyda loudness (24 Bark bands + total)
                   │                                              │
                   └─► monitor gain ─► speakers                   ▼  postMessage {t:'audio', vol, specific} every frame
                                                         frame: HydraAudio.feed()  → a.bins / a.fft / a0…aN
```

Hydra's own `a` object (`hydra-synth/src/lib/audio.js`) opens the microphone in its constructor and cannot take a file or a stream, so
the runtime starts hydra-synth with `detectAudio: false` (and the frame bundle stubs that module out) and installs
`HydraAudio` (`packages/core/src/hydra-audio.ts`) as `a`. It mirrors Hydra's semantics: `fft`, `bins`, `vol`, `setBins`, `setCutoff`,
`setScale`, `setSmooth`, `setMax`, `show`, `hide`, and the `a0…aN` helpers `setBins` creates. `feed()` is a line-for-line port of
`Audio.tick()`; `test/audio.test.ts` runs the **real** hydra-synth `Audio` class and `HydraAudio` on identical frames and asserts
identical `vol`, `bins` and `fft` (including after `setCutoff/Scale/Smooth/Bins`). Differences kept on purpose: no beat detection
(`onBeat` is a no-op stub), no microphone, and `reduce` has an initial value so `setBins(n)` with `n > 24` yields zeros instead of throwing.

Installing it: `hydra.synth.a = audio; window.a = audio` after construction (the sandbox copies `synth` keys to `window` when `makeGlobal`).

## Using it from an editor

```ts
import { getAudioEngine, mountAudioPanel, audioChip, parseAudioChip } from '@hydra-ipad/core'
mountAudioPanel(el)                         // source picker, start/stop/pause, level+bins meter, cutoff/scale/smooth/bins, monitor volume
const rt = createRuntime(stage, { audio: getAudioEngine() })   // streams analysis into the frame
setArg(sketch, call.id, 0, audioChip(1, 4, 0.5))               // → () => a.fft[1] * 4 + 0.5
```

`AudioSource` = `{kind, label, start(ctx) → AudioNode, stop(), transport?}`; `MicSource` and `FileSource` ship now; `stream` and `device`
(and a device picker, beat detection, streaming playback) are the follow-up change. `AudioEngine`: `setSource`, `start` (**must be called from a
user gesture**), `stop`, `pause`/`resume`, `setSettings({bins,cutoff,scale,smooth})`, `setMonitorGain`, `setMonitorMuted`, `onFrame`, `onSettings`, `subscribe`.
A sketch calling `a.setCutoff(3)` updates the panel (frame → host `audioSettings` message) and vice versa.

## iOS handling (implemented; **not testable in the build container** — verify on the iPad)

* The `AudioContext` is created and `resume()`d inside `engine.start()`, i.e. from the tap on *Start*.
* Re-resume: on `statechange` (iOS reports `interrupted` for calls/Siri/other apps), and on `visibilitychange`, `pageshow`, `pointerdown`, `touchend` while the engine wants to run.
* **Hardware silent switch (iPhones and some older iPads; most current iPads have none, where this is a harmless no-op):** iOS mutes Web Audio but not `<audio>` playback. `installSilentBypass()` sets `navigator.audioSession.type` (`'playback'`, or `'play-and-record'` for the mic; Safari 16.4+) and loops a generated 1-second silent WAV through an `<audio>` element, started from the same gesture. This follows the technique of [activetheory/ios-silent-bypass](https://github.com/activetheory/ios-silent-bypass) (MIT licensed; license checked); the code here is our own, no third-party data is embedded.
* **Playback volume while the mic is active:** iOS may route output to the receiver or reduce its level when an input is open. Not fixable from a page; the panel says so. Keep the monitor muted for the mic (default) to avoid feedback.
* Mic constraints turn echo cancellation, noise suppression and auto-gain **off**, they flatten the dynamics the visuals react to.

## What cannot be done

A web page cannot capture audio from other apps on the iPad (there is no system-audio capture; `getDisplayMedia` does not exist in iOS Safari and
elsewhere rarely carries audio). Workarounds: **acoustic pickup** through the microphone (hold the iPad near the speaker), or **hardware**:
a USB-C audio interface with line-in, or a loopback cable/adapter feeding the interface, selected as the input device (the device picker arrives with the next change; iOS exposes it as the mic).

## Meyda note

Analysis calls `Meyda.extract('loudness', samples)` on a 512-sample `AnalyserNode` time-domain buffer each animation frame, which is the same
input size and windowing (Hann) as Hydra's `createMeydaAnalyzer` (`bufferSize` 512); only the scheduling differs (per frame instead of per ScriptProcessor callback).
