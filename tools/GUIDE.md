# How to use the pencil

Everything on a notepad page is put there by one physical pencil, simulated in `js/engine.js`.
Pages are filled through `node tools/pencil.mjs` (run from the repo root).

## The physics

- The page is 148 × 210 mm. Origin is the top-left corner, x goes right, y goes down. Ruled lines
  sit at y = 24, 32, 40 … (every 8 mm). Keep a ~12 mm margin.
- The pencil starts 175 mm long with a soft lead. **The whole project ends the moment it is
  87.5 mm long**: the pencil stops mid-stroke and that page is the last one.
- Every millimetre of stroke lays down graphite. More **pressure** (0.1 – 1.6, default 0.8) and a
  **wider, duller tip** lay down more.
- Laying down graphite wears the point. A fresh point is 0.25 mm wide; it widens as it dulls, up to
  1.8 mm, when it is worn to the wood and the hand is forced to sharpen.
- **Sharpening** restores the point and is what really eats a pencil: about 1.1 mm of length each
  time, on top of the length worn away by writing. A sharpener does nothing to a point that is
  already sharp (under 0.4 mm wide).
- **Paper tooth saturates.** A patch of paper that is already black takes no more graphite, so
  scribbling over a solid black area costs almost nothing. Fresh paper — or freshly erased paper —
  takes graphite again.
- The **eraser** (12 mm) lifts about 90 % of the graphite where it rubs and wears down as it works.
  Erased graphite is still used pencil.

## A page draft

A draft is a JSON file:

```json
{
  "says": "What I am about to write or draw, and why — in my own voice.",
  "ops": [
    { "op": "write", "text": "A heading", "size": 12, "y": 16, "pressure": 1.1 },
    { "op": "write", "text": "Body text wraps on its own and sits on the ruled lines." },
    { "op": "sharpen" },
    { "op": "circle", "cx": 74, "cy": 130, "r": 30 },
    { "op": "hatch", "region": { "circle": [74, 130, 30] }, "angle": 30, "spacing": 0.8, "cross": true }
  ]
}
```

Ops run in order, exactly as a hand would do them.

| op | fields | notes |
| --- | --- | --- |
| `write` | `text`, `x`, `y`, `size`, `font`, `width`, `lineHeight` | `font`: `"print"` (default) or `"script"`. `size` is the em height in mm (default 7; capitals are ~⅔ of it). `y` is the baseline; leave it out to continue below the previous `write`. Wraps at `width` (default: to the right margin). `\n` starts a new line. ASCII only. |
| `line` | `x1`, `y1`, `x2`, `y2` | |
| `polyline` | `points: [[x,y],…]`, `closed` | straight segments |
| `curve` | `points: [[x,y],…]`, `closed` | smooth curve through the points |
| `rect` | `x`, `y`, `w`, `h` | outline |
| `circle` | `cx`, `cy`, `r` | outline |
| `ellipse` | `cx`, `cy`, `rx`, `ry`, `rot` | outline, `rot` in degrees |
| `arc` | `cx`, `cy`, `r`, `from`, `to` | degrees, clockwise from 3 o'clock |
| `spiral` | `cx`, `cy`, `r0`, `r1`, `turns` | |
| `hatch` | `region`, `angle`, `spacing`, `cross` | parallel shading lines `spacing` mm apart (min 0.15); `cross: true` adds the perpendicular set |
| `scribble` | `region`, `length` | a loose tangled line of about `length` mm inside the region |
| `stipple` | `region`, `count` | dots |
| `erase` | `x`, `y`, `w`, `h` | rub the eraser over a rectangle |
| `sharpen` | | |

Any drawing op also takes `pressure` (0.1 – 1.6), `wobble` (hand tremor in mm, default 0.2; 0 for
ruler-straight) and `repeat` (go over it n times).

A `region` is one of `{ "rect": [x, y, w, h] }`, `{ "circle": [cx, cy, r] }`,
`{ "ellipse": [cx, cy, rx, ry] }`, `{ "polygon": [[x, y], …] }`.

Drafts are plain JSON, so for anything intricate (a landscape, a pattern, a diagram) it is fine to
write a small throwaway script that generates the draft file.

## Commands

```
node tools/pencil.mjs status                 where things stand, whose turn it is
node tools/pencil.mjs preview draft.json     dry run: stats + an image, nothing is used up
node tools/pencil.mjs commit draft.json      writer: the page goes in the notepad for good
node tools/pencil.mjs comment comment.txt    critic: respond to the latest page
node tools/pencil.mjs closing closing.txt    writer: last words, after the pencil is half gone
node tools/pencil.mjs wait writer|critic     block until it is your turn (re-run if it says STILL_WAITING)
```

Every preview and commit prints how much line was drawn, how much graphite and pencil length it
cost, and the path of a PNG of the page to look at.
