# Previews on an iPad (Vercel, with GitHub Pages as a fallback)

Everything is one static site: `npm run build:all` writes `dist/` (the shell at the root, every editor in `dist/<name>/`,
`apps.json`, one root-scope `sw.js`). Vercel and GitHub Pages both serve it over HTTPS, which service workers, Add to Home
Screen, the camera and the microphone require.

> **What I could not verify from the build container:** I have no Vercel account and no outbound access to the Vercel dashboard,
> so every Vercel-side statement below comes from Vercel's documented behaviour as I know it, not from a run. Check the dashboard
> labels on first use; they move around. The build itself (`npm ci && npm run build:all` → `dist/`) *was* run here.

## One-time setup (repo owner)

1. Vercel → **Add New… → Project → Import Git Repository** → pick `thepelkus-too/iDra` (install/authorise the Vercel GitHub app for that repo).
2. **Framework Preset: Other.** The repo's `vercel.json` already sets what the dashboard would ask for, so leave the overrides alone:
   * Install Command `npm ci`
   * Build Command `npm run build:all`
   * Output Directory `dist`
   * Root Directory: the repository root (not `apps/…`)
   * Node.js: 20 or newer (22 is what I tested with; set it under *Settings → General → Node.js Version* if the default is older).
3. **Settings → Git → Production Branch: `main`.** Every other branch becomes a Preview deployment.
4. Deploy. Nothing needs environment variables: `VERCEL_GIT_COMMIT_SHA` and `VERCEL_GIT_COMMIT_REF` are provided by Vercel and
   are used for the service-worker version and the "branch · commit" line in the shell footer. No secrets, tokens or project ids are
   committed (`vercel.json` has none, `.vercel/` and `.env*` are git-ignored).

## Where preview URLs come from

* **Per commit:** each push gets its own URL (`<project>-<hash>-<team>.vercel.app`), shown on the commit/PR as the Vercel check and in the dashboard under *Deployments*. It never changes, so it is the one to cite in a bug report.
* **Per branch:** each branch also gets a stable alias that always points at the newest deployment of that branch, of the form
  `<project>-git-<branch>-<team>.vercel.app` (branch name slugified; long names are truncated by Vercel). For the prototype branches
  expect e.g. `…-git-proto-graph-….vercel.app`. The alias is also listed on the deployment page under *Domains*.
* The PR comment the Vercel bot posts links the same URLs.

Each preview contains the shell **and every editor present on that branch**. A branch that adds `apps/graph` gets `/graph/` with no
config change, because `scripts/build-all.mjs` auto-discovers every `apps/*` with a `build` script and lists it in `/apps.json`.

## Deployment Protection — read this before testing on the iPad

By default Vercel puts previews behind **Deployment Protection ("Vercel Authentication")**: opening a preview URL requires being signed
in to a Vercel account with access to the team. On an iPad you have two options — **this is the owner's choice, I have changed nothing**:

* **Sign in to Vercel in Safari on the iPad** once (the preview then opens), or
* **Relax protection for previews:** *Project → Settings → Deployment Protection → Vercel Authentication*. Options include "Standard" (production public, previews protected), "Only Preview Deployments", "All Deployments", or "Disabled"; "Shareable Links" and "Protection Bypass for Automation" also exist on some plans. Disabling it makes every preview URL public to anyone who has the link. This repository is public anyway, but a branch alias is still guessable, so prefer a shareable link if you want to stay protected.

If a protected URL is installed as a Home Screen app, the sign-in cookie may not be shared with the standalone app (see `docs/ios-storage.md`), which is one more reason to test the installed app against a **production** URL (`main`) or GitHub Pages.

## Pull requests from forks

Because the repository is public, PRs from **forks** normally do not auto-deploy: Vercel asks a team member to authorise the
deployment first (a comment on the PR with an "Authorize" link). Branches pushed to this repository itself deploy automatically.

## Cost / licensing note

Vercel's free **Hobby** plan is intended for **non-commercial, personal use**; commercial use needs a paid plan. If that is a
concern, use the GitHub Pages fallback below, or any other static host (the build output is plain files).

## Fallback: GitHub Pages (no extra account)

`.github/workflows/pages.yml` builds and deploys `main` to GitHub Pages using only the default `GITHUB_TOKEN`:

1. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions** (one-time; I cannot set this from here).
2. Push to `main` (or run the workflow manually). The site appears at `https://thepelkus-too.github.io/iDra/`.

Everything uses relative URLs and `base: './'`, so the sub-path is fine; the service worker scope is the directory it is served from.
GitHub Pages serves `Cache-Control: max-age=600`: after a deploy the update toast may take up to ~10 minutes to appear.

## On the iPad

1. Open the **site root** (`https://…/`, not an editor URL) in Safari.
2. Share → **Add to Home Screen**. The manifest (`scope` and `start_url` are the root) makes the shell the installed app; switching editors from the switcher stays inside the app.
3. Open it once online so the service worker can precache everything (`dist/` is ~1.2 MB today), then it works offline.
4. Home Screen apps and Safari tabs keep **separate** storage on iOS: the installed app starts with an empty library. Use *Backup everything* / *Restore…* to move sketches (see `docs/ios-storage.md`).
5. *Harness → Diagnostics → Copy report* shows what that iPad supports; paste it into an issue.

## Local

```
npm ci
npm run build:all          # → dist/
npm run serve              # http://localhost:4173 (service worker and camera work on localhost)
npm run dev --workspace=harness
npm test                   # core unit tests (vitest)
npm run test:e2e           # real Chromium at an iPad viewport, software WebGL
```
