// two sources, then blends
osc(10, 0.1, 0.8).out(o1)
noise(3, 0.2).thresh(0.5, 0.1).out(o2)

src(o1).mult(o2).out(o3)
src(o1).blend(o2, 0.3).out(o0)

src(o0).add(o3, 0.5).diff(o1).mask(o2).out(o0)
render()
