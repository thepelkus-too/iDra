// Three starter sketches seeded into the library on first run (see Library.seedIfEmpty).
export const starters: Array<{ name: string; code: string }> = [
  {
    name: 'Oscillator spin',
    code: `// a first sketch: change a number, see what moves
osc(20, 0.1, 0.8)
  .rotate(0.8, 0.1)
  .kaleid(5)
  .color(1, 0.6, 1.2)
  .out()
`,
  },
  {
    name: 'Feedback bloom',
    code: `// the output is read back into itself
src(o0)
  .scale(1.01)
  .rotate(0.01)
  .layer(osc(30, 0.05, 1).mask(shape(4, 0.4, 0.01)))
  .modulate(noise(2, 0.1), 0.004)
  .out(o0)
`,
  },
  {
    name: 'Moving numbers',
    code: `// functions and arrays make parameters move
speed = 0.6
shape([3, 4, 6].fast(0.5), () => 0.3 + Math.sin(time) * 0.1, 0.02)
  .color([1, 0.2, 0.7].smooth(), 0.5, 0.9)
  .modulateScale(noise(3, 0.1), 0.3)
  .out()
`,
  },
]
