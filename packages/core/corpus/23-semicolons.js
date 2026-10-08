speed = 0.8;
osc(20, 0.1, 0.8).out();
const k = noise(3);
src(o0).modulate(k, 0.1).out(o1);
render(o1);
