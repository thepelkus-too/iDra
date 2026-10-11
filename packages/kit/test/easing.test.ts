import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { MOTION_EASINGS } from '@hydra-ipad/core'
import { describe, expect, it } from 'vitest'
import { EASE_PRESETS, EASINGS, ease, easePath } from '../src/easing'

// the built plugin, evaluated on its own: the kit's curves must match what a pad's glide does in the sketch
const file = createRequire(import.meta.url).resolve('hydra-motion/dist/hydra-motion.js')
const sandbox: Record<string, unknown> = { console: { warn() {}, log() {} } }
sandbox.window = sandbox
sandbox.globalThis = sandbox
runInNewContext(readFileSync(file, 'utf8'), sandbox)
const hm = sandbox.hydraMotion as { ease(name: string): (t: number) => number; easings: Record<string, unknown> | string[] }

describe('easing', () => {
  it('names come from the plugin (core MOTION_EASINGS), at least eight presets, all real names', () => {
    expect(EASINGS).toEqual(MOTION_EASINGS)
    expect(EASE_PRESETS.length).toBeGreaterThanOrEqual(8)
    for (const n of EASE_PRESETS) expect(EASINGS).toContain(n)
  })
  it('every curve matches hydraMotion.ease(name) from the built file', () => {
    for (const name of EASINGS) {
      const theirs = hm.ease(name)
      const ours = ease(name)
      for (let i = 0; i <= 64; i++) {
        const t = i / 64
        expect(Math.abs(ours(t) - theirs(t))).toBeLessThan(1e-12)
      }
    }
  })
  it('unknown names are linear; thumbnails are paths', () => {
    expect(ease('nope')(0.3)).toBe(0.3)
    expect(easePath('linear')).toMatch(/^M 0\.0 20\.0 L/)
  })
})
