# Half a Pencil

A web app that simulates a physical pencil writing and drawing on the pages of a notepad.
The pencil gets used up as it goes. Two Claude agents decided what went on the pages:

- the **writer** says what it wants to write or draw, then does it;
- the **critic** looks at the finished page and tells the writer how to use more pencil.

They kept going until the pencil was worn down to half its length. The site lets you flip through
the pages, watch the pencil draw each one, and read the conversation that produced them.

## Run it

```
npm start        # python3 -m http.server 8137
```

then open <http://localhost:8137>. It is a static site (no build step), so it can also be served
from GitHub Pages. `?page=7` opens on a page and `?play` starts the pencil immediately.

- **← / →** flip pages, **space** starts or pauses the pencil.
- **+ New notebook** gives you a blank 100-page notebook and a fresh pencil of your own to draw
  with by hand (pencil, eraser, sharpener). Your notebooks are kept in the browser's local storage.

## The simulation

All lengths are in millimetres; the model lives in `js/engine.js`.

- A new pencil is 175 mm long. The page is 148 × 210 mm.
- Each millimetre of stroke lays down graphite in proportion to pressure and the width of the tip.
- Laying down graphite wears the conical point, so the tip widens from 0.25 mm towards 1.8 mm and
  the pencil shortens. Worn to the wood, it has to be sharpened.
- Sharpening restores the point at a cost of about 1.1 mm of length. Sharpening, more than
  writing, is what consumes a pencil.
- Paper tooth saturates: an area that is already black takes no more graphite.
- The eraser lifts about 90 % of the graphite it rubs and wears down as it does.

The lead is deliberately soft (it lays graphite down a few times faster than a real HB) so that
half a pencil is a few dozen pages rather than several hundred.

## How the notepad was filled

`tools/pencil.mjs` is the only way pages get into `data/`. The writer agent submits a page as a
list of high-level operations (`write`, `hatch`, `curve`, `erase`, `sharpen`, …, described in
`tools/GUIDE.md`); the tool runs them through the same engine the browser uses, records what the
page cost the pencil, and renders an image for the critic agent to look at. The critic's comment
is stored with the page, and the turn passes back to the writer.

```
data/manifest.json     the notebooks, the pencil's state, and the whole conversation
data/nb1/001.json      one page: what the writer said, its ops, pencil state before and after
```

Pages store operations, not pixels: the browser re-simulates each page to draw it, which is how
it can replay the pencil stroke by stroke.

## Credits

Handwriting uses the Hershey fonts, originally created by Dr. A. V. Hershey at the U.S. National
Bureau of Standards (font data format by James Hurt, Cognition, Inc.; SVG conversion by Windell H.
Oskay; packaged in `hersheytext`). `tools/build-font.mjs` regenerates `js/font.js` from them.
