// a function that returns a function
const scaledSides = (k) => () => Math.floor(k * (0.5 + 0.5 * Math.sin(time)))

shape(scaledSides(8), 0.4)
  .rotate(0, 0.2)
  .out()
