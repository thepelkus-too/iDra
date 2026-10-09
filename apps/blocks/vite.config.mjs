import { hydraApp } from '@hydra-ipad/core/vite'
export default hydraApp(import.meta.url, {
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
})
