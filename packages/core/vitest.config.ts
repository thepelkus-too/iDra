import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export default defineConfig({
  resolve: {
    alias: [
      // hydra-synth's `exports` only exposes the entry and glsl-functions; tests reach into src/ for the pure-JS parts
      { find: /^@hydra-src\/(.*)$/, replacement: resolve(here, '../../node_modules/hydra-synth/src/$1') },
    ],
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 30000, setupFiles: ['./test/setup-dom.ts'] },
})
