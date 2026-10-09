# Where do sketches live on an iPad?

All editors share one origin, so they share one library (`getLibrary()`): IndexedDB (`hydra-ipad` database), falling back to
`localStorage` (`hydra-lib/…` keys), then memory (private browsing). `navigator.storage.persist()` is requested on first run.
The shell's *Storage & about* dialog and the line under the title show the engine in use, whether persistence was granted, usage/quota,
and whether the page is running as an installed app.

## The iOS caveat (documented, **not testable from the build container** — confirm on the iPad)

On iOS/iPadOS, a site added to the **Home Screen** runs as a separate web app whose website data (IndexedDB, localStorage, caches,
service workers, cookies) is **separate from Safari's**. Practical consequences:

* Sketches made in a Safari tab are **not visible** in the installed app, and the other way round. The installed app starts with the three starter sketches.
* Deleting the app from the Home Screen deletes its storage. Clearing Safari website data does not touch it (and vice versa).
* Safari applies "Intelligent Tracking Prevention" limits (script-writable storage can be cleared after about 7 days without interaction for sites used only in the browser); installed web apps are documented as exempt from that cap, and `navigator.storage.persist()` is supported in recent Safari versions. I could not verify the exact behaviour for your iOS version here, hence the backup features.
* Under storage pressure iOS may still evict non-persistent data.

What the app does about it:

1. The shell states the storage engine and whether it is installed or a tab, and says plainly that the two libraries are separate.
2. **Backup everything** downloads one JSON file (`hydra-ipad-backup-YYYY-MM-DD.json`: every sketch with its `meta`, so editor view-state survives); **Restore…** merges it back (newer copies win unless *overwrite* is ticked). Per-sketch **Export .js** (byte-identical to what was imported if untouched) and **Export .json** exist too; **Import…** accepts pasted text, `.js` and `.json` files.
3. The library keeps ~20 revisions per sketch (`library.revisions(id)`, `restoreRevision`).

## Recommended test on a real iPad (5 minutes)

1. In Safari, open the site, create a sketch. 2. Add to Home Screen, open the installed app: is the sketch there? (expect: no)
3. *Backup everything* in Safari, *Restore…* in the installed app. 4. Force-quit the installed app, reopen: still there?
5. Harness → Diagnostics → *IndexedDB + persistence* row: note `persistent` or `best-effort`. Paste the copied report into an issue.
