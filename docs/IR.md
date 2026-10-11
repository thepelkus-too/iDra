# The Hydra IR

A sketch is a JSON-serializable `Sketch` (`packages/core/src/ir.ts`). Editors read and write **only** the IR; text is produced by
`toCode` and consumed by `importText`.

```ts
Sketch  { version: 1, id, name, createdAt, modifiedAt, stmts: Stmt[], meta?, plugins?, src? }
Stmt    = chain | render | source | setting | def | comment | raw            // ORDER IS SEMANTIC
Chain   { id, gen: Call, mods: Call[], out?: 'o0'..'o3' | null, meta?, src? }  // out === null: not rendered; undefined: nested chain
Call    { id, fn, args: Value[], meta?, src?, disabled? }
// every Stmt also has disabled?: switched off, kept in place as // comments (see "Disabled nodes")
Value   = num | fn | arr | tex | ref | vec4 | var | js | default
```

| Value | meaning | emitted as |
|---|---|---|
| `{k:'num', v}` | static float. **Baked into the GLSL** (see `docs/live-edit.md`) | `0.5` |
| `{k:'fn', src}` | a function expression, called every frame | `() => Math.sin(time)` |
| `{k:'arr', v, mods}` | time pattern; `mods` key order = application order (`ease` then `smooth` ≠ `smooth` then `ease`) | `[1, 2, 3].fast(2).smooth(1)` |
| `{k:'tex', chain}` | nested chain | `noise(3).thresh()` |
| `{k:'ref', name}` | `o0..o3`, `s0..s3` | `o1` |
| `{k:'vec4', v}` | constant vector (2–4 numbers): `sum`'s scale, plugin vec2/vec3 inputs | `[1, 1, 1, 1]` |
| `{k:'var', name}` | reference to a `def` stmt that precedes it | `base` |
| `{k:'js', src}` | verbatim non-function JS expression, evaluated once (`Math.PI / 2`, `scaledSides(8)`) | verbatim |
| `{k:'default'}` | omitted; the catalog default. Trailing ones are dropped, middle ones are written as the default literal | |

Statements:

* `chain` — `osc(…).rotate(…).out(o1)`. A chain with `out: null` has no `.out()` and is not rendered (kept, flagged).
* `render` — `render()` (`'all'`) or `render(o1)`.
* `source` — `s0.initCam(0)`, `initImage('url')`, `initVideo('url')`, `initScreen()`, `clear()` (`kind: 'clear'` is an addition to the brief).
* `setting` — `speed = 0.5`, `bpm = 120` with a numeric literal. (`speed = () => …` is an ordinary `def`.)
* `def` — `let x = …` / `const` / `var` / bare `x = …`; the value is any `Value`.
* `comment` — consecutive `//` lines are one comment; `block: true` for `/* */`; `trailing: true` when it follows a statement on the same line.
* `raw` — anything else, verbatim, in its original position (`update = …`, loops, `if`, `await loadScript(…)`, p5, `a.show()`, `hush()`, `setFunction({…})`, …).

## Everything is optional extensible

* Every node has an `id` and an optional `meta` object. Editors write only `sketch.meta[<their app name>]` (and `node.meta[<app>]`)
  and must preserve every other key and any unknown field: `withMeta`, `setMeta`, `withNodeMeta`, `mapCalls`, `setArg` all do.
* `src` records on `Sketch`, `Stmt`, `Chain`, `Call` are the **format-preservation** data written by the importer: original text,
  a content hash, whitespace between statements, and the gaps between chain segments. `toCode` re-emits the original text of
  anything whose content hash is unchanged and regenerates only what was edited, so changing one number in a 6-line chain
  rewrites one line. Never edit or drop `src`; spread nodes (`{...call, args}`) and it stays valid. Use `fresh: true` to ignore it.
* Unknown functions are kept as ordinary calls (`fn: 'foo'`); position is inferred from the chain (first = generator). `validate`
  reports them as warnings and re-resolves them when `catalog.refresh` learns about a plugin function.

## Text → IR (`importText`)

`importText(code)` uses acorn, never throws, and never loses code:
original text = concatenation of `src.before + src.text` of every statement + `sketch.src.tail` (asserted on every import; if the
check ever failed the whole text becomes one `raw` stmt and `report.parseFailed` is set).

* Whole-text syntax error → one `raw` stmt + warning (default). `{recover: true}` instead splits on blank lines and keeps the blocks that parse.
* A chain whose base is a variable (`base.out(o1)`) is kept as `raw`: in hydra-synth `base.rotate()` **mutates** `base`.
* `a0(…)`-style helpers and calls to unknown identifiers in numeric slots become `js`; in texture slots (`modulate(myPlugin(3))`) they become generic calls.

## Disabled nodes (switched off, still in the code)

A modifier (`Call.disabled`) or a whole statement (`StmtBase.disabled`) can be switched off without deleting it. Off is
ordinary commented-out code, so the exported text still runs in vanilla Hydra and means the same thing there:

```js
osc(20, 0.1, 0.8)
  .rotate(0.8)
  // .kaleid(4)          ← a disabled modifier: its own line, "// " + the call
  .out()

// noise(3)              ← a disabled statement: "// " before every line ("//" on an empty one)
//   .colorama(0.2)
//   .out(o1)
```

* **What can be switched** (`canDisable(sketch, id)` says, with a plain-sentence `reason` when not): modifiers of a chain
  statement or of a def's chain; chain, def, source, setting and render statements. Not: a generator (its chain starts with
  it; `instead` names the statement), a call inside a texture argument (written on one line; `instead` names the call
  taking it), a call whose own code spans several lines, comments and raw code (raw is edited as code).
* **Defs cascade.** Switching off a `def` that enabled code still uses is refused alone; `cascade` lists the statements
  that use it (transitively), and `setDisabled(…, { cascade: true })` switches them together. Enabling a statement or call
  that needs a disabled def lists that def the same way. A def used by raw code can't be switched off.
* **Everything else ignores disabled nodes.** `toRunnable` (the runtime), `validate` (enabled code that uses a disabled def
  gets `uses-disabled`), the trust fingerprint (`riskyParts`), `compat`, `describe` (its facts are about what runs; it adds
  `disabled` and `disabledEffects`: chains that win an output only because a later writer is off, feedback that only exists
  with the disabled parts on) and the runtime's def tracking. `activeSketch(sketch)` is the sketch with disabled nodes
  removed; `enableAll(sketch)` switches everything back on (tests count nodes against `describe(enableAll(s))`).
  `autoLayout` keeps disabled nodes in place, flagged `disabled` (`{ disabled: 'skip' }` leaves them out).
* **IR order never changes.** Switching off is a flag; the node stays where it is. `setDisabled(setDisabled(x, id, true),
  id, false)` is `x` again and its text is byte-identical (enabling deletes the flag; a statement whose content did not
  change re-emits its original text, commented or uncommented).
* **Format.** A disabled modifier is emitted on its own line (`CallSrc.lead` keeps the exact opener the importer saw,
  `'//'`, `'// '`, `'//    '`; `''` marks a second call on the same comment line, `// .rotate(1).kaleid(4)`). A chain whose
  last modifier is disabled ends without `;`. A disabled call inside a texture argument (only from hand-written IR) falls
  back to `/* .x() */`.

**Importer revival.** `importText` turns commented-out code back into disabled nodes, conservatively, and counts them in
`report.revived`:

* inside a chain: an own-line `// .call(…)` (one or several calls) between two segments, or right after the last one
  when the chain has no `.out()` (a def's chain, an out-less chain), is a disabled modifier. A trailing `// note` after
  the call is kept as a comment.
* between statements: a run of `//` lines is split greedily by line ranges (up to 40 lines) into statements that parse
  as a chain, def, source, setting or render statement, one per line range with nothing else in it (a one-line trailing
  comment is allowed). Anything else (prose, `TODO try .rotate()`, half a statement, raw JS) stays a comment, byte for byte.
* `toCode(importText(t).sketch) === t` holds for revived text as for everything else (`corpus/34-…`, `35-…`, and the fuzz
  tests in `packages/core/test/disable.test.ts`).

The same text form is what the proposed evaluation model calls a draft (a disabled, commented chain statement), so a
later "drafts" feature can reuse it as is.

## Variables holding texture chains (verified in hydra-synth 1.4.0 source)

`const b = osc(3)` is a `GlslSource`. Using it as an **argument** (`modulate(b)`, in several places) is safe: `generate-glsl.js` reads
`b.transforms` without mutating, and each use gets its own generated variable names. Calling a modifier **on** it (`b.rotate(1)`)
pushes onto `b.transforms` and changes every other use. The IR only ever uses a `var` as an argument; the editors must not emit `b.mod()`.

## Equality for tests

`canonicalSketch(sketch)` drops ids, `src`, timestamps and trailing default arguments. The contract is
`canonicalSketch(fromCode(toCode(x))) ≡ canonicalSketch(x)`, and `toCode(importText(t).sketch) === t` for untouched imports.
