// Statements switched off by commenting them out
speed = 1
// speed = 0.2
// bpm = 120
// s0.initImage('https://example.com/a.png')

osc(10, 0.1, 1.2)
  .rotate(0.3)
  .out()

// noise(3)
//   .colorama(0.2)
//   // .kaleid(3)
//   .out(o1)

// a draft with a note, and two alternatives next to each other
// osc(30).kaleid(5).out(o2)   // brighter
// voronoi(8).out(o2)
// const k = 0.5
// render(o2)

// prose that looks like code stays a comment:
// try osc(10) with rotation
// out(o1) is the second output
// osc(
// hush()
// x = foo bar

/* block comments are never revived
osc(1).out()
*/
src(o0).modulate(noise(2), 0.02).out(o3)
