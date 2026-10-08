// arrays step once per beat
shape([3, 4, 5, 6].fast(0.5), 0.4, 0.01)
  .color([1, 0.2, 0.7].smooth(), [0.2, 1].ease('easeInOutCubic'), 0.9)
  .rotate([0, 1.57, 3.14].offset(0.25).fast(2))
  .scale([1, 2, 4].fit(0.5, 1.5))
  .out()
