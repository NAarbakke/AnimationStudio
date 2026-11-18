// Razorbill teaser, illustrated: an Anatomy isometric plate of the real airframe. Writes a film page (window.__film) to video/out/teaser-figure/.
//   node video/teaser/figure/build.mjs
// The drawing itself is razorbill.mjs.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../../.claude/skills/anatomy/kit/iso-kit.mjs";
import { W, H, items, data } from "./razorbill.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const OUT = join(ROOT, "video/out/teaser-figure");

const body = items.map((item, i) => `<g class="it" data-i="${i}" data-asm="${item.asm}" data-k="${item.key.toFixed(2)}">${item.svg}</g>`).join("");

mkdirSync(OUT, { recursive: true });
for (const font of ["ibm-plex-mono-400-latin.woff2"]) copyFileSync(join(ROOT, "site/src/shared/fonts", font), join(OUT, font));
const live = readFileSync(join(HERE, "live.js"), "utf8");
const css = readFileSync(join(HERE, "figure.css"), "utf8");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Razorbill figure</title>
<style>${k.ISO_CSS}\n${css}</style></head>
<body class="iso"><svg id="film" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" role="img" aria-label="An isometric drawing of the Razorbill farm drone, taken apart and coming together under a moving line of light.">
<defs>
<linearGradient id="slitGrad" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2="1">
<stop offset="0" stop-color="#000"/><stop offset=".35" stop-color="#fff"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
<linearGradient id="wakeGrad" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2="1">
<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
<mask id="slitMask" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="${W + 4000}" height="${H + 4000}"><rect id="slitRect" x="-2000" y="-2000" width="${W + 4000}" height="${H + 4000}" fill="url(#slitGrad)"/></mask>
<mask id="wakeMask" maskUnits="userSpaceOnUse" x="-2000" y="-2000" width="${W + 4000}" height="${H + 4000}"><rect id="wakeRect" x="-2000" y="-2000" width="${W + 4000}" height="${H + 4000}" fill="url(#wakeGrad)"/></mask>
<radialGradient id="glowGrad"><stop offset="0" stop-color="#b7c7e6"/><stop offset=".3" stop-color="#5d6f93" stop-opacity=".75"/><stop offset=".68" stop-color="#1c2536" stop-opacity=".3"/><stop offset="1" stop-color="#05070c" stop-opacity="0"/></radialGradient>
</defs>
<circle id="glow" r="1000" fill="url(#glowGrad)" opacity="0"/>
<g id="art">${body}</g>
<g id="wake" mask="url(#wakeMask)" opacity="0"><use href="#art"/></g>
<g id="lit" mask="url(#slitMask)"><use href="#art" class="litcopy"/></g>
<rect id="beam" x="-2000" width="${W + 4000}" height="3" fill="#dfe9ff" opacity="0"/>
</svg>
<div class="corner" data-c="tl">Fig 1</div><div class="corner" data-c="tr" id="title">&#9608;&#9608;&#9608;&#9608;&#9608;&#9608;&#9608;&#9608;&#9608;</div><div class="corner" data-c="br" id="readout"></div><div id="black"></div>
<script>window.FIG = ${JSON.stringify(data)};</script><script>${live}</script></body></html>`;
writeFileSync(join(OUT, "index.html"), html);
console.log(`${items.length} drawn items, ${(html.length / 1e6).toFixed(1)} MB -> ${OUT}`);
