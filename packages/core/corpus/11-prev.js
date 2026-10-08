// prev() is the previous frame of the output this chain writes to
prev()
  .scale(0.99)
  .hue(0.01)
  .layer(shape(3, 0.2).color(1, 0.3, 0.1))
  .out(o1)
render(o1)
