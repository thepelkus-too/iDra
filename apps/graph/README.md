# Patch Graph

A node canvas for Hydra in the spirit of Pure Data and TouchDesigner. Each Hydra call is a node, cables carry textures and
moving numbers, and outputs `o0`–`o3` and sources `s0`–`s3` are nodes of their own, so feedback is a visible loop. Served at
`/graph/` inside the shell. It reads and writes the shared sketch format, so anything made in another editor opens here and
the other way round.

* `npm run dev -w graph`: dev server
* `npm run test -w graph`: unit tests (graph ↔ IR round trip over the whole corpus, layout, graph edits)
* `npm run build:all && node apps/graph/e2e/acceptance.mjs`: the iPad acceptance run (Chromium, touch through CDP, software
  WebGL). Results land in [`shots/RESULTS.md`](shots/RESULTS.md) next to the screenshots.

## Gestures

| | |
|---|---|
| **Pan** | one finger on empty canvas, or two fingers anywhere on the canvas |
| **Zoom** | pinch; on a trackpad, pinch or ⌘-scroll |
| **Select** | tap a node; ⇧/⌘-tap adds; the ⬚ button turns one-finger drags into a selection rectangle (Apple Pencil always draws a rectangle) |
| **Move** | drag a node by any part that is not a control; a selection moves together |
| **Connect** | drag from a port (the dots on the edges) to another port, or onto a node to use its first free input that fits |
| **Add where you are** | drop a cable on empty canvas: a menu of the nodes that fit (modifiers after a texture output, generators before a texture input, modulators before a number input) |
| **Move or remove a cable** | drag its end off the input it plugs into; or tap the cable and tap its ✕ chip |
| **Add a node** | ＋ Node opens the palette (grouped, searchable, recent and favourites; hold an item to make it a favourite). Tap an item to add it (after the selected node for modifiers), or drag it onto the canvas, onto a node (appended after it), onto a cable (spliced in) or onto an input |
| **Add at a spot** | hold on empty canvas |
| **Numbers** | drag sideways; the further your finger is above or below the slider, the finer the steps (Pencil is always fine); tap for a keypad; double-tap for the default |
| **Undo / redo** | two-finger tap / three-finger tap, the ↶ ↷ buttons, ⌘Z / ⇧⌘Z |
| **Keyboard** | ⌘D duplicate, ⌫ delete, ⌘K palette, ⌘A select all, ⌘Enter run, Esc clear |

One finger on empty canvas pans rather than lassoes: on a tablet, panning is the thing you do constantly and selecting a
rectangle the thing you do rarely, so the rectangle lives behind a toolbar toggle (and the Pencil).

The selection bar at the bottom: **Duplicate**, **Delete** (a node in the middle of a chain is spliced out and the chain
closes up), **Bypass** (the node stays, dimmed and dashed, and is left out of the code), **Group** (collapse a run of nodes
into one macro card that expands on tap; display only, the code is flat), **👁 Preview** (pin a live view of the texture at
that node), **Pin** (put the node's numbers on the performance screen) and **Bake** (see below).

The output floats as a picture-in-picture window (drag its top to move it, its corner to resize). ⛶ is performance mode: the
visuals full screen with the pinned sliders on top. **Code** opens the code panel, read-only until you switch on Edit; the
selected nodes are highlighted in it, and text you type parses back into nodes.

## How the graph becomes Hydra code (compile rules)

The sketch (core's IR) is the only source of truth. The graph is rebuilt from it after every change (`irToGraph`), and every
structural edit is a graph operation followed by `graphToIR` and a commit. Positions and other view state live in
`sketch.meta.graph`, keyed by core node ids.

* A **chain** is the run of nodes from a generator along *main* inputs (the dot in the header) to an **output** node, which
  becomes `.out(oN)`. A chain that reaches no output ends in a dashed "not rendered" terminal with a one-tap "→ oN".
* A cable into a **texture input** is a nested chain written inside that argument: `modulate(noise(3))`.
* A cable from an **output** node's right-hand (read) port is `src(oN)` in a main input and `oN` in a texture argument. That is
  how feedback works, and it is the only way a cable may loop back. Any other loop is refused: the cable flashes red and a
  message says why.
* A cable from a **modulator** into a number input writes a function or array argument: Sine/Saw/Tri/Square/Random LFOs
  (`() => Math.sin(time * f) * amp + off`), Time, Mouse X/Y, Audio bin (`a.fft[n]` with a live meter), Volume, Step pattern
  (`[a, b, c].fast(n).smooth(s)`) and Expression (free text). An argument that a modulator cannot express exactly (any
  other arrow function) opens as an Expression node holding its text unchanged.
* A **variable** (`const x = …`) is one node however many places use it; each use is a cable.
* A node that feeds **more than one** place is written once per place (Hydra has no texture variables). The node shows
  "×2"; the copies keep stable ids in `meta.graph.links`, so the graph reads them back as one node. **Bake** writes such a
  node once into a free output and reads that output everywhere instead.
* **Bypassed** nodes are stored whole in `meta.graph.bypass` with the node they follow, so they come back where they were.
* Comments are sticky notes; `setting`, `source`, `render` and raw JavaScript statements are small setup nodes in a column on
  the left. Nothing in a sketch is dropped: whatever the graph does not understand stays a raw JS node and is written back as
  it was.
* An unchanged sketch exports byte for byte as it was imported; changing one number changes one line (checked over the whole
  corpus in the unit tests and again in the browser).

## Previews

A pinned preview is a second, small (192×108, lowp) runtime that runs the whole sketch plus one extra cable from the pinned
node into a spare output (`o3` unless the sketch writes it and another output is free) and shows only that output. The main
preview is never touched. At most two previews at a time (pinning a third unpins the oldest), because each one renders the
whole sketch again; on an iPad that is a real GPU cost. Previews follow the trust gate (safe mode until you say yes) and do
not get camera access.

## Known issues and limits

* Frame times in `shots/RESULTS.md` are from software WebGL (SwiftShader) in a container without a GPU. They say the canvas
  itself stays at one frame per display refresh while panning a 60-node graph (median 16.7 ms); the long frames (p95) are
  the software-rendered Hydra frame on the same thread, and drop by two thirds when the preview is paused. They say nothing
  about an iPad.
* Text fields on nodes (function names of unknown calls, expressions, comments, URLs) use the system prompt. It works with the
  on-screen keyboard and Scribble but is plain.
* "Group" is display only. Grouping nodes from different chains works, but the macro card sits where the first node was.
* Dropping a node where others are pushes the overlapped nodes (and those to their right) aside; it does not re-run the
  whole layout. "Arrange" (in ⋯) does.
* `hydra-examples` has no license file, so the blending check uses the corpus's own `03-blending.js` instead of copying
  `1-blending.js`.

## Retrospective: where the graph fights Hydra's chains, and what I did about it

**Hydra has no texture variables, a graph has fan-out.** In a node editor one output feeding three inputs is the most
natural thing in the world; in Hydra it means writing that sub-chain three times. I kept the graph honest about it rather
than hiding it: the code really does contain the copies, the node says "×3", and the copies carry stable ids in
`meta.graph.links` so they collapse back into one node when read. "Bake" is the Hydra-native answer (render it once into an
output, read the output), offered right on the badge. The cost is a little bookkeeping that only this editor understands:
open the sketch in another editor, edit one copy there, and the graph shows two nodes again. That is the correct reading of
the code, so I let it be.

**Chains are lists, cables are a graph.** The compile step has to decide which cable is "the chain" and which is an argument.
Ports make that explicit (main input in the header, texture arguments in the rows), and I reuse the previous sketch's
statements wherever a chain end still matches, so editing one cable does not reorder or re-format the rest of the file. That
matching (four passes, from exact matches to "any chain that ended here before") was the most fiddly code in the app and is
what keeps the one-line-diff promise.

**Order matters in Hydra and nowhere in a graph.** Statement order decides which writer of an output wins, where variables
are defined and when raw code runs. The graph cannot show order, so it shows consequences instead: an output written twice
marks the earlier writer "shadowed"; variables are hoisted above their first use when compiled; setup and raw statements
keep their place in a column whose top-to-bottom order is the source order.

**Loops.** A graph editor's first instinct is to forbid cycles. Hydra's best trick is feedback, which is a cycle. Allowing
cycles only through output nodes, and saying exactly that when a cable is refused, turned out to be both correct and easy to
explain.

**Moving numbers are values in Hydra and wires in a patcher.** `() => Math.sin(time) * 0.5` is an argument, not a node.
Modulator nodes make it a wire, which is the patcher's strength (you can see what moves), but only arguments that round-trip
exactly become LFO nodes; everything else stays an Expression node with its original text, so nothing is rewritten behind the
user's back.

**What I would do next:** make "Group" produce a real reusable macro (it would need a core notion of user functions), give
text editing on nodes a proper inline editor instead of the system prompt, and measure on a real iPad.
