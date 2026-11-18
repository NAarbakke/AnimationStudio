// X-12 Autonomous, 78 s investor film: the uncrewed X-12 runs down a northern Norwegian fjord in rough seas, a camera tour
// of its hull and mission fit, a sprint toward an escort group, and the detection and interception of a one-way attack drone.
// World units are metres, +y up. The fjord runs along +x; the boat model has +x to the bow, +z to starboard, waterline at y = 0.
// Everything is a pure function of film time t, so any frame renders on its own
// (x12.html?film for video/render.js, ?t=40 to preview from a given second; space pauses, arrows skip).
// Model: site/public/models/x12-autonomous.glb, copied from SystemsAnalysisTool (goldfish-x12/build.py -- --autonomous).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createStage, lin, NOISE } from '../shared/stage';

const DUR = 78, G = 9.81, DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const mix = (a, b, u) => a + (b - a) * u;
const ease = u => { u = clamp(u, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const qs = new URLSearchParams(location.search);

/** Smooth curve through keyframes [t, ...values] (cubic Hermite on uneven times), at rest at both ends. */
function keyed(keys, t) {
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1], h = b[0] - a[0], u = clamp((t - a[0]) / h, 0, 1);
  const slope = (k, n) => (k <= 0 || k >= keys.length - 1) ? 0 : (keys[k + 1][n] - keys[k - 1][n]) / (keys[k + 1][0] - keys[k - 1][0]);
  return a.slice(1).map((_, c) => {
    const n = c + 1, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * a[n] + (u3 - 2 * u2 + u) * h * slope(i, n) + (-2 * u3 + 3 * u2) * b[n] + (u3 - u2) * h * slope(i + 1, n);
  });
}

// ---------- sea: Gerstner swell, the same numbers on the CPU (boat motion) and the GPU (water surface) ----------
// Waves run mostly toward -x, so the boat heading up the fjord meets them on the bow. Each wave gives 0.1 of the 0.8 steepness budget.
const SWELL = 1.3; // rougher than the first cut: the long swell is 30 % higher, steepness unchanged
const WAVES = [[48, 0.52, 180], [31, 0.36, 160], [22, 0.26, 205], [14, 0.15, 170], [9, 0.09, 195], [6, 0.055, 150], [3.8, 0.032, 215], [2.4, 0.018, 175]]
  .map(([L, A, deg]) => [L, A * (L > 10 ? SWELL : 1), deg])
  .map(([L, A, deg], i) => { const k = 2 * Math.PI / L; return { L, k, A, w: Math.sqrt(G * k), dx: Math.cos(deg * DEG), dz: Math.sin(deg * DEG), Q: 0.8 / (k * A * 8), ph: i * 1.7 }; });
const _wd = { x: 0, y: 0, z: 0 };
function waveDisp(x, z, t, o = _wd) {
  let dx = 0, dy = 0, dz = 0;
  for (const w of WAVES) { const f = w.k * (w.dx * x + w.dz * z) - w.w * t + w.ph, c = Math.cos(f); dx += w.Q * w.A * w.dx * c; dz += w.Q * w.A * w.dz * c; dy += w.A * Math.sin(f); }
  o.x = dx; o.y = dy; o.z = dz; return o;
}
/** Sea surface height at world (x, z): undo the horizontal Gerstner shift first. */
function seaH(x, z, t) {
  let px = x, pz = z;
  for (let i = 0; i < 4; i++) { waveDisp(px, pz, t); px = x - _wd.x; pz = z - _wd.z; }
  return waveDisp(px, pz, t).y;
}
const f5 = v => v.toFixed(5);
const WAVE_GLSL = `
vec3 waveDisp(vec2 p, float dist){
  vec3 d = vec3(0.0); float f, a;
  ${WAVES.map(w => `f = ${f5(w.k)}*dot(vec2(${f5(w.dx)}, ${f5(w.dz)}), p) - ${f5(w.w)}*uTime + ${f5(w.ph)}; a = ${f5(w.A)}*(1.0 - smoothstep(${(w.L * 40).toFixed(1)}, ${(w.L * 120).toFixed(1)}, dist));
  d.xz += ${f5(w.Q)}*a*vec2(${f5(w.dx)}, ${f5(w.dz)})*cos(f); d.y += a*sin(f);`).join('\n  ')}
  return d;
}
void waveNormal(vec2 p, float dist, float fw, out vec3 n, out float jac){
  n = vec3(0.0, 1.0, 0.0); float jx = 1.0, jz = 1.0, jxz = 0.0, f, wa, c, s;
  ${WAVES.map(w => `f = ${f5(w.k)}*dot(vec2(${f5(w.dx)}, ${f5(w.dz)}), p) - ${f5(w.w)}*uTime + ${f5(w.ph)}; c = cos(f); s = sin(f);
  wa = ${f5(w.k * w.A)}*(1.0 - smoothstep(${(w.L * 40).toFixed(1)}, ${(w.L * 120).toFixed(1)}, dist))*(1.0 - smoothstep(${(w.L * 0.3).toFixed(3)}, ${(w.L * 0.9).toFixed(3)}, fw));
  n.x -= ${f5(w.dx)}*wa*c; n.z -= ${f5(w.dz)}*wa*c; n.y -= ${f5(w.Q)}*wa*s;
  jx -= ${f5(w.Q * w.dx * w.dx)}*wa*s; jz -= ${f5(w.Q * w.dz * w.dz)}*wa*s; jxz -= ${f5(w.Q * w.dx * w.dz)}*wa*s;`).join('\n  ')}
  jac = jx*jz - jxz*jxz;
}
vec3 ripples(vec2 p, float fw){
  vec3 n = vec3(0.0); float f, wa;
  ${Array.from({ length: 12 }, (_, i) => { const L = 0.3 + 1.6 * Math.pow(i / 11, 1.6), a = (190 + 70 * Math.sin(i * 2.4)) * DEG, k = 2 * Math.PI / L;
    return `f = ${f5(k)}*dot(vec2(${f5(Math.cos(a))}, ${f5(Math.sin(a))}), p) - ${f5(Math.sqrt(G * k))}*uTime + ${(i * 2.1).toFixed(2)}; wa = ${f5(0.045)}*(1.0 - smoothstep(${(L * 0.25).toFixed(3)}, ${(L * 0.8).toFixed(3)}, fw));
  n.xz -= vec2(${f5(Math.cos(a))}, ${f5(Math.sin(a))})*wa*cos(f);`; }).join('\n  ')}
  return n;
}`;

// ---------- fjord: one height function on the CPU, baked into a mesh with colours and sun visibility ----------
const perm = (() => { const r = rng(1234), p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } return Uint8Array.from([...p, ...p]); })();
const grad = (h, x, y) => { const a = h * 0.7853981634; return Math.cos(a) * x + Math.sin(a) * y; };
function noise2(x, y) {
  const X = Math.floor(x), Y = Math.floor(y), fx = x - X, fy = y - Y, xi = X & 255, yi = Y & 255;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1], ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
  return mix(mix(grad(aa, fx, fy), grad(ba, fx - 1, fy), u), mix(grad(ab, fx, fy - 1), grad(bb, fx - 1, fy - 1), u), v);
}
const fbm = (x, y, o = 5) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise2(x * f + i * 17.3, y * f - i * 9.1); f *= 2.03; a *= 0.5; } return s; };
const ridged = (x, y, o = 6) => { let s = 0, a = 0.55, f = 1, w = 1; for (let i = 0; i < o; i++) { let n = 1 - Math.abs(noise2(x * f + i * 31.7, y * f + i * 7.9)); n *= n * w; w = clamp(n * 1.6, 0, 1); s += a * n; f *= 2.07; a *= 0.48; } return s; };

const fjordC = x => 70 * Math.sin(x / 1300 + 0.5) + 0.00011 * Math.max(0, x - 2600) ** 2;  // centreline z; bends south past x = 2.6 km
const fjordW = x => 820 + 170 * Math.sin(x / 1700 + 1.2) + 120 * Math.sin(x / 640);        // half-width
const BOAT_Z = x => 0.35 * fjordC(x) + 28 * Math.sin(x / 380 + 0.4);
const JUNCTION = V3(1000, 0, fjordC(1000) - fjordW(1000) + 40);                           // where the side fjord meets the north shore
const SIDE_DIR = new THREE.Vector2(-0.25, -0.97).normalize();                              // up the side fjord, away from the main one
function landDist(x, z) {
  const wig = 55 * fbm(x / 420, z / 420, 3);
  let dm = Math.abs(z - fjordC(x)) - fjordW(x) + wig;
  dm -= 4200 * sstep(-3300, -5600, x);                                                     // out to the open sea in the west
  const rx = x - JUNCTION.x, rz = z - JUNCTION.z, along = rx * SIDE_DIR.x + rz * SIDE_DIR.y, perp = Math.abs(rx * SIDE_DIR.y - rz * SIDE_DIR.x);
  const ds = along > -400 ? perp - (240 + 0.04 * Math.max(along, 0)) + wig * 0.6 : 1e4;
  const k = 160, hh = clamp(0.5 + 0.5 * (ds - dm) / k, 0, 1);                              // smooth union of the two channels
  return mix(ds, dm, hh) - k * hh * (1 - hh);
}
function terrainH(x, z) {
  const d = landDist(x, z);
  const skerry = x < -2600 ? Math.max(0, fbm(x / 160, z / 160, 4) - 0.28) * 260 * sstep(-2600, -3400, x) : 0;
  if (d < 0) return Math.max(-45 + d * 0.05, skerry > 0 ? skerry - 8 : -1e9);
  const valley = 0.4 + 0.6 * sstep(0.12, 0.7, Math.abs(Math.sin(x / 1150 * Math.PI + 1.3 * noise2(x / 3000, z / 3000))));
  const rg = ridged(x / 2300, z / 2300), pk = ridged(x / 900 + 11, z / 900 - 4, 4);
  const M = (300 + 820 * Math.pow(rg, 1.25) + 260 * pk * rg) * valley * (1 - 0.75 * sstep(-3000, -5200, x));
  const rise = Math.pow(1 - Math.exp(-d / 280), 0.85);
  return 2 + M * rise + 40 * fbm(x / 230, z / 230, 4) * rise + Math.min(d * 0.25, 6) + skerry;
}

// ---------- boat track: speed profile, heading from the track, heave/pitch/roll from the sea under the hull ----------
const X0 = -760;
const SPEED = w => w < 5.5 ? 21 : w < 12 ? mix(21, 7, sstep(5.5, 12, w)) : w < 46 ? 7 : w < 69 ? mix(7, 23.5, sstep(46, 51.5, w)) : mix(23.5, 15, sstep(69, 76, w));
const DW = 1 / 60, NP = Math.ceil((DUR + 2) / DW) + 2;
const BOAT = (() => {
  const P = { x: new Float64Array(NP), y: new Float32Array(NP), z: new Float64Array(NP), yaw: new Float32Array(NP), pitch: new Float32Array(NP), roll: new Float32Array(NP), v: new Float32Array(NP), bowV: new Float32Array(NP) };
  let s = 0;
  const raw = { h: new Float32Array(NP), p: new Float32Array(NP), r: new Float32Array(NP) };
  for (let i = 0; i < NP; i++) {
    const w = i * DW;
    if (i) s += SPEED(w - DW / 2) * DW;
    const x = X0 + s, z = BOAT_Z(x), dz = (BOAT_Z(x + 0.5) - BOAT_Z(x - 0.5));
    const yaw = Math.atan2(dz, 1) + 0.025 * Math.sin(0.6 * w) + 0.012 * Math.sin(1.7 * w + 1);
    P.x[i] = x; P.z[i] = z; P.yaw[i] = yaw; P.v[i] = SPEED(w);
    const c = Math.cos(yaw), sn = Math.sin(yaw), at = (fx, fz) => seaH(x + c * fx - sn * fz, z + sn * fx + c * fz, w);
    const hb = at(4.2, 0), hs = at(-4.6, 0), hp = at(0, -1.6), hst = at(0, 1.6);
    raw.h[i] = (hb + hs + hp + hst) / 4; raw.p[i] = Math.atan2(hb - hs, 8.8); raw.r[i] = -Math.atan2(hst - hp, 3.2);
  }
  // the hull's inertia: a short gaussian on the sea it sits on; at speed it skims the short waves and pitches harder on the long ones
  const smooth = (a, sig) => { const R = Math.ceil(sig * 3 / DW), ker = Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-(((k - R) * DW) ** 2) / (2 * sig * sig))), out = new Float32Array(NP);
    for (let i = 0; i < NP; i++) { let sum = 0, ws = 0; for (let k = -R; k <= R; k++) { const j = clamp(i + k, 0, NP - 1); sum += a[j] * ker[k + R]; ws += ker[k + R]; } out[i] = sum / ws; } return out; };
  const h = smooth(raw.h, 0.16), p = smooth(raw.p, 0.17), r = smooth(raw.r, 0.26);
  for (let i = 0; i < NP; i++) {
    const v = P.v[i], plane = sstep(9, 19, v), yr = (P.yaw[Math.min(i + 1, NP - 1)] - P.yaw[Math.max(i - 1, 0)]) / (2 * DW);
    P.y[i] = h[i] * 0.95 + 0.18 * plane - 0.16;
    P.pitch[i] = p[i] * (0.85 + 0.35 * plane) + (4.2 * sstep(4, 10, v) - 1.8 * sstep(12, 22, v)) * DEG;
    P.roll[i] = r[i] * 0.75 - yr * v * 0.03;
  }
  // the transom's buoyancy: wherever a crest would climb the outboards, lift the hull and trim the stern up, smoothly
  for (let pass = 0; pass < 3; pass++) {
    const ex = new Float32Array(NP);
    for (let i = 0; i < NP; i++) {
      const c = Math.cos(P.yaw[i]), sn = Math.sin(P.yaw[i]), w = i * DW;
      const hw = seaH(P.x[i] - c * 5.9, P.z[i] - sn * 5.9, w);
      ex[i] = Math.max(0, hw - (P.y[i] - 5.9 * Math.sin(P.pitch[i])) - 0.18);
    }
    const R = Math.round(0.25 / DW), mx = new Float32Array(NP);
    for (let i = 0; i < NP; i++) { let m = 0; for (let k = -R; k <= R; k++) m = Math.max(m, ex[clamp(i + k, 0, NP - 1)]); mx[i] = m; }
    const e = smooth(mx, 0.12);
    for (let i = 0; i < NP; i++) { P.y[i] += 0.6 * e[i]; P.pitch[i] -= 0.45 * e[i] / 5.9; }
  }
  for (let i = 0; i < NP; i++) { const a = Math.max(0, i - 2), b = Math.min(NP - 1, i + 2); P.bowV[i] = ((P.y[b] + 4 * Math.sin(P.pitch[b])) - (P.y[a] + 4 * Math.sin(P.pitch[a]))) / ((b - a) * DW); }
  return P;
})();
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _one = V3(1, 1, 1), _v = V3(), _m = new THREE.Matrix4();
/** Boat state at world time w: position, quaternion, matrix, level heading basis Fh/Rh, speed. `soft` scales pitch and roll. */
function boatAt(w, o = {}, soft = 1) {
  const f = clamp(w / DW, 0, NP - 2), i = Math.floor(f), k = f - i, L = a => mix(a[i], a[i + 1], k);
  const yaw = L(BOAT.yaw);
  o.pos = (o.pos || V3()).set(L(BOAT.x), L(BOAT.y), L(BOAT.z));
  o.q = (o.q || new THREE.Quaternion()).setFromEuler(_e.set(L(BOAT.roll) * soft, -yaw, L(BOAT.pitch) * soft, 'YZX'));
  o.m = (o.m || new THREE.Matrix4()).compose(o.pos, o.q, _one);
  o.Fh = (o.Fh || V3()).set(Math.cos(yaw), 0, Math.sin(yaw));
  o.Rh = (o.Rh || V3()).set(-Math.sin(yaw), 0, Math.cos(yaw));
  o.v = L(BOAT.v); o.bowV = L(BOAT.bowV); o.yaw = yaw;
  o.vel = (o.vel || V3()).copy(o.Fh).multiplyScalar(o.v);
  return o;
}
const B = boatAt(0), Bc = boatAt(0);
const toWorld = (S, x, y, z, out = V3()) => out.set(x, y, z).applyMatrix4(S.m);

// ---------- the escort group and the threat ----------
const SHIPS = [
  { kind: 'cargo', L: 86, B: 14, dx: 0, dz: 40 },
  { kind: 'patrol', L: 58, B: 9.5, dx: 190, dz: -150 },
  { kind: 'supply', L: 48, B: 11, dx: -210, dz: 170 },
];
const CONVOY_X = t => 1200 + 6.5 * (t - 60);
const shipPos = (s, t, out = V3()) => { const x = CONVOY_X(t) + s.dx; return out.set(x, 0, 0.35 * fjordC(x) + s.dz); };

const VD = 52, T_PASS = 64, T_DET = 53.6, T_TRK = 55.2, T_ID = 58.4, T_L = 61.2, T_I = 65.2;
const DIR_IN = (() => { const c = shipPos(SHIPS[0], 72); return V3(c.x - JUNCTION.x, 0, c.z - JUNCTION.z).normalize(); })();
const SIDE3 = V3(-DIR_IN.z, 0, DIR_IN.x);
const droneAt = (t, out = V3()) => out.copy(JUNCTION).addScaledVector(DIR_IN, (t - T_PASS) * VD).addScaledVector(SIDE3, 6 * Math.sin(t * 0.7)).setY(46 + 3 * Math.sin(t * 0.55) - 0.6 * (t - 50));
const I_PT = droneAt(T_I);

// ---------- stage ----------
const canvas = document.getElementById('c');
const st = createStage(canvas, document.body, { depth24: true });
if (!st) { document.getElementById('err').hidden = false; throw new Error('WebGL unavailable'); }
const { renderer, scene, camera, controls } = st;
controls.enabled = false;
camera.near = 0.05; camera.far = 24000; camera.updateProjectionMatrix();
scene.background = null;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
st.bloom.strength = 0.32; st.bloom.threshold = 0.92;

const SUN = V3(-0.42, 0.40, 0.81).normalize();
const SUN_COL = lin(0xffe2bf);
const FOG = new THREE.Color(0.46, 0.52, 0.58), FOG_D = 0.000105;
scene.fog = new THREE.FogExp2(FOG, FOG_D);
const shared = { uSun: { value: SUN }, uTime: { value: 0 } };
const SKY_GLSL = `
uniform vec3 uSun;
vec3 skyBase(vec3 d){
  float e = clamp(d.y, 0.0, 1.0), mu = max(dot(d, uSun), 0.0);
  vec3 col = mix(vec3(0.46, 0.52, 0.58), vec3(0.12, 0.2, 0.34), pow(e, 0.55));
  col += vec3(1.0, 0.72, 0.46)*pow(mu, 6.0)*0.45*(1.0 - 0.6*e);
  col += vec3(1.0, 0.88, 0.7)*pow(mu, 120.0)*1.4;
  if (d.y < 0.0) col = mix(vec3(0.46, 0.52, 0.58), vec3(0.1, 0.13, 0.16), clamp(-d.y*5.0, 0.0, 1.0));
  return col;
}`;

const sun = new THREE.DirectionalLight(SUN_COL, 3.0);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035;
const hemi = new THREE.HemisphereLight(lin(0xa9bdd6), lin(0x1d2a33), 0.75);
scene.add(sun, sun.target, hemi);
function shadowAt(focus, size) {
  sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(SUN, 200);
  const c = sun.shadow.camera; c.left = c.bottom = -size; c.right = c.top = size; c.near = 1; c.far = 500; c.updateProjectionMatrix();
}

const skyMat = new THREE.ShaderMaterial({
  uniforms: shared, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
  fragmentShader: NOISE + SKY_GLSL + `uniform float uTime; varying vec3 vDir;
    float cfbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a*snoise(vec3(p, uTime*0.004 + float(i)*3.1)); p = p*2.07 + 1.3; a *= 0.5; } return s; }
    void main(){ vec3 d = normalize(vDir); vec3 c = skyBase(d);
      if (d.y > 0.0) {
        vec2 uv = d.xz/(d.y + 0.1)*0.9 + vec2(uTime*0.002, 0.0);
        float n = cfbm(uv), nl = cfbm(uv + uSun.xz*0.18);
        float cover = smoothstep(-0.12, 0.38, n)*smoothstep(0.0, 0.12, d.y);
        float lit = clamp(0.55 + (n - nl)*2.2, 0.0, 1.0);
        vec3 cc = mix(vec3(0.24, 0.27, 0.31), vec3(0.86, 0.84, 0.8), lit);
        cc += vec3(1.0, 0.7, 0.45)*pow(max(dot(d, uSun), 0.0), 8.0)*0.6*lit;
        c = mix(c, cc, cover*0.92);
      }
      float mu = dot(d, uSun); c += vec3(1.0, 0.92, 0.8)*smoothstep(0.99985, 0.99993, mu)*20.0;
      c += (fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5)*0.01; gl_FragColor = vec4(c, 1.0); }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 48, 24), skyMat);
sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
{
  const envSky = new THREE.ShaderMaterial({ uniforms: shared, side: THREE.BackSide, vertexShader: skyMat.vertexShader,
    fragmentShader: SKY_GLSL + `varying vec3 vDir; void main(){ vec3 d = normalize(vDir); gl_FragColor = vec4(mix(skyBase(d), vec3(0.5, 0.52, 0.55), 0.35*step(0.0, d.y)), 1.0); }` });
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envSky));
  const sea = new THREE.Mesh(new THREE.CircleGeometry(90, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.05, 0.06) }));
  sea.position.y = -1; envScene.add(sea);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0, 0.1, 1000).texture;
}

// ---------- terrain mesh ----------
const TER = { x0: -7200, x1: 6800, z0: -6200, z1: 6200, step: 18 };
const terrain = (() => {
  const nx = Math.round((TER.x1 - TER.x0) / TER.step) + 1, nz = Math.round((TER.z1 - TER.z0) / TER.step) + 1;
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = terrainH(TER.x0 + i * TER.step, TER.z0 + j * TER.step);
  const hAt = (x, z) => { const fi = clamp((x - TER.x0) / TER.step, 0, nx - 1.001), fj = clamp((z - TER.z0) / TER.step, 0, nz - 1.001), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    return mix(mix(H[j * nx + i], H[j * nx + i + 1], u), mix(H[(j + 1) * nx + i], H[(j + 1) * nx + i + 1], u), v); };
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), vis = new Float32Array(nx * nz);
  const sh = Math.hypot(SUN.x, SUN.z), sx = SUN.x / sh, sz = SUN.z / sh, tanE = SUN.y / sh;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = TER.x0 + i * TER.step, z = TER.z0 + j * TER.step, h = H[k];
    pos.set([x, h, z], k * 3);
    // sun visibility: march toward the sun over the height grid, soft at the edge of the shadow
    let m = 1e9;
    if (h > -5) for (let d = 30; d < 5000; d *= 1.06) { const ry = h + 2 + d * tanE; if (ry > 1700) break; m = Math.min(m, ry - hAt(x + sx * d, z + sz * d)); if (m < -40) break; }
    vis[k] = sstep(-30, 20, m);
    // ground cover from height and slope: heath and birch low down, bare rock on the steep faces, snow above a ragged line
    const gx = (H[j * nx + Math.min(i + 1, nx - 1)] - H[j * nx + Math.max(i - 1, 0)]) / (2 * TER.step), gz = (H[Math.min(j + 1, nz - 1) * nx + i] - H[Math.max(j - 1, 0) * nx + i]) / (2 * TER.step);
    const ny = 1 / Math.hypot(gx, gz, 1), n1 = fbm(x / 300, z / 300, 4), n2 = fbm(x / 60, z / 60, 3);
    const veg = (1 - sstep(120 + 70 * n1, 300, h)) * sstep(0.6, 0.8, ny);
    const forest = veg * (1 - sstep(40, 160 + 40 * n2, h)) * sstep(0.0, 0.3, n1 + 0.2);
    const t = 0.8 + 0.35 * n2;
    let r = 0.034 * t, g = 0.036 * t, b = 0.04 * t;                                                    // granite and gneiss
    r = mix(r, 0.036 * t, veg); g = mix(g, 0.037 * t, veg); b = mix(b, 0.026 * t, veg);                 // heath
    r = mix(r, 0.016, forest); g = mix(g, 0.027, forest); b = mix(b, 0.013, forest);                     // birch
    if (h < 7) { const wet = 1 - sstep(1, 7, h); r = mix(r, 0.022, wet); g = mix(g, 0.024, wet); b = mix(b, 0.022, wet); }
    col.set([r, g, b], k * 3);
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let n = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.set([a, c, b, b, c, d], n); n += 6; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('sunVis', new THREE.BufferAttribute(vis, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = s => {
    s.vertexShader = 'attribute float sunVis; varying float vSunVis; varying vec3 vTW; varying vec3 vWN;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSunVis = sunVis; vTW = (modelMatrix*vec4(position, 1.0)).xyz; vWN = objectNormal;');
    s.fragmentShader = 'varying float vSunVis; varying vec3 vTW; varying vec3 vWN;\n' + NOISE + '\n' + s.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // crags, ledges and gullies as a bump on the 18 m mesh, then snow wherever a ledge holds it
          vec3 p = vTW;
          float fw = length(fwidth(p));                      // metres per pixel: fade each octave before it aliases
          float r1 = 1.0 - abs(snoise(p*vec3(0.011, 0.014, 0.011)));
          float r2 = 1.0 - abs(snoise(p*vec3(0.035, 0.045, 0.035) + 3.0));
          float h = 9.0*r1*r1*(1.0 - smoothstep(12.0, 45.0, fw))
                  + 3.0*r2*r2*(1.0 - smoothstep(4.0, 14.0, fw))
                  + 0.8*snoise(p*0.16)*(1.0 - smoothstep(0.8, 3.0, fw))
                  + 0.25*snoise(p*0.55)*(1.0 - smoothstep(0.25, 0.9, fw));
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), R1 = cross(sy, normal), R2 = cross(normal, sx);
          float det = dot(sx, R1);
          vec3 gr = sign(det)*(dFdx(h)*R1 + dFdy(h)*R2);
          normal = normalize(abs(det)*normal - gr*0.9);
          vec3 wn = normalize((vec4(normal, 0.0)*viewMatrix).xyz);
          float n = snoise(p*0.004)*0.6 + snoise(p*0.02)*0.3 + snoise(p*0.08)*0.1;
          float rockTone = 0.75 + 0.4*mix(r2, 0.6, smoothstep(4.0, 14.0, fw)) + 0.15*snoise(p*vec3(0.02, 0.07, 0.02))*(1.0 - smoothstep(1.5, 5.0, fw));
          diffuseColor.rgb *= rockTone;
          float gy = normalize(vWN).y, ny = mix(gy, wn.y, 0.35);
          float line = 240.0 + 130.0*n;
          float snow = smoothstep(line - 70.0, line + 50.0, p.y)*smoothstep(0.52, 0.72, ny + 0.06*r2);
          snow = max(snow, smoothstep(130.0, 240.0, p.y)*smoothstep(0.8, 0.9, gy)*smoothstep(0.0, 0.35, n + 0.25));
          snow *= 1.0 - 0.35*smoothstep(0.6, 1.0, r2)*(1.0 - smoothstep(4.0, 14.0, fw));   // dark rock ribs poke through
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.81, 0.86)*(0.92 + 0.08*r2), clamp(snow, 0.0, 1.0));
        }`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, geometry, directLight );', 'getDirectionalLightInfo( directionalLight, geometry, directLight ); directLight.color *= vSunVis;'));
  };
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; scene.add(mesh);
  return { mesh, hAt };
})();
// a far ring of ranges beyond the mesh, open to the sea in the west, mostly fog
{
  const segs = 360, rings = 6, pos = [], idx = [], r = rng(9);
  const ph = Array.from({ length: 6 }, () => r() * 6.28);
  for (let j = 0; j <= rings; j++) for (let i = 0; i <= segs; i++) {
    const a = i / segs * Math.PI * 2, u = j / rings, rad = mix(7600, 13000, u);
    const west = sstep(0.35, 0.8, -Math.cos(a));
    const h = (500 + 380 * Math.sin(3 * a + ph[0]) * Math.sin(7 * a + ph[1]) + 220 * Math.sin(13 * a + ph[2]) + 90 * Math.sin(29 * a + ph[3])) * Math.sin(Math.PI * Math.min(1, u * 1.4)) * (1 - 0.9 * west);
    pos.push(Math.cos(a) * rad, Math.max(-20, h), Math.sin(a) * rad);
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) { const a = j * (segs + 1) + i, b = a + segs + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: new THREE.Color(0.12, 0.13, 0.15) })));
}

// ---------- water: a polar grid round the camera, Gerstner in the vertex shader, wake and foam in the fragment shader ----------
const TRAIL_N = 44, TRAIL_DT = 0.45;
const beamTex = new THREE.DataTexture(new Float32Array(128), 128, 1, THREE.RedFormat, THREE.FloatType); beamTex.needsUpdate = true;
const waterU = {
  ...shared, uCam: { value: V3() }, uFogD: { value: FOG_D }, uFog: { value: FOG },
  uBoatInv: { value: new THREE.Matrix4() }, uBoatV: { value: 0 }, uBeam: { value: beamTex },
  uTrail: { value: Array.from({ length: TRAIL_N }, () => new THREE.Vector4()) },
  uShips: { value: Array.from({ length: 3 }, () => new THREE.Vector4()) }, uShipD: { value: Array.from({ length: 3 }, () => new THREE.Vector2()) },
  uSplash: { value: new THREE.Vector4(0, 0, -1, 0) },
};
const water = (() => {
  const rings = 300, segs = 512, pos = new Float32Array((rings + 1) * (segs + 1) * 3), idx = [];
  for (let j = 0; j <= rings; j++) { const r = 0.34 * (Math.pow(1.0345, j) - 1); for (let i = 0; i <= segs; i++) { const a = i / segs * 2 * Math.PI; pos.set([Math.cos(a) * r, 0, Math.sin(a) * r], (j * (segs + 1) + i) * 3); } }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) { const a = j * (segs + 1) + i, b = a + segs + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    uniforms: waterU, fog: false,
    vertexShader: `uniform float uTime; uniform vec3 uCam; varying vec3 vWP; varying vec2 vP0; varying float vDist;
      ${WAVE_GLSL}
      void main(){
        vec2 p0 = position.xz + uCam.xz; float dist = length(position.xz);
        vec3 d = waveDisp(p0, dist);
        vWP = vec3(p0.x + d.x, d.y, p0.y + d.z); vP0 = p0; vDist = dist;
        gl_Position = projectionMatrix*viewMatrix*vec4(vWP, 1.0);
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uCam; uniform float uFogD; uniform vec3 uFog; uniform mat4 uBoatInv; uniform float uBoatV; uniform sampler2D uBeam;
      uniform vec4 uTrail[${TRAIL_N}]; uniform vec4 uShips[3]; uniform vec2 uShipD[3]; uniform vec4 uSplash;
      varying vec3 vWP; varying vec2 vP0; varying float vDist;
      ${NOISE}
      ${SKY_GLSL}
      ${WAVE_GLSL}
      float sq(float x){ return x*x; }
      float beamAt(float x){ return texture2D(uBeam, vec2(clamp((x + 6.2)/12.4, 0.0, 1.0), 0.5)).r; }
      void main(){
        // inside the hull's waterplane the sea is the boat's business: don't draw water over the cockpit sole
        vec3 lp = (uBoatInv*vec4(vWP, 1.0)).xyz;
        float bw = beamAt(lp.x), edge = abs(lp.z) - bw;
        bool inFoot = lp.x > -6.0 && lp.x < 6.1 && edge < -0.04;
        float hullBot = mix(-0.45, 0.02, clamp(abs(lp.z)/1.4, 0.0, 1.0)) + 0.14*sq(max(lp.x - 2.5, 0.0)) + 0.05;
        if (inFoot && lp.y > hullBot && lp.y < 1.0) discard;
        float under = inFoot ? 1.0 : exp(-sq(max(edge, 0.0)/0.5))*step(-6.0, lp.x)*step(lp.x, 6.1);

        float fw = length(fwidth(vP0));
        vec3 n; float jac; waveNormal(vP0, vDist, fw, n, jac);
        n = normalize(n + ripples(vP0, fw));
        vec3 V = normalize(cameraPosition - vWP);
        float cosv = max(dot(n, V), 0.0), fres = 0.02 + 0.98*pow(1.0 - cosv, 5.0);
        vec3 R = reflect(-V, n); R.y = abs(R.y);
        vec3 refl = mix(skyBase(R), vec3(0.42, 0.45, 0.5), 0.3);
        // the fjord walls fill the low reflections across the fjord
        float wall = (0.05 + 0.3*smoothstep(0.25, 0.95, abs(R.z)))*(1.0 - smoothstep(-5200.0, -3200.0, vWP.x)*0.8);
        refl = mix(refl, vec3(0.06, 0.068, 0.078), (1.0 - smoothstep(0.0, wall*1.8, R.y))*0.7);
        float spec = pow(max(dot(R, uSun), 0.0), 900.0)*24.0 + pow(max(dot(R, uSun), 0.0), 80.0)*0.35;
        float crest = clamp(vWP.y*0.55 + 0.45, 0.0, 1.0);
        float back = pow(max(dot(-V, uSun)*0.5 + 0.5, 0.0), 3.0);
        vec3 body = vec3(0.004, 0.016, 0.022) + vec3(0.012, 0.06, 0.055)*crest*(0.35 + 1.4*back*crest);
        vec3 col = mix(body*(0.6 + 0.6*max(uSun.y, 0.0)), refl, fres) + vec3(1.0, 0.9, 0.75)*spec;
        col *= 1.0 - 0.6*under;

        // foam: breaking crests, the boat's wake and hull, the escorts' wakes
        float fn = snoise(vec3(vP0*0.35, uTime*0.15))*0.5 + snoise(vec3(vP0*1.4, uTime*0.3))*0.3 + snoise(vec3(vP0*5.0, uTime*0.5))*0.2;
        float cap = smoothstep(0.62, 0.25, jac)*smoothstep(0.1, 0.4, crest);
        float wk = 0.0, wakeArm = 0.0;
        for (int i = 0; i < ${TRAIL_N - 1}; i++) {
          vec4 a = uTrail[i], b = uTrail[i + 1];
          if (b.z < 0.0) break;
          vec2 ab = b.xy - a.xy, ap = vWP.xz - a.xy; float L2 = max(dot(ab, ab), 1e-4);
          float ur = dot(ap, ab)/L2, u = clamp(ur, 0.0, 1.0); vec2 q = a.xy + ab*u; float dist = length(vWP.xz - q);
          float inside = step(-0.02, ur)*step(ur, 1.02);
          float age = mix(a.z, b.z, u), spd = mix(a.w, b.w, u);
          float width = 1.1 + 0.35*age + 0.02*spd*age;
          wk = max(wk, exp(-sq(dist/width))*exp(-age/(3.0 + 0.22*spd))*clamp(spd/16.0, 0.12, 1.0));
          float arm = 1.4 + age*spd*0.33;
          wakeArm = max(wakeArm, inside*exp(-sq((dist - arm)/(0.6 + 0.15*age)))*exp(-age/4.0)*clamp((spd - 4.0)/10.0, 0.0, 1.0));
        }
        // foam hugging the hull, a little wider at speed, streaking aft
        float along = smoothstep(-6.2, -4.5, lp.x)*smoothstep(6.3, 4.8, lp.x);
        float hull = exp(-sq(max(edge, 0.0)/(0.28 + 0.025*uBoatV)))*(0.4 + 0.5*clamp(uBoatV/15.0, 0.0, 1.0))*along;
        float streak = 0.5 + 0.5*snoise(vec3(lp.x*0.25, abs(lp.z)*3.0, uTime*0.4));
        float bowSpray = exp(-sq(max(edge, 0.0)/(0.35 + 0.05*uBoatV)))*clamp((uBoatV - 6.0)/12.0, 0.0, 1.0)*smoothstep(-1.0, 2.0, lp.x)*smoothstep(6.3, 4.5, lp.x)*streak;
        float sw = 0.0;
        for (int i = 0; i < 3; i++) {
          vec2 d = uShipD[i], rel = vWP.xz - uShips[i].xy; float L = uShips[i].z, Bm = uShips[i].w;
          float along = dot(rel, d), side = abs(d.x*rel.y - d.y*rel.x), behind = -(along + L*0.5);
          float inHull = 1.0 - smoothstep(0.0, 2.5, side - Bm*0.5*sqrt(max(0.0, 1.0 - sq(max(along, 0.0)/(L*0.5)))));
          sw = max(sw, inHull*smoothstep(L*0.5 + 4.0, L*0.3, abs(along))*0.6);
          if (behind > 0.0) {
            sw = max(sw, exp(-sq(side/(Bm*0.55 + behind*0.05)))*exp(-behind/260.0)*0.9);
            sw = max(sw, exp(-sq((side - Bm*0.5 - behind*0.34)/(1.5 + behind*0.03)))*exp(-behind/180.0)*0.55);
          }
        }
        float spl = 0.0;
        if (uSplash.z >= 0.0) spl = exp(-sq(length(vWP.xz - uSplash.xy)/18.0))*exp(-uSplash.z/3.0);
        float foamAmt = max(max(cap*0.85, wk), max(wakeArm*0.8, max(hull, bowSpray)));
        foamAmt = max(foamAmt, max(sw, spl*0.8));
        float foam = smoothstep(0.15, 0.75, foamAmt*(0.65 + 0.7*fn) + foamAmt*0.25);
        foam = mix(foam, foamAmt*0.6, smoothstep(0.3, 3.0, fw));                   // far off, foam is a tone, not a pattern
        vec3 foamCol = vec3(0.78, 0.82, 0.85)*(0.55 + 0.6*max(dot(n, uSun), 0.0));
        col = mix(col, foamCol, foam);

        float fd = length(vWP - cameraPosition);
        float fogF = 1.0 - exp(-sq(uFogD*fd));
        col = mix(col, uFog, fogF);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  m.extensions = { derivatives: true };
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 1; scene.add(mesh);
  return mesh;
})();

// ---------- particles: spray, smoke and fire, all rebuilt every frame from the clock ----------
function layer(max, additive) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(max), 1));
  g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(max * 4), 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 }, uFogD: { value: FOG_D }, uFog: { value: FOG } }, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `uniform float uScale; attribute float aSize; attribute vec4 aCol; varying vec4 vCol; varying float vFog;
      void main(){ vec4 mv = modelViewMatrix*vec4(position, 1.0); gl_Position = projectionMatrix*mv; vCol = aCol;
        gl_PointSize = min(aSize*uScale/max(-mv.z, 0.05), 1400.0); vFog = 1.0 - exp(-pow(${FOG_D}*length(mv.xyz), 2.0)); }`,
    fragmentShader: `uniform vec3 uFog; varying vec4 vCol; varying float vFog;
      void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c)*2.0; if (r > 1.0) discard;
        float a = pow(1.0 - r*r, 1.6);
        ${additive ? 'gl_FragColor = vec4(vCol.rgb*vCol.a*a*(1.0 - vFog), 1.0);' : 'gl_FragColor = vec4(mix(vCol.rgb, uFog, vFog), vCol.a*a);'} }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = additive ? 4 : 3; scene.add(pts);
  const P = g.attributes.position.array, S = g.attributes.aSize.array, C = g.attributes.aCol.array;
  const L = { pts, n: 0, max, list: [],
    push(x, y, z, size, r, gg, b, a) { if (this.n < max && a > 0.002) { this.list.push([x, y, z, size, r, gg, b, a]); this.n++; } },
    flush(sort) {
      if (sort) { const cp = camera.position; this.list.sort((p, q) => ((q[0] - cp.x) ** 2 + (q[1] - cp.y) ** 2 + (q[2] - cp.z) ** 2) - ((p[0] - cp.x) ** 2 + (p[1] - cp.y) ** 2 + (p[2] - cp.z) ** 2)); }
      this.list.forEach((p, i) => { P[i * 3] = p[0]; P[i * 3 + 1] = p[1]; P[i * 3 + 2] = p[2]; S[i] = p[3]; C[i * 4] = p[4]; C[i * 4 + 1] = p[5]; C[i * 4 + 2] = p[6]; C[i * 4 + 3] = p[7]; });
      g.setDrawRange(0, this.list.length);
      g.attributes.position.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aCol.needsUpdate = true;
      mat.uniforms.uScale.value = st.size()[1] * st.pr() * 0.5 / Math.tan(camera.fov * DEG / 2);
      this.list.length = 0; this.n = 0;
    } };
  return L;
}
const sprayL = layer(6000, false), smokeL = layer(5000, false), fireL = layer(600, true);

const SPRAY = (() => {
  const r = rng(41), list = [];
  for (let i = 0; i < 2600; i++) list.push({ kind: 'bow', life: 0.9 + 0.7 * r(), ph: r(), s: [r(), r(), r(), r(), r()] });
  for (let i = 0; i < 1500; i++) list.push({ kind: 'tail', life: 1.2 + 0.8 * r(), ph: r(), s: [r(), r(), r(), r(), r()] });
  return list;
})();
const _sb = {}, _p = V3(), _d = V3();
function emitSpray(w) {
  for (const p of SPRAY) {
    const birth = Math.floor((w - p.ph * p.life) / p.life) * p.life + p.ph * p.life, age = w - birth;
    if (birth < 0) continue;
    boatAt(birth, _sb);
    const v = _sb.v, slam = clamp(-_sb.bowV / 2.5, 0, 1.4), s = p.s;
    let amt, life = p.life;
    if (p.kind === 'bow') {
      amt = sstep(9, 20, v) * 0.8 + slam * mix(0.25, 0.8, sstep(6, 16, v));
      if (amt < 0.02 || s[4] > amt) continue;
      const side = s[0] < 0.5 ? -1 : 1, lx = mix(0.8, 3.8, s[1]);
      toWorld(_sb, lx, mix(-0.05, 0.25, s[2]), side * 1.78 * Math.sqrt(1 - (lx / 6.3) ** 2), _p);
      const out = mix(1.2, 3.5, s[2]) + 0.16 * v, up = mix(0.6, 2.2, s[3]) + 0.09 * v + slam * 1.6;
      _d.copy(_sb.Rh).multiplyScalar(side * out).addScaledVector(_sb.Fh, v * 0.55 + (s[1] - 0.5) * 2).setY(up);
    } else {
      amt = sstep(11, 21, v);
      if (amt < 0.02 || s[4] > amt) continue;
      toWorld(_sb, -6.35, -0.05, [-0.74, 0, 0.74][Math.floor(s[0] * 3)], _p);
      _d.copy(_sb.Fh).multiplyScalar(v * mix(0.35, 0.75, s[1])).addScaledVector(_sb.Rh, (s[2] - 0.5) * 3).setY(mix(3.0, 7.5, s[3]) * (0.3 + 0.7 * sstep(11, 21, v)));
      life *= 1.2;
    }
    const drag = 1.1, tr = (1 - Math.exp(-drag * age)) / drag;
    const x = _p.x + _d.x * tr, z = _p.z + _d.z * tr, y = _p.y + _d.y * tr - 0.5 * G * age * age * 0.8;
    const sea = seaH(x, z, w);
    if (y < sea - 0.1) continue;
    const u = age / life, a = (p.kind === 'bow' ? 0.26 : 0.2) * Math.min(1, amt) * Math.pow(1 - u, 1.4) * sstep(0, 0.05, age);
    const size = (p.kind === 'bow' ? 0.06 : 0.08) + age * (p.kind === 'bow' ? 0.22 + 0.025 * v : 0.55);
    const lit = 0.8 + 0.25 * s[2];
    sprayL.push(x, y, z, size, 0.86 * lit, 0.9 * lit, 0.93 * lit, a);
  }
}

// ---------- boat ----------
const BOATG = { root: new THREE.Group(), parts: {}, hi: {}, nav: null, gim: null, gimB: null, launchers: {} };
BOATG.root.matrixAutoUpdate = false; scene.add(BOATG.root);
const HI_COL = lin(0xffb35c);
function addHighlight(mat, u) {
  mat.onBeforeCompile = s => {
    s.uniforms.uHi = u;
    s.fragmentShader = 'uniform float uHi;\n' + s.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      { float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.5);
        gl_FragColor.rgb += vec3(${HI_COL.r.toFixed(3)}, ${HI_COL.g.toFixed(3)}, ${HI_COL.b.toFixed(3)})*uHi*(0.015 + 1.4*rim*rim*rim); }`);
  };
  mat.customProgramCacheKey = () => 'hi';
}
/** Split a part's meshes into pieces by a triangle test in its own coordinates; returns [{geometry, material}] per side. */
function splitMeshes(node, toLocal, test) {
  const out = [[], []];
  node.updateMatrixWorld(true);
  const meshes = []; node.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const mesh of meshes) {
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
    const sides = [[], []], nrm = [[], []], uvs = [[], []];
    const a = V3(), b = V3(), c = V3(), na = V3(), m3 = new THREE.Matrix3();
    const toL = toLocal.clone().multiply(mesh.matrixWorld); m3.getNormalMatrix(toL);
    for (let i = 0; i < P.count; i += 3) {
      a.fromBufferAttribute(P, i).applyMatrix4(toL); b.fromBufferAttribute(P, i + 1).applyMatrix4(toL); c.fromBufferAttribute(P, i + 2).applyMatrix4(toL);
      const k = test(mesh, _v.copy(a).add(b).add(c).divideScalar(3)) ? 1 : 0;
      sides[k].push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      for (let j = 0; j < 3; j++) { na.fromBufferAttribute(N, i + j).applyMatrix3(m3).normalize(); nrm[k].push(na.x, na.y, na.z); if (UV) uvs[k].push(UV.getX(i + j), UV.getY(i + j)); }
    }
    for (let k = 0; k < 2; k++) if (sides[k].length) {
      const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(sides[k], 3)); ng.setAttribute('normal', new THREE.Float32BufferAttribute(nrm[k], 3));
      if (UV) ng.setAttribute('uv', new THREE.Float32BufferAttribute(uvs[k], 2));
      out[k].push({ geometry: ng, material: mesh.material });
    }
  }
  return out;
}
const GROUPS = {
  hull: ['Hull', 'Tube collar', 'Foredeck', 'Aft deck', 'Cockpit'],
  prop: ['Outboard (port)', 'Outboard (centre)', 'Outboard (starboard)', 'Engine bracket'],
  mast: ['Sensor mast', 'Surveillance radar arrays', 'Navigation radar'],
  percep: ['Lidar units', 'Panoramic cameras', 'Bow sensor pod'],
  eoir: ['EO/IR gimbal'],
  auto: ['Mission electronics bay', 'SATCOM terminal', 'Comms and GNSS antennas'],
  ad: ['Launcher deck', 'Air defence launcher (port)', 'Air defence launcher (starboard)'],
};
const LAUNCH = { port: { sz: -1 }, starboard: { sz: 1 } };
const boatLoad = new GLTFLoader().loadAsync('/models/x12-autonomous.glb').then(gltf => {
  const model = gltf.scene; BOATG.root.add(model); model.updateMatrixWorld(true); BOATG.model = model;
  // one highlight uniform per part, materials cloned so each part can glow on its own
  for (const node of [...model.children]) {
    const label = node.userData.label || node.name; BOATG.parts[label] = node;
    const u = BOATG.hi[label] = { value: 0 };
    node.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); addHighlight(o.material, u); o.castShadow = o.receiveShadow = true; } });
  }
  // beam of the tube collar along the hull, for the water shader's hull cut-out and the waterline foam
  {
    const beam = beamTex.image.data; beam.fill(0);
    BOATG.parts['Tube collar'].traverse(o => { if (!o.isMesh) return; const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = Math.abs(P.getZ(i)); if (y > 0.75) continue; const b = clamp(Math.floor((x + 6.2) / 12.4 * 128), 0, 127); beam[b] = Math.max(beam[b], z); } });
    BOATG.parts['Hull'].traverse(o => { if (!o.isMesh) return; const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i++) { const b = clamp(Math.floor((P.getX(i) + 6.2) / 12.4 * 128), 0, 127); beam[b] = Math.max(beam[b], Math.abs(P.getZ(i))); } });
    const sm = Float32Array.from(beam); for (let i = 0; i < 128; i++) beam[i] = Math.max(sm[i], 0.5 * (sm[Math.max(0, i - 1)] + sm[Math.min(127, i + 1)])) - 0.08;
    beamTex.needsUpdate = true;
  }
  // navigation radar turns about its pedestal
  {
    const node = BOATG.parts['Navigation radar'], box = new THREE.Box3().setFromObject(node), c = box.getCenter(V3());
    const piv = new THREE.Group(); piv.position.set(c.x, 0, c.z); model.add(piv); piv.updateMatrixWorld(true); piv.attach(node); BOATG.nav = piv; piv.name = 'rig_nav';
  }
  // EO/IR gimbal: the ball and its windows turn; the bracket and yoke stay on the mast
  {
    const node = BOATG.parts['EO/IR gimbal'], u = BOATG.hi['EO/IR gimbal'];
    const C = V3(0, 1.29, 0), [fixed, ball] = splitMeshes(node, new THREE.Matrix4(), (mesh, p) => mesh.material.name === 'Sensor window' || p.distanceTo(C) < 0.165);
    model.remove(node);
    const g = new THREE.Group(); model.add(g); fixed.forEach(({ geometry, material }) => { const m = new THREE.Mesh(geometry, material); m.castShadow = m.receiveShadow = true; g.add(m); });
    const piv = new THREE.Group(); piv.position.copy(C); g.add(piv);
    const tilt = new THREE.Group(); piv.add(tilt);
    ball.forEach(({ geometry, material }) => { geometry.translate(-C.x, -C.y, -C.z); const m = new THREE.Mesh(geometry, material); m.castShadow = true; tilt.add(m); });
    BOATG.parts['EO/IR gimbal'] = g; BOATG.gim = piv; BOATG.gimT = tilt; void u;
    g.name = 'EO/IR gimbal'; piv.name = 'rig_gim'; tilt.name = 'rig_gim_tilt';
  }
  // launchers: rebuilt as train (vertical axis) and elevation (trunnion) stages, numbers from build.py
  for (const [name, L] of Object.entries(LAUNCH)) {
    const label = `Air defence launcher (${name})`, node = BOATG.parts[label];
    const box = new THREE.Box3().setFromObject(node);
    const ox = -4.0, oz = L.sz * 0.55, base = box.min.y, H = 0.72, EL = 20 * DEG, TRAIN = -L.sz * 15 * DEG;
    const toLocal = new THREE.Matrix4().makeRotationY(-TRAIN).multiply(new THREE.Matrix4().makeTranslation(-ox, -base, -oz));
    const packMats = new Set(['Canister', 'Canister cap', 'Dark trim', 'Sensor window']);
    const [turn, pack] = splitMeshes(node, toLocal, (mesh, p) => packMats.has(mesh.material.name) || Math.abs(p.z) > 0.27);
    model.remove(node);
    const root = new THREE.Group(); root.position.set(ox, base, oz); model.add(root);
    const train = new THREE.Group(); train.rotation.y = TRAIN; root.add(train);
    const elev = new THREE.Group(); elev.position.set(0, H, 0); elev.rotation.z = EL; train.add(elev);
    const unEl = new THREE.Matrix4().makeRotationZ(-EL).multiply(new THREE.Matrix4().makeTranslation(0, -H, 0));
    turn.forEach(({ geometry, material }) => { const m = new THREE.Mesh(geometry, material); m.castShadow = m.receiveShadow = true; train.add(m); });
    pack.forEach(({ geometry, material }) => { geometry.applyMatrix4(unEl); const m = new THREE.Mesh(geometry, material); m.castShadow = m.receiveShadow = true; elev.add(m); });
    Object.assign(L, { root, train, elev, TRAIN, EL });
    root.name = label; train.name = `rig_${name}_train`; elev.name = `rig_${name}_elev`;
    BOATG.parts[label] = root;
  }
});

// ---------- escort ships, built from boxes and extrusions ----------
function makeShip(s) {
  const g = new THREE.Group(), L = s.L, Bm = s.B;
  const std = (hex, r = 0.7, m = 0.1) => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: r, metalness: m });
  const colours = { cargo: [0x5b1c16, 0xe9e7e1], patrol: [0x59626a, 0x8d969c], supply: [0x1f416f, 0xeceae4] }[s.kind];
  const hullM = std(colours[0], 0.6), supM = std(colours[1], 0.55), dark = std(0x1b1d20, 0.6);
  const free = s.kind === 'cargo' ? 6 : 4.2, draft = s.kind === 'cargo' ? 5 : 3;
  const sh = new THREE.Shape();
  sh.moveTo(-L / 2, -Bm / 2 * 0.86); sh.lineTo(L * 0.18, -Bm / 2);
  sh.quadraticCurveTo(L * 0.42, -Bm / 2, L / 2, 0); sh.quadraticCurveTo(L * 0.42, Bm / 2, L * 0.18, Bm / 2);
  sh.lineTo(-L / 2, Bm / 2 * 0.86); sh.lineTo(-L / 2, -Bm / 2 * 0.86);
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: free + draft, bevelEnabled: false, curveSegments: 12 }).rotateX(-Math.PI / 2).translate(0, -draft, 0), hullM);
  g.add(hull);
  const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y + h / 2, z); g.add(b); return b; };
  const deck = free;
  if (s.kind === 'cargo') {
    box(14, 9, Bm * 0.9, -L / 2 + 9, deck, 0, supM); box(10, 3, Bm * 1.05, -L / 2 + 9, deck + 9, 0, supM); box(2.6, 6, 2.6, -L / 2 + 4, deck + 9, 0, dark);
    const cols = [0x8c2b22, 0x24466e, 0x3e6b3a, 0xb0802a, 0x6b6e71];
    for (let i = 0; i < 6; i++) for (let k = 0; k < 2; k++) box(6.1, 2.6, Bm * 0.8, -L / 2 + 22 + i * 7.4, deck + k * 2.6, 0, std(cols[(i * 3 + k) % 5], 0.7));
  } else if (s.kind === 'patrol') {
    box(L * 0.32, 5, Bm * 0.8, L * 0.02, deck, 0, supM); box(L * 0.16, 2.8, Bm * 0.7, L * 0.08, deck + 5, 0, supM);
    box(1.2, 10, 1.2, L * 0.02, deck + 7.8, 0, dark); const dome = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 10), supM); dome.position.set(L * 0.02, deck + 18.4, 0); g.add(dome);
    box(3, 1.6, 3, L * 0.3, deck, 0, supM); const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4.5, 8).rotateZ(Math.PI / 2), dark); barrel.position.set(L * 0.3 + 3, deck + 1.1, 0); g.add(barrel);
  } else {
    box(L * 0.3, 7, Bm * 0.92, L * 0.22, deck, 0, supM); box(L * 0.2, 2.5, Bm, L * 0.24, deck + 7, 0, supM); box(1, 8, 1, L * 0.24, deck + 9.5, 0, dark);
    const crane = box(1.2, 12, 1.2, -L * 0.25, deck, 0, std(0xc9a227, 0.6)); crane.rotation.z = 0.5;
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = false; });
  scene.add(g); return g;
}
SHIPS.forEach(s => { s.obj = makeShip(s); });
const _sq = new THREE.Quaternion();
function poseShips(t) {
  SHIPS.forEach((s, i) => {
    const p = shipPos(s, t, s.obj.position), dzdx = (0.35 * (fjordC(p.x + 1) - fjordC(p.x - 1))) / 2, yaw = Math.atan2(dzdx, 1);
    const c = Math.cos(yaw), sn = Math.sin(yaw), hb = seaH(p.x + c * s.L * 0.35, p.z + sn * s.L * 0.35, t), hs = seaH(p.x - c * s.L * 0.35, p.z - sn * s.L * 0.35, t), h = seaH(p.x, p.z, t);
    p.y = h * 0.4;
    s.obj.quaternion.setFromEuler(_e.set(0.012 * Math.sin(t * 0.7 + i), -yaw, Math.atan2(hb - hs, s.L * 0.7) * 0.4, 'YZX'));
    waterU.uShips.value[i].set(p.x, p.z, s.L, s.B); waterU.uShipD.value[i].set(c, sn);
  });
}

// ---------- the drone and the interceptor ----------
const drone = (() => {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: lin(0x3a3d39), roughness: 0.55, metalness: 0.2 }), dark = new THREE.MeshStandardMaterial({ color: lin(0x15171a), roughness: 0.5 });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 3.0, 16).rotateZ(-Math.PI / 2), m); g.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 16).rotateZ(-Math.PI / 2), m); nose.position.x = 1.77; g.add(nose);
  const wing = new THREE.Shape(); wing.moveTo(0.7, 0); wing.lineTo(-1.35, 1.3); wing.lineTo(-1.55, 1.3); wing.lineTo(-1.4, 0); wing.lineTo(-1.55, -1.3); wing.lineTo(-1.35, -1.3); wing.lineTo(0.7, 0);
  const wg = new THREE.Mesh(new THREE.ExtrudeGeometry(wing, { depth: 0.05, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 0.02, 0), m); g.add(wg);
  for (const s of [-1, 1]) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.03), m); fin.position.set(-1.42, 0.2, s * 1.3); g.add(fin); }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.18, 10).rotateZ(Math.PI / 2), dark); hub.position.x = -1.6; g.add(hub);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })); disc.position.x = -1.7; g.add(disc);
  scene.add(g); return g;
})();
const missile = (() => {
  const g = new THREE.Group(), w = new THREE.MeshStandardMaterial({ color: lin(0xd9dcdc), roughness: 0.4, metalness: 0.2 }), d = new THREE.MeshStandardMaterial({ color: lin(0x2b2e31), roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1.45, 14).rotateZ(-Math.PI / 2), w); g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.28, 14).rotateZ(-Math.PI / 2), w); nose.position.x = 0.86; g.add(nose);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.067, 0.067, 0.08, 14).rotateZ(-Math.PI / 2), d); band.position.x = 0.45; g.add(band);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.004, 0.13), d); f.position.set(-0.6, 0, 0.1); const p = new THREE.Group(); p.rotation.x = i * Math.PI / 2; p.add(f); g.add(p); }
  g.visible = false; scene.add(g); return g;
})();
const DEBRIS = (() => {
  const r = rng(71), m = new THREE.MeshStandardMaterial({ color: lin(0x26282a), roughness: 0.7 }), list = [];
  for (let i = 0; i < 18; i++) {
    const s = i < 3 ? [0.9, 0.05, 0.6] : [0.12 + r() * 0.35, 0.04 + r() * 0.12, 0.1 + r() * 0.3];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...s), m); mesh.visible = false; scene.add(mesh);
    const az = r() * 6.283, el = (r() - 0.3) * 1.4, sp = 6 + r() * 20;
    list.push({ mesh, v: V3(Math.cos(az) * Math.cos(el) * sp, Math.sin(el) * sp + 4, Math.sin(az) * Math.cos(el) * sp).addScaledVector(DIR_IN, VD * 0.45), spin: V3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), w: 4 + r() * 14, drag: 0.25 + r() * 0.6, fire: i < 5 });
  }
  return list;
})();
/** Debris position at age a: drag on the throw, gravity; returns false once it is in the sea. */
function debrisAt(d, a, out) {
  const k = d.drag, tr = (1 - Math.exp(-k * a)) / k;
  out.copy(I_PT).addScaledVector(d.v, tr); out.y -= 0.5 * G * a * a * 0.92;
  return out.y > seaH(out.x, out.z, T_I + a) - 0.2;
}
DEBRIS.forEach(d => { let a = 0; for (; a < 8; a += 0.01) if (!debrisAt(d, a, _p)) break; d.splash = a; d.splashP = _p.clone(); });

// missile launch geometry, filled in once the boat model is posed at the launch time
const MSL = { p0: V3(), d0: V3(), ready: false, T: T_I - T_L };
const bez = (u, out) => {
  const a = MSL.p0, b = MSL.p1, c = MSL.p2, d = I_PT, v = 1 - u;
  return out.set(0, 0, 0).addScaledVector(a, v * v * v).addScaledVector(b, 3 * v * v * u).addScaledVector(c, 3 * v * u * u).addScaledVector(d, u * u * u);
};
const mslU = tau => { const x = clamp(tau / MSL.T, 0, 1); return 0.05 * x + 0.95 * Math.pow(x, 1.45); };
const missileAt = (tau, out) => bez(mslU(tau), out);

// ---------- launcher, radar and gimbal motion ----------
const _inv = new THREE.Matrix4(), _lp = V3();
/** Train and elevation that put the port launcher on the intercept point, from the boat's pose right now. */
function aimAt(L, S, target, loft) {
  _inv.copy(S.m).invert(); _lp.copy(target).applyMatrix4(_inv).sub(L.root.position);
  return [Math.atan2(-_lp.z, _lp.x), Math.atan2(_lp.y, Math.hypot(_lp.x, _lp.z)) + loft];
}
const angLerp = (a, b, u) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * u; };
function poseRig(w, S) {
  if (BOATG.nav) BOATG.nav.rotation.y = -w * 2 * Math.PI / 2.5;
  const L = LAUNCH.port;
  if (L.train) {
    const [th, el] = aimAt(L, S, I_PT, 9 * DEG), u = ease((w - 56.2) / 3.4) * (1 - ease((w - 70) / 3));
    L.train.rotation.y = angLerp(L.TRAIN, th, u); L.elev.rotation.z = mix(L.EL, el, u);
    const R = LAUNCH.starboard, [th2, el2] = aimAt(R, S, I_PT, 9 * DEG), u2 = ease((w - 57) / 3.4) * (1 - ease((w - 69) / 3)) * 0.6;
    R.train.rotation.y = angLerp(R.TRAIN, th2, u2); R.elev.rotation.z = mix(R.EL, el2, u2);
  }
  if (BOATG.gim) {
    _inv.copy(S.m).invert(); const tgt = w < 64.9 ? droneAt(w, _lp) : _lp.copy(I_PT);
    tgt.applyMatrix4(_inv).sub(V3(0, 1.29, 0));
    const scan = 0.9 * Math.sin(w * 0.35), track = sstep(T_DET - 0.6, T_TRK, w);
    BOATG.gim.rotation.y = angLerp(scan, Math.atan2(-tgt.z, tgt.x), track);
    BOATG.gimT.rotation.z = mix(-0.08 + 0.05 * Math.sin(w * 0.5), Math.atan2(tgt.y, Math.hypot(tgt.x, tgt.z)), track);
  }
}
function computeLaunch() {
  boatAt(T_L, B); BOATG.root.matrix.copy(B.m); BOATG.root.matrixWorldNeedsUpdate = true; poseRig(T_L, B); BOATG.root.updateMatrixWorld(true);
  const e = LAUNCH.port.elev; e.updateMatrixWorld(true);
  MSL.p0.set(0.95, 0.08, -0.08).applyMatrix4(e.matrixWorld);
  MSL.back = V3(-0.75, 0.08, -0.08).applyMatrix4(e.matrixWorld);
  MSL.d0.copy(MSL.p0).sub(MSL.back).normalize();
  const dist = MSL.p0.distanceTo(I_PT);
  MSL.p1 = MSL.p0.clone().addScaledVector(MSL.d0, dist * 0.35);
  MSL.p2 = MSL.p1.clone().lerp(I_PT, 0.62).add(V3(0, dist * 0.05, 0));
  MSL.ready = true;
}

// ---------- smoke and fire ----------
const SMOKE = (() => {
  const r = rng(99), puffs = [];
  for (let i = 0; i < 90; i++) puffs.push({ kind: 'blast', s: [r(), r(), r(), r()] });
  for (let i = 0; i < 70; i++) puffs.push({ kind: 'ball', s: [r(), r(), r(), r()] });
  for (let i = 0; i < 90; i++) puffs.push({ kind: 'boom', s: [r(), r(), r(), r()] });
  return puffs;
})();
const WIND = V3(-2.5, 0.4, 1.2);
const sphereDir = (s, out) => { const z = 2 * s[0] - 1, a = s[1] * 6.283, q = Math.sqrt(1 - z * z); return out.set(q * Math.cos(a), z, q * Math.sin(a)); };
function emitFx(w) {
  if (!MSL.ready) return;
  const tau = w - T_L, sky = 0.62 + 0.25 * SUN.y;
  // the launch: a blast of grey from the canister's front and back, left in the air as the boat drives on
  if (tau > 0) for (const p of SMOKE) {
    if (p.kind !== 'blast') continue;
    const a = tau - p.s[3] * 0.25; if (a <= 0) continue;
    const front = p.s[0] < 0.4, base = front ? MSL.p0 : MSL.back, dir = sphereDir(p.s, _d).multiplyScalar(0.6).addScaledVector(MSL.d0, front ? 1 : -1.3).normalize();
    const reach = (front ? 2.2 : 3.2) * (0.5 + p.s[2]) * (1 - Math.exp(-a * 3));
    _p.copy(base).addScaledVector(dir, reach).addScaledVector(WIND, a).add(_v.set(0, a * 0.5, 0));
    const al = 0.32 * (1 - sstep(1.0, 4.5, a)) * sstep(0, 0.04, a), sz = 0.4 + 1.5 * Math.sqrt(a) * (0.6 + p.s[1]);
    if (_p.distanceTo(camera.position) < 4) continue;
    smokeL.push(_p.x, _p.y, _p.z, sz, 0.74 * sky, 0.74 * sky, 0.75 * sky, al);
  }
  // the motor's trail
  const tEnd = Math.min(tau, MSL.T);
  for (let te = 0; te < tEnd; te += 0.0028) {
    const a = tau - te, k = Math.floor(te / 0.0028);
    missileAt(te, _p);
    const j = Math.sin(k * 12.9898) * 43758.5453, jr = j - Math.floor(j);
    _p.addScaledVector(WIND, a * 0.7).add(_v.set(Math.sin(k * 1.7), Math.cos(k * 2.3), Math.sin(k * 0.9)).multiplyScalar(0.35 * Math.sqrt(a)));
    const al = 0.36 * (1 - sstep(2.5, 9, a)) * sstep(0, 0.05, a), sz = 1.3 + 1.7 * Math.sqrt(a) * (0.7 + 0.6 * jr);
    if (_p.distanceTo(camera.position) < 5) continue;
    smokeL.push(_p.x, _p.y, _p.z, sz, 0.82 * sky, 0.82 * sky, 0.84 * sky, al);
  }
  // the motor flame
  if (tau > 0 && tau < MSL.T) {
    missileAt(tau, _p); missileAt(tau + 0.01, _d); const dir = _d.sub(_p).normalize();
    for (let i = 0; i < 4; i++) { const f = 0.85 + 0.3 * Math.sin(w * 90 + i * 2.1); _v.copy(_p).addScaledVector(dir, -0.8 - i * 0.28); fireL.push(_v.x, _v.y, _v.z, (0.9 - i * 0.16) * f, 9, 5.2, 2.0, 1 - i * 0.2); }
    if (tau < 0.12) fireL.push(MSL.back.x, MSL.back.y, MSL.back.z, 1.4 * (1 - tau / 0.12), 10, 6, 2.5, 1);
  }
  // the intercept: a flash, a fireball that turns to smoke, burning pieces falling into the sea
  const b = w - T_I;
  if (b > 0) {
    if (b < 0.18) fireL.push(I_PT.x, I_PT.y, I_PT.z, 40 * (1 - b / 0.18) + 8, 14, 11, 8, 1);
    for (const p of SMOKE) {
      if (p.kind === 'ball') {
        const dir = sphereDir(p.s, _d), r = 8.5 * (0.5 + 0.5 * p.s[2]) * (1 - Math.exp(-b * 7));
        _p.copy(I_PT).addScaledVector(dir, r).addScaledVector(DIR_IN, VD * 0.25 * (1 - Math.exp(-b * 2)));
        const heat = Math.exp(-b * (2.6 + 2 * p.s[3]));
        fireL.push(_p.x, _p.y, _p.z, 3 + 5 * Math.sqrt(b), 9 * heat + 0.3, 3.6 * heat * heat + 0.1, 0.8 * heat * heat * heat, heat * 0.9);
      } else if (p.kind === 'boom') {
        const dir = sphereDir(p.s, _d), r = 13 * (0.4 + 0.6 * p.s[2]) * (1 - Math.exp(-b * 2.2));
        _p.copy(I_PT).addScaledVector(dir, r).addScaledVector(DIR_IN, VD * 0.25 * (1 - Math.exp(-b * 2))).addScaledVector(WIND, b).add(_v.set(0, 1.2 * b, 0));
        const al = 0.75 * sstep(0.08, 0.4, b) * (1 - sstep(4, 12, b)), sz = 6 + 7 * Math.sqrt(b) * (0.6 + p.s[1]), c = 0.07 + 0.08 * p.s[3] + 0.1 * sstep(1, 6, b);
        smokeL.push(_p.x, _p.y, _p.z, sz, c, c * 0.96, c * 0.92, al);
      }
    }
    for (const d of DEBRIS) {
      const end = Math.min(b, d.splash);
      for (let a = 0.05; a < end; a += 0.06) {
        debrisAt(d, a, _p); const age = b - a; _p.addScaledVector(WIND, age);
        const al = 0.45 * (1 - sstep(1, 6, age)) * (d.fire ? 1 : 0.5), c = 0.1 + 0.08 * sstep(0.5, 4, age);
        smokeL.push(_p.x, _p.y, _p.z, 0.6 + 1.2 * Math.sqrt(age), c, c, c, al);
      }
      if (d.fire && b < d.splash && b < 2.5) { debrisAt(d, b, _p); fireL.push(_p.x, _p.y, _p.z, 1.6 + 0.5 * Math.sin(w * 70 + d.w), 9, 4, 1.2, 1 - b / 2.5); }
      if (b > d.splash) { // the splash where it hit
        const a = b - d.splash;
        for (let k = 0; k < 14; k++) {
          const az = k * 2.4 + d.w, sp = 2 + (k % 5), up = 5 + (k % 3) * 2.5, y = up * a - 0.5 * G * a * a;
          if (y < -0.2) continue;
          sprayL.push(d.splashP.x + Math.cos(az) * sp * a, d.splashP.y + y, d.splashP.z + Math.sin(az) * sp * a, 0.3 + a * 1.2, 0.86, 0.9, 0.93, 0.5 * (1 - sstep(0.5, 1.6, a)));
        }
      }
    }
  }
}

// ---------- camera ----------
const shake = (t, a) => V3(Math.sin(t * 13.7) + 0.5 * Math.sin(t * 31.3 + 1), Math.sin(t * 17.3 + 2) + 0.5 * Math.sin(t * 27.7), Math.sin(t * 11.1 + 4)).multiplyScalar(a);
// the tour: camera and aim in the boat's level frame (x to the bow, z to starboard), lens
const TOUR = [
  [13.0, 7.5, 1.9, 9.5, 0.2, 0.3, 0, 40], [15.6, -1.5, 1.7, 8.2, -0.8, 0.25, 0, 40],
  [18.0, -11.5, 1.8, 4.8, -5.8, 0.45, 0, 34], [20.6, -10.8, 2.6, -2.8, -5.8, 0.45, 0, 32],
  [22.8, 2.8, 3.8, 6.2, -0.7, 2.35, 0, 34], [25.1, -4.0, 4.1, 5.6, -0.7, 2.5, 0, 32],
  [27.4, 0.9, 3.6, 2.8, -0.7, 2.6, 0, 34], [29.8, 7.8, 2.9, 2.9, 4.1, 0.9, 0, 36],
  [32.0, 2.4, 1.65, 1.9, 0, 1.3, 0, 30], [34.2, 2.0, 1.25, -1.7, 0, 1.3, 0, 30],
  [36.4, -0.8, 2.4, -4.0, -1.2, 0.85, 0, 36], [38.8, -3.4, 3.3, -3.2, -1.2, 1.5, 0, 38],
  [41.0, -2.0, 2.9, 3.6, -3.9, 1.1, 0, 34], [43.6, -7.2, 2.7, 2.6, -3.9, 1.2, 0, 34],
  [46.0, -15, 2.6, 4.0, -1, 1.0, 0, 40],
];
const CHAPTERS = [
  { t: 13.0, end: 18.0, g: 'hull', grp: 'Hull and decks', title: 'Goldfish X12 hull', anchor: [2.2, 0.35, 1.55],
    lines: ['Four-step deep-V planing hull', 'GRP/CRP vacuum-infused sandwich', '12.45 m LOA · 3.6 m beam · Category B offshore', 'Non-skid deck in place of the crewed hardtop and seats'] },
  { t: 18.0, end: 22.8, g: 'prop', grp: 'Propulsion', title: 'Triple 500 hp outboards', anchor: [-6.0, 0.9, 0.75],
    lines: ['Supercharged V8s, 1,500 hp combined', 'Sprint at 45 kn, on a hull proven beyond 50', '1,000 l fuel for long patrols'] },
  { t: 22.8, end: 27.4, g: 'mast', grp: 'Sensor mast', title: '360° radar coverage', anchor: [-0.3, 2.3, 0.35],
    lines: ['Four fixed phased-array faces for air and surface search', 'Rotating navigation radar for collision avoidance', 'Faceted, radar-absorbent composite mast'] },
  { t: 27.4, end: 32.0, g: 'percep', grp: 'Perception', title: 'Lidar and panoramic vision', anchor: [-0.36, 2.88, 0.07], anchor2: [29.0, 4.4, 0.88, 0.0],
    lines: ['Mast-head 360° lidar and four corner solid-state units', 'Four day / low-light cameras for the remote operator', 'Bow pod: forward lidar and camera for close quarters'] },
  { t: 32.0, end: 36.4, g: 'eoir', grp: 'Identification', title: 'Stabilised EO/IR turret', anchor: [0.12, 1.29, 0],
    lines: ['Electro-optical and infrared imaging', 'Holds a track through sea state and spray', 'Confirms what the radar has found'] },
  { t: 36.4, end: 41.0, g: 'auto', grp: 'Autonomy and links', title: 'Mission electronics bay', anchor: [-1.62, 0.85, 0],
    lines: ['Autonomy computers, power and networking', 'SATCOM for beyond-line-of-sight command and video', 'VHF / AIS, mesh datalink and dual GNSS heading'] },
  { t: 41.0, end: 46.0, g: 'ad', grp: 'Air defence', title: 'Two trainable launchers', anchor: [-4.0, 1.45, 0.55],
    lines: ['Eight ready short-range interceptors', 'Cued directly by the surveillance radar', 'Human authorisation in the loop for every engagement'] },
];
const SHOTS = [
  { t: 0, f(t) { // aerial over the fjord, the boat running up it under the title
    const u = t / 7;
    boatAt(t, Bc);
    camera.position.copy(Bc.pos).addScaledVector(Bc.Fh, mix(-150, -70, u)).addScaledVector(Bc.Rh, mix(70, 38, u)).add(_v.set(0, mix(46, 22, u), 0));
    camera.lookAt(_d.copy(Bc.pos).addScaledVector(Bc.Fh, mix(260, 160, u)).addScaledVector(Bc.Rh, mix(-235, -150, u)).add(_v.set(0, mix(4, 0, u), 0)));
    camera.fov = 36; return [Bc.pos, 18];
  } },
  { t: 7, f(t) { // low on the water: it charges past and settles to cruise
    const base = boatAt(11.6, {}).pos, cx = base.x + 3, cz = base.z + 13;
    camera.position.set(cx, seaH(cx, cz, t) * 0.6 + 1.5, cz);
    boatAt(t, Bc);
    camera.lookAt(_v.copy(Bc.pos).add(V3(0, 0.9, 0)));
    camera.fov = mix(26, 44, sstep(7, 12.5, t)); return [Bc.pos, 9];
  } },
  { t: 13, f(t) { // the tour
    const [cx, cy, cz, lx, ly, lz, fov] = keyed(TOUR, t);
    boatAt(t, Bc, 0.35);
    camera.position.copy(Bc.pos).addScaledVector(Bc.Fh, cx).addScaledVector(Bc.Rh, cz).add(_v.set(0, cy, 0));
    camera.lookAt(_d.copy(Bc.pos).addScaledVector(Bc.Fh, lx).addScaledVector(Bc.Rh, lz).add(_v.set(0, ly, 0)));
    camera.fov = fov; return [Bc.pos, 8.5];
  } },
  { t: 46, f(t) { // power up: the camera lets it go
    boatAt(46, Bc, 0.35);
    const [cx, cy, cz] = keyed(TOUR, 46), drift = 7 * (t - 46) - 1.2 * (t - 46) ** 2 * 0.5;
    camera.position.copy(Bc.pos).addScaledVector(Bc.Fh, cx + Math.max(drift, 0)).addScaledVector(Bc.Rh, cz).add(_v.set(0, cy, 0));
    boatAt(t, Bc);
    camera.lookAt(_d.copy(Bc.pos).add(V3(0, 1.1, 0)));
    camera.fov = mix(40, 30, sstep(46, 49.5, t)); return [Bc.pos, 9];
  } },
  { t: 49.4, f(t) { // alongside at speed, from a chase helicopter
    boatAt(t, Bc, 0.2); const u = (t - 49.4) / 4.2;
    camera.position.copy(Bc.pos).addScaledVector(Bc.Fh, mix(8, 2, u)).addScaledVector(Bc.Rh, -24).add(_v.set(0, mix(5.5, 7.5, u), 0)).add(shake(t, 0.12));
    camera.lookAt(_d.copy(Bc.pos).addScaledVector(Bc.Fh, 1.5).add(V3(0, 0.8, 0)));
    camera.fov = 30; return [Bc.pos, 9];
  } },
  { t: 53.6, f(t) { // the threat, low over the side fjord
    const D = droneAt(t, _pa), u = (t - 53.6) / 3.6;
    camera.position.copy(D).addScaledVector(DIR_IN, mix(-11, -8, u)).addScaledVector(SIDE3, mix(5, 3.2, u)).add(_v.set(0, mix(-1.4, 1.6, u), 0));
    camera.lookAt(_d.copy(D).addScaledVector(DIR_IN, 22));
    camera.fov = 38; return [D, 6];
  } },
  { t: 57.2, eoir: true, f(t) { // through the gimbal: the boat's own view of the drone
    boatAt(t, Bc); const g = toWorld(Bc, 0.15, 1.29, 0, _pa), D = droneAt(t, _pb);
    camera.position.copy(g);
    camera.lookAt(_d.copy(D).add(shake(t * 0.6, 0.0008 * g.distanceTo(D))));
    camera.fov = 0.8; return [Bc.pos, 9];
  } },
  { t: 60.3, f(t) { // the launcher on the port quarter: it fires
    boatAt(t, Bc, 0.6);
    camera.position.copy(Bc.pos).addScaledVector(Bc.Fh, 1.2).addScaledVector(Bc.Rh, -7.2).add(_v.set(0, 2.3, 0));
    const look = toWorld(Bc, -4.0, 1.3, -0.55, _pa);
    look.y += 1.6 * sstep(T_L + 0.1, T_L + 1.6, t);
    camera.lookAt(look);
    if (t > T_L) camera.position.add(shake(t, 0.07 * Math.exp(-(t - T_L) * 2.5)));
    camera.fov = mix(40, 50, sstep(T_L, T_L + 1.5, t)); return [Bc.pos, 9];
  } },
  { t: 63.6, f(t) { // the intercept: from behind the drone, out over the main fjord, the interceptor coming head-on
    boatAt(63.6, Bc);
    const c = _pa.copy(I_PT).addScaledVector(DIR_IN, -mix(120, 135, (t - 63.6) / 5)).addScaledVector(SIDE3, -26).setY(I_PT.y + 4);
    camera.position.copy(c).add(t > T_I ? shake(t, 0.12 * Math.exp(-(t - T_I) * 2)) : _v.set(0, 0, 0));
    const D = droneAt(Math.min(t, T_I), _pb), aim = _pc.copy(D).lerp(I_PT, sstep(T_I - 1.2, T_I, t)).add(V3(0, -mix(0, 16, sstep(T_I + 0.6, T_I + 3.4, t)), 0));
    camera.lookAt(aim);
    camera.fov = mix(15, 34, sstep(T_I + 0.15, T_I + 2.2, t)); return [Bc.pos, 9];
  } },
  { t: 68.6, f(t) { // on to the escorts: low behind the boat, rising to the wide
    const u = ease((t - 68.6) / 9);
    boatAt(t, Bc, 0.3);
    camera.position.copy(Bc.pos).addScaledVector(Bc.Fh, mix(-16, -60, u)).addScaledVector(Bc.Rh, mix(5, 30, u)).add(_v.set(0, mix(2.2, 70, u), 0));
    camera.lookAt(_d.copy(Bc.pos).addScaledVector(Bc.Fh, mix(10, 300, u)).add(V3(0, mix(1, -10, u), 0)));
    camera.fov = mix(38, 34, u); return [Bc.pos, 10];
  } },
];
const _pa = V3(), _pb = V3(), _pc = V3();

// ---------- overlays ----------
const $ = id => document.getElementById(id);
const toScreen = (p, out = {}) => { _v.copy(p).project(camera); const [w, h] = st.size(); out.x = (_v.x * 0.5 + 0.5) * w; out.y = (-_v.y * 0.5 + 0.5) * h; out.on = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1; return out; };
let chapterShown = -1;
const BLIPS = $('blips');
function overlays(t, w) {
  const [W_, H_] = st.size();
  $('fade').style.opacity = String(Math.max(1 - sstep(0, 1.2, t), sstep(DUR - 1.2, DUR - 0.1, t)));
  $('intro').style.opacity = String(sstep(1.0, 1.8, t) * (1 - sstep(5.6, 6.6, t)));
  // the component card follows the chapter, its leader the part on screen
  const ci = CHAPTERS.findIndex(c => t >= c.t && t < c.end), ch = CHAPTERS[ci];
  for (const [g, labels] of Object.entries(GROUPS)) {
    const on = ch && ch.g === g ? sstep(ch.t + 0.3, ch.t + 1.0, t) * (1 - sstep(ch.end - 0.8, ch.end - 0.1, t)) : 0;
    labels.forEach(l => { if (BOATG.hi[l]) BOATG.hi[l].value = on * (0.24 + 0.06 * Math.sin(t * 4)); });
  }
  if (ch) {
    if (ci !== chapterShown) {
      chapterShown = ci;
      $('cidx').textContent = `${String(ci + 1).padStart(2, '0')} / ${String(CHAPTERS.length).padStart(2, '0')}`;
      $('cgrp').textContent = ch.grp; $('ctitle').textContent = ch.title;
      $('clist').innerHTML = ch.lines.map(l => `<li>${l}</li>`).join('');
    }
    const a = sstep(ch.t + 0.4, ch.t + 1.1, t) * (1 - sstep(ch.end - 0.7, ch.end - 0.1, t));
    $('card').style.opacity = String(a); $('card').style.transform = `translateY(${(1 - a) * 14}px)`;
    const an = ch.anchor2 && t > ch.anchor2[0] ? ch.anchor2.slice(1) : ch.anchor;
    const p = toScreen(toWorld(B, ...an, _pa)), card = $('card').getBoundingClientRect();
    const ax = card.right, ay = card.top + 20;
    $('ln').setAttribute('x1', ax); $('ln').setAttribute('y1', ay); $('ln').setAttribute('x2', p.x); $('ln').setAttribute('y2', p.y);
    $('ld').setAttribute('cx', p.x); $('ld').setAttribute('cy', p.y); $('lr').setAttribute('cx', p.x); $('lr').setAttribute('cy', p.y);
    $('leader').style.opacity = String(a * (p.on ? 1 : 0));
  } else { $('card').style.opacity = '0'; $('leader').style.opacity = '0'; }
  // sprint telemetry
  $('tele').style.opacity = String(sstep(47.2, 48, t) * (1 - sstep(53.2, 53.7, t)));
  $('kn').textContent = String(Math.round(B.v * 1.944));
  // engagement
  const hud = sstep(T_DET - 0.1, T_DET + 0.4, t) * (1 - sstep(68.2, 69, t)), eo = t >= 57.2 && t < 60.3;
  $('steps').style.opacity = String(hud); $('scope').style.opacity = String(hud * (eo ? 0 : 1));
  const steps = [T_DET, T_TRK, T_ID, 60.4, T_I + 0.3], cur = steps.filter(s => t >= s).length - 1;
  [...$('steps').children].forEach((d, i) => { d.className = i < cur ? 'done' : i === cur ? (i === 4 ? 'kill' : 'on') : ''; });
  if (hud > 0) {
    const sw = (t * 2 * Math.PI / 2.2) % (2 * Math.PI), R = 140, cx = 150, cy = 150;
    const arc = (a0, a1) => `M${cx} ${cy}L${cx + R * Math.sin(a0)} ${cy - R * Math.cos(a0)}A${R} ${R} 0 0 1 ${cx + R * Math.sin(a1)} ${cy - R * Math.cos(a1)}Z`;
    $('sweep').setAttribute('d', arc(sw - 0.5, sw));
    const blip = (p, cls, r, lbl) => {
      _lp.copy(p).sub(B.pos); const fx = _lp.dot(B.Fh), rx = _lp.dot(B.Rh), k = R / 3000;
      const x = cx + rx * k, y = cy - fx * k; if (Math.hypot(x - cx, y - cy) > R - 4) return '';
      return `<circle class="${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>` + (lbl ? `<text x="${(x + 8).toFixed(1)}" y="${(y - 6).toFixed(1)}">${lbl}</text>` : '');
    };
    let s = SHIPS.map(sh => blip(shipPos(sh, w), 'friend', 4.5)).join('');
    if (t < T_I + 0.2) s += blip(droneAt(w), t > T_ID ? 'hostile' : 'msl', 5, t > T_ID ? 'UAS-07' : 'TRK 07');
    if (MSL.ready && t > T_L && t < T_I) s += blip(missileAt(t - T_L, _pc), 'msl', 3);
    BLIPS.innerHTML = s;
  }
  // target box on the drone
  const boxOn = (t >= 53.9 && t < 57.2) || (t >= 63.6 && t < T_I);
  if (boxOn) {
    const p = toScreen(droneAt(w, _pa));
    $('box').style.opacity = p.on ? '1' : '0'; $('box').style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    $('box').className = 'fx' + (t > T_ID ? ' hostile' : '');
    const rng_ = Math.round(droneAt(w, _pb).distanceTo(B.pos));
    $('boxl').innerHTML = t > T_ID ? `UAS-07 · HOSTILE<span>RNG ${rng_} M · ${Math.round(VD * 1.944)} KN</span>` : `TRK 07 · AIR · UNKNOWN<span>RNG ${rng_} M · ${Math.round(VD * 1.944)} KN · ALT ${Math.round(_pa.y)} M</span>`;
  } else $('box').style.opacity = '0';
  // the alert card
  const al = sstep(T_DET + 0.2, T_DET + 0.8, t) * (1 - sstep(56.8, 57.2, t)) + sstep(60.4, 60.9, t) * (1 - sstep(63.3, 63.6, t)) + sstep(T_I + 0.4, T_I + 0.9, t) * (1 - sstep(68.2, 68.6, t));
  $('alert').style.opacity = String(al);
  $('alertT').textContent = t < 57.2 ? 'AIR CONTACT' : t < 63.6 ? 'ENGAGE · AUTHORISED' : 'TARGET NEUTRALISED';
  $('alertB').innerHTML = t < 57.2 ? 'Surveillance radar · track 07<br>Low, fast, inbound to the escort group'
    : t < 63.6 ? 'Operator consent received over SATCOM<br>Port launcher · interceptor 1 of 8'
    : `Intercept ${Math.round(I_PT.distanceTo(boatAt(T_L, {}).pos))} m from own ship<br>Escort group unharmed · 7 rounds ready`;
  // EO/IR view: black-and-white, inverted so the hot drone reads white against a cold sky
  $('eoir').style.opacity = eo ? '1' : '0';
  canvas.style.filter = eo ? 'grayscale(1) invert(1) brightness(0.62) contrast(2.1)' : 'none';
  drone.traverse(o => { if (o.isMesh && o.material.color) { o.material.userData.c ??= o.material.color.clone(); o.material.color.copy(eo ? new THREE.Color(0, 0, 0) : o.material.userData.c); } });
  if (eo) {
    $('eoirR').innerHTML = `TRK 07<br>RNG ${Math.round(droneAt(w, _pa).distanceTo(B.pos))} M<br>BRG ${((Math.atan2(_pa.z - B.pos.z, _pa.x - B.pos.x) / DEG + 450) % 360).toFixed(1)}°`;
    $('eoirC').style.opacity = String(sstep(T_ID, T_ID + 0.3, t));
  }
  $('end').style.opacity = String(sstep(72.4, 73.6, t));
}

// ---------- frame ----------
function render(t, draw = true) {
  const w = t;
  shared.uTime.value = w;
  boatAt(w, B);
  BOATG.root.matrix.copy(B.m); BOATG.root.matrixWorldNeedsUpdate = true;
  poseRig(w, B);
  poseShips(w);
  // the drone until the intercept, then its pieces
  const dAlive = w < T_I;
  drone.visible = dAlive;
  if (dAlive) { droneAt(w, drone.position); droneAt(w + 0.05, _pa); drone.lookAt(_pa); drone.rotateY(-Math.PI / 2); drone.rotateX(0.12 * Math.sin(w * 0.7 + 1)); drone.children[drone.children.length - 1].rotation.x = w * 50; }
  DEBRIS.forEach(d => { const a = w - T_I; d.mesh.visible = a > 0 && a < d.splash; if (d.mesh.visible) { debrisAt(d, a, d.mesh.position); d.mesh.quaternion.setFromAxisAngle(d.spin, a * d.w); } });
  missile.visible = MSL.ready && w > T_L && w < T_I;
  if (missile.visible) { missileAt(w - T_L, missile.position); missileAt(w - T_L + 0.01, _pa); missile.lookAt(_pa); missile.rotateY(-Math.PI / 2); }
  // wake trail: the stern's path over the last 20 s, newest first
  for (let i = 0; i < TRAIL_N; i++) {
    const a = i * TRAIL_DT, tw = w - a, o = waterU.uTrail.value[i];
    if (tw < 0) { o.set(0, 0, -1, 0); continue; }
    boatAt(tw, _sb); o.set(_sb.pos.x - _sb.Fh.x * 5.6, _sb.pos.z - _sb.Fh.z * 5.6, a, _sb.v);
  }
  waterU.uBoatInv.value.copy(B.m).invert(); waterU.uBoatV.value = B.v;
  const firstSplash = Math.min(...DEBRIS.map(d => d.splash));
  waterU.uSplash.value.set(I_PT.x, I_PT.z, w - T_I - firstSplash, 0);

  let k = 0; while (k + 1 < SHOTS.length && t >= SHOTS[k + 1].t) k++;
  const [focus, size] = SHOTS[k].f(t);
  // keep the lens out of the sea
  const sea = seaH(camera.position.x, camera.position.z, w);
  if (camera.position.y < sea + 0.35) camera.position.y = sea + 0.35;
  const dB = camera.position.distanceTo(B.pos);
  camera.near = SHOTS[k].eoir ? 2 : clamp(Math.min(dB - 8, camera.position.y - sea - 0.2) * 0.5, 0.05, 4);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  shadowAt(focus, size);
  sky.position.copy(camera.position);
  waterU.uCam.value.set(Math.round(camera.position.x * 2) / 2, 0, Math.round(camera.position.z * 2) / 2);
  water.position.set(0, 0, 0);

  emitSpray(w); emitFx(w);
  sprayL.flush(false); smokeL.flush(true); fireL.flush(false);
  overlays(t, w);
  if (draw && !OVERLAY) st.render(0, t);
}

let ft = Number(qs.get('t') || 0);
// ?film&overlay: the HTML layer alone on a transparent page, for laying over the Blender render (video/x12/finish.js)
const OVERLAY = qs.has('overlay');
if (OVERLAY) { canvas.style.visibility = 'hidden'; document.documentElement.style.background = document.body.style.background = 'transparent'; }
// the choreography for Blender (video/x12/bake.js): pose without drawing, then read the state back
window.__bake = {
  pose: t => render(t, false), B, BOATG, LAUNCH, camera, drone, missile, DEBRIS, SHIPS, MSL, I_PT, DIR_IN, SIDE3, WIND, WAVES, SUN, BOAT, DW, NP, waterU,
  T: { DUR, T_DET, T_TRK, T_ID, T_L, T_I, VD, T_PASS }, TRAIL_N, TRAIL_DT, SHOTS, CHAPTERS, TER, terrainH, fjordC, fjordW, JUNCTION,
  async exportBoat() {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const model = BOATG.model, keep = model.parent; keep.remove(model);
    try { const buf = await new GLTFExporter().parseAsync(model, { binary: true }); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(s); }
    finally { keep.add(model); }
  },
};
const ready = boatLoad.then(() => { computeLaunch(); });
window.__dbg = { boatAt, seaH, droneAt, I_PT, JUNCTION, MSL, terrainH, BOAT, SHIPS, shipPos };
window.__film = { ready, seek: t => render(t), duration: DUR };
if (!qs.has('film')) $('labs').hidden = false;
ready.then(() => {
  if (qs.has('film')) return render(ft);
  let last = performance.now(), paused = false;
  addEventListener('keydown', e => { if (e.code === 'Space') paused = !paused; if (e.code === 'ArrowRight') ft += 2; if (e.code === 'ArrowLeft') ft = Math.max(0, ft - 2); });
  const loop = now => { const dt = Math.min(0.1, (now - last) / 1000); last = now; if (!paused) ft = (ft + dt) % DUR; render(ft); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
