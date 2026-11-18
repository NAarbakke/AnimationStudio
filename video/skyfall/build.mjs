// Operation SKYFALL programme film, phases 1 and 2: the Razorbill drawn as a blueprint, then exploded and assembled.
// Writes a film page (window.__film, clock in programme seconds) to video/out/skyfall-plate/.
//   node video/skyfall/build.mjs
// The drawing is the teaser's (video/teaser/figure/razorbill.mjs); only the clock, colours and annotations are new here.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "../../.claude/skills/anatomy/kit/lathe.mjs";
import { W, H, P, at, screenOf, SIGNS, MOTOR, items } from "../teaser/figure/razorbill.mjs";
import { PHASES, TITLE, END } from "./phases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const OUT = join(ROOT, "video/out/skyfall-plate");

// exploded offsets in mm: wider in plan than the teaser's, shorter down the rod so the frame stays on the airframe
const MOVES = {
  frame: [0, 0, 0], battery: [0, 0, 340], top: [0, 0, 220], board: [0, 0, 100], release: [0, 0, -95], hook: [0, 0, -170], rod: [0, 0, -250],
};
// where each assembly sits, for the dashed assembly axes
const HOME = { frame: [0, 0, 130], battery: [0, 0, 232], top: [0, 0, 183], board: [0, 0, 137], release: [0, 0, 79], hook: [0, 30, -60], rod: [0, 0, -300] };
SIGNS.forEach(([sx, sy], n) => {
  const [mx, my] = [sx * MOTOR[0], sy * MOTOR[1]];
  MOVES[`arm${n}`] = [sx * 150, sy * 150, 0]; HOME[`arm${n}`] = [sx * 165, sy * 165, 150];
  MOVES[`leg${n}`] = [sx * 210, sy * 210, -170]; HOME[`leg${n}`] = [sx * 261, sy * 261, 90];
  MOVES[`motor${n}`] = [sx * 210, sy * 210, 140]; HOME[`motor${n}`] = [mx, my, 186];
  MOVES[`prop${n}`] = [sx * 210, sy * 210, 290]; HOME[`prop${n}`] = [mx, my, 196];
});

// callouts, drawn in screen space by live.js from these sheet points; t is when each appears
const r1 = (p) => at(p).map((v) => +v.toFixed(1));
// two holds: the airframe (13.0–15.8 s), then the camera runs down the rod (16–18.3 s); `until` fades each set out
const AIR = 15.6, ROD = 18.2;
const CALLOUTS = [
  { t: 13.5, until: AIR, at: r1([MOTOR[0], -MOTOR[1], 188]), dx: 120, dy: -120, text: "Motor ×4", sub: "outrunner, 3-blade prop" },
  { t: 13.8, until: AIR, at: r1([0, -20, 233]), dx: -330, dy: -190, text: "LiPo battery", sub: "strapped to the top plate" },
  { t: 14.1, until: AIR, at: r1([-165, 165, 165]), dx: -200, dy: -95, text: "Ø30 mm arm", sub: "clamped tube" },
  { t: 14.4, until: AIR, at: r1([0, 48, -38]), dx: 240, dy: 175, text: "Fishhook release", sub: "servo-driven, lets go of the rod" },
  { t: 16.3, until: ROD, at: r1([0, 52, -420]), dx: 230, dy: 20, text: "Stabiliser fins", sub: "keep the rod nose-down" },
  { t: 16.6, until: ROD, at: r1([0, 11, -980]), dx: 230, dy: 0, text: "Sensor strip", sub: "12.5 mm wide, 60 mm pitch" },
  { t: 16.9, until: ROD, at: r1([0, 0, -1350]), dx: 230, dy: -20, text: "Spike tip", sub: "drives into the soil" },
];
// dimensions: two sheet points, an offset in screen px (perpendicular to them), the label
const DIMS = [
  { t: 13.0, until: AIR, a: r1([-MOTOR[0], MOTOR[1], 200]), b: r1([MOTOR[0], MOTOR[1], 200]), off: 170, text: `${2 * MOTOR[0]} mm` },
  { t: 13.2, until: AIR, a: r1([MOTOR[0], -MOTOR[1], 200]), b: r1([MOTOR[0], MOTOR[1], 200]), off: -150, text: `${2 * MOTOR[1]} mm` },
  { t: 16.0, until: ROD, a: r1([0, 0, -282]), b: r1([0, 0, -1356]), off: 170, text: `${1356 - 282} mm` },
];
// how far a move carries a part toward the viewer, for the painter's order (as in the teaser)
const VIEW = G.viewOf(P);
const AXES = Object.fromEntries(Object.keys(MOVES).map((name) => [name, { home: r1(HOME[name]), s: screenOf(MOVES[name]).map((v) => +v.toFixed(2)) }]));

const data = {
  W, H,
  floorX: screenOf([1, 0, 0]), floorY: screenOf([0, 1, 0]),
  moves: Object.fromEntries(Object.entries(MOVES).map(([name, m]) => [name, { s: screenOf(m), lift: G.dot3(m, VIEW) }])),
  axes: AXES, callouts: CALLOUTS, dims: DIMS, phases: PHASES, title: TITLE, end: END.from, endTo: END.to,
  spots: { heart: r1([0, 0, 150]), rod: r1([0, 0, -1000]), low: r1([0, 0, -330]) },
};

const body = items.map((item, i) => `<g class="it" data-i="${i}" data-asm="${item.asm}" data-k="${item.key.toFixed(2)}">${item.svg}</g>`).join("")
  // every outline gets a unit length, so the sketch can draw it on with one dash offset
  .replace(/<path class="iso-line(?![^>]*data-dotted)/g, '<path pathLength="1" class="iso-line');

mkdirSync(OUT, { recursive: true });
for (const font of ["ibm-plex-mono-400-latin.woff2", "ibm-plex-mono-500-latin.woff2", "saira-condensed-600-latin.woff2", "saira-condensed-700-latin.woff2"]) {
  copyFileSync(join(ROOT, "site/src/shared/fonts", font), join(OUT, font));
}
const live = readFileSync(join(HERE, "live.js"), "utf8");
const css = readFileSync(join(HERE, "plate.css"), "utf8");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Operation SKYFALL: design and assembly</title>
<style>${k.ISO_CSS}\n${css}</style></head>
<body class="iso">
<div id="bg"><div id="paper"></div><div id="shop"></div></div>
<svg id="film" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" role="img" aria-label="An isometric drawing of the Razorbill farm drone, sketched, dimensioned, exploded and assembled.">
<defs><pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse"><path class="g1" d="M100 0H0V100"/><path class="g0" d="M50 0V100M0 50H100"/></pattern></defs>
<rect id="gridRect" x="-4000" y="-4000" width="${W + 8000}" height="${H + 8000}" fill="url(#grid)"/>
<g id="art">${body}</g>
</svg>
<svg id="ui" viewBox="0 0 1920 1080"><g id="axes"></g><g id="dims"></g><g id="notes"></g></svg>
<div id="step"><b></b><span></span></div>
<div id="block"><div class="row"><span>Razorbill farm drone</span></div><div class="row"><span id="sheet">General arrangement</span></div>
<div class="row split"><span>DWG SKY-RB-001</span><span id="rev">REV A</span></div><div class="row split"><span id="where">StartupLab</span><span>1:5</span></div></div>
<div id="stamp">Design freeze<small>Rev C · released for build</small></div>
<div id="card" class="card"><p>${TITLE.kicker}</p><h1>${TITLE.name}</h1><i></i><small>${TITLE.sub}</small></div>
<div id="end" class="card"><p>${TITLE.kicker}</p><h1>${TITLE.name}</h1><i></i><small>${PHASES.map((p) => p.short).join(" &nbsp;·&nbsp; ")}</small></div>
<div id="black"></div>
<script>window.FIG = ${JSON.stringify(data)};</script><script>${live}</script></body></html>`;
writeFileSync(join(OUT, "index.html"), html);
console.log(`${items.length} drawn items, ${(html.length / 1e6).toFixed(1)} MB -> ${OUT}`);
