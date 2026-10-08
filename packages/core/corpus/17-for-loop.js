// loops build many chains
for (let i = 0; i < 3; i++) {
  osc(10 + i * 10, 0.1, i).out([o0, o1, o2][i])
}
render()
