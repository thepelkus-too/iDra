import { compat, type Compat } from './compat'
import { SOURCE_NAMES, type Chain, type OutName, type RefName, type Sketch, type SourceName, type Value } from './ir'

export interface ChainFacts {
  stmtId: string
  chainId: string
  out: OutName | null
  gen: string
  modCount: number
  /** nesting depth of texture args (0 = none) */
  depth: number
  readsOutputs: OutName[]
  readsSources: SourceName[]
  usesVars: string[]
  rendered: boolean
  /** an earlier writer of an output that a later chain overwrites */
  shadowed: boolean
  feedback: boolean
}

export interface Description {
  chains: ChainFacts[]
  notRendered: string[]
  outputs: Record<OutName, { writers: string[]; winner?: string; shadowed: string[] }>
  shadowed: string[]
  feedbackEdges: Array<{ chainId: string; output: OutName }>
  sources: Array<{ slot: SourceName; kind: string; stmtId: string }>
  usedSources: SourceName[]
  maxDepth: number
  defs: Array<{ name: string; stmtId: string; valueKind: Value['k']; uses: string[] }>
  unusedDefs: string[]
  comments: number
  raws: number
  rawStmtIds: string[]
  renders: Array<{ stmtId: string; target: OutName | 'all' }>
  /** what `render` finally shows: the last render stmt wins; undefined = o0 */
  activeRender?: OutName | 'all'
  usesAudio: boolean
  /** a camera or screen source (`sN.initCam`/`initScreen`): needs inline mode, see docs/security.md */
  usesCamera: boolean
  usesPrev: boolean
  settings: Record<string, number>
  /** will the exported text run in vanilla Hydra? (`compat(sketch)`; pass the audio source to `compat` yourself for the full answer) */
  compat: Compat
}

function scanValue(v: Value, f: { outs: Set<OutName>; srcs: Set<SourceName>; vars: Set<string>; depth: number; audio: boolean; prev: boolean }, d: number) {
  f.depth = Math.max(f.depth, d)
  switch (v.k) {
    case 'ref':
      if (v.name.startsWith('o')) f.outs.add(v.name as OutName)
      else f.srcs.add(v.name as SourceName)
      break
    case 'var':
      f.vars.add(v.name)
      break
    case 'fn':
    case 'js':
      if (/\ba\.fft\b|\ba\d+\s*\(|\ba\.(vol|bins)\b/.test(v.src)) f.audio = true
      break
    case 'tex':
      scanChain(v.chain, f, d + 1)
      break
  }
}
function scanChain(c: Chain, f: any, d: number) {
  for (const call of [c.gen, ...c.mods]) {
    if (call.fn === 'prev') f.prev = true
    for (const a of call.args) scanValue(a, f, d)
  }
}

/** Structure facts front-ends use to choose sensible default views. */
export function describe(sketch: Sketch): Description {
  const chains: ChainFacts[] = []
  const outputs: Description['outputs'] = {
    o0: { writers: [], shadowed: [] },
    o1: { writers: [], shadowed: [] },
    o2: { writers: [], shadowed: [] },
    o3: { writers: [], shadowed: [] },
  }
  const sources: Description['sources'] = []
  const defs: Description['defs'] = []
  const renders: Description['renders'] = []
  const settings: Record<string, number> = {}
  let comments = 0
  const rawStmtIds: string[] = []
  const usedSrc = new Set<SourceName>()
  let usesAudio = false
  let usesPrev = false
  let usesCamera = false
  let maxDepth = 0
  const defUses = new Map<string, string[]>()

  for (const s of sketch.stmts) {
    switch (s.k) {
      case 'comment':
        comments++
        break
      case 'raw':
        rawStmtIds.push(s.id)
        if (/\binit(Cam|Screen)\b/.test(s.code)) usesCamera = true
        if (/\ba\.(show|fft|setBins)\b/.test(s.code)) usesAudio = true
        break
      case 'source':
        sources.push({ slot: s.slot, kind: s.init.kind, stmtId: s.id })
        if (s.init.kind === 'cam' || s.init.kind === 'screen') usesCamera = true
        break
      case 'render':
        renders.push({ stmtId: s.id, target: s.target })
        break
      case 'setting':
        settings[s.name] = s.v
        break
      case 'def': {
        const f = { outs: new Set<OutName>(), srcs: new Set<SourceName>(), vars: new Set<string>(), depth: 0, audio: false, prev: false }
        scanValue(s.value, f, 0)
        for (const v of f.vars) defUses.set(v, [...(defUses.get(v) ?? []), s.id])
        f.srcs.forEach((x) => usedSrc.add(x))
        if (f.audio) usesAudio = true
        if (f.prev) usesPrev = true
        defs.push({ name: s.name, stmtId: s.id, valueKind: s.value.k, uses: [] })
        break
      }
      case 'chain': {
        const c = s.chain
        const f = { outs: new Set<OutName>(), srcs: new Set<SourceName>(), vars: new Set<string>(), depth: 0, audio: false, prev: false }
        scanChain(c, f, 0)
        const readsOutputs = [...f.outs]
        if (f.prev) {
          const o = c.out === null ? undefined : (c.out ?? 'o0')
          if (o && !readsOutputs.includes(o)) readsOutputs.push(o)
        }
        f.srcs.forEach((x) => usedSrc.add(x))
        for (const v of f.vars) defUses.set(v, [...(defUses.get(v) ?? []), c.id])
        if (f.audio) usesAudio = true
        if (f.prev) usesPrev = true
        maxDepth = Math.max(maxDepth, f.depth)
        const out = c.out === undefined ? 'o0' : c.out
        chains.push({
          stmtId: s.id,
          chainId: c.id,
          out,
          gen: c.gen.fn,
          modCount: c.mods.length,
          depth: f.depth,
          readsOutputs,
          readsSources: [...f.srcs],
          usesVars: [...f.vars],
          rendered: out !== null,
          shadowed: false,
          feedback: out !== null && readsOutputs.includes(out),
        })
        if (out) outputs[out].writers.push(c.id)
        break
      }
    }
  }

  const shadowed: string[] = []
  for (const o of Object.keys(outputs) as OutName[]) {
    const w = outputs[o].writers
    if (w.length) {
      outputs[o].winner = w[w.length - 1]
      outputs[o].shadowed = w.slice(0, -1)
      shadowed.push(...outputs[o].shadowed)
    }
  }
  for (const c of chains) c.shadowed = shadowed.includes(c.chainId)
  for (const d of defs) d.uses = defUses.get(d.name) ?? []
  return {
    chains,
    notRendered: chains.filter((c) => !c.rendered).map((c) => c.chainId),
    outputs,
    shadowed,
    feedbackEdges: chains.filter((c) => c.feedback).map((c) => ({ chainId: c.chainId, output: c.out! })),
    sources,
    usedSources: SOURCE_NAMES.filter((n) => usedSrc.has(n) || sources.some((s) => s.slot === n)),
    maxDepth,
    defs,
    unusedDefs: defs.filter((d) => d.uses.length === 0).map((d) => d.name),
    comments,
    raws: rawStmtIds.length,
    rawStmtIds,
    renders,
    activeRender: renders.length ? renders[renders.length - 1].target : undefined,
    usesAudio,
    usesCamera,
    usesPrev,
    settings,
    compat: compat(sketch),
  }
}

export type { RefName }
