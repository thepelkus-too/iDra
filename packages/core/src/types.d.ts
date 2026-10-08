/// <reference types="vite/client" />
declare module 'hydra-synth/src/glsl/glsl-functions.js' {
  const glslFunctions: () => Array<{
    name: string
    type: string
    inputs: Array<{ name: string; type: string; default?: unknown }>
    glsl: string
  }>
  export default glslFunctions
}
declare module 'hydra-synth' {
  const Hydra: any
  export default Hydra
}
