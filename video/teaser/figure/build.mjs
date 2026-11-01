// Razorbill teaser, illustrated: an Anatomy isometric plate of the real airframe. Writes a film page (window.__film) to video/out/teaser-figure/.
//   node video/teaser/figure/build.mjs
// Sizes are millimetres read from site/public/models/razorbill.glb (feet on z = 0, hub on the z axis); the shapes are drawn from them, not traced.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../../.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "../../../.claude/skills/anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../../.claude/skills/anatomy/kit/tube.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const OUT = join(ROOT, "video/out/teaser-figure");

const W = 3200, H = 3200; // a large virtual sheet: the film's camera is a viewBox moving over it, so paths need the precision

// exploded offsets per assembly, in mm; the film's springs take each from 1 (apart) to 0 (assembled)
const MOVES = {
  frame: [0, 0, 0], battery: [0, 0, 300], top: [0, 0, 190], board: [0, 0, 90], release: [0, 0, -120], hook: [0, 0, -230], rod: [0, 0, -360],
  arm0: [-70, -70, 0], arm1: [-70, 70, 0], arm2: [70, 70, 0], arm3: [70, -70, 0],
  leg0: [-105, -105, -130], leg1: [-105, 105, -130], leg2: [105, 105, -130], leg3: [105, -105, -130],
  motor0: [-105, -105, 110], motor1: [-105, 105, 110], motor2: [105, 105, 110], motor3: [105, -105, 110],
  prop0: [-105, -105, 210], prop1: [-105, 105, 210], prop2: [105, 105, 210], prop3: [105, -105, 210],
};
const SIGNS = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
const MOTOR = [273, 274];

const P = k.fitProjection(
  [[-560, -560, 0], [560, 560, 0], [560, -560, 0], [-560, 560, 0], [0, 0, 760], [0, 0, -1720]],
  W, H, { pad: 60, azimuth: 33, elevation: 26 },
);
const at = (p) => k.iso(p, P);
const origin = at([0, 0, 0]);
const screenOf = (v) => { const s = at(v); return [s[0] - origin[0], s[1] - origin[1]]; };

const items = [];
function put(asm, centre, svg, bias = 0, extra = {}) {
  items.push({ asm, key: k.depthOf(centre, P) + bias, svg, ...extra });
}
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const vertical = (o) => G.frameOf(o, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const unit = (a) => { const n = Math.hypot(...a); return a.map((c) => c / n); };

// a bar of width `w` between two floor points, as a floor outline
function barRing([x0, y0], [x1, y1], w) {
  const [dx, dy] = unit([x1 - x0, y1 - y0]);
  const [nx, ny] = [-dy * w / 2, dx * w / 2];
  return [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
}
const octagon = (r, c) => [[r - c, -r], [r, -r + c], [r, r - c], [r - c, r], [-r + c, r], [-r, r - c], [-r, -r + c], [-r + c, -r]];

function frame() {
  const deck = k.extrude(octagon(109, 34), 120, 6, P, { bevel: 1.1 });
  put("frame", [0, 0, 120], S(deck, { tone: "mid", inner: L(k.onTop(octagon(98, 30), 126, P, true), { tone: "lo" }) }), -30);
  const screws = octagon(101, 31).map(([x, y]) => [x, y, 126]);
  put("frame", [0, 0, 126], D(screws.map(at), { size: 1.1, tone: "mid" }), -29);
  for (const [x, y] of octagon(102, 32)) {
    put("frame", [x, y, 148], S(k.cylinder(x, y, 3.2, 126, 45, P, 16), { tone: "mid" }));
    put("frame", [x, y, 171], S(k.cylinder(x, y, 4.2, 171, 4, P, 16), { tone: "lo" }));
  }
  // the side cheeks that take the arm roots
  for (const [sx, sy] of SIGNS) {
    const ring = barRing([sx * 58, sy * 58], [sx * 86, sy * 86], 34);
    put("frame", [sx * 72, sy * 72, 127], S(k.extrude(ring, 126, 8, P, { bevel: 0.7 }), { tone: "lo" }));
    put("frame", [sx * 72, sy * 72, 166], S(k.extrude(ring, 166, 9, P, { bevel: 0.7 }), { tone: "mid" }));
  }
}

function board() {
  const carrier = { x: -46, y: -38, w: 92, d: 76, r: 3 };
  put("board", [0, 0, 128], S(k.slabOf(carrier, 127, 2, P, 3, 0.6), { tone: "mid", inner: L(k.planOutline(k.insetPlan(carrier, 4), 129, P, 3), { tone: "faint" }) }));
  for (const [x, y] of k.corners(carrier, 7)) {
    put("board", [x, y, 133], S(k.cylinder(x, y, 2.6, 129, 8, P, 12), { tone: "lo" }));
    put("board", [x, y, 137], S(k.cylinder(x, y, 3, 137, 1.2, P, 12), { tone: "mid" }));
  }
  const stack = { x: -24, y: -26, w: 48, d: 46, r: 2 };
  put("board", [0, -3, 134], S(k.slabOf(stack, 129, 7, P, 3, 0.5), { tone: "hi", lit: true, inner: L(k.topTicks(stack.x + 4, stack.x + stack.w - 4, 4, 5, stack.y + 3, 136, [2, 4], P).major, { tone: "lo" }) }));
  put("board", [0, -3, 137], D(k.dotGrid(-16, -14, 8, 6, 4.4, 136, P).map((p) => p), { size: 0.7, tone: "mid" }));
  const chip = { x: -13, y: -13, w: 26, d: 26, r: 1 };
  put("board", [0, 0, 141], S(k.slabOf(chip, 136, 7, P, 2, 0.5), { tone: "hi", lit: true }));
  put("board", [0, 0, 144], S(k.cylinder(0, 0, 7, 143, 4, P, 24, 0.5), { tone: "mid" }));
  // the GNSS/ESC blocks at the carrier's ends, avionics_0 and avionics_1 in the GLB
  put("board", [91, 7, 127], S(k.slabOf({ x: 84, y: -4, w: 14, d: 22, r: 1 }, 126, 4, P, 2, 0.4), { tone: "mid" }));
  put("board", [-84, 4, 130], S(k.slabOf({ x: -98, y: -13, w: 28, d: 34, r: 1.5 }, 126, 10, P, 3, 0.6), { tone: "mid" }));
}

function top() {
  const plate = octagon(100, 28);
  const inner = [
    L(k.onTop(octagon(92, 26), 183, P, true), { tone: "faint" }),
    L(k.onTop([[-62, -24], [-34, -24], [-34, 24], [-62, 24]], 183, P, true), { tone: "lo" }),
    L(k.onTop([[62, -24], [34, -24], [34, 24], [62, 24]], 183, P, true), { tone: "lo" }),
    L(k.onTop([[-58, 0], [-40, -16], [-40, 16]], 183, P, true), { tone: "mid" }),
    L(k.onTop([[58, 0], [40, -16], [40, 16]], 183, P, true), { tone: "mid" }),
  ].join("");
  put("top", [0, 0, 179], S(k.extrude(plate, 175, 8, P, { bevel: 1.4 }), { tone: "hi", inner }), 30);
  const screws = octagon(93, 26);
  put("top", [0, 0, 183], D(screws.map(([x, y]) => at([x, y, 183])), { size: 1.2, tone: "hi" }) + L(screws.map(([x, y]) => k.ring(x, y, 3.2, 183, P, 12)).join(""), { tone: "lo" }), 31);
  for (const [sx, sy] of SIGNS) put("top", [sx * 72, sy * 72, 183], D([0, 1, 2].map((i) => at([sx * (58 + i * 11), sy * (58 + i * 11), 183])), { size: 0.9, tone: "mid" }), 31);
}

function battery() {
  const pack = { x: -22, y: -70, w: 44, d: 137, r: 2.5 };
  put("battery", [0, 0, 205], S(k.slabOf(pack, 180, 52, P, 3, 1.4), { tone: "hi", lit: true, inner: L(k.sideSeam(pack, 192, P, 3) + k.sideSeam(pack, 221, P, 3), { tone: "faint" }) }), 60);
  for (const y of [-38, 34]) {
    const strap = { x: -23.5, y, w: 47, d: 9, r: 0.6 };
    put("battery", [0, y + 4, 233], S(k.slabOf(strap, 231, 2.4, P, 2, 0.3), { tone: "mid" }), 61);
  }
  put("battery", [0, 0, 232], L(k.topTicks(-68, 64, 6, 4, -10, 232, [1.4, 3], P, "y").major, { tone: "lo" }), 61);
  put("battery", [10, 66, 196], S(k.slabOf({ x: 4, y: 66, w: 12, d: 7, r: 1 }, 190, 10, P, 2), { tone: "mid" }), 61);
}

function rotor(n) {
  const [sx, sy] = SIGNS[n];
  const [mx, my] = [sx * MOTOR[0], sy * MOTOR[1]];
  // arm: a 30 mm tube, as in the GLB, in a clamp collar at the motor end
  const A = G.frameAlong([sx * 68, sy * 68, 150], unit([sx, sy, 0]));
  const LEN = 194 * Math.SQRT2;
  const c = [sx * 165, sy * 165, 150];
  const seams = [24, 40, LEN - 34].map((at) => L(G.arcOf(A, at, 15, P), { tone: "faint" })).join("");
  put(`arm${n}`, c, S(G.solidOf([[0, 15], [LEN, 15]], A, P), { tone: "hi", inner: seams }));
  for (const d of [80, 96, 232, 248]) {
    put(`arm${n}`, [sx * d, sy * d, 165], D([at([sx * d, sy * d, 165])], { size: 1.3, tone: "hi" }) + L(k.ring(sx * d, sy * d, 2.8, 165, P, 10), { tone: "mid" }), 1);
  }
  put(`arm${n}`, [sx * 251, sy * 251, 150], S(G.disc(LEN - 24, LEN + 2, 18, A, P, { bevel: 0.6 }), { tone: "mid" }), 2);

  // legs: a welded truss standing in the arm's vertical plane
  const along = unit([sx, sy, 0]);
  const across = unit([sy, -sx, 0]);
  const F = G.frameOf([sx * 261, sy * 261, 0], across, along, [0, 0, 1]);
  const strut = (a, b, w) => { const [ux, uy] = unit([b[0] - a[0], b[1] - a[1]]); const [nx, ny] = [-uy * w / 2, ux * w / 2]; return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]; };
  const STRUTS = [[[-50, 165], [-10, 3], 8], [[50, 165], [10, 3], 8], [[-47, 140], [47, 140], 6], [[43, 138], [-22, 55], 6], [[-23, 58], [23, 58], 5]];
  STRUTS.forEach(([a, b, w], i) => put(`leg${n}`, [sx * 261 + along[0] * (a[0] + b[0]) / 2, sy * 261 + along[1] * (a[0] + b[0]) / 2, (a[1] + b[1]) / 2], S(G.prismOf(F, strut(a, b, w), -4, 4, P), { tone: i < 2 ? "hi" : "mid" })));
  put(`leg${n}`, [sx * 261, sy * 261, 3], S(k.cylinder(sx * 261, sy * 261, 11, 0, 5, P, 20, 0.5), { tone: "lo" }), 2);

  // motor: can, stator gap, bell, cap
  const M = vertical([mx, my, 0]);
  const bell = G.solidOf([[165, 22], [170, 24, 1], [183, 24, 1], [186, 21], [188, 10], [190, 8]], M, P);
  put(`motor${n}`, [mx, my, 156], S(G.disc(151, 160, 24, M, P), { tone: "mid", inner: L(G.arcOf(M, 155.5, 24, P), { tone: "faint" }) }), 5);
  put(`motor${n}`, [mx, my, 162], S(G.disc(160, 165, 15, M, P), { tone: "lo" }), 6);
  const ribs = G.ribsOf(M, 170, 183, 24, 22, P, { fade: [0.05, 0.5], seams: true });
  put(`motor${n}`, [mx, my, 176], S(bell, { tone: "hi", inner: k.fadedSvg(ribs.filter((r) => r.alpha !== undefined || r.d), { tone: "mid" }) }), 7);

  // prop: three blades that the film rotates as one flat group, about the motor, with an affine map of the floor plane
  const blades = [];
  const SPIN = n % 2 ? 0.45 : 1.2;
  for (let b = 0; b < 3; b++) {
    const a = SPIN + b * 2 * Math.PI / 3;
    const [ca, sa] = [Math.cos(a), Math.sin(a)];
    const shape = [[12, -6], [38, -13], [120, -10], [178, -4], [186, 0], [178, 3], [90, 7], [12, 6]];
    const ring = shape.map(([u, v]) => [mx + ca * u - sa * v, my + sa * u + ca * v]);
    const ridge = k.segment([mx + ca * 26, my + sa * 26, 193], [mx + ca * 170, my + sa * 170, 193], P);
    blades.push(S(k.extrude(ring, 191, 2, P, { bevel: 0 }), { tone: "hi", crease: "none", inner: L(ridge, { tone: "faint" }) }));
  }
  const [hx, hy] = at([mx, my, 192]);
  const disc = k.ring(mx, my, 186, 192, P, 96);
  const hub = S(G.solidOf([[190, 13], [196, 12], [199, 5], [200, 2]], M, P), { tone: "hi", lit: true });
  put(`prop${n}`, [mx, my, 195], `<path class="spin-disc" d="${disc}"/><g class="blades" data-pivot="${hx.toFixed(1)} ${hy.toFixed(1)}" data-dir="${n % 2 ? 1 : -1}">${blades.join("")}</g>${hub}`, 20);
}

function release() {
  const plate = { x: -37, y: -82, w: 74, d: 164, r: 3 };
  put("release", [0, 0, 79], S(k.slabOf(plate, 75, 4, P, 3, 0.8), { tone: "mid", inner: L(k.planOutline(k.insetPlan(plate, 4), 79, P, 3), { tone: "faint" }) }));
  for (const [x, y] of [[32, 76], [32, -77], [-32, 0], [32, 0], [-32, 76], [-32, -77]]) {
    put("release", [x, y, 100], S(k.cylinder(x, y, 3, 79, 41, P, 12), { tone: "hi" }));
  }
  const servo = { x: -1, y: -73, w: 43, d: 54, r: 2 };
  put("release", [20, -46, 90], S(k.slabOf(servo, 80, 20, P, 2, 0.7), { tone: "hi", lit: true, inner: L(k.sideSeam(servo, 90, P, 2), { tone: "faint" }) }));
  put("release", [-1, -35, 98], S(k.extrude(barRing([-3, -42], [-3, -29], 8), 84, 29, P), { tone: "mid" }));
  put("release", [-6, -19, 110], S(k.extrude(barRing([-6.5, -39], [-6.5, 1], 3), 106, 9, P), { tone: "hi" }));
  put("release", [10, 0, 92], S(k.slabOf({ x: 6, y: -12, w: 8, d: 24, r: 1 }, 79, 25, P, 2, 0.4), { tone: "mid" }));
}

function hook() {
  // the fishhook: a shank from the bracket down through the deck, bending back up to the point the ring hangs on
  const route = G.fillet([[0, 0, 120], [0, -6, 40], [0, -18, -44], [0, 2, -71], [0, 40, -56], [0, 52, -34]], 16, 7);
  const pieces = tubePieces(route, (t) => 5.5 - 3.5 * t, P, { maxLength: 36 });
  for (const piece of pieces) put("hook", piece.mid, tubeSvg(piece, { tone: "hi" }));
}

function rod() {
  const ringCentre = -173, r = 116;
  const points = [];
  for (let i = 0; i < 96; i++) points.push([Math.cos((i / 96) * 2 * Math.PI) * r, 0, ringCentre + Math.sin((i / 96) * 2 * Math.PI) * r]);
  for (const piece of tubePieces(points, 1.8, P, { closed: true, maxLength: 44 })) put("rod", piece.mid, tubeSvg(piece, { tone: "hi" }));

  const F = vertical([0, 0, -1356]);
  const s = (z) => z + 1356;
  put("rod", [0, 0, -300], S(G.solidOf([[s(-306), 13], [s(-300), 13, 1], [s(-288), 11, 1], [s(-282), 5]], F, P), { tone: "hi" }), 8);
  put("rod", [0, 0, -800], S(G.solidOf([[s(-1296), 11], [s(-296), 11]], F, P, { rims: "none" }), { tone: "mid" }));
  put("rod", [0, 0, -1320], S(G.solidOf([[s(-1356), 0.6], [s(-1286), 11]], F, P), { tone: "hi" }));

  // the sensor strip: a 12.5 mm wide spiral at 60 mm pitch, drawn only where it faces the viewer
  const V = G.viewOf(P);
  const strip = [];
  for (let z = -1286; z < -502; z += 60) {
    const run = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40, a = u * 2 * Math.PI, nz = z + u * 60;
      const n = [Math.cos(a), Math.sin(a), 0];
      if (G.dot3(n, V) > 0.04) run.push([n[0] * 11.1, n[1] * 11.1, nz]);
      else if (run.length) break;
    }
    if (run.length > 1) {
      const top = run.map(([x, y, h]) => at([x, y, h + 6.25]));
      const low = run.map(([x, y, h]) => at([x, y, h - 6.25])).reverse();
      const d = `M${[...top, ...low].map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L")}Z`;
      strip.push(`<path class="tape" d="${d}"/>`);
    }
  }
  put("rod", [0, 0, -900], `<g class="tapes">${strip.join("")}</g>`, 120);

  // the fins: the one thing in colour, as on the real rod
  const Fy = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const Fx = G.frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  put("rod", [0, -40, -360], S(G.prismOf(Fy, [[-81, -296], [-81, -330], [-11, -496], [0, -496], [0, -296]], -0.8, 0.8, P), { tone: "red", className: "ember" }), -6);
  put("rod", [0, 40, -360], S(G.prismOf(Fy, [[0, -296], [0, -496], [11, -496], [81, -330], [81, -296]], -0.8, 0.8, P), { tone: "red", className: "ember" }), 6);
  put("rod", [-20, 0, -360], S(G.prismOf(Fx, [[-47, -296], [-47, -330], [-11, -496], [0, -496], [0, -296]], -0.8, 0.8, P), { tone: "red", className: "ember" }), -5);
  put("rod", [40, 0, -360], S(G.prismOf(Fx, [[0, -296], [0, -496], [11, -496], [93, -330], [93, -296]], -0.8, 0.8, P), { tone: "red", className: "ember" }), 5);
}

frame(); board(); top(); battery(); release(); hook(); rod();
for (let n = 0; n < 4; n++) rotor(n);
items.sort((a, b) => a.key - b.key);

const view = G.viewOf(P);
const data = {
  W, H,
  floorX: screenOf([1, 0, 0]), floorY: screenOf([0, 1, 0]),
  zero: origin,
  up: screenOf([0, 0, 1]),
  moves: Object.fromEntries(Object.entries(MOVES).map(([name, m]) => [name, { s: screenOf(m), lift: G.dot3(m, view) }])),
  // where the camera looks, in sheet coordinates
  spots: {
    rotor2: at([MOTOR[0] + 105, MOTOR[1] + 105, 300]),
    heart: at([0, 0, 240]),
    fins: at([0, 0, -470]),
    strip: at([0, 0, -1050]),
    whole: at([0, 0, -330]),
  },
  scale: screenOf([1, 0, 0]) && G.scaleOf(P),
  count: items.length,
};
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
