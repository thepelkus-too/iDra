osc(10, 0.1, 1)
  .rotate(0.4)
  .out(o0)


noise(3)

  .thresh(0.5)
  .out(o1)



gradient(2).out(o2)
