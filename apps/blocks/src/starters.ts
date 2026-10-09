// Starter scripts for the "New from a starter" sheet: classic Hydra idioms, short enough to read as blocks. Written as code and
// imported through core's parser (the IR it produces is the same as hand-built blocks; the code is the readable form).
// Core has no template registry yet (see the PR's core change requests), so these live here and make a new library sketch.
export interface Starter {
  name: string
  about: string
  code: string
}

export const STARTERS: Starter[] = [
  {
    name: 'Kaleidoscope',
    about: 'Stripes folded into a turning mirror.',
    code: 'osc(20, 0.1, 0.8)\n  .kaleid(6)\n  .rotate(0, 0.1)\n  .out()\n',
  },
  {
    name: 'Feedback trails',
    about: 'The picture reads itself, so movement leaves trails.',
    code: 'shape(4, 0.3, 0.01)\n  .rotate(() => time * 0.2)\n  .blend(src(o0).scale(1.01), 0.9)\n  .out(o0)\n',
  },
  {
    name: 'Wobbly stripes',
    about: 'Stripes pushed around by moving noise.',
    code: 'osc(30, 0.05, 1.2)\n  .modulate(noise(3, 0.2), 0.3)\n  .out()\n',
  },
  {
    name: 'Pulsing shape',
    about: 'A triangle whose size follows a sine wave.',
    code: 'shape(3, () => Math.sin(time * 2) * 0.2 + 0.4, 0.02)\n  .color(1, 0.4, 0.7)\n  .out()\n',
  },
  {
    name: 'Pattern steps',
    about: 'Shapes that step through 3, 4 and 6 sides.',
    code: 'shape([3, 4, 6].fast(0.5), 0.5, 0.01)\n  .repeat(3, 3)\n  .out()\n',
  },
  {
    name: 'Two outputs mixed',
    about: 'Two scripts on o1 and o2, blended on o0.',
    code: 'osc(10, 0.1, 0.5).out(o1)\nvoronoi(5, 0.3).out(o2)\nsrc(o1)\n  .diff(src(o2))\n  .out(o0)\n',
  },
  {
    name: 'Colour cycle',
    about: 'Soft noise whose hue keeps turning.',
    code: 'noise(2, 0.1)\n  .colorama(() => time * 0.05)\n  .saturate(1.5)\n  .out()\n',
  },
]
