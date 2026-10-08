// deeply nested textures
osc(10, 0.1, 1)
  .modulate(
    noise(3).modulateRotate(osc(5).rotate(1), 0.4).kaleid(3),
    0.2
  )
  .layer(src(o0).modulate(voronoi(4, 0.3, 0.1), 0.01).luma(0.3))
  .out()
