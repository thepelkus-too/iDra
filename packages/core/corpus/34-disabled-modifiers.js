// Modifiers switched off by commenting them out, one per line
osc(20, 0.1, 0.8)
  .rotate(0.8)
  // .kaleid(4)
  .color(1, 0.5, 0.2)
  //.scale(1.5)
  //    .pixelate(20, 20)
  .out()

// two on one comment line, one with a trailing note, and a combine with its texture argument
noise(3, 0.1)
  // .rotate(1).kaleid(4)
  .colorama(0.1)
  // .modulate(o1, 0.2) // too wobbly
  // .blend(osc(10).rotate(0.5), 0.5)
  .out(o1)

// comments in the chain that are not code stay comments
shape(4, 0.3)
  // TODO try .rotate() here
  // .repeat(2, 2) and then something
  // .out(o3)
  // .scale(2);
  .scrollX(0.1) // .rotate(2)
  .out(o2)

// a chain held by a variable, with a modifier switched off
const layer = voronoi(5, 0.3)
  // .thresh(0.5)
  .invert()
src(o0)
  .layer(layer)
  .out(o3)
