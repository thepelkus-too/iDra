import { hydraApp } from '@hydra-ipad/core/vite'

// The shell is built to the SITE ROOT (../../dist): it owns the manifest and the single root-scope service worker.
export default hydraApp(import.meta.url, { build: { outDir: '../../dist', emptyOutDir: true } })
