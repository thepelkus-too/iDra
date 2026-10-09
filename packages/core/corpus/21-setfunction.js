setFunction({
  name: 'wobble2',
  type: 'coord',
  inputs: [{ type: 'float', name: 'amount', default: 0.1 }],
  glsl: `
    return _st + vec2(sin(_st.y * 10.0 + time) * amount, 0.0);
  `,
})

osc(20).wobble2(0.05).out()
