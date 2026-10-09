// licensed under nothing in particular: a typical live-coding session
setResolution(1280, 720)
hush()
speed = 0.7

osc(60, -0.015, 0.3)
  .diff(osc(60, 0.08).rotate(Math.PI / 2))
  .modulateScale(noise(3, 0.1).modulateScale(osc(2).rotate(0.3)), 0.4, 1)
  .color(0.9, 0.5, 0.8)
  .out(o0)

voronoi(20, 0.5, 0.2).brightness(() => Math.sin(time) * 0.2).out(o1)
src(o0).blend(src(o1), 0.2).out(o2)
render(o2)
