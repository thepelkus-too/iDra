// feedback: read the output back into itself
src(o0)
  .scale(1.01)
  .rotate(0.01)
  .layer(osc(40, 0.05, 1).mask(shape(4, 0.4, 0.01)))
  .modulate(noise(2, 0.1), 0.004)
  .out(o0)
