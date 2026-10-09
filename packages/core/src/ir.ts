// The Hydra IR: a JSON-serializable model of a sketch that every front-end edits.
// See docs/IR.md. Rules every transform in this package follows:
//  * `meta` objects and the `src` format-preservation records are never dropped or reordered;
//  * unknown fields on any node survive (we always spread existing nodes);
//  * statement ORDER is semantic.

export type OutName = 'o0' | 'o1' | 'o2' | 'o3'
export type SourceName = 's0' | 's1' | 's2' | 's3'
export type RefName = OutName | SourceName
export const OUT_NAMES: OutName[] = ['o0', 'o1', 'o2', 'o3']
export const SOURCE_NAMES: SourceName[] = ['s0', 's1', 's2', 's3']

export type ArrMods = {
  fast?: number
  smooth?: number
  ease?: string
  offset?: number
  fit?: [number, number]
}

export type Value =
  | { k: 'num'; v: number }
  /** `src` is a complete function expression, e.g. `() => Math.sin(time)` or `a0(2)` wrapped by audioChip. Emitted verbatim. */
  | { k: 'fn'; src: string }
  /** Time pattern. Key order of `mods` is the order the modifiers are applied/emitted (it matters for ease/smooth). */
  | { k: 'arr'; v: number[]; mods: ArrMods }
  | { k: 'tex'; chain: Chain }
  | { k: 'ref'; name: RefName }
  /** Constant vector (length 2–4). Used for `sum`'s vec4 scale and plugin vec2/vec3 inputs. */
  | { k: 'vec4'; v: number[] }
  | { k: 'var'; name: string }
  /** Verbatim JS expression that is not a function (`Math.PI / 2`, `scaledSides(8)`, `a.fft[0]`). Evaluated once. */
  | { k: 'js'; src: string }
  | { k: 'default' }

export interface CallSrc {
  /** original text of the call: `name(args)` for generators, `.name(args)` (with the dot) for modifiers */
  text: string
  hash: string
}

export interface Call {
  id: string
  fn: string
  args: Value[]
  meta?: Record<string, unknown>
  src?: CallSrc
}

export interface ChainSrc {
  /** whitespace/comments between consecutive segments (gen, mods..., out). gaps[i] precedes segment i+1 */
  gaps: string[]
  /** original `.out(...)` text, if any */
  outText?: string
  outHash?: string
}

export interface Chain {
  id: string
  gen: Call
  mods: Call[]
  /** undefined for nested chains; null = top-level chain that is not rendered yet */
  out?: OutName | null
  meta?: Record<string, unknown>
  src?: ChainSrc
}

export type DefDecl = 'bare' | 'let' | 'const' | 'var'

export interface StmtSrc {
  /** exact original text of the statement (including trailing `;`) */
  text: string
  hash: string
  /** exact original whitespace between the previous statement and this one */
  before: string
}

interface StmtBase {
  id: string
  meta?: Record<string, unknown>
  src?: StmtSrc
}
export type SourceInit = {
  kind: 'cam' | 'image' | 'video' | 'screen' | 'clear'
  /** decoded string for string literals (urls), number text for numeric literals */
  arg?: string
  /** verbatim argument list when it is neither a lone string nor a lone number */
  argsSrc?: string
}
export type ChainStmt = StmtBase & { k: 'chain'; chain: Chain }
export type RenderStmt = StmtBase & { k: 'render'; target: OutName | 'all' }
export type SourceStmt = StmtBase & { k: 'source'; slot: SourceName; init: SourceInit }
export type SettingStmt = StmtBase & { k: 'setting'; name: 'bpm' | 'speed'; v: number }
export type DefStmt = StmtBase & {
  k: 'def'
  name: string
  decl: DefDecl
  value: Value
}
export type CommentStmt = StmtBase & { k: 'comment'; text: string; block?: boolean; trailing?: boolean }
export type RawStmt = StmtBase & { k: 'raw'; code: string }
export type Stmt = ChainStmt | RenderStmt | SourceStmt | SettingStmt | DefStmt | CommentStmt | RawStmt

export interface PluginRef {
  id: string
  name: string
  url?: string
  src?: string
  integrity?: string
}

export interface Sketch {
  version: 1
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  stmts: Stmt[]
  meta?: Record<string, unknown>
  plugins?: PluginRef[]
  /** import-time facts used for format-preserving export */
  src?: { tail: string; semi: boolean }
}

// ---------------------------------------------------------------- ids

let counter = 0
const session = Math.random().toString(36).slice(2, 6)
export function newId(prefix = 'n'): string {
  counter = (counter + 1) % 0xffffff
  return `${prefix}${session}${counter.toString(36)}`
}

// ---------------------------------------------------------------- constructors

export const num = (v: number): Value => ({ k: 'num', v })
export const DEFAULT: Value = { k: 'default' }
export const ref = (name: RefName): Value => ({ k: 'ref', name })
export const fnv = (src: string): Value => ({ k: 'fn', src })
export const arr = (v: number[], mods: ArrMods = {}): Value => ({ k: 'arr', v, mods })
export const tex = (chain: Chain): Value => ({ k: 'tex', chain })

export function makeCall(fn: string, args: Value[] = []): Call {
  return { id: newId('c'), fn, args }
}
export function makeChain(gen: Call, mods: Call[] = [], out?: OutName | null): Chain {
  const c: Chain = { id: newId('h'), gen, mods }
  if (out !== undefined) c.out = out
  return c
}
export function chainStmt(chain: Chain): ChainStmt {
  return { id: newId('s'), k: 'chain', chain }
}
export function newSketch(name = 'untitled', stmts: Stmt[] = []): Sketch {
  const t = Date.now()
  return { version: 1, id: newId('k'), name, createdAt: t, modifiedAt: t, stmts }
}
export function commentStmt(text: string, block = false): CommentStmt {
  return { id: newId('s'), k: 'comment', text, ...(block ? { block } : {}) }
}
export function rawStmt(code: string): RawStmt {
  return { id: newId('s'), k: 'raw', code }
}

// ---------------------------------------------------------------- hashing (format preservation)

function canonical(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canonical)
  if (x && typeof x === 'object') {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(x as object).sort()) {
      const val = (x as Record<string, unknown>)[k]
      // `src` is a format-preservation record when it is an object; on fn/js Values it is the code string (content)
      if (k === 'id' || k === 'meta' || (k === 'src' && typeof val === 'object')) continue
      o[k] = canonical(val)
    }
    return o
  }
  return x
}
/** Stable content string: ignores ids, `meta` and `src` anywhere in the tree. */
export function contentString(x: unknown): string {
  return JSON.stringify(canonical(x))
}
export function contentHash(x: unknown): string {
  const s = typeof x === 'string' ? x : contentString(x)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0') + s.length.toString(16)
}

// ---------------------------------------------------------------- meta (foreign data survives)

export function getMeta<T = unknown>(sketch: Sketch, app: string): T | undefined {
  return sketch.meta?.[app] as T | undefined
}
/** Shallow-merge `patch` into sketch.meta[app]; every other meta key is carried over untouched. */
export function withMeta(sketch: Sketch, app: string, patch: Record<string, unknown>): Sketch {
  const prev = (sketch.meta?.[app] as Record<string, unknown> | undefined) ?? {}
  return { ...sketch, meta: { ...(sketch.meta ?? {}), [app]: { ...prev, ...patch } } }
}
/** Replace sketch.meta[app] wholesale (still leaves other apps' keys alone). */
export function setMeta(sketch: Sketch, app: string, value: unknown): Sketch {
  return { ...sketch, meta: { ...(sketch.meta ?? {}), [app]: value } }
}
/** Per-node meta, namespaced by app so editors do not collide. */
export function withNodeMeta<T extends { meta?: Record<string, unknown> }>(
  node: T,
  app: string,
  patch: Record<string, unknown>,
): T {
  const prev = (node.meta?.[app] as Record<string, unknown> | undefined) ?? {}
  return { ...node, meta: { ...(node.meta ?? {}), [app]: { ...prev, ...patch } } }
}

// ---------------------------------------------------------------- traversal

export function* walkChains(sketch: Sketch): Generator<{ chain: Chain; stmt?: ChainStmt | DefStmt; nested: boolean; depth: number }> {
  function* inValue(v: Value, stmt: ChainStmt | DefStmt | undefined, depth: number): Generator<any> {
    if (v.k === 'tex') yield* inChain(v.chain, stmt, true, depth)
  }
  function* inChain(chain: Chain, stmt: ChainStmt | DefStmt | undefined, nested: boolean, depth: number): Generator<any> {
    yield { chain, stmt, nested, depth }
    for (const c of [chain.gen, ...chain.mods]) for (const a of c.args) yield* inValue(a, stmt, depth + 1)
  }
  for (const s of sketch.stmts) {
    if (s.k === 'chain') yield* inChain(s.chain, s, false, 0)
    else if (s.k === 'def') yield* inValue(s.value, s, 1)
  }
}

export function* walkCalls(sketch: Sketch): Generator<{ call: Call; chain: Chain; position: 'gen' | 'mod'; index: number }> {
  for (const { chain } of walkChains(sketch)) {
    yield { call: chain.gen, chain, position: 'gen', index: 0 }
    for (let i = 0; i < chain.mods.length; i++) yield { call: chain.mods[i], chain, position: 'mod', index: i + 1 }
  }
}

export function findCall(sketch: Sketch, callId: string): Call | undefined {
  for (const x of walkCalls(sketch)) if (x.call.id === callId) return x.call
  return undefined
}

function mapValue(v: Value, f: (c: Call) => Call): Value {
  return v.k === 'tex' ? { ...v, chain: mapChain(v.chain, f) } : v
}
function mapChain(chain: Chain, f: (c: Call) => Call): Chain {
  const mapCall = (c: Call): Call => f({ ...c, args: c.args.map((a) => mapValue(a, f)) })
  return { ...chain, gen: mapCall(chain.gen), mods: chain.mods.map(mapCall) }
}
/** Immutably map every call in the sketch (children first). */
export function mapCalls(sketch: Sketch, f: (c: Call) => Call): Sketch {
  return {
    ...sketch,
    stmts: sketch.stmts.map((s) => {
      if (s.k === 'chain') return { ...s, chain: mapChain(s.chain, f) }
      if (s.k === 'def') return { ...s, value: mapValue(s.value, f) }
      return s
    }),
  }
}
/** Replace one call's args immutably. */
export function setArg(sketch: Sketch, callId: string, index: number, value: Value): Sketch {
  return mapCalls(sketch, (c) => {
    if (c.id !== callId) return c
    const args = c.args.slice()
    while (args.length < index) args.push(DEFAULT)
    args[index] = value
    return { ...c, args }
  })
}

export function cloneSketch<T>(x: T): T {
  return structuredClone(x)
}

/** Fresh ids for a node tree (use when duplicating a sketch or pasting a chain). */
export function reId<T>(x: T): T {
  const prefixOf = (id: string) => id.charAt(0)
  const walk = (n: any): any => {
    if (Array.isArray(n)) return n.map(walk)
    if (n && typeof n === 'object') {
      const o: any = {}
      for (const k of Object.keys(n)) o[k] = k === 'id' && typeof n[k] === 'string' ? newId(prefixOf(n[k])) : k === 'meta' || (k === 'src' && typeof n[k] === 'object') ? n[k] : walk(n[k])
      return o
    }
    return n
  }
  return walk(x)
}

// ---------------------------------------------------------------- canonical form for comparisons

/** Drop trailing `default` args and trailing nums equal to the catalog default. Used by tests and round-trips. */
export function canonicalArgs(args: Value[], defaults: Array<number | number[] | null | undefined>): Value[] {
  const out = args.slice()
  while (out.length) {
    const last = out[out.length - 1]
    const i = out.length - 1
    if (last.k === 'default') out.pop()
    else if (last.k === 'num' && defaults[i] === last.v) out.pop()
    else break
  }
  return out
}

/** Strip ids, `src` and `meta` recursively: for deep-equality in tests and diffing. */
export function stripVolatile<T>(x: T, opts: { meta?: boolean } = {}): T {
  const walk = (n: any): any => {
    if (Array.isArray(n)) return n.map(walk)
    if (n && typeof n === 'object') {
      const o: any = {}
      for (const k of Object.keys(n)) {
        if (k === 'id') continue
        // `src` on a Value (fn/js) is code (a string); on nodes it is a source record (an object)
        if (k === 'src' && typeof n[k] === 'object') continue
        if (k === 'meta' && !opts.meta) continue
        if (k === 'createdAt' || k === 'modifiedAt') continue
        o[k] = walk(n[k])
      }
      return o
    }
    return n
  }
  return walk(x)
}
