import { catalog as defaultCatalog, type Catalog } from './catalog'
import { walkChains, type Call, type Sketch, type Value } from './ir'

export type Severity = 'error' | 'warning' | 'info'
export type ProblemCode =
  | 'unknown-function'
  | 'wrong-position'
  | 'texture-missing'
  | 'too-many-args'
  | 'var-before-def'
  | 'unknown-var'
  | 'function-not-called'
  | 'bad-arg'
  | 'not-rendered'
  | 'empty-name'

export interface Problem {
  severity: Severity
  code: ProblemCode
  /** id of the offending Call / Chain / Stmt */
  nodeId: string
  message: string
  /** argument index, when the problem is about one argument */
  arg?: number
}

function checkValue(
  v: Value,
  call: Call,
  index: number,
  inputType: string | undefined,
  cat: Catalog,
  defined: Set<string>,
  allDefs: Set<string>,
  out: Problem[],
) {
  const push = (code: ProblemCode, message: string, severity: Severity = 'error') =>
    out.push({ severity, code, nodeId: call.id, message, arg: index })
  if (v.k === 'var') {
    if (!defined.has(v.name)) {
      if (allDefs.has(v.name)) push('var-before-def', `"${v.name}" is used before it is defined`)
      else push('unknown-var', `"${v.name}" is not defined in this sketch`)
    }
    return
  }
  if (v.k === 'js' && /^[A-Za-z_$][\w$]*$/.test(v.src.trim()) && cat.has(v.src.trim()) && !defined.has(v.src.trim())) {
    push('function-not-called', `"${v.src.trim()}" is a Hydra function; call it with parentheses`)
    return
  }
  if (!inputType) return
  const isTex = inputType === 'sampler2D'
  const isVec = inputType.startsWith('vec')
  switch (v.k) {
    case 'num':
      if (isTex) push('bad-arg', `${call.fn}: a texture is expected here, not a number`)
      break
    case 'fn':
    case 'arr':
      if (isTex) push('bad-arg', `${call.fn}: a texture is expected here`)
      break
    case 'ref':
      if (!isTex) push('bad-arg', `${call.fn}: ${v.name} is a texture; this input takes a ${inputType}`)
      break
    case 'vec4':
      if (!isVec) push('bad-arg', `${call.fn}: a vector was given for a ${inputType} input`)
      break
    default:
      break
  }
}

/** Structural checks. Never throws. Unknown calls are warnings so a sketch that uses a not-yet-loaded plugin stays openable. */
export function validate(sketch: Sketch, cat: Catalog = defaultCatalog): Problem[] {
  const out: Problem[] = []
  const allDefs = new Set<string>()
  for (const s of sketch.stmts) if (s.k === 'def') allDefs.add(s.name)
  const defined = new Set<string>()
  for (const s of sketch.stmts) {
    if (s.k === 'def' && !s.name) out.push({ severity: 'error', code: 'empty-name', nodeId: s.id, message: 'definition without a name' })
    const holder = s.k === 'chain' || s.k === 'def' ? s : undefined
    if (holder) {
      const sub: Sketch = { ...sketch, stmts: [holder] }
      for (const { chain, nested } of walkChains(sub)) {
        const calls: Array<[Call, 'gen' | 'mod']> = [[chain.gen, 'gen'], ...chain.mods.map((m) => [m, 'mod'] as [Call, 'mod'])]
        for (const [call, pos] of calls) {
          const def = cat.get(call.fn)
          if (!def) {
            out.push({ severity: 'warning', code: 'unknown-function', nodeId: call.id, message: `unknown function "${call.fn}" (a plugin that is not loaded, or a typo)` })
            call.args.forEach((a, i) => checkValue(a, call, i, undefined, cat, defined, allDefs, out))
            continue
          }
          const isGen = def.type === 'src'
          if (pos === 'gen' && !isGen) out.push({ severity: 'error', code: 'wrong-position', nodeId: call.id, message: `${call.fn}() is a modifier and cannot start a chain` })
          if (pos === 'mod' && isGen) out.push({ severity: 'error', code: 'wrong-position', nodeId: call.id, message: `${call.fn}() is a generator and can only start a chain` })
          if (call.args.length > def.inputs.length) out.push({ severity: 'warning', code: 'too-many-args', nodeId: call.id, message: `${call.fn}() takes ${def.inputs.length} argument(s), ${call.args.length} given` })
          def.inputs.forEach((inp, i) => {
            const a = call.args[i]
            if (inp.type === 'sampler2D' && (!a || a.k === 'default')) {
              out.push({ severity: 'error', code: 'texture-missing', nodeId: call.id, message: `${call.fn}() needs a texture for "${inp.name}"`, arg: i })
            }
          })
          call.args.forEach((a, i) => checkValue(a, call, i, def.inputs[i]?.type, cat, defined, allDefs, out))
        }
        if (!nested && s.k === 'chain' && chain.out === null) {
          out.push({ severity: 'info', code: 'not-rendered', nodeId: chain.id, message: 'this chain has no .out() so it is not rendered' })
        }
      }
    }
    if (s.k === 'def') defined.add(s.name)
  }
  return out
}
