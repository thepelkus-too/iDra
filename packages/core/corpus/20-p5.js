// p5 drawing into a hydra source
p5 = new P5({ width: 400, height: 400, mode: 'P2D' })
p5.hide()
p5.draw = () => {
  p5.background(0)
  p5.ellipse(p5.mouseX, p5.mouseY, 80, 80)
}
s0.init({ src: p5.canvas })
src(s0).kaleid(4).out()
