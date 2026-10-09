<!-- SPDX-License-Identifier: MIT -->
# Moving hydra-motion to its own repository

`packages/motion` is self-contained: its build and tests use only its own files and its own dev dependencies
(`esbuild`, `hydra-synth`). iDra uses only the built file, through the plugin registry. So moving it is four steps.

## 1. Split the history

From the iDra repository root, on an up-to-date `main`:

```sh
git subtree split --prefix=packages/motion -b hydra-motion-split
mkdir ../hydra-motion && cd ../hydra-motion
git init -b main
git pull ../iDra hydra-motion-split
# point package.json "repository" at the new repo (it is a placeholder: git+https://github.com/OWNER/hydra-motion.git)
git remote add origin git@github.com:<owner>/hydra-motion.git
git push -u origin main
```

Check it stands alone: `npm install && npm run build && npm test` (the build must reproduce `dist/hydra-motion.js` byte
for byte).

## 2. Publish

```sh
npm view hydra-motion          # must still say the name is free (it was when this package was written; check again)
npm login
npm publish --access public
git tag hydra-motion-v0.1.0 && git push origin hydra-motion-v0.1.0
```

## 3. Repoint iDra's registry

In iDra, only three fields of the `hydra-motion` entry in `packages/core/plugins/registry.json` change:

```json
"url": "https://cdn.jsdelivr.net/npm/hydra-motion@0.1.0/dist/hydra-motion.js",
"version": "0.1.0",
"integrity": "sha256-…"   // of that exact file
```

Then `packages/core/package.json` depends on `"hydra-motion": "0.1.0"` from npm instead of the workspace, and
`scripts/sync-motion.mjs` stops rewriting the entry (or reads the npm copy to check the SRI). Sketches saved with the old
site URL keep working while the site still serves `plugins/`; new ones get the npm URL.

## 4. Delete the workspace

```sh
git rm -r packages/motion
# remove the "!packages/motion/dist/" line from .gitignore and the hydra-motion steps from scripts/build-all.mjs and CI
npm install
```
