# Plugins

Hydra extensions are ordinary scripts: they call `setFunction(...)` to add shader functions, or put helpers on `window`
(hydra-midi's `midi`, `cc`, `note`; hyper-hydra's array and output helpers), or both. Here they are managed per device and
per sketch, cached for offline use, and **only ever run inside the sandboxed preview frame**, never in the app page.

## Where you manage them

* **Shell → Plugins…**: everything installed on this device (add, inspect, check for changes, remove).
* **⇄ menu → Plugins…** in every editor: a bottom sheet with the same manager plus "Use in this sketch" toggles and the
  sketch's own `loadScript` lines. Editors that pass `sketchAccess` to `mountSwitcher` get edits in place; otherwise the sheet
  edits the saved copy and reloads the page when you close it, so the editor picks the change up.
* **Harness → Plugins** tab: the manager, plus the page catalog grouped by origin (`#fn-list`).

## Adding one

Three ways, all ending in the same preview card **before anything is installed or run**:

| how | notes |
|---|---|
| URL | any `https` script URL (jsDelivr, unpkg, raw GitHub, your own host) |
| Known plugins | the curated list in `packages/core/plugins/registry.json` |
| Paste code | stored with the plugin record (and in the sketch's `PluginRef.src`) |

The card shows the source URL, size, version (from the registry or the URL), **SHA-256** of the exact bytes, whether the URL is
**pinned** (`@1.2.3` or a commit) or floating (`@latest`, a branch, no version), and for registry entries the licence, author and
whether the URL was confirmed from the project's README. *Install* records it on this device; *Install and use in this sketch*
also adds a `PluginRef` to `sketch.plugins`. The manager then loads it once in a hidden sandboxed frame (`probePlugin`) to list
the functions and globals it adds, and any built-in it replaces.

### The registry

`packages/core/plugins/registry.json`: id, name, author, licence, homepage, URL, version, `kind`
(`functions` / `js` / `mixed`), description and `verified: { status, checked, how }`.
Entries built in this repository (hydra-motion) also carry `integrity`: the manager checks the file against it and the
runtime refuses anything else. Only URLs copied from each project's README are marked `verified`; the rest are listed with `unverified` and the card says so.

| plugin | licence | URL source |
|---|---|---|
| hydra-motion (pinned by version and SRI) | MIT | built from `packages/motion` in this repository and served by this site at `plugins/hydra-motion@<v>/hydra-motion.js` (a site-relative URL, resolved against the site root); see docs/motion.md |
| hydra-midi 0.4.6 (pinned) | MIT | README of github.com/arnoson/hydra-midi |
| hyper-hydra: arithmetics, arrays, blend, colorspaces, convolutions, gif, glsl, outputs, src, text (`@latest`) | GPL-3.0 | README of github.com/geikha/hyper-hydra |
| extra-shaders-for-hydra: `all`, `lib-pattern` | AGPL-3.0 | README of gitlab.com/metagrowing/extra-shaders-for-hydra |
| extra-shaders-for-hydra: `lib-softpattern`, `lib-color`, `lib-noise`, `lib-screen`, `lib-wave` | AGPL-3.0 | **unverified**: file names from the repository tree, not the README |

hyper-hydra only publishes `@latest` URLs, so those entries are floating; the manager warns about that (below). Nothing from these
projects is bundled with the app. `scripts/fixtures/hydra-midi/` holds an unmodified copy of hydra-midi 0.4.6's `dist/index.js` (MIT, its
licence alongside) used **only** by tests; the build never includes it.

## Loading

* `runtime.loadPlugin(ref)` and `sketch.plugins` (loaded in order before each full run) evaluate the code **inside the frame**.
  Code with top-level `await` works (it is retried inside an async function when a classic script would not parse; there,
  top-level `var` stays local, which matches how Hydra plugins publish things: `setFunction` or `window.x = …`).
* In inline mode (no isolation) plugins and `loadScript` are **refused** with a warning instead of running in the app page.
  `createRuntime(…, { pluginsInHostPage: true })` exists for tests only.
* Functions a plugin registers arrive as a catalog delta with `origin: 'plugin:<id>'`; `catalog.refresh` fires
  `catalog.subscribe`, editors re-render their pickers, and calls that were "unknown function" become known (and keep their text).
  Inputs of other types (`int`, `vec2`…`vec4`, `sampler2D`) come through as `InputDef.type`.
* A plugin defining a name that already exists (a built-in or another plugin's) **replaces it** and the runtime reports
  `plugin <id> replaces the built-in function "<name>"` (also in `PluginResult.shadows`).
* JS-only plugins (hydra-midi, hyper-hydra helpers) add globals, listed in `PluginResult.globals`. Their calls stay as raw text
  and `js`/`fn` values in the IR, exactly as written.
* A plugin that fails (network, syntax, integrity) is reported with its URL, and **the sketch runs without it**: its functions
  stay unknown calls. A `PluginRef.integrity` (`sha256-…`, recorded when you install a pinned URL or paste code) must match or
  the plugin is not run.
* Plugins that look for Hydra's renderer get `window.hydraSynth` (hyper-hydra uses `hydraSynth.regl`), and `localStorage` /
  `sessionStorage` are in-memory stand-ins inside the frame (an opaque origin throws on them; hydra-midi 0.4.6 reads
  `sessionStorage` while loading).

## `loadScript` and the offline cache

The frame never fetches scripts. `loadScript(url)` (and URL plugins) ask the host, whose `ScriptCache` keeps every script in
Cache Storage (`hydra-ipad-scripts-v1`, kept by the service worker across app updates):

* **pinned URLs** (`@1.2.3`, a commit hash): served from the cache once fetched, never refetched;
* **floating URLs** (`@latest`, branches, unversioned): network first while online, the cached copy offline, and a warning
  once per URL per runtime: "is not pinned to a version: what it does may change between runs". *Check for changes* in the
  manager refetches and shows whether the hash moved.

A sketch that loads a URL both as a plugin and with its own `await loadScript(url)` line evaluates it once.

## Code text

`toCode(sketch)` starts with `await loadScript('<url>')` for each URL plugin in `sketch.plugins` **unless a raw statement
already loads that URL** (so imported text round-trips byte for byte), then a blank line. Pasted plugins add a comment line instead
(plain text cannot carry them). When you import text that has `loadScript` lines, the shell's Import dialog and the manager offer
**Add to plugins**: the URL is fetched, cached and recorded with its hash; the line in the sketch is left as it is.

## Self-contained export

`exportWithPrelude(sketch)` inlines hydra-motion's code at the top of the text (between delimiters with its version, SRI
and MIT notice) instead of a `loadScript` line, so the file runs in vanilla Hydra with no network; importing it gives back the
plugin, not raw code. Other plugins keep their `loadScript` lines. `compat(sketch)` says whether the exported text needs
plugins or iDra itself. See docs/motion.md.

## Trust

A sketch with plugins always goes through the trust gate (`riskyParts` lists them; the approval fingerprint covers each plugin's
id, URL, pasted source and integrity). Until the owner says yes it runs in safe mode, which skips plugins. See `docs/security.md`.

## API

```ts
import { getPluginStore, pluginRegistry, mountPluginManager, openPluginSheet, probePlugin, withPlugin, withoutPlugin,
         pluginRefFor, pluginRefFromUrl, findLoadScripts, onPluginLoaded, getScriptCache } from '@hydra-ipad/core'
const store = getPluginStore()                      // IndexedDB 'hydra-ipad-plugins'
const preview = await store.preview(url)            // fetch + hash, nothing runs
const rec = await store.install(preview)
sketch = withPlugin(sketch, pluginRefFor(rec))
const r = await rt.loadPlugin(pluginRefFor(rec))    // { ok, delta, globals, shadows, from, warning }
```
