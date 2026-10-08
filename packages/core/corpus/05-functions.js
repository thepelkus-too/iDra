// functions make numbers move
osc(() => 20 + 10 * Math.sin(time * 0.5), 0.1, () => mouse.x / width)
  .rotate(() => time * 0.1)
  .kaleid(() => 3 + Math.floor(Math.abs(Math.sin(time)) * 5))
  .out()
