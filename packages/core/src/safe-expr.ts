import * as acorn from 'acorn'

// Conservative allowlist used by "safe mode": an expression/function that only does arithmetic over
// Hydra's documented globals can run without the trust prompt. Anything else needs the owner's OK.

const ALLOWED_IDENTS = new Set([
  'time', 'bpm', 'speed', 'width', 'height', 'mouse', 'a', 'fft', 'Math', 'Infinity', 'NaN', 'undefined',
  'o0', 'o1', 'o2', 'o3', 's0', 's1', 's2', 's3', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
])
const ALLOWED_MEMBERS = new Set([
  // Math.*
  'PI', 'E', 'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'min', 'max', 'pow', 'sqrt', 'random', 'atan', 'atan2',
  'asin', 'acos', 'exp', 'log', 'sign', 'trunc', 'fround', 'hypot', 'cbrt', 'log2', 'log10', 'LN2', 'LN10', 'SQRT2', 'SQRT1_2',
  // hydra globals
  'x', 'y', 'fft', 'bins', 'vol', 'length',
])

export function isSafeExpression(src: string): boolean {
  let ast: acorn.Node
  try {
    ast = acorn.parseExpressionAt(src, 0, { ecmaVersion: 'latest' })
  } catch {
    return false
  }
  if ((ast as any).end !== src.length && src.slice((ast as any).end).trim() !== '') return false
  const scopes: Array<Set<string>> = []
  const isParam = (n: string) => scopes.some((s) => s.has(n))
  const ok = (n: any): boolean => {
    if (!n) return true
    switch (n.type) {
      case 'Literal':
        return !n.regex
      case 'Identifier':
        return ALLOWED_IDENTS.has(n.name) || isParam(n.name)
      case 'ArrowFunctionExpression': {
        if (n.async || n.generator) return false
        const names = new Set<string>()
        for (const p of n.params) {
          if (p.type !== 'Identifier') return false
          names.add(p.name)
        }
        scopes.push(names)
        const r = ok(n.body)
        scopes.pop()
        return r
      }
      case 'BinaryExpression':
      case 'LogicalExpression':
        return ok(n.left) && ok(n.right)
      case 'UnaryExpression':
        return n.operator !== 'delete' && n.operator !== 'void' && n.operator !== 'typeof' ? ok(n.argument) : n.operator === 'typeof' && ok(n.argument)
      case 'ConditionalExpression':
        return ok(n.test) && ok(n.consequent) && ok(n.alternate)
      case 'MemberExpression': {
        if (n.computed) return ok(n.object) && ok(n.property)
        return n.property.type === 'Identifier' && ALLOWED_MEMBERS.has(n.property.name) && ok(n.object)
      }
      case 'CallExpression': {
        const c = n.callee
        // Math.fn(...) or an audio helper a0(...)
        const okCallee =
          (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'Math' && ALLOWED_MEMBERS.has(c.property.name)) ||
          (c.type === 'Identifier' && /^a\d+$/.test(c.name))
        return okCallee && n.arguments.every(ok)
      }
      case 'ArrayExpression':
        return n.elements.every((e: any) => e && e.type !== 'SpreadElement' && ok(e))
      case 'ParenthesizedExpression':
        return ok(n.expression)
      case 'SequenceExpression':
        return n.expressions.every(ok)
      case 'TemplateLiteral':
        return n.expressions.length === 0
      default:
        return false
    }
  }
  return ok(ast)
}
