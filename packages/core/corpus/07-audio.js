// audio reactivity
a.show()
a.setBins(6)
a.setCutoff(2)
a.setScale(8)
a.setSmooth(0.7)

osc(() => 10 + a.fft[0] * 40, 0.1, 1)
  .kaleid(() => 2 + a.fft[1] * 10)
  .scale(a0(0.5, 1))
  .modulate(noise(3), () => a.fft[3] * 0.2)
  .out()
