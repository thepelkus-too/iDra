// Launch the test browser. BROWSER=webkit runs Playwright's WebKit (the engine behind Safari on iPad); the default is
// Chromium. In the cloud container Playwright's own Chromium download is skipped and a system Chromium lives at
// /opt/pw-browsers/chromium; elsewhere Playwright's own install is used.
import { chromium, webkit } from 'playwright'
import { existsSync } from 'node:fs'

export const BROWSER = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium'
export const IS_WEBKIT = BROWSER === 'webkit'

// Software WebGL (SwiftShader): there is no GPU in CI / the container. Timings taken this way are NOT device performance.
// These are Chromium command-line flags; WebKit uses its own software GL on Linux and takes none of them.
export const SOFTWARE_GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
export const FAKE_MEDIA_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

export function launch(opts = {}) {
  const { args = [], ...rest } = opts
  if (IS_WEBKIT) return webkit.launch(rest)
  const sys = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
  return chromium.launch({ executablePath: sys, args: ['--no-sandbox', ...args], ...rest })
}
