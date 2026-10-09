// Bundles the sandboxed-frame runtime (hydra-synth + bridge) into one classic IIFE script.
// Classic (non-module) because a sandboxed frame without allow-same-origin has an opaque origin, and module scripts
// would need CORS headers. The host inlines this text into the frame's srcdoc, so it works offline too.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdirSync, statSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stubAudio = {
  name: 'stub-hydra-audio',
  setup(b) {
    // hydra-synth's microphone-bound Audio class (and the Meyda dependency it drags in) is never used: we run with
    // detectAudio:false and install our own `a` object (src/hydra-audio.ts).
    b.onResolve({ filter: /lib\/audio\.js$/ }, (args) => (args.importer.includes('hydra-synth') ? { path: 'stub-audio', namespace: 'stub' } : undefined))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default class Audio { constructor(){ throw new Error("hydra audio is not available in the frame") } }', loader: 'js' }))
  },
}
mkdirSync(resolve(root, 'dist-frame'), { recursive: true })
const out = resolve(root, 'dist-frame/hydra-frame.js')
await build({
  entryPoints: [resolve(root, 'src/runtime/frame-entry.ts')],
  outfile: out,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020', 'safari14'],
  minify: true,
  legalComments: 'none',
  banner: { js: '/* hydra-ipad frame runtime. Bundles hydra-synth (AGPL-3.0, https://github.com/ojack/hydra-synth) and regl (MIT). Source: see repository. */' },
  define: { 'process.env.NODE_ENV': '"production"', global: 'window' },
  plugins: [stubAudio],
  logLevel: 'warning',
})
console.log(`frame bundle: ${(statSync(out).size / 1024).toFixed(0)} KB → ${out}`)
