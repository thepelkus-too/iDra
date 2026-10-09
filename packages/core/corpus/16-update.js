// update runs every frame
let n = 0
update = (dt) => {
  n += dt * 0.001
  if (n > 10) n = 0
}
afterUpdate = () => {}
osc(() => 10 + n, 0.1, 1).out()
