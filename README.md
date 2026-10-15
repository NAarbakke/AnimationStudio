# Kestrel labs

One website of interactive three.js pages about rocket propulsion, plus the tooling around it: code-CAD that
feeds the solid-motor lab, and scripts that turn the pages into video. Everything shares one Vite project, one
`package.json` and the renderer in `site/src/shared/`.

| Page | URL | Source (under `site/`) | What it is |
| --- | --- | --- | --- |
| Launch | `/` (`index.html`) | `src/launch/` | The launch animation, HUD included |
| Liquid engine | `/engine.html` | `src/engine/` | Gas-generator cycle lab |
| Solid motor | `/srm.html` | `src/srm/` | Solid-motor lab, burn-back from your own CAD |
| The maths | `/math.html` | `src/math/` + `video/manim/` | The labs' equations as ManimGX films, drawn live in the browser (WebGPU) |
| Burevestnik ConOps | `/conops.html` | `src/conops/` | 3-minute notional concept-of-operations film (not in the tab bar) |

The first four are linked by the tabs in the top-left corner.

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check, then the static site in dist/; host anywhere
```

## Project layout

```
site/                the website (Vite root): everything here ends up in dist/
  *.html             the five pages; URLs stay /srm.html etc.
  src/
    shared/          stage (renderer + post + quality), nozzle gas dynamics, plume, lab.css
    launch/          launch animation (index.html; plain JS module)
    engine/          liquid-engine lab (plain JS module)
    srm/             solid-motor lab: main, burn worker, ballistics, CAD loader, grain volume renderer
    math/            maths page: assembles the ManimGX scenes for the in-browser player
    conops/          Burevestnik ConOps film
  public/models/     CAD exports the site loads, served as-is at /models/ (srm.glb, srm.json)
cad/
  srm.py             default solid motor (build123d), the source of site/public/models/srm.glb
  imports/           third-party CAD received as-is (STEP), not loaded by the site
video/
  render.js          page → MP4 (Playwright + ffmpeg); also used as a module
  stills.js          single frames from a film-mode page
  hf.js              HyperFrames CLI wrapper (bundled ffmpeg/ffprobe on PATH)
  index.html         HyperFrames composition: the solid-motor film
  showcase.html      HyperFrames composition: the showcase edit
  conops/            export.js (full ConOps delivery), review.js (timeline checks)
  manim/             ManimGX equation scenes: kit.py, srm.py, engine.py, their data
                     (srm.json, engine.json, from export.js) and insert.js (clips for the showcase)
  clips/ out/ site/ conops-site/     generated, git-ignored
reference/           source material (Hecla & Kemp, Burevestnik paper)
tmp/                 git-ignored scratch space
```

`vite.config.ts`, `tsconfig.json` and `package.json` stay at the top: they configure the whole project, and
`npm run dev` / `build` work from there as before. Scripts that render pages take page paths relative to
`site/` (`"srm.html?film"`).

**Why `public/`?** It is Vite's folder for files that are served and copied to `dist/` exactly as they are,
without bundling or renamed hashes. The solid-motor lab fetches `/models/srm.glb` by that fixed URL at runtime and
reloads it when it changes, so the GLB has to live there. `cad/` holds the Python *source* (and its 21k-file
venv), which must never be published; `site/public/models/` holds only its *output*.

Generated output always lands in `video/out/` (finished films, stills, review frames) or `video/clips/`
(intermediate clips); `dist/` is the built site.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Renderer | three.js **0.147** (pinned) | Same renderer and version the pages were tuned on, so the look is unchanged. Upgrading (r15x+ changes lighting and colour management) is a deliberate re-tune, not a bump. |
| Build / dev | Vite 6 + TypeScript | Instant reload; watches `site/public/models/` and hot-swaps CAD exports into open pages without losing state. |
| Heavy compute | Web Worker (`site/src/srm/burn.worker.ts`) | Grain voxelisation and the distance transform run off the main thread. |
| CAD | build123d (Python, `cad/.venv`) | Code-CAD scripts export named-part GLBs. CadQuery `Assembly.save('x.glb')` and FreeCAD's glTF export work the same way. |
| Maths films | ManimGX (Python in `video/manim/.venv` for rendering; the `manimgx` npm player for `math.html`) | One scene source serves both the video inserts and the live page. |
| Video | Playwright + ffmpeg-static, HyperFrames for editing | Frame-stepped rendering, so output is smooth however slow the GPU is. |

Performance budget (measured on Intel UHD integrated graphics): no MSAA on the HDR target, bloom at half
resolution, render scale starts at ≤1.25× and steps down automatically below ~40 fps, then bloom turns off
as a last resort. See `site/src/shared/stage.ts`.

### Python environments

Both venvs are git-ignored; recreate them with Python 3.13 if missing:

```bash
python -m venv cad/.venv && cad/.venv/Scripts/pip install build123d
python -m venv video/manim/.venv && video/manim/.venv/Scripts/pip install manimgx
```

## npm scripts

| Script | Does |
| --- | --- |
| `dev` / `build` / `preview` | Vite dev server, production build to `dist/`, serve the build |
| `cad` / `cad:watch` | Export `cad/srm.py` to `site/public/models/` once / on every save |
| `render -- <page> [opts]` | Render any page to MP4 (see below) |
| `stills -- <page> <t>…` | PNG frames from a film-mode page at the given seconds, to `video/out/stills/` |
| `video` | Solid-motor film through HyperFrames → `video/out/srm-hyperframes.mp4` |
| `insert` | Export the labs' physics, render the ManimGX inserts → `video/clips/*-math.mp4` |
| `sample` | Clip every page, make the inserts, cut the showcase → `video/out/showcase.mp4` |
| `video:conops` | Build, then the full ConOps delivery → `video/out/burevestnik-conops.mp4` |
| `video:conops:review` | Sample the ConOps timeline and check cutaway labels → `video/out/conops-review/` |

## Using your own CAD (solid motor)

1. Edit `cad/srm.py`, or write your own script, then run `npm run cad:watch` in a second terminal.
   Every save re-exports `site/public/models/srm.glb`.
2. On the Solid motor page, pick **CAD**. Each export is picked up live: the grain burn-back,
   pressure, thrust, charts, plume and tour all recompute from the new geometry.

**Contract.** A GLB with parts named by prefix (case-insensitive):

| Name | Needed | Used for |
| --- | --- | --- |
| `grain…` | yes, one or more closed solids | voxelised; burn-back distance field, Ab(w), propellant mass |
| `nozzle…` | yes | sliced along the axis; throat and exit radius, flow profile |
| `case…` | optional | case inner radius (particle/plume bounds); displayed |
| `insulation…`, `liner…`, `forward_closure…`, `igniter…`, anything else | optional | displayed |

- Axis, orientation and units (m or mm) are detected: the axis runs from nozzle to grain, and the throat
  is found as the narrowest nozzle section.
- An optional `site/public/models/srm.json` next to the GLB sets
  `{"units": "mm", "inhibit": ["forward", "aft"], "meop_MPa": 9}`. Inhibited ends are treated as bonded and
  don't burn; `meop_MPa` is the case pressure limit used for burst warnings.
- The grain is assumed case-bonded on its outside. Faces open to the port or to the end gaps burn.

## Rendering video

### Any page: `video/render.js`

```bash
npm run render -- "srm.html?film" --duration 18        # video/out/srm.mp4, 1920x1080 @ 30 fps
npm run render -- index.html --duration 60 --fps 60    # the launch, HUD included
npm run render -- engine.html --size 1280x720 --out video/out/engine-720.mp4
npm run stills -- "conops.html?film" 10 30 95          # check shots without a full render
```

`render.js` starts the Vite dev server, opens the page in headless Chrome through Playwright, steps it
one frame at a time on a virtual clock and pipes the screenshots to ffmpeg (H.264). Frames are stepped rather
than recorded live, so the result is smooth however slow the GPU is. `--click <selector>` (repeatable) presses
a control before the first frame. A page that sets `window.__film` (`srm.html?film`, `conops.html?film`) is
given the time directly; any other page is driven through `requestAnimationFrame`, so CSS transitions there
still run in real time and look snappier than live. `renderVideo()` is exported for use from other scripts.
ffmpeg comes from the `ffmpeg-static` package (`FFMPEG_PATH` overrides it); the browser is the installed
Chrome (`--channel msedge` or `chromium` to change).

### HyperFrames edits

Both go through `video/hf.js`, which runs the HyperFrames CLI with the bundled ffmpeg and ffprobe on `PATH`:

- `npm run video` films the solid motor directly: it builds the site into `video/site` and renders the
  composition in `video/index.html`, which drives the lab's `window.__film` clock, to `video/out/srm-hyperframes.mp4`.
- `npm run sample` uses everything: Playwright renders a clip of each page into `video/clips/`, `insert`
  renders the ManimGX equation inserts, then HyperFrames cuts them together with titles (`video/showcase.html`)
  into `video/out/showcase.mp4`.

### ManimGX equation scenes

`video/manim/srm.py` and `engine.py` (sharing `kit.py`) write out the labs' equations with the labs' own numbers.
`export.js` loads each lab headless and saves its physics to `srm.json` / `engine.json` (committed: `math.html`
bundles them). `npm run insert` re-exports and renders the clips; `npm run insert -- inspect` writes storyboards
and layout checks only.

### Burevestnik ConOps

The sequence is a notional reconstruction after Hecla & Kemp, Figure 4 (paper in `reference/`); the authors also
allow that the twin boosters were for testing only.

```bash
npm run video:conops:review   # sample the timeline, check cutaway label placement
npm run video:conops          # video/out/burevestnik-conops.mp4: 3:00, 1080p, 30 fps, ambient audio
```

The export renders six 30 s sections from a frozen copy of the build (`video/conops-site/`) into
`video/out/conops-parts-<hash>/`, so `--resume` continues an interrupted run and `--mux-only` only redoes the
audio and chapters. The final MP4 has chapter markers, source/uncertainty cards and a quiet synthesized ambient
soundtrack; on-screen captions carry the explanation. Media validation details go to
`video/out/burevestnik-conops.validation.json`.

## Not done yet

- **CAD import for the liquid engine.** The same pattern applies: slice a `chamber`/`nozzle` part for the
  contour that drives the 1-D flow, spin `rotor*` parts, and take flow paths from a manifest. The engine
  code is still procedural.
- **Launch page shaders.** The log-depth `#include`s are spliced mid-line, so the earth, clouds, atmosphere,
  flood beams, plumes and smoke/fire shaders never compile (see the note above `LOGV` in `site/src/launch/main.js`).
  Fixing that brings them back but drops the page to ~7 fps on Intel UHD and changes the look, so it needs a
  tuning pass (cheaper earth/cloud noise) before it ships.
- Solid-motor physics omits erosive burning, throat erosion and the ignition transient. The footnote on
  the page says so.
