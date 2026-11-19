# Pencil

A web app that simulates a physical pencil writing and drawing on the pages of a notepad.
The pencil gets used up as it goes. Each notebook on the site was filled by a pair of Claude
agents under a different brief, and the conversation that produced it is shown next to the pages.

Live site: <https://crumplabsandbox.github.io/pencil/>

| Notebook | Brief | Ends when |
| --- | --- | --- |
| **Half a Pencil** | A writer decides what to write and draw; a critic looks at each page and argues for using more pencil. | half the pencil is gone |
| **On the Phone** | Two Claudes talk as if on a phone call; one doodles while it talks, and the other cannot see the page. | three quarters of the pencil is gone |
| **The Doodle Critic** | The same phone call, but the doodles are about the conversation, and a third agent looks at each page and asks for more interesting, more elaborate doodles. | half the pencil is gone |

## Run it

```
npm start        # python3 -m http.server 8137
```

then open <http://localhost:8137>. It is a static site with no build step; pushing to `main`
deploys it to GitHub Pages (`.github/workflows/pages.yml`).
`?book=phone-call` opens a notebook, `?page=7` a page, and `?play` starts the pencil immediately.

- **← / →** flip pages, **space** starts or pauses the pencil.
- Each notebook has a short explanation and the full prompts its two agents were given.
- **+ New notebook** gives a visitor a blank 100-page notebook and a fresh pencil to draw with by
  hand (pencil, eraser, sharpener). Those are kept in the visitor's own browser storage, not on
  the site.

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

## How a notebook gets filled

Notebooks are generated ahead of time and committed as data; the site itself calls no API.
`tools/pencil.mjs` is the only way pages get into `data/`. Two agents take turns through it:

- the role holding the pencil submits a page as a list of high-level operations (`write`, `hatch`,
  `curve`, `erase`, `sharpen`, …, described in `tools/GUIDE.md`) together with what it has to say;
- the tool runs the operations through the same engine the browser uses, records what the page
  cost the pencil, and renders an image of the page;
- the other role responds, and the turn passes back.

When the pencil reaches the project's stop mark it stops mid-stroke, and that page is the last.

```
data/index.json                    the list of notebook projects
data/<project>/manifest.json       brief, prompts, pencil state, and the whole conversation
data/<project>/nb1/001.json        one page: what was said, its ops, pencil state before and after
```

Pages store operations, not pixels: the browser re-simulates each page to draw it, which is how
it can replay the pencil stroke by stroke. A project rolls over into a second notebook after 100
pages.

### Starting a new notebook

1. Write a config file and create the project:

   ```json
   {
     "id": "my-notebook",
     "title": "My Notebook",
     "about": "Two or three sentences shown on the site.",
     "stopAt": 87.5,
     "hearOnly": false,
     "models": "which models ran the agents",
     "roles": {
       "writer": { "name": "Writer", "cue": "before the page", "does": "says what it will draw, then draws it.", "closingCue": "at the end" },
       "critic": { "name": "Critic", "cue": "after looking at it", "does": "looks at the page and responds." }
     },
     "prompts": { "writer": "the full prompt…", "critic": "the full prompt…" }
   }
   ```

   ```
   node tools/pencil.mjs init config.json
   ```

   `stopAt` is the pencil length in mm at which the project ends. `hearOnly: true` means the
   second agent is shown only the first agent's words, never the page or its statistics.
   Adding a `reviewer` entry under `roles` (and `prompts`) brings in a third agent that also
   responds to every page, always looking at the image; the pencil-holder waits for both.

2. Launch the agents (for example from a Claude Code session, choosing their model), one with each
   prompt. Each loops on `node tools/pencil.mjs --book my-notebook wait writer|critic|reviewer` and
   then `commit`s a page, `comment`s on one or `review`s one, until the tool reports the project
   is finished.

3. Commit `data/` and push.

Rendering page images for the agents needs Google Chrome (set `CHROME_BIN` if it is not in the
default macOS location).

## Credits

Handwriting uses the Hershey fonts, originally created by Dr. A. V. Hershey at the U.S. National
Bureau of Standards (font data format by James Hurt, Cognition, Inc.; SVG conversion by Windell H.
Oskay; packaged in `hersheytext`). `tools/build-font.mjs` regenerates `js/font.js` from them.
