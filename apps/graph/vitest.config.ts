import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  define: { __REPO_URL__: JSON.stringify('https://github.com/thepelkus-too/iDra'), __COMMIT__: JSON.stringify(''), __BRANCH__: JSON.stringify('') },
  test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'node', testTimeout: 30000, setupFiles: ['./test/setup.ts'] },
})
