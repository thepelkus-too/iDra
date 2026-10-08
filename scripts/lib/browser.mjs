// Launch Chromium for scripts/tests. In the cloud container Playwright's own browser download is skipped and a
// system Chromium lives at /opt/pw-browsers/chromium; elsewhere Playwright's own install is used.
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

// Software WebGL (SwiftShader): there is no GPU in CI / the container. Timings taken this way are NOT device performance.
export const SOFTWARE_GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
export const FAKE_MEDIA_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

export function launch(opts = {}) {
  const sys = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
  const { args = [], ...rest } = opts
  return chromium.launch({ executablePath: sys, args: ['--no-sandbox', ...args], ...rest })
}
