// variables of every flavour
speed = 0.5
bpm = 90
mult = 1.5
let sides = () => Math.floor(3 + 6 * Math.abs(Math.sin(time * 0.2)))
let pat = [0.1, 0.4, 0.9].fast(2).smooth(0.5)
const base = osc(30, 0.1, 1.5).rotate(0.3)
var wobble = noise(4).thresh(0.4)

base.out(o1)
shape(sides, 0.3, 0.02)
  .modulate(base, 0.1)
  .modulateScale(wobble, pat)
  .scale(mult)
  .out(o0)
src(o1).mult(base).out(o2)
