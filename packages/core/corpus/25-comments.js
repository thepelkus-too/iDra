/* header block comment
   spanning lines */
// leading
// two-line comment
osc(20, /* freq */ 0.1, 0.8) // after gen
  // before rotate
  .rotate(0.8) /* inline */
  .out() // after out

// between statements

/* block between */
noise(3).out(o1) // trailing

// final comment with no newline at end
