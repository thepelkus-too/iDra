// Math reporters: nestable `+ − × ÷`, `sin`, `abs`, `random` blocks over numbers, `time` and the mouse, written as one arrow
// function (`() => Math.sin(time * 2) + 1`). Only text this module writes is read back as blocks (parse → write must give
// the same text); any other function stays a JS reporter with its text untouched.
export type MathNode =
  | { t: 'num'; v: number }
  | { t: 'time' }
  | { t: 'mouseX' }
  | { t: 'mouseY' }
  | { t: 'random' }
  | { t: 'op'; op: '+' | '-' | '*' | '/'; a: MathNode; b: MathNode }
  | { t: 'fn'; fn: 'sin' | 'abs'; a: MathNode }

export const OP_LABEL: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' }

const numText = (v: number): string => (Object.is(v, -0) ? '0' : String(v))

function write(n: MathNode, inner: boolean): string {
  switch (n.t) {
    case 'num': return numText(n.v)
    case 'time': return 'time'
    case 'mouseX': return 'mouse.x'
    case 'mouseY': return 'mouse.y'
    case 'random': return 'Math.random()'
    case 'fn': return `Math.${n.fn}(${write(n.a, false)})`
    case 'op': {
      const s = `${write(n.a, true)} ${n.op} ${write(n.b, true)}`
      return inner ? `(${s})` : s
    }
  }
}

export function mathToSrc(n: MathNode): string {
  return `() => ${write(n, false)}`
}

// ---------------------------------------------------------------- parsing (only our own spelling)

type Tok = { k: 'num'; v: number; text: string } | { k: 'id'; v: string } | { k: 'p'; v: string }

function lex(s: string): Tok[] | undefined {
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ') {
      i++
      continue
    }
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/.exec(s.slice(i))
    // a minus is part of a number only where an operand starts
    const prev = out[out.length - 1]
    const operandPos = !prev || (prev.k === 'p' && prev.v !== ')')
    if (num && (c !== '-' || operandPos)) {
      out.push({ k: 'num', v: Number(num[0]), text: num[0] })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(s.slice(i))
    if (id) {
      out.push({ k: 'id', v: id[0] })
      i += id[0].length
      continue
    }
    if ('+-*/()'.includes(c)) {
      out.push({ k: 'p', v: c })
      i++
      continue
    }
    return undefined
  }
  return out
}

function parseExpr(t: Tok[]): MathNode | undefined {
  let i = 0
  const peek = () => t[i]
  const take = (v: string) => (t[i]?.k === 'p' && t[i].v === v ? (i++, true) : false)
  const primary = (): MathNode | undefined => {
    const x = t[i++]
    if (!x) return undefined
    if (x.k === 'num') return { t: 'num', v: x.v }
    if (x.k === 'p' && x.v === '(') {
      const e = sum()
      return e && take(')') ? e : undefined
    }
    if (x.k === 'id') {
      if (x.v === 'time') return { t: 'time' }
      if (x.v === 'mouse.x') return { t: 'mouseX' }
      if (x.v === 'mouse.y') return { t: 'mouseY' }
      if (x.v === 'Math.random') return take('(') && take(')') ? { t: 'random' } : undefined
      if (x.v === 'Math.sin' || x.v === 'Math.abs') {
        if (!take('(')) return undefined
        const a = sum()
        return a && take(')') ? { t: 'fn', fn: x.v === 'Math.sin' ? 'sin' : 'abs', a } : undefined
      }
    }
    return undefined
  }
  const product = (): MathNode | undefined => {
    let a = primary()
    while (a && peek()?.k === 'p' && (peek().v === '*' || peek().v === '/')) {
      const op = t[i++].v as '*' | '/'
      const b = primary()
      if (!b) return undefined
      a = { t: 'op', op, a, b }
    }
    return a
  }
  const sum = (): MathNode | undefined => {
    let a = product()
    while (a && peek()?.k === 'p' && (peek().v === '+' || peek().v === '-')) {
      const op = t[i++].v as '+' | '-'
      const b = product()
      if (!b) return undefined
      a = { t: 'op', op, a, b }
    }
    return a
  }
  const e = sum()
  return e && i === t.length ? e : undefined
}

/** The math blocks for a function argument, or undefined when it is not one we wrote (it then stays JS text). */
export function srcToMath(src: string): MathNode | undefined {
  const m = /^\(\) => (.+)$/s.exec(src)
  if (!m) return undefined
  const toks = lex(m[1])
  if (!toks) return undefined
  const n = parseExpr(toks)
  if (!n || n.t === 'num') return undefined
  return mathToSrc(n) === src ? n : undefined
}

// ---------------------------------------------------------------- editing by path ("a", "b" steps from the root)

export type MathPath = Array<'a' | 'b'>

export function getAt(n: MathNode, path: MathPath): MathNode | undefined {
  let cur: MathNode | undefined = n
  for (const p of path) {
    if (!cur || (cur.t !== 'op' && cur.t !== 'fn')) return undefined
    cur = p === 'a' ? cur.a : cur.t === 'op' ? cur.b : undefined
  }
  return cur
}

export function setAt(n: MathNode, path: MathPath, v: MathNode): MathNode {
  if (!path.length) return v
  const [p, ...rest] = path
  if (n.t === 'op') return p === 'a' ? { ...n, a: setAt(n.a, rest, v) } : { ...n, b: setAt(n.b, rest, v) }
  if (n.t === 'fn' && p === 'a') return { ...n, a: setAt(n.a, rest, v) }
  return n
}

export const MATH_ITEMS: Array<{ key: string; label: string; node: MathNode }> = [
  { key: 'op:+', label: '( ) + ( )', node: { t: 'op', op: '+', a: { t: 'time' }, b: { t: 'num', v: 1 } } },
  { key: 'op:-', label: '( ) − ( )', node: { t: 'op', op: '-', a: { t: 'num', v: 1 }, b: { t: 'time' } } },
  { key: 'op:*', label: '( ) × ( )', node: { t: 'op', op: '*', a: { t: 'time' }, b: { t: 'num', v: 0.5 } } },
  { key: 'op:/', label: '( ) ÷ ( )', node: { t: 'op', op: '/', a: { t: 'time' }, b: { t: 'num', v: 4 } } },
  { key: 'fn:sin', label: 'sin ( )', node: { t: 'fn', fn: 'sin', a: { t: 'time' } } },
  { key: 'fn:abs', label: 'abs ( )', node: { t: 'fn', fn: 'abs', a: { t: 'fn', fn: 'sin', a: { t: 'time' } } } },
  { key: 'random', label: 'random', node: { t: 'random' } },
]
