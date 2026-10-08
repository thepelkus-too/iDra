# The Hydra IR

A sketch is a JSON-serializable `Sketch` (`packages/core/src/ir.ts`). Editors read and write **only** the IR; text is produced by
`toCode` and consumed by `importText`.

```ts
Sketch  { version: 1, id, name, createdAt, modifiedAt, stmts: Stmt[], meta?, plugins?, src? }
Stmt    = chain | render | source | setting | def | comment | raw            // ORDER IS SEMANTIC
Chain   { id, gen: Call, mods: Call[], out?: 'o0'..'o3' | null, meta?, src? }  // out === null: not rendered; undefined: nested chain
Call    { id, fn, args: Value[], meta?, src? }
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

## Variables holding texture chains (verified in hydra-synth 1.4.0 source)

`const b = osc(3)` is a `GlslSource`. Using it as an **argument** (`modulate(b)`, in several places) is safe: `generate-glsl.js` reads
`b.transforms` without mutating, and each use gets its own generated variable names. Calling a modifier **on** it (`b.rotate(1)`)
pushes onto `b.transforms` and changes every other use. The IR only ever uses a `var` as an argument; the editors must not emit `b.mod()`.

## Equality for tests

`canonicalSketch(sketch)` drops ids, `src`, timestamps and trailing default arguments. The contract is
`canonicalSketch(fromCode(toCode(x))) ≡ canonicalSketch(x)`, and `toCode(importText(t).sketch) === t` for untouched imports.
