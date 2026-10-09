// One line of plain-English help per catalog function (≤ 12 words each), shown on a long press in the palette.
// First pass written for this app; lines marked `TODO review` are ones I am less sure describe the effect well.
// Functions the catalog gains later (plugins) fall back to a generic line built from their category.
import type { FnDef } from '@hydra-ipad/core'

export const HELP: Record<string, string> = {
  noise: 'Smooth cloudy noise that drifts over time.',
  voronoi: 'Cells like cracked mud or soap bubbles.',
  osc: 'Stripes of colour that slide across the screen.',
  shape: 'A polygon: sides, size and how soft its edge is.',
  gradient: 'A colour fade from corner to corner.',
  src: 'Use an output or camera source as the starting picture.',
  solid: 'One flat colour everywhere.',
  prev: 'The previous frame of this output (feedback). TODO review',
  rotate: 'Turn the picture; speed keeps it spinning.',
  scale: 'Zoom in or out, and stretch sideways or up.',
  pixelate: 'Big chunky pixels.',
  posterize: 'Fewer colour steps, like a screen print.',
  shift: 'Nudge the red, green and blue channels.',
  repeat: 'Tile the picture in a grid.',
  modulateRepeat: 'Tile the picture, warped by another picture.',
  repeatX: 'Tile the picture side by side.',
  modulateRepeatX: 'Tile sideways, warped by another picture.',
  repeatY: 'Tile the picture top to bottom.',
  modulateRepeatY: 'Tile up and down, warped by another picture.',
  kaleid: 'Mirror into a kaleidoscope with this many sides.',
  modulateKaleid: 'Kaleidoscope whose sides are bent by another picture.',
  scroll: 'Slide the picture; speeds keep it moving.',
  scrollX: 'Slide the picture left or right.',
  modulateScrollX: 'Slide sideways by the brightness of another picture.',
  scrollY: 'Slide the picture up or down.',
  modulateScrollY: 'Slide up or down by another picture.',
  add: 'Add another picture on top, brightening.',
  sub: 'Subtract another picture, darkening.',
  layer: 'Put another picture on top, using its transparency.',
  blend: 'Mix with another picture by an amount.',
  mult: 'Multiply with another picture: dark parts darken.',
  diff: 'Difference with another picture: strange inverted colours.',
  modulate: 'Warp the picture using another picture.',
  modulateScale: 'Zoom different parts by another picture.',
  modulatePixelate: 'Pixel size follows another picture.',
  modulateRotate: 'Twist the picture by another picture.',
  modulateHue: 'Push pixels by colour differences in another picture. TODO review',
  invert: 'Flip colours to their opposites.',
  contrast: 'More or less difference between light and dark.',
  brightness: 'Make everything lighter or darker.',
  mask: 'Show only where another picture is bright.',
  luma: 'Keep only the bright parts, the rest transparent.',
  thresh: 'Black and white: brighter than this becomes white.',
  color: 'Tint by red, green, blue and alpha amounts.',
  saturate: 'Stronger or greyer colours.',
  hue: 'Spin colours around the colour wheel.',
  colorama: 'Psychedelic colour cycling.',
  sum: 'Add up the colour channels, each scaled. TODO review',
  r: 'Keep only the red channel, as grey.',
  g: 'Keep only the green channel, as grey.',
  b: 'Keep only the blue channel, as grey.',
  a: 'Keep only the alpha channel, as grey.',
}

const GENERIC: Record<string, string> = {
  src: 'Makes a picture from scratch.',
  coord: 'Moves or bends the picture.',
  color: 'Changes the colours.',
  combine: 'Mixes in another picture.',
  combineCoord: 'Warps the picture using another picture.',
}

export function helpFor(f: FnDef | undefined, name = f?.name ?? ''): string {
  if (HELP[name]) return HELP[name].replace(/\s*TODO review$/, '')
  if (!f) return 'A function this editor does not know (a plugin that has not loaded yet?).'
  const plugin = f.origin.startsWith('plugin:') ? ` From the plugin ${f.origin.slice(7)}.` : ''
  return (GENERIC[f.type] ?? 'A Hydra function.') + plugin
}
