# Earlier hydra-motion builds

Sketches pin hydra-motion by URL and SRI (`<site>/plugins/hydra-motion@<version>/hydra-motion.js`), so every version a
sketch may have been saved with stays on the site. `packages/motion/dist/` holds only the current build; the earlier
built files live here, byte for byte as they were released, and `scripts/sync-motion.mjs --copy` serves each one at its
pinned path next to the current one.

`integrity.json` records each file's SRI. `scripts/sync-motion.mjs --check` (CI) fails if a file here no longer matches
it, or if the registry would move past a version that is not archived yet.

**Before bumping `packages/motion`'s version**, copy the released `packages/motion/dist/hydra-motion.js` to
`hydra-motion@<old version>/hydra-motion.js` here and add its SRI (the registry's `integrity` for that version) to
`integrity.json`. `sync-motion --check` refuses a registry entry whose previous version is not archived.
