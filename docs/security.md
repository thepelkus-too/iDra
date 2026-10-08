# Security model

Sketches are arbitrary JavaScript and plugins are third-party scripts. All apps share **one origin** with the sketch library
(IndexedDB, `localStorage`). So by default the Hydra runtime runs in a **sandboxed iframe** that cannot touch any of that.

## What is isolated

`createRuntime(container)` (default `isolation: 'iframe'`) creates `<iframe sandbox="allow-scripts" srcdoc=…>`:

* **no `allow-same-origin`** → opaque origin: no access to the library's IndexedDB, `localStorage`, cookies, the parent DOM, or the service worker's caches. Checked in a real browser by the e2e run (a sketch's `parent.document.title` throws `SecurityError`) and live by *Diagnostics → Sandboxed frame is isolated*.
* The frame's code is the bundled `hydra-frame.js` (hydra-synth + `src/runtime/bridge.ts`), inlined into `srcdoc` by the host: nothing is fetched from a CDN, it works offline, and module-script CORS problems of opaque origins do not arise (it is a classic script).
* The **only** channel is `postMessage` (`src/runtime/protocol.ts`). The host only accepts messages whose `event.source` is its own iframe and treats them as data (never evals them); the frame only accepts messages from `window.parent`.
* **The microphone is never given to the frame.** Audio is captured and analysed in the host; only `loudness.specific`/`total` numbers cross the boundary each frame (`HydraAudio` inside the frame turns them into `a.fft` with Hydra's formulas).
* `loadScript(url)` and plugins go through the host (`ScriptCache`: network first, cached copy when offline, optional SRI check). The frame never fetches scripts itself.
* Inline mode (`isolation: 'inline'`) runs the same bridge in the host window, with the same structured-clone message semantics, but with **no isolation**: sketch code can read the library. It is for tests, debugging and the camera fallback below. Editors must gate it behind the trust prompt.

## What the sandbox does NOT protect against

* **Network:** a sandboxed frame can still `fetch`/`XHR`/load images/`WebSocket` anywhere the browser allows (no CSP is set; Hydra sketches legitimately load images/videos/scripts). A malicious sketch can exfiltrate anything *it* can see (e.g. screen/camera frames it was given) or call third-party services.
* **CPU / GPU / memory:** infinite loops, huge allocations and expensive shaders can freeze or crash the tab (the frame shares the process with the host in some browsers). The host cannot preempt a sketch; reload.
* **UI spoofing:** the frame draws pixels, so it can fake a dialog inside its own area (including the "Run it?" prompt). The trust prompt lives in the host's chrome, outside the frame.
* **Popups/navigation:** `allow-popups` and `allow-top-navigation` are not granted, so these are blocked; the frame can still try to open windows from user gestures it receives only if you add those flags. Don't.
* **Side channels** (timing, GPU fingerprinting) are out of scope.
* **Supply chain:** hydra-synth and regl are bundled at build time from `package-lock.json`; plugins are only as trustworthy as their URL. Use `integrity` (`sha256-…`) on plugin refs.

## Trust gate

`needsTrustPrompt(sketch, approvedFingerprint)` is true when a sketch has `raw` stmts, `def`s with arbitrary JS, expressions outside the
safe subset (`isSafeExpression`: arithmetic over `time`, `mouse`, `a.fft[i]`, `a0()`, `bpm`, `width`, `height`, `Math.*`), or plugins —
unless the owner approved that exact content (`library.approve(sketch)` stores a hash of just the risky parts).
`runtime.run(sketch, { safe: true })` runs only recognised chains, settings and sources and replaces unsafe expressions by the catalog default.
The allowlist is deliberately small; it is a convenience filter for "obviously just maths", **not** a security boundary — the iframe is.

## Camera and screen sources

Tested here (Chromium, fake camera device, `allow="camera *"` on the sandboxed frame): **`getUserMedia` is denied (`SecurityError`)**
inside an opaque-origin frame; permissions cannot be held by an opaque origin. (The e2e run records this on every execution; I could
not test iOS Safari.) Therefore `s0.initCam()` / `initScreen()` do not work in iframe mode. The harness detects `describe(sketch).usesCamera`
(and `camera` runtime errors) and offers **"Switch to inline"**, which runs the sketch with no isolation. Do that only for sketches you trust.
A better design (not built): the host captures the camera and transfers frames (`ImageBitmap`) into the frame like audio.

## Reporting

Please report vulnerabilities privately through GitHub's *Security → Report a vulnerability* on the repository.
