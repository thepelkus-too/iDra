# hydra-midi 0.4.6 (vendored for tests only)

`index.js` is `dist/index.js` from the npm package `hydra-midi@0.4.6` by Arno Schlipf (https://github.com/arnoson/hydra-midi),
unmodified, under the MIT License in `LICENSE`. It is used only by the unit tests and the e2e run, which cannot reach a CDN,
to check that the frame's Web MIDI shim and the on-screen controller drive the real plugin. The app itself never ships it:
users install hydra-midi from its CDN URL through the plugin manager.
