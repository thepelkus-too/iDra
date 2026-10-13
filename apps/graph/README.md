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
| **Numbers** | drag sideways; the further your finger is above or below the slider, the finer the steps (Pencil is always fine); tap for the number editor (tabs **Keypad** with Glide, **Ladder**, **Pad**; the last tab is remembered); double-tap for the default |
| **Ladder** | long-press a number (hold still ⅓ s), then without lifting: slide up or down to pick the step (1000 … 0.01), left or right to change the value by it (the step then stays put until you slide back to where you started); let go to keep it (one undo step), Esc to cancel. Hold still and let go: the Ladder tab |
| **Pads** | in a number's Pad tab, **Bind to a pad**: the number becomes a hydra-motion knob played from a floating pad (hold, latch or trigger). ⇄ → **Pads** shows or hides them |
| **Undo / redo** | two-finger tap / three-finger tap, the ↶ ↷ buttons, ⌘Z / ⇧⌘Z |
| **Switch off / on** | tap a node's `//` (in its header, or in the selection bar). A generator's `//` switches its whole chain; a node inside a switched-off chain or argument switches that back on. Hold `//` for why, when it can't |
| **Preview up to here** | tap a node's 👁: a thumbnail of its chain up to that node sits above it. Tap the thumbnail to enlarge it (it animates); tap again to fold. ✕ unpins |
| **A/B** | on a modifier's thumbnail (or in the selection bar), **A/B** turns it into before/after this node; enlarge it and tap **A · before** / **B · after** |
| **Keyboard** | ⌘D duplicate, ⌫ delete, ⌘K palette, ⌘A select all, ⌘Enter run, Esc clear |

One finger on empty canvas pans rather than lassoes: on a tablet, panning is the thing you do constantly and selecting a
rectangle the thing you do rarely, so the rectangle lives behind a toolbar toggle (and the Pencil).

The selection bar at the bottom: **Duplicate**, **Delete** (a node in the middle of a chain is spliced out and the chain
closes up), **`//`** (switch off or on, see below), **Group** (collapse a run of nodes into one macro card that expands on
tap; display only, the code is flat), **👁 Preview** and **A/B** (see Previews), **Pin** (put the node's numbers on the
performance screen) and **Bake** (see below). ⋯ → **Node previews** cycles the previews preference: on demand, live, off.

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
* A **switched-off** node is core's `disabled` flag (docs/IR.md, "Disabled nodes"): it stays where it is in its chain and
  is written as commented-out code, `// .rotate(0.8)` on a line of its own, so vanilla Hydra skips it exactly as iDra does.
  On the canvas it is dashed, dimmed and striped, still selectable, movable and editable; its cables stay but are drawn as
  carrying nothing, and the chain passes through it. Switching off a generator switches off its chain statement (every
  line `// `). A switched-off blend or modulate takes its texture argument with it, so those nodes look off too, as do
  modulators feeding a switched-off node. A node written several times (fan-out) switches every copy. Two edits that would
  put a `//` line where none can go are refused with the reason: a switched-off node becoming the start of a chain, and a
  chain holding one being wired into a texture input (written on one line).
* **Old sketches.** Before core had the flag, the graph "bypassed" nodes by leaving them out of the code and keeping them
  in `meta.graph.bypass`. On first open each such node goes back after the call it followed, switched off, and the key is
  removed (`src/migrate.ts`). A bypassed node whose neighbour is gone becomes a comment instead of being dropped.
* **Commented-out code** in an imported sketch that core revives (`// .kaleid(4)` inside a chain, a `//`-commented
  statement) shows as switched-off nodes, with a note "N commented-out chunks were revived as disabled" until you tap OK
  (remembered in `meta.graph.revivedSeen`).
* Comments are sticky notes; `setting`, `source`, `render` and raw JavaScript statements are small setup nodes in a column on
  the left. Nothing in a sketch is dropped: whatever the graph does not understand stays a raw JS node and is written back as
  it was.
* An unchanged sketch exports byte for byte as it was imported; changing one number changes one line (checked over the whole
  corpus in the unit tests and again in the browser).

## Previews

A pinned thumbnail is the kit's `<PreviewPeek>` with core's `prefix` spec: the node's chain from its generator up to and
including that node, switched-off modifiers left out (a switched-off node's own preview includes it, so you can see what
switching it on would do). On an output node it is the last chain that writes that output. **A/B** on a modifier uses the
`diff` spec, before and after that call. Pictures come from core's preview pool (docs/previews-runtime.md), shared by every
thumbnail: at most two small hidden runtimes exist, whatever the number of pins. The main output is never touched (the
old approach, a whole second runtime per pin drawing the node into a spare `o3`, is gone).

* **The preference** (⋯ → Node previews, shared by every editor): *on demand* (default) shows a still, refreshed when the
  chunk or its numbers change, and animates the one you enlarge; *live* animates visible thumbnails, as many at once as the
  pool has runtimes (the others keep their last picture); *off* hides them.
* A chunk that reads another output, `prev()` or a camera shows "≈": it is seen through a copy of the main picture,
  refreshed about once a second.
* Thumbnails pause when panned or zoomed off screen and close in performance mode. They follow the trust gate: until you
  say yes, they say "Runs once you run the sketch".

## Core change requests

* **Preview pool, live mode: thumbnails beyond the pool's size never get a first picture.** In live mode the newest
  handles keep the runtimes, so a thumbnail opened together with two newer ones (three pins on page load) shows nothing
  until one of them goes away. Suggestion: give waiting handles one still each, in turn, before animating the chosen ones.
* **`PreviewPeek`: an `open` prop (or `defaultOpen`).** A/B would read better opening straight to the enlarged
  before/after view; today it is one more tap.

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

**Switching off in a graph (step 09).** Core's rule that a switched-off call is a `//` line *inside* its chain fits a
graph well: the node stays where it was, the cables stay, and the chain visibly passes through it. The old bypass had to
keep the node outside the code, in editor-only state, which is exactly what the vanilla-Hydra principle warns against;
now the code says it. Two graph edits can't be expressed as Hydra comments (a switched-off node starting a chain, or one
inside a texture argument, which is written on one line) and are refused with a sentence rather than silently
re-enabling anything. What felt clumsy: the node header got crowded (name, 👁 and `//` share 212 px, so long names
truncate sooner), and on a generator `//` means "the whole chain", which is right for Hydra but is a different reach from
the same button on a modifier; the toggle's label says which. Enlarged thumbnails sit above their node and can run off
the top of the canvas for nodes near the top edge (pan down a little). Not verified without an iPad: how the dimmed
stripes read in sunlight, whether 28 px eye buttons are easy enough to hit with a finger, how two preview runtimes plus
the main one behave under Safari's WebGL context limit, and battery cost in live mode.

**What I would do next:** make "Group" produce a real reusable macro (it would need a core notion of user functions), give
text editing on nodes a proper inline editor instead of the system prompt, and measure on a real iPad.

## iPad checklist (switching off and previews)

On the deployed site, Safari and the installed app, landscape and portrait:

1. Open a sketch with a chain of three or more calls. Tap a modifier's `//`: it dims, stripes and dashes; its cables go
   dotted; the output changes as if it were gone. Code: the line reads `// .name(…)`. Tap `//` again: the code is back
   exactly as it was. Two-finger tap undoes and three-finger tap redoes the switch.
2. Tap a generator's `//`: every node of the chain dims, and the code comments every line. Tap `//` on another node of
   that chain: the whole chain comes back.
3. Switch off a `blend(…)` or `modulate(…)`: the nodes of its texture argument dim too. Hold the `//` on one of those
   nodes: a note explains why it can't switch alone, with a button for the whole thing.
4. Delete the generator of a chain whose next node is switched off: the edit is refused with a sentence, nothing changes.
5. Tap 👁 on a few nodes: thumbnails appear above them (a still each, on demand). Tap one: it enlarges and animates; tap
   again: it folds. Pan them off screen and back. Drag a number on the chain: the stills follow.
6. On a modifier's thumbnail, tap A/B, enlarge it, switch A · before and B · after. Check the "≈" badge on a node reading
   `src(o0)` or `prev()`.
7. ⋯ → Node previews: live (thumbnails animate; watch frame rate, heat and battery for a few minutes with three pins),
   off (they disappear), on demand again. Enter and leave performance mode: no thumbnails there.
8. Import a `.js` with commented-out chain calls (`// .kaleid(4)` on its own line): the note says how many were revived;
   OK dismisses it for good. Switch to Chain Stack and back: the switched-off nodes and the code are unchanged.
9. Open a sketch saved before this change with a bypassed node: it appears switched off in place.
