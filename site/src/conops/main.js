// Burevestnik notional ConOps, 180 s: canister launch on a kicker, twin-SRB boost, change-over to direct-cycle
// nuclear cruise. Source: Hecla & Kemp (MIT), "Modeling the Performance of the Burevestnik", §3.1.1 and Fig. 4.
// World units are metres: +x is the launch heading, +y up, +z to the vehicle's right. Everything is a pure function
// of film time t, so any frame can be rendered on its own (conops.html?film for video/render.js, ?t=120 to preview).
import * as THREE from 'three';
import { createStage, lin, NOISE } from '../shared/stage';

const DEG = Math.PI / 180, DUR = 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const mix = (a, b, u) => a + (b - a) * u;
const win = (t, a, b, f = 0.8) => sstep(a, a + f, t) * (1 - sstep(b - f, b, t)); // 0→1→0 over [a,b]
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------- film timeline ----------
// Film-time events (s). The kicker and booster separations play in slow motion; mission time m(t) carries it.
const E = { IGN: 16, KBO: 33, KSEP: 37, SIGN: 41, SBO: 86, SSEP: 92, TJ: 96, CRIT: 108, CRUISE: 135, TURN0: 150, TURN1: 162, WARP: 166 };
const RATE = [[0, 1], [15, 1], [16, 0.14], [46, 0.14], [52, 1], [86.5, 1], [88.5, 0.3], [100, 0.3], [104, 1], [DUR, 1]];
const FDT = 1 / 240;
const MT = (() => { // mission time sampled every FDT of film time; m = 0 at kicker ignition
  const n = Math.ceil(DUR / FDT) + 2, a = new Float64Array(n);
  const rate = t => { for (let i = 1; i < RATE.length; i++) if (t <= RATE[i][0]) { const [t0, r0] = RATE[i - 1], [t1, r1] = RATE[i]; return mix(r0, r1, (t - t0) / (t1 - t0)); } return 1; };
  for (let i = 1; i < n; i++) a[i] = a[i - 1] + rate((i - 0.5) * FDT) * FDT;
  const off = a[Math.round(E.IGN / FDT)];
  for (let i = 0; i < n; i++) a[i] -= off;
  return a;
})();
const M = t => { const f = clamp(t, 0, DUR) / FDT, i = Math.floor(f); return mix(MT[i], MT[i + 1], f - i); };
const mE = Object.fromEntries(Object.entries(E).map(([k, v]) => [k, M(v)]));

// ---------- terrain (mirrored exactly in GLSL below) ----------
const LAUNCH_ELEV = 18 * DEG, CANISTER = new THREE.Vector3(0, 9.4, 0), AXIS = new THREE.Vector3(Math.cos(LAUNCH_ELEV), Math.sin(LAUNCH_ELEV), 0);
let X2 = 1e9; // far coastline, placed after a first path pass so the missile reaches it during the cruise shots
const shore1 = z => 1500 + 300 * Math.sin(z * 0.0011) + 120 * Math.sin(z * 0.0037 + 1);
const shore2 = z => X2 + 800 * Math.sin(z * 0.0006 + 0.5) + 300 * Math.sin(z * 0.0021);
const landH1 = (x, z) => 5 + 4 * Math.sin(x * 0.003 + 1.3) * Math.sin(z * 0.004) + 2 * Math.sin(x * 0.011 + z * 0.007);
const landH2 = (x, z) => {
  const r = clamp((x - shore2(z)) / 2500, 0, 1);
  return 4 + r * (60 + 55 * Math.sin(x * 0.0011 + z * 0.0007) * Math.sin(z * 0.0013 - x * 0.0004) + 22 * Math.sin(x * 0.0047 + 0.7) * Math.sin(z * 0.0051)) + 6 * r * Math.sin(x * 0.017 + z * 0.013);
};
function terrainH(x, z) {
  const m1 = sstep(80, -80, x - shore1(z)), m2 = sstep(-80, 80, x - shore2(z));
  let h = mix(-14, landH1(x, z), m1);
  h = mix(h, landH2(x, z), m2);
  return mix(h, 6, sstep(70, 40, Math.hypot(x + 5, z)));
}
const TERRAIN_GLSL = `
uniform float uX2;
float shore1(float z){ return 1500.0 + 300.0*sin(z*0.0011) + 120.0*sin(z*0.0037 + 1.0); }
float shore2(float z){ return uX2 + 800.0*sin(z*0.0006 + 0.5) + 300.0*sin(z*0.0021); }
float landH1(float x, float z){ return 5.0 + 4.0*sin(x*0.003 + 1.3)*sin(z*0.004) + 2.0*sin(x*0.011 + z*0.007); }
float landH2(float x, float z){
  float r = clamp((x - shore2(z))/2500.0, 0.0, 1.0);
  return 4.0 + r*(60.0 + 55.0*sin(x*0.0011 + z*0.0007)*sin(z*0.0013 - x*0.0004) + 22.0*sin(x*0.0047 + 0.7)*sin(z*0.0051)) + 6.0*r*sin(x*0.017 + z*0.013);
}
float terrainH(vec2 p){
  float m1 = smoothstep(80.0, -80.0, p.x - shore1(p.y)), m2 = smoothstep(-80.0, 80.0, p.x - shore2(p.y));
  float h = mix(-14.0, landH1(p.x, p.y), m1);
  h = mix(h, landH2(p.x, p.y), m2);
  return mix(h, 6.0, smoothstep(70.0, 40.0, length(p + vec2(5.0, 0.0))));
}`;

// ---------- flight path ----------
// Integrated once at load in mission time. Speeds and the 6° climb follow the paper's sizing cases; the rest is staging.
const DM = 1 / 240, P0 = CANISTER.clone().addScaledVector(AXIS, 0.8), RAIL = 11.4;
function speed(m) {
  const vK = 35 * mE.KBO, vS = vK - 4 * (mE.SIGN - mE.KBO);
  if (m < 0) return 0;
  if (m < mE.KBO) return 35 * m;
  if (m < mE.SIGN) return vK - 4 * (m - mE.KBO);
  if (m < mE.SBO) return vS + (272 - vS) * (1 - Math.exp(-(m - mE.SIGN) / 10)) / (1 - Math.exp(-(mE.SBO - mE.SIGN) / 10));
  return 272 - 4 * (1 - Math.exp(-(m - mE.SBO) / 8));
}
function buildPath() {
  const mEnd = M(DUR) + 1, n = Math.ceil(mEnd / DM) + 2;
  const P = { n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), v: new Float32Array(n), g: new Float32Array(n), psi: new Float32Array(n), bank: new Float32Array(n), spool: new Float32Array(n) };
  let x = P0.x, y = P0.y, z = P0.z, g = LAUNCH_ELEV, psi = 0, s = 0, spool = 0;
  for (let i = 0; i < n; i++) {
    const m = i * DM, v = speed(m);
    const turn = 1.6 * DEG * win(m, mE.TURN0, mE.TURN1, 2.5);
    P.x[i] = x; P.y[i] = y; P.z[i] = z; P.v[i] = v; P.g[i] = g; P.psi[i] = psi; P.bank[i] = Math.atan(v * turn / 9.81); P.spool[i] = spool;
    const rate = (lim, tgt) => clamp(tgt - g, -lim * DM, lim * DM);
    if (s < RAIL) g = LAUNCH_ELEV;
    else if (m < mE.SIGN) g += -0.35 * 9.81 * Math.cos(g) / Math.max(v, 20) * DM;
    else if (m < mE.SBO) g += rate(2 * DEG, (m - mE.SIGN < 7 ? 13 : 6) * DEG);
    else { // terrain following at ~55 m: look ahead along the heading and hold clearance over the highest point
      let hT = 0;
      for (const d of [0, 150, 300, 600, 900]) hT = Math.max(hT, terrainH(x + d * Math.cos(psi), z + d * Math.sin(psi)));
      g += rate(2.5 * DEG, clamp((hT + 55 - y) / (v * 5), -6 * DEG, 7 * DEG));
    }
    psi += turn * DM;
    x += v * Math.cos(g) * Math.cos(psi) * DM; z += v * Math.cos(g) * Math.sin(psi) * DM; y += v * Math.sin(g) * DM; s += v * DM;
    spool += (m < mE.TJ ? 0 : 60 * sstep(mE.TJ, mE.TJ + 12, m) + 30) * DM; // compressor turns (rev), for the cutaway
  }
  return P;
}
let PATH = buildPath();
X2 = PATH.x[Math.round(M(141) / DM)] + 900; // missile makes landfall around t = 142 s
PATH = buildPath();

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _w = new THREE.Vector3(0, 1, 0), _m4 = new THREE.Matrix4();
/** Vehicle state at mission time m: position, velocity, unit basis (forward, up, right; banked), quaternion. */
function state(m, out = {}) {
  const f = clamp(m / DM, 0, PATH.n - 2), i = Math.floor(f), k = f - i, L = (a) => mix(a[i], a[i + 1], k);
  out.pos = (out.pos || new THREE.Vector3()).set(L(PATH.x), L(PATH.y), L(PATH.z));
  const g = L(PATH.g), psi = L(PATH.psi), bank = L(PATH.bank);
  out.v = L(PATH.v); out.g = g; out.spool = L(PATH.spool);
  out.F = (out.F || new THREE.Vector3()).set(Math.cos(g) * Math.cos(psi), Math.sin(g), Math.cos(g) * Math.sin(psi));
  _r.crossVectors(out.F, _w).normalize(); _u.crossVectors(_r, out.F);
  out.Rf = (out.Rf || new THREE.Vector3()).copy(_r); out.Uf = (out.Uf || new THREE.Vector3()).copy(_u); // unbanked, for cameras
  out.U = (out.U || new THREE.Vector3()).copy(_u).multiplyScalar(Math.cos(bank)).addScaledVector(_r, Math.sin(bank));
  out.R = (out.R || new THREE.Vector3()).copy(_r).multiplyScalar(Math.cos(bank)).addScaledVector(_u, -Math.sin(bank));
  out.q = (out.q || new THREE.Quaternion()).setFromRotationMatrix(_m4.makeBasis(out.F, out.U, out.R));
  out.vel = (out.vel || new THREE.Vector3()).copy(out.F).multiplyScalar(out.v);
  return out;
}
const local = (S, x, y, z, out = new THREE.Vector3()) => out.copy(S.pos).addScaledVector(S.F, x).addScaledVector(S.U, y).addScaledVector(S.R, z);

// ---------- stage ----------
const canvas = document.getElementById('c');
const st = createStage(canvas, document.body);
if (!st) { document.getElementById('err').hidden = false; throw new Error('WebGL unavailable'); }
const { renderer, scene, camera, controls } = st;
controls.enabled = false;
renderer.localClippingEnabled = true;
camera.near = 0.1; camera.far = 60000; camera.updateProjectionMatrix();
scene.background = null;

const SUN = new THREE.Vector3(0.35, 0.27, 0.9).normalize();
const SKY_GLSL = `
uniform vec3 uSun;
vec3 skyColor(vec3 d){
  float e = clamp(d.y, 0.0, 1.0), mu = max(dot(d, uSun), 0.0);
  vec3 col = mix(vec3(0.78, 0.74, 0.70), vec3(0.13, 0.25, 0.55), pow(e, 0.5));
  col += vec3(1.0, 0.6, 0.3)*pow(mu, 6.0)*0.5*(1.0 - e);
  col += vec3(1.0, 0.82, 0.58)*pow(mu, 60.0)*0.7;
  if (d.y < 0.0) col = mix(vec3(0.78, 0.74, 0.70), vec3(0.42, 0.44, 0.46), clamp(-d.y*5.0, 0.0, 1.0));
  return col;
}
vec3 fogged(vec3 col, vec3 wpos, vec3 cam){
  vec3 dv = wpos - cam; float d = length(dv);
  float f = 1.0 - exp(-d/14000.0) * exp(-max(0.0, 0.0));
  return mix(col, skyColor(dv/d), clamp(f, 0.0, 1.0));
}`;
const shared = { uSun: { value: SUN }, uX2: { value: X2 }, uTime: { value: 0 } };

const sun = new THREE.DirectionalLight(lin(0xfff0dc), 2.7); sun.position.copy(SUN).multiplyScalar(100);
const hemi = new THREE.HemisphereLight(lin(0xa9bfe0), lin(0x5a5444), 0.75);
scene.add(sun, sun.target, hemi);

// sky dome follows the camera; the same function feeds the environment map
const skyMat = new THREE.ShaderMaterial({
  uniforms: shared, side: THREE.BackSide, depthWrite: false, depthTest: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
  fragmentShader: SKY_GLSL + `varying vec3 vDir; void main(){ vec3 d = normalize(vDir); vec3 c = skyColor(d);
    float mu = dot(d, uSun); c += vec3(1.0,0.92,0.8)*smoothstep(0.99985, 0.99992, mu)*30.0; gl_FragColor = vec4(c, 1.0); }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), skyMat);
sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
{
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0, 0.1, 1000).texture;
}

// ---------- terrain: polar grid centred under the camera, heights and shading in the shader ----------
{
  const K = 170, A = 256, q = 0.045, pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let k = 1; k <= K; k++) { const r = 1.5 * ((1 + q) ** k - 1) / q; for (let a = 0; a < A; a++) { const th = (a / A) * Math.PI * 2; pos.push(Math.cos(th) * r, 0, Math.sin(th) * r); } }
  for (let a = 0; a < A; a++) idx.push(0, 1 + ((a + 1) % A), 1 + a);
  for (let k = 1; k < K; k++) for (let a = 0; a < A; a++) {
    const i0 = 1 + (k - 1) * A + a, i1 = 1 + (k - 1) * A + ((a + 1) % A), j0 = i0 + A, j1 = i1 + A;
    idx.push(i0, i1, j0, i1, j1, j0);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  var terrain = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: { ...shared, uCenter: { value: new THREE.Vector2() } },
    vertexShader: TERRAIN_GLSL + `uniform vec2 uCenter; varying vec3 vW;
      void main(){ vec2 p = position.xz + uCenter; float h = max(terrainH(p), 0.0); vW = vec3(p.x, h, p.y); gl_Position = projectionMatrix*viewMatrix*vec4(vW, 1.0); }`,
    fragmentShader: NOISE + TERRAIN_GLSL + SKY_GLSL + `uniform float uTime; varying vec3 vW;
      void main(){
        vec2 p = vW.xz; float d = length(cameraPosition - vW);
        float h = terrainH(p);
        vec3 V = normalize(cameraPosition - vW);
        vec3 col;
        if (h < 0.15) { // sea: wind ripples, sky reflection, sun glint, foam at the shore
          float s = 0.035;
          vec2 q = p*s + vec2(uTime*0.05, uTime*0.02);
          float n1 = snoise(vec3(q, uTime*0.15)), n2 = snoise(vec3(q*3.1 + 7.0, uTime*0.3));
          float fade = exp(-d/2500.0);
          vec3 N = normalize(vec3((n1*0.6 + n2*0.4)*0.12*fade + snoise(vec3(p*0.4, uTime*0.6))*0.05*exp(-d/300.0), 1.0, (snoise(vec3(q.yx + 3.0, uTime*0.15))*0.6 + n2*0.4)*0.12*fade));
          vec3 Rf = reflect(-V, N); Rf.y = abs(Rf.y);
          float fr = 0.02 + 0.98*pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 deep = vec3(0.02, 0.06, 0.075) + vec3(0.03, 0.05, 0.04)*max(dot(N, uSun), 0.0);
          col = mix(deep, skyColor(Rf), fr) + vec3(1.0, 0.85, 0.6)*pow(max(dot(Rf, uSun), 0.0), 300.0)*5.0;
          float foam = smoothstep(-2.0, 0.1, h)*(0.5 + 0.5*snoise(vec3(p*0.08, uTime*0.4)));
          col = mix(col, vec3(0.75, 0.78, 0.8), foam*0.6);
        } else {
          float e = max(0.6, d*0.002);
          vec3 N = normalize(vec3(terrainH(p - vec2(e, 0.0)) - terrainH(p + vec2(e, 0.0)), 2.0*e, terrainH(p - vec2(0.0, e)) - terrainH(p + vec2(0.0, e))));
          float n = snoise(vec3(p*0.004, 1.0))*0.5 + snoise(vec3(p*0.03, 2.0))*0.3 + snoise(vec3(p*0.2, 3.0))*0.2*exp(-d/400.0);
          vec3 tundra = mix(vec3(0.19, 0.17, 0.10), vec3(0.28, 0.27, 0.15), 0.5 + 0.5*n);
          tundra = mix(tundra, vec3(0.12, 0.15, 0.08), smoothstep(0.2, 0.6, snoise(vec3(p*0.012, 4.0)))); // dark scrub
          vec3 sand = vec3(0.46, 0.42, 0.33);
          col = mix(sand, tundra, smoothstep(0.6, 3.5, h + n*1.5));
          col = mix(col, vec3(0.33, 0.31, 0.29), smoothstep(0.75, 0.55, N.y)); // rock on steep slopes
          col = mix(col, vec3(0.85, 0.88, 0.9), smoothstep(0.55, 0.8, snoise(vec3(p*0.006, 5.0)) + h*0.004)*smoothstep(0.8, 0.95, N.y)*0.7); // snow patches
          // launch site: concrete apron and access road
          float pad = smoothstep(1.0, -1.0, max(abs(p.x + 8.0) - 20.0, abs(p.y) - 14.0));
          float road = smoothstep(3.5, 3.0, abs(p.y - 4.0*sin(p.x*0.004))) * step(p.x, -26.0);
          col = mix(col, vec3(0.5, 0.49, 0.46)*(0.9 + 0.1*n), max(pad, road));
          float lit = max(dot(N, uSun), 0.0);
          col *= vec3(1.0, 0.94, 0.86)*lit*2.4 + vec3(0.5, 0.58, 0.72)*(0.45 + 0.25*N.y);
        }
        gl_FragColor = vec4(fogged(col, vW, cameraPosition), 1.0);
      }`,
  }));
  terrain.frustumCulled = false; scene.add(terrain);
}

// ---------- materials ----------
const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6); // cutaway plane, world space, set each frame
const std = (hex, o = {}) => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: 0.55, metalness: 0.25, envMapIntensity: 0.6, ...o });
const MAT = {
  skin: std(0x646a58, { side: THREE.DoubleSide, clippingPlanes: [clip], clipShadows: true }),
  dark: std(0x2a2c29, { roughness: 0.7 }),
  wing: std(0x5e6453),
  booster: std(0x9a9c95, { roughness: 0.6 }),
  kicker: std(0x3b3e38),
  nozzle: std(0x2f2b28, { metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide, clippingPlanes: [clip] }),
  canister: std(0x5f654f, { roughness: 0.75, side: THREE.DoubleSide }),
  steel: std(0x50544c, { metalness: 0.5, roughness: 0.5 }),
  concrete: std(0x8c8980, { roughness: 0.95, metalness: 0 }),
  // cutaway internals
  duct: std(0xa9adb2, { metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide, clippingPlanes: [clip] }),
  blade: std(0xc6c9cc, { metalness: 0.9, roughness: 0.3, clippingPlanes: [clip] }),
  hot: std(0x9b7a5c, { metalness: 0.85, roughness: 0.35, clippingPlanes: [clip] }),
  vessel: std(0x6e7378, { metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide, clippingPlanes: [clip] }),
  shield: std(0x3d4148, { metalness: 0.6, roughness: 0.5, clippingPlanes: [clip] }),
  fuel: new THREE.MeshStandardMaterial({ color: lin(0x2a1a10), emissive: lin(0xff7a2a), emissiveIntensity: 0, roughness: 0.6, clippingPlanes: [clip] }),
  payload: std(0x4b5244, { roughness: 0.8, clippingPlanes: [clip] }),
  avionics: std(0x2d3a45, { roughness: 0.6, clippingPlanes: [clip] }),
};

// ---------- vehicle (Table 1: 9.51 m, 0.846 × 0.561 m section, 5.6 m span, 14.8° sweep) ----------
const LEN = 9.51, HW = 0.423, HH = 0.2805, XN = LEN / 2, XT = -LEN / 2;
function fuselageGeo() {
  const NX = 90, NA = 56, pos = [], idx = [];
  const scale = x => { // blunt nose over the front 1.2 m, slight boat-tail at the back
    if (x > XN - 1.2) { const u = (x - (XN - 1.2)) / 1.2; return Math.sqrt(Math.max(0, 1 - u ** 2.2)) * 0.97 + 0.03 * (1 - u); }
    if (x < XT + 0.9) return mix(0.78, 1, (x - XT) / 0.9);
    return 1;
  };
  for (let i = 0; i <= NX; i++) {
    const u = i / NX, x = XT + (XN - XT) * (1 - (1 - u) ** 1.0), s = i === NX ? 0 : scale(x);
    for (let a = 0; a < NA; a++) {
      const th = (a / NA) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      pos.push(x, Math.sign(sn) * Math.abs(sn) ** 0.45 * HH * s, Math.sign(c) * Math.abs(c) ** 0.45 * HW * s);
    }
  }
  for (let i = 0; i < NX; i++) for (let a = 0; a < NA; a++) {
    const p = i * NA + a, q = i * NA + ((a + 1) % NA);
    idx.push(p, p + NA, q, q, p + NA, q + NA);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// thin lifting surface: planform in (x, s) extruded through its thickness; s → +z (or −z when mirrored)
function surfaceGeo(pts, t, mirror = 1) {
  const sh = new THREE.Shape(pts.map(([x, s]) => new THREE.Vector2(x, s * mirror)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: true, bevelThickness: t * 0.4, bevelSize: t * 0.6, bevelSegments: 2 });
  g.rotateX(Math.PI / 2); g.translate(0, t / 2, 0); g.computeVertexNormals();
  return g;
}
const alongX = g => g.rotateZ(-Math.PI / 2); // three.js cylinders run along +y; ours run along +x

function buildMissile() {
  const root = new THREE.Group();
  const skin = new THREE.Mesh(fuselageGeo(), MAT.skin); root.add(skin);
  // panel lines and a dark nose band
  const tailCap = new THREE.Mesh(new THREE.BoxGeometry(0.02, HH * 1.5, HW * 1.5), MAT.nozzle); tailCap.position.x = XT + 0.01; root.add(tailCap);
  // ventral intake (fixed), x 1.3–2.5
  const intake = new THREE.Group();
  const lip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.46), MAT.skin); lip.position.set(1.85, -HH - 0.07, 0);
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.12), new THREE.MeshBasicMaterial({ color: 0x050505 }));
  mouth.rotation.y = Math.PI / 2; mouth.position.set(2.452, -HH - 0.07, 0);
  intake.add(lip, mouth); root.add(intake);
  // tail nozzle
  const noz = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.2, 0.17, 0.5, 28, 1, true)), MAT.nozzle); noz.position.x = XT + 0.1; root.add(noz);
  const nozGlow = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  nozGlow.rotation.y = -Math.PI / 2; nozGlow.position.x = XT + 0.2; root.add(nozGlow);

  // wings: one pivot on the spine, folded aft over the back in the canister
  const wingPts = [[0.36, 0], [0.36 - 2.75 * 0.306, 2.75], [0.36 - 2.75 * 0.306 - 0.46, 2.75], [-0.35, 0]];
  const wings = [1, -1].map((side, k) => {
    const piv = new THREE.Group(); piv.position.set(0.55, HH + 0.012 + k * 0.045, 0);
    piv.add(new THREE.Mesh(surfaceGeo(wingPts, 0.035, side), MAT.wing)); root.add(piv); piv.userData.side = side; return piv;
  });
  // tail: vertical fin on top, two low horizontal stabilisers (2.38 m span), hinged along x
  const finPts = [[0.0, 0], [-0.32, 0.72], [-0.6, 0.72], [-0.52, 0]];
  const fin = new THREE.Group(); fin.position.set(XT + 0.95, HH, 0);
  const finMesh = new THREE.Mesh(surfaceGeo(finPts, 0.03), MAT.wing); finMesh.rotation.x = -Math.PI / 2; fin.add(finMesh); root.add(fin);
  const stabPts = [[0.0, 0], [-0.3, 0.77], [-0.55, 0.77], [-0.5, 0]];
  const stabs = [1, -1].map(side => { const g = new THREE.Group(); g.position.set(XT + 0.95, -HH * 0.5, side * HW * 0.95); g.add(new THREE.Mesh(surfaceGeo(stabPts, 0.03, side), MAT.wing)); g.userData.side = side; root.add(g); return g; });

  // kicker: single aft solid motor
  const kicker = new THREE.Group();
  kicker.add(new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.31, 0.31, 1.45, 32)), MAT.kicker));
  kicker.children[0].position.x = -0.725;
  const kb = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.14, 0.26, 0.35, 28, 1, true)), MAT.nozzle); kb.position.x = -1.62; kicker.add(kb);
  const ring = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.33, 0.33, 0.06, 32)), MAT.dark); ring.position.x = -0.03; kicker.add(ring);
  kicker.position.x = XT; root.add(kicker);

  // twin strap-on boosters on the lower flanks
  const srbs = [1, -1].map(side => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.17, 0.17, 2.4, 28)), MAT.booster); g.add(body);
    const cone = new THREE.Mesh(alongX(new THREE.ConeGeometry(0.17, 0.45, 28)), MAT.booster); cone.position.x = 1.42; g.add(cone);
    const bell = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.08, 0.15, 0.28, 24, 1, true)), MAT.nozzle); bell.position.x = -1.34; g.add(bell);
    for (const x of [0.8, -0.8]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.12), MAT.dark); st.position.set(x, 0.06, -side * 0.15); g.add(st); }
    g.userData.side = side; g.userData.home = new THREE.Vector3(-2.75, -0.13, side * (HW + 0.17)); g.userData.cant = side * 6 * DEG;
    g.position.copy(g.userData.home); g.rotation.y = g.userData.cant; root.add(g); return g;
  });

  // ---- internals, seen in the cutaway ----
  const inner = new THREE.Group(); root.add(inner);
  const label = {};
  // avionics and guidance in the nose
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.4), MAT.avionics); b.position.set(3.85 - i * 0.22, 0, 0); inner.add(b); }
  label.avionics = new THREE.Vector3(3.6, 0.15, 0.1);
  const pay = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.36, 0.56), MAT.payload); pay.position.set(2.55, 0.02, 0); inner.add(pay);
  label.payload = new THREE.Vector3(2.55, 0.2, 0.15);
  const shield = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.3, 0.33, 0.32, 40)), MAT.shield); shield.position.set(1.66, 0.04, 0); inner.add(shield);
  label.shield = new THREE.Vector3(1.66, 0.25, 0.1);
  const duct = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(2.45, -0.35, 0), new THREE.Vector3(1.8, -0.34, 0), new THREE.Vector3(1.2, -0.24, 0), new THREE.Vector3(0.95, -0.06, 0), new THREE.Vector3(0.8, 0, 0)]), 40, 0.13, 24, false), MAT.duct);
  inner.add(duct);
  label.intake = new THREE.Vector3(2.1, -0.36, 0.1);
  const casing = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.3, 0.3, 4.05, 48, 1, true)), MAT.duct); casing.position.x = -1.2; inner.add(casing);
  const shaft = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.03, 0.03, 3.3, 12)), MAT.blade); shaft.position.x = -0.8; inner.add(shaft);
  // compressor and turbine stages: discs with blades, spun by spool angle
  const rotor = (x0, n, dx, rIn, rOut, mat) => {
    const g = new THREE.Group();
    const bladeGeo = new THREE.BoxGeometry(0.035, rOut - rIn, 0.012); bladeGeo.translate(0, (rIn + rOut) / 2, 0);
    for (let s = 0; s < n; s++) {
      const hub = new THREE.Mesh(alongX(new THREE.CylinderGeometry(rIn, rIn, 0.06, 24)), mat); hub.position.x = x0 - s * dx; g.add(hub);
      const nb = 20;
      const inst = new THREE.InstancedMesh(bladeGeo, mat, nb);
      for (let b = 0; b < nb; b++) { _m4.makeRotationX((b / nb) * Math.PI * 2 + s * 0.2).multiply(new THREE.Matrix4().makeRotationY(0.5)); _m4.setPosition(x0 - s * dx, 0, 0); inst.setMatrixAt(b, _m4); }
      g.add(inst);
    }
    return g;
  };
  const comp = rotor(0.7, 6, 0.15, 0.09 /*hub grows*/, 0.27, MAT.blade); inner.add(comp);
  label.compressor = new THREE.Vector3(0.35, 0.28, 0.12);
  const turb = rotor(-2.0, 2, 0.18, 0.12, 0.27, MAT.hot); inner.add(turb);
  label.turbine = new THREE.Vector3(-2.1, 0.28, 0.12);
  // reactor: pressure vessel with a hexagonal array of fuel channels
  const vessel = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.29, 0.29, 1.7, 48, 1, true)), MAT.vessel); vessel.position.x = -1.05; inner.add(vessel);
  for (const x of [-0.2, -1.9]) { const plate = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.29, 0.29, 0.04, 48)), MAT.vessel); plate.position.x = x; inner.add(plate); }
  const rods = [];
  for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) { const y = 0.042 * (i + j * 0.5), z = 0.042 * j * 0.866; if (Math.hypot(y, z) < 0.25 && Math.hypot(y, z) > 0.04) rods.push([y, z]); }
  const fuel = new THREE.InstancedMesh(alongX(new THREE.CylinderGeometry(0.015, 0.015, 1.62, 8)), MAT.fuel, rods.length);
  rods.forEach(([y, z], k) => { _m4.makeTranslation(-1.05, y, z); fuel.setMatrixAt(k, _m4); });
  inner.add(fuel);
  label.reactor = new THREE.Vector3(-1.05, 0.29, 0.12);
  // interburner ring with spray bars, then the nozzle
  const ib = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.018, 10, 40), MAT.hot); ib.rotation.y = Math.PI / 2; ib.position.x = -2.55; inner.add(ib);
  for (let k = 0; k < 6; k++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.02), MAT.hot); bar.position.set(-2.55, 0, 0); bar.rotation.x = (k / 6) * Math.PI * 2; bar.geometry = bar.geometry.clone().translate(0, 0.1, 0); inner.add(bar); }
  label.interburner = new THREE.Vector3(-2.6, -0.22, 0.12);
  const lathe = new THREE.LatheGeometry([new THREE.Vector2(0.29, 0), new THREE.Vector2(0.27, -0.6), new THREE.Vector2(0.19, -1.3), new THREE.Vector2(0.17, -1.55)], 40);
  lathe.rotateZ(Math.PI / 2); // lathe runs along +y; x' = -y so the profile runs aft along −x
  const nozIn = new THREE.Mesh(lathe, MAT.duct); nozIn.position.x = -3.1; inner.add(nozIn);
  label.nozzle = new THREE.Vector3(-4.1, 0.15, 0.1);
  inner.visible = false;

  return { root, skin, wings, fin, stabs, kicker, srbs, inner, comp, turb, fuel, nozGlow, label };
}
const V = buildMissile();
scene.add(V.root);

// flow tracers for the cutaway: cold air in through the intake, heated in the core, out of the nozzle
const FLOW = [[2.6, -0.35], [1.8, -0.34], [1.2, -0.24], [0.9, -0.05], [0.7, 0], [-0.2, 0], [-1.9, 0], [-2.4, 0], [-3.1, 0], [-4.65, 0], [-6.5, 0]].map(([x, y]) => new THREE.Vector3(x, y, 0));
const FLOW_LEN = FLOW.slice(1).reduce((s, p, i) => s + p.distanceTo(FLOW[i]), 0);
const flow = (() => {
  const N = 900, r = rng(7), geo = new THREE.BufferGeometry();
  const seed = new Float32Array(N * 3); for (let i = 0; i < N; i++) seed.set([r(), r() * 2 - 1, r() * 2 - 1], i * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; V.root.add(pts);
  const cold = new THREE.Color(0.35, 0.65, 1.6), warm = new THREE.Color(2.4, 0.9, 0.25), c = new THREE.Color(), p = new THREE.Vector3();
  return {
    pts,
    update(m, on) {
      pts.visible = on > 0.01; if (!pts.visible) return;
      pts.material.opacity = on;
      const P = geo.attributes.position.array, C = geo.attributes.color.array;
      for (let i = 0; i < N; i++) {
        let d = ((seed[i * 3] + m * 0.9) % 1) * FLOW_LEN, k = 0;
        while (k < FLOW.length - 2 && d > FLOW[k].distanceTo(FLOW[k + 1])) { d -= FLOW[k].distanceTo(FLOW[k + 1]); k++; }
        p.lerpVectors(FLOW[k], FLOW[k + 1], Math.min(1, d / FLOW[k].distanceTo(FLOW[k + 1])));
        const rad = p.x > -4.7 ? (p.x > 0.8 ? 0.1 : 0.2) : 0.15 + (-4.7 - p.x) * 0.06;
        P[i * 3] = p.x; P[i * 3 + 1] = p.y + seed[i * 3 + 1] * rad; P[i * 3 + 2] = seed[i * 3 + 2] * rad;
        const heat = sstep(-0.3, -1.8, p.x) * (1 - sstep(-4.7, -6.5, p.x) * 0.6);
        c.copy(cold).lerp(warm, heat); C[i * 3] = c.r; C[i * 3 + 1] = c.g; C[i * 3 + 2] = c.b;
      }
      geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = true;
    },
  };
})();

// ---------- launch site: canister on an inclined launcher, roll-back shelter, apron furniture ----------
const site = new THREE.Group(); scene.add(site);
const canister = new THREE.Group(); canister.position.copy(CANISTER); canister.rotation.z = LAUNCH_ELEV; site.add(canister);
{
  const L = 11.8, W = 2.0, H = 1.15, t = 0.06; // wide enough for the strapped-on boosters
  for (const [h, w, y, z] of [[t, W, H / 2, 0], [t, W, -H / 2, 0], [H, t, 0, W / 2], [H, t, 0, -W / 2]]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(L, h, w), MAT.canister); s.position.set(0, y, z); canister.add(s);
  }
  for (const x of [-5.2, -1.8, 1.8, 5.2]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.18, H + 0.1, W + 0.1), MAT.steel); band.position.x = x; canister.add(band); }
  // launcher: base frame and two struts holding the canister at 18°
  const base = new THREE.Mesh(new THREE.BoxGeometry(14, 0.6, 3.2), MAT.steel); base.position.set(-0.5, 6.3, 0); site.add(base);
  for (const [x, hgt] of [[-4.2, 0.95], [3.6, 3.5]]) for (const z of [-1.1, 1.1]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.25, hgt, 0.25), MAT.steel); s.position.set(x, 6.55 + hgt / 2, z); site.add(s);
  }
  const pivot = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.2, 0.2, 3.0, 16)).rotateY(Math.PI / 2), MAT.steel); pivot.position.set(-4.2, 7.4, 0); site.add(pivot);
  // roll-back shelter on rails behind the launcher
  const shelter = new THREE.Group(); shelter.position.set(-34, 6, 0); site.add(shelter);
  const shW = 9, shH = 7, shL = 18;
  for (const [w, h, d, x, y, z] of [[shL, 0.3, shW, 0, shH, 0], [shL, shH, 0.3, 0, shH / 2, shW / 2], [shL, shH, 0.3, 0, shH / 2, -shW / 2], [0.3, shH, shW, -shL / 2, shH / 2, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(0x7d806f, { roughness: 0.8 })); b.position.set(x, y, z); shelter.add(b);
  }
  for (const z of [-3.2, 3.2]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(60, 0.15, 0.2), MAT.steel); rail.position.set(-20, 6.08, z); site.add(rail); }
  // blast wall, service building, light masts
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4, 26), MAT.concrete); wall.position.set(-16, 8, 0); site.add(wall);
  const bldg = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 10), std(0x8a8574, { roughness: 0.9 })); bldg.position.set(-70, 9, 40); site.add(bldg);
  const bldg2 = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 8), std(0x6f6c60, { roughness: 0.9 })); bldg2.position.set(-60, 8, -45); site.add(bldg2);
  for (const [x, z] of [[18, 22], [18, -22], [-28, 24], [-28, -24]]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 22, 8), MAT.steel); mast.position.set(x, 17, z); site.add(mast);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.5), MAT.dark); lamp.position.set(x, 28, z); site.add(lamp);
  }
}
// canister front cover, blown off at ignition
const cover = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.15, 2.0), MAT.steel); scene.add(cover);

// ---------- exhaust plumes (additive cones along local −x) ----------
function makePlume(len, rad, core, outer) {
  const geo = alongX(new THREE.CylinderGeometry(1, 1, 1, 28, 40, true).translate(0, -0.5, 0));
  const U = { uTime: shared.uTime, uLen: { value: len }, uRad: { value: rad }, uInt: { value: 0 }, uCore: { value: new THREE.Vector3(...core) }, uOuter: { value: new THREE.Vector3(...outer) } };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: NOISE + `uniform float uLen, uRad, uTime; varying float vU; varying vec3 vN, vV, vL;
      void main(){
        float u = -position.x; vec2 rr = position.yz;
        float r = uRad*(0.55 + 1.7*pow(u, 0.7))*(1.0 + 0.12*snoise(vec3(rr*2.0, u*6.0 - uTime*30.0)));
        vec3 lp = vec3(-u*uLen, rr*r);
        vec4 w = modelMatrix*vec4(lp, 1.0);
        vN = normalize(mat3(modelMatrix)*vec3(0.0, rr)); vV = normalize(cameraPosition - w.xyz); vU = u; vL = lp;
        gl_Position = projectionMatrix*viewMatrix*w;
      }`,
    fragmentShader: NOISE + `uniform float uTime, uInt, uLen; uniform vec3 uCore, uOuter; varying float vU; varying vec3 vN, vV, vL;
      void main(){
        float body = pow(abs(dot(vN, vV)), 1.4);
        float fall = exp(-vU*2.8)*smoothstep(1.0, 0.55, vU)*smoothstep(0.0, 0.02, vU);
        float n = snoise(vec3(vL.x*0.9 + uTime*40.0, vL.y*3.0, vL.z*3.0));
        vec3 col = mix(uOuter, uCore, exp(-vU*7.0))*(0.7 + 0.45*n);
        gl_FragColor = vec4(col*body*fall*uInt, 1.0);
      }`,
  }));
  mesh.frustumCulled = false;
  return { mesh, U };
}
const plKick = makePlume(8, 0.26, [3.2, 2.6, 1.9], [2.2, 0.9, 0.3]); plKick.mesh.position.x = -1.78; V.kicker.add(plKick.mesh);
const plSrb = V.srbs.map(g => { const p = makePlume(7, 0.14, [3.2, 2.7, 2.0], [2.3, 1.0, 0.35]); p.mesh.position.x = -1.47; g.add(p.mesh); return p; });
const plJet = makePlume(3.2, 0.15, [2.6, 1.5, 0.7], [1.6, 0.55, 0.2]); plJet.mesh.position.x = XT + 0.2; V.root.add(plJet.mesh);
const plGlow = new THREE.PointLight(lin(0xffa860), 0, 80, 2); scene.add(plGlow);

// ---------- smoke: deterministic puffs, each a pure function of mission time ----------
// Every puff is emitted at a fixed mission time from a known emitter state, so any frame can be computed directly.
const puffs = [];
const WIND = new THREE.Vector3(1.0, 0, 2.6);
{
  const r = rng(42), S = {}, tmp = new THREE.Vector3(), add = o => puffs.push(o);
  const jit = (s) => new THREE.Vector3((r() - 0.5) * s, (r() - 0.5) * s, (r() - 0.5) * s);
  const rear = CANISTER.clone().addScaledVector(AXIS, -5.9), front = CANISTER.clone().addScaledVector(AXIS, 5.9);
  // hot launch: exhaust blasts out of the canister's open back and hits the apron; then gas pushes out ahead of the nose
  for (let m = 0.0; m < 0.9; m += 0.006) {
    add({ m, p: rear.clone().add(jit(0.6)), v: AXIS.clone().multiplyScalar(-45).add(jit(30)).setY(-8 + r() * 6), tau: 0.35, s0: 0.9, grow: 3.2, life: 30, a: 0.75, heat: 1, tint: 0 });
    if (r() < 0.6) add({ m, p: new THREE.Vector3(-8 + r() * 6, 6.6, (r() - 0.5) * 3), v: new THREE.Vector3(-10 - r() * 15, 1 + r() * 3, (r() - 0.5) * 50), tau: 1.0, s0: 1.4, grow: 3.6, life: 30, a: 0.55, heat: 0.3, tint: 1 });
  }
  for (let m = 0.15; m < 0.85; m += 0.01) add({ m, p: front.clone().add(jit(0.5)), v: AXIS.clone().multiplyScalar(18).add(jit(14)), tau: 0.4, s0: 0.7, grow: 2.2, life: 25, a: 0.5, heat: 0.4, tint: 0 });
  // kicker and boosters: trail from the nozzle, exhaust slowing quickly in the air
  const trail = (m0, m1, dm, nozzle, a, grow, life) => {
    for (let m = m0; m < m1; m += dm) {
      state(m, S); const p = nozzle(S, tmp).clone().add(jit(0.15));
      add({ m, p, v: S.vel.clone().multiplyScalar(0.12).addScaledVector(S.F, -35).add(jit(6)), tau: 0.45, s0: 0.5, grow, life, a, heat: 1, tint: 0 });
    }
  };
  trail(0.25, mE.KBO, 0.012, (S, o) => local(S, XT - 1.8, 0, 0, o), 0.6, 2.6, 60);
  for (const side of [1, -1]) trail(mE.SIGN + 0.02, mE.SBO, 0.035, (S, o) => local(S, -2.75 - 1.5, -0.13, side * (HW + 0.17 + 0.16), o), 0.55, 3.0, 70);
  // the reactor's exhaust carries activation gases: shown as a faint violet wake, not something visible to the eye
  for (let m = M(147); m < M(DUR); m += 0.02) {
    state(m, S); add({ m, p: local(S, XT - 0.4, 0, 0, tmp).clone(), v: S.vel.clone().multiplyScalar(0.15).add(jit(1.2)), tau: 0.5, s0: 0.25, grow: 1.6, life: 5, a: 0.5, heat: 0, tint: 1.5 });
  }
}
const SMOKE_MAX = puffs.length;
const smoke = (() => {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_MAX * 3), 3), iP = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_MAX * 4), 4);
  iPos.setUsage(THREE.DynamicDrawUsage); iP.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos); geo.setAttribute('iP', iP); // iP: size, alpha, heat, tint
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: shared, transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 iPos; attribute vec4 iP; varying vec2 vUv; varying vec4 vP; varying vec3 vR, vUp, vW; varying float vSeed;
      void main(){
        vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float a = fract(sin(dot(iPos.xz, vec2(12.9, 78.2)))*43758.5)*6.283; vSeed = a;
        vec2 c = mat2(cos(a), -sin(a), sin(a), cos(a))*position.xy;
        vec3 w = iPos + (r*c.x + u*c.y)*iP.x;
        vUv = position.xy; vP = iP; vR = r; vUp = u; vW = w;
        gl_Position = projectionMatrix*viewMatrix*vec4(w, 1.0);
      }`,
    fragmentShader: NOISE + SKY_GLSL + `varying vec2 vUv; varying vec4 vP; varying vec3 vR, vUp, vW; varying float vSeed;
      void main(){
        float r2 = dot(vUv, vUv);
        float n = snoise(vec3(vUv*1.7, vSeed*3.0))*0.5 + snoise(vec3(vUv*4.0, vSeed*7.0))*0.25;
        float dens = smoothstep(1.0, 0.25, r2 + n*0.45);
        if (dens < 0.003) discard;
        vec3 toCam = normalize(cameraPosition - vW);
        vec3 N = normalize(vR*vUv.x + vUp*vUv.y + toCam*sqrt(max(0.0, 1.0 - r2)) + (vR + vUp)*n*0.3);
        float lit = 0.5 + 0.5*dot(N, uSun);
        vec3 col = vec3(0.78, 0.77, 0.75)*(vec3(1.0, 0.92, 0.82)*lit*1.15 + vec3(0.32, 0.38, 0.48));
        col = mix(col, vec3(0.62, 0.55, 0.45)*(0.5 + 0.7*lit), clamp(vP.w, 0.0, 1.0));            // dust
        col += vec3(3.0, 1.35, 0.4)*vP.z*(1.0 - r2);                                               // incandescent near the nozzle
        float alpha = dens*vP.y;
        if (vP.w > 1.2) { col = vec3(0.75, 0.45, 1.5); alpha *= 0.9; }                              // activation-gas wake
        gl_FragColor = vec4(fogged(col, vW, cameraPosition), alpha);
      }`,
  }));
  mesh.frustumCulled = false; mesh.renderOrder = 5; scene.add(mesh);
  const order = new Uint32Array(SMOKE_MAX), depth = new Float32Array(SMOKE_MAX), pos = new Float32Array(SMOKE_MAX * 3), prm = new Float32Array(SMOKE_MAX * 4);
  const p = new THREE.Vector3();
  return {
    update(m) {
      let n = 0;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (let i = 0; i < SMOKE_MAX; i++) {
        const q = puffs[i], age = m - q.m;
        if (age < 0 || age > q.life) continue;
        const k = q.tau * (1 - Math.exp(-age / q.tau));
        p.copy(q.p).addScaledVector(q.v, k).addScaledVector(WIND, age * (q.tint > 1.2 ? 0.2 : 1)); p.y += age * 0.5;
        const size = q.s0 + q.grow * Math.sqrt(age) + 0.25 * age;
        p.y = Math.max(p.y, terrainH(p.x, p.z) + size * 0.45);
        const a = q.a * sstep(0, 0.04, age) * (1 - sstep(q.life * 0.45, q.life, age));
        pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
        prm[n * 4] = size; prm[n * 4 + 1] = a; prm[n * 4 + 2] = q.heat * Math.exp(-age / 0.12); prm[n * 4 + 3] = q.tint;
        depth[n] = (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2; order[n] = n; n++;
      }
      const ord = Array.from(order.subarray(0, n)).sort((a, b) => depth[b] - depth[a]);
      for (let j = 0; j < n; j++) { const i = ord[j]; iPos.array.set(pos.subarray(i * 3, i * 3 + 3), j * 3); iP.array.set(prm.subarray(i * 4, i * 4 + 4), j * 4); }
      iPos.needsUpdate = iP.needsUpdate = true; geo.instanceCount = n;
    },
  };
})();

// ---------- jettisoned hardware: ballistic with drag, tumbling ----------
function debrisTrack(m0, attach, push, spin, k) {
  const S = state(m0), p = attach(S, new THREE.Vector3()), v = S.vel.clone().addScaledVector(S.R, push[0]).addScaledVector(S.U, push[1]).addScaledVector(S.F, push[2]);
  const q0 = S.q.clone(), dt = 1 / 120, n = 120 * 40, P = [];
  for (let i = 0; i < n; i++) {
    P.push(p.clone());
    const sp = v.length(); v.addScaledVector(v, -k * sp * dt); v.y -= 9.81 * dt; p.addScaledVector(v, dt);
    const g = terrainH(p.x, p.z); if (p.y < g) { p.y = g; v.set(0, 0, 0); }
  }
  return { m0, q0, spin, P, at(m, obj) {
    const a = clamp(m - m0, 0, 39.9), f = a * 120, i = Math.floor(f);
    obj.position.lerpVectors(P[i], P[i + 1], f - i);
    obj.quaternion.copy(q0).multiply(new THREE.Quaternion().setFromAxisAngle(spin.axis, spin.w * a));
  } };
}
const kickTrack = debrisTrack(mE.KSEP, (S, o) => local(S, XT, 0, 0, o), [0, -1.5, -6], { axis: new THREE.Vector3(0.3, 0.2, 1).normalize(), w: 1.4 }, 0.006);
const srbTrack = V.srbs.map(g => debrisTrack(mE.SSEP, (S, o) => local(S, g.userData.home.x, g.userData.home.y, g.userData.home.z, o), [g.userData.side * 6, -2.5, -4],
  { axis: new THREE.Vector3(0.2, 0.4 * g.userData.side, 1 * g.userData.side).normalize(), w: 1.6 }, 0.004));
const coverTrack = (() => { const p = CANISTER.clone().addScaledVector(AXIS, 5.95), v = AXIS.clone().multiplyScalar(28).add(new THREE.Vector3(0, 6, 3)); return m => {
  const a = Math.max(0, m - 0.03); const q = p.clone().addScaledVector(v, a); q.y -= 4.9 * a * a; q.y = Math.max(q.y, terrainH(q.x, q.z) + 0.6);
  cover.position.copy(m < 0.03 ? p : q); cover.rotation.set(0, 0, LAUNCH_ELEV + a * 7);
}; })();

// ---------- HUD ----------
const $ = id => document.getElementById(id);
const TICKS = [[E.IGN, 'Launch'], [E.KSEP, 'Kicker sep'], [E.SIGN, 'Boost'], [E.SSEP, 'Booster sep'], [E.CRIT, 'Reactor critical'], [E.CRUISE, 'Nuclear cruise']];
for (const [t, txt] of TICKS) { const d = document.createElement('div'); d.className = 'tick'; d.style.left = `${(t / DUR) * 100}%`; d.innerHTML = `<span>${txt}</span>`; d.dataset.t = t; $('tl').appendChild(d); }
const CAPS = [
  [16.6, 24, 'Hot launch', 'A single aft-mounted solid "kicker" drives the missile out of its canister'],
  [25, 32.5, 'Wings and tail deploy', '9.5 m long · 5.6 m span · ~3,340 kg (photogrammetric estimate)'],
  [37.2, 45, 'Kicker separation', 'The spent kicker drops away and twin solid rocket boosters light'],
  [54, 64, 'A proposed boost sequence', 'The paper also notes that the twin boosters may be for testing only (Fig. 4)'],
  [68, 80, '6° climb', 'A sizing case for the propulsion system: sustained 6° climb at optimum Mach'],
  [88, 100, 'Booster separation', 'High subsonic now, about Mach 0.8, with no chemical boost left'],
  [106.5, 116, 'Direct-cycle nuclear turbojet', 'Air is compressed, heated directly in the reactor core, then expanded through the turbine and nozzle'],
  [117, 125.5, 'Reactor to power', 'Reactors change power slowly; a chemical interburner bridges the gap'],
  [126.5, 134, '~4.3 MWth at cruise', 'Peak demand in climbs and terminal manoeuvres is over 15 MWth'],
  [137.5, 147.5, 'Nuclear cruise', 'A proposed subsonic, low-altitude cruise phase with extended endurance'],
  [150, 161.5, 'Radioactive wake', 'Over 5 TBq of gaseous radionuclides per MW·h (⁴¹Ar, ⁸⁵ᵐKr, ⁸³ᵐKr, ¹⁴C). Shown in violet; invisible in reality'],
];
const PHASES = [
  [0, 'Pre-launch', 'Canister on launcher'], [E.IGN, 'Hot launch', 'Kicker burning'], [E.KBO, 'Kicker burnout', 'Coast, wings deployed'],
  [E.KSEP, 'Kicker separation', 'Slow motion'], [E.SIGN, 'Boost', 'Twin SRBs'], [E.SBO, 'Booster burnout', 'Slow motion'], [E.SSEP, 'Booster separation', 'Turbojet start'],
  [104, 'Engine change-over', 'Cutaway'], [E.CRUISE, 'Nuclear cruise', 'Terrain following'], [E.WARP, 'Nuclear cruise', 'Time-lapse'],
];
const LABELS = [
  ['avionics', 'Guidance', '', [-40, -120]], ['payload', 'Payload bay', '', [-10, -150]], ['shield', 'Shadow shield', 'protects payload & avionics', [30, -110]],
  ['intake', 'Ventral intake', '', [-30, 110]], ['compressor', 'Compressor', '', [10, -150]], ['reactor', 'Reactor core', 'UN–SiC fuel, ~4–15 MWth', [0, -125]],
  ['turbine', 'Turbine', '', [20, -150]], ['interburner', 'Chemical interburner', 'fast power for transients', [10, 120]], ['nozzle', 'Nozzle', '', [40, -110]],
];
const labelEls = LABELS.map(([key, t, sub]) => { const d = document.createElement('div'); d.className = 'lbl'; d.innerHTML = `${t}${sub ? `<small>${sub}</small>` : ''}`; $('labels').appendChild(d); return d; });
const lineEls = LABELS.map(() => {
  const ns = 'http://www.w3.org/2000/svg', g = document.createElementNS(ns, 'g');
  const l = document.createElementNS(ns, 'line'), c = document.createElementNS(ns, 'circle'); c.setAttribute('r', '3'); g.append(l, c); $('lines').appendChild(g); return { g, l, c };
});
const fmtClock = s => { const sg = s < 0 ? '−' : '+'; s = Math.abs(Math.round(s)); return `T${sg}${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

function reactorPower(t, S) {
  if (t < E.CRIT) return 0;
  const cruise = clamp(4.3 * (1 + 9.9 * Math.sin(S.g)), 1.8, 15);
  return cruise * sstep(E.CRIT, E.CRIT + 20, t) + 0.6 * win(t, E.CRIT, E.CRIT + 22, 6);
}
const warpRate = t => 1 + 1199 * sstep(E.WARP, E.WARP + 9, t);
const metDisplay = (() => { let acc = 0; const tab = []; for (let t = 0; t <= DUR + 0.01; t += 0.05) { tab.push(acc); acc += (M(t + 0.05) - M(t)) * warpRate(t); } return t => tab[Math.min(tab.length - 1, Math.round(t / 0.05))] + M(0); })();

function hud(t, m, S) {
  const vis = v => String(Math.round(v * 1000) / 1000);
  $('hud').style.opacity = vis(1 - win(t, 1.0, 13, 1.5) * 0.85 - sstep(E.WARP + 3, E.WARP + 6, t) * 0.75);
  $('titleCard').style.opacity = vis(win(t, 1.5, 12.5, 1.6));
  $('endCard').style.opacity = vis(sstep(E.WARP + 4, E.WARP + 6.5, t));
  $('fill').style.width = `${(t / DUR) * 100}%`;
  for (const el of $('tl').querySelectorAll('.tick')) el.classList.toggle('done', t >= +el.dataset.t);
  let cap = null; for (const c of CAPS) if (t >= c[0] - 0.5 && t <= c[1] + 0.5) cap = c;
  const ce = $('cap');
  if (cap) { if (ce.dataset.k !== cap[2]) { ce.innerHTML = `${cap[2]}<small>${cap[3]}</small>`; ce.dataset.k = cap[2]; } ce.style.opacity = vis(win(t, cap[0], cap[1], 0.6)); } else ce.style.opacity = '0';
  let ph = PHASES[0]; for (const p of PHASES) if (t >= p[0]) ph = p;
  $('phase').textContent = ph[1]; $('phaseSub').textContent = ph[2];
  const v = t < E.IGN ? 0 : S.v, mach = v / 340, alt = t < E.IGN ? 8 : S.pos.y;
  $('mach').textContent = mach.toFixed(2); $('machBar').style.width = `${clamp(mach / 0.9, 0, 1) * 100}%`;
  $('alt').innerHTML = `${Math.round(alt).toLocaleString('en-US')}<small>m</small>`; $('altBar').style.width = `${clamp(alt / 1500, 0, 1) * 100}%`;
  const prop = t < E.IGN ? 'In canister' : t < E.KBO ? 'Solid kicker' : t < E.SIGN ? 'Coast' : t < E.SBO ? 'Twin solid boosters' : t < E.TJ ? 'Coast' : t < E.CRIT ? 'Turbojet + interburner' : t < 128 ? 'Nuclear + interburner' : 'Direct-cycle nuclear';
  $('prop').textContent = prop;
  const P = reactorPower(t, S);
  $('pwr').innerHTML = t < E.CRIT ? `Subcrit.<small></small>` : `${P.toFixed(1)}<small>MWth</small>`; $('pwrBar').style.width = `${clamp(P / 15, 0, 1) * 100}%`;
  $('clk').textContent = fmtClock(metDisplay(t));
  const rate = (M(t + 0.02) - M(t)) / 0.02 * warpRate(t);
  $('warp').textContent = rate < 0.95 ? `${rate.toFixed(2)}× slow motion` : rate < 1.05 ? '1×' : `${Math.round(rate)}×`;
}

// ---------- camera choreography ----------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const S = {}, S2 = {};
const ease = u => u * u * (3 - 2 * u);
function shot(t, m) {
  state(Math.max(m, 0), S);
  const cam = camera.position, tgt = _a;
  let fov = 38, near = 0.15;
  const rel = (f, u, r) => cam.copy(S.pos).addScaledVector(S.F, f).addScaledVector(S.Uf, u).addScaledVector(S.Rf, r);
  const keepAbove = (h = 2) => { cam.y = Math.max(cam.y, terrainH(cam.x, cam.z) + h); };
  if (t < 7.5) { // establishing: slow aerial arc onto the launch site
    const u = ease(t / 7.5), ang = mix(205, 235, u) * DEG, rad = mix(170, 95, u);
    cam.set(CANISTER.x + Math.cos(ang) * rad, mix(60, 28, u), CANISTER.z + Math.sin(ang) * rad); tgt.copy(CANISTER).add(_b.set(-6, -2, 0)); fov = 40; near = 0.5;
  } else if (t < 15.5) { // low three-quarter on the canister mouth
    const u = ease((t - 7.5) / 8);
    cam.set(mix(26, 20, u), mix(7.5, 8.5, u), mix(24, 20, u)); tgt.copy(CANISTER).addScaledVector(AXIS, 2.5); fov = 36; near = 0.3;
  } else if (t < 23.5) { // fixed side camera, panning as the missile leaves the canister
    cam.set(9, 7.2, 34); tgt.lerpVectors(_b.copy(CANISTER).addScaledVector(AXIS, 4), _c.copy(S.pos).addScaledVector(S.F, 1), sstep(19, 22.5, t)); fov = 40; near = 0.3;
  } else if (t < 37) { // tracking alongside: wings and fins unfold, kicker burns out
    const u = (t - 23.5) / 13.5; rel(mix(5, 1.5, u), mix(1.2, 2.2, u), mix(13, 10, u)); tgt.copy(S.pos).addScaledVector(S.F, 0.5); fov = 40;
  } else if (t < 52) { // rear quarter: kicker falls away, boosters light, back to real time
    const u = ease((t - 37) / 15); rel(mix(-15, -24, u), mix(3, 5, u), mix(9, 7, u)); tgt.copy(S.pos).addScaledVector(S.F, mix(-5, 4, u)); fov = 42;
  } else if (t < 66) { // high chase looking past the vehicle along the trail
    const u = (t - 52) / 14; rel(mix(-40, -55, u), mix(11, 16, u), mix(10, 4, u)); tgt.copy(S.pos).addScaledVector(S.F, 25); fov = 44; near = 0.5;
  } else if (t < 76) { // long lens from the launch site: the boost arc and smoke trail
    cam.set(-35, 14, 70); tgt.copy(S.pos).lerp(_b.copy(CANISTER), 0.12);
    const d = cam.distanceTo(S.pos); fov = clamp(2 * Math.atan(180 / d) / DEG, 4, 30); near = 2;
  } else if (t < 86) { // backlit underside pass
    const u = (t - 76) / 10; rel(mix(14, -4, u), -3.5, -18); tgt.copy(S.pos); fov = 36;
  } else if (t < 104) { // booster burnout and jettison, slow motion
    const u = ease((t - 86) / 18); rel(mix(-1, -9, u), mix(-1.2, 1.5, u), mix(10, 16, u)); tgt.copy(S.pos).addScaledVector(S.F, mix(-1.5, -5, u)); fov = 40;
  } else if (t < 135) { // cutaway orbit
    const u = (t - 104) / 31, a = mix(40, 118, ease(u)) * DEG, d = mix(14, 13, Math.sin(u * Math.PI)), h = mix(3.0, 1.6, ease(u));
    rel(Math.cos(a) * d, h, Math.sin(a) * d); tgt.copy(S.pos).addScaledVector(S.F, mix(-0.4, -1.2, u)); fov = 42; near = 0.05;
  } else if (t < 150) { // low chase towards landfall
    const u = (t - 135) / 15; rel(mix(-20, -28, u), mix(3.5, 5, u), mix(7, 4, u)); keepAbove(2); tgt.copy(S.pos).addScaledVector(S.F, 40); fov = 42; near = 0.3;
  } else if (t < 158) { // ground camera; the missile passes overhead and away
    state(M(155.2), S2); cam.copy(S2.pos).addScaledVector(S2.Rf, 30).addScaledVector(S2.F, 30); cam.y = terrainH(cam.x, cam.z) + 2.5;
    tgt.copy(S.pos).addScaledVector(S.F, 3); fov = 34; near = 0.3;
  } else if (t < 165) { // alongside in the turn
    const u = (t - 158) / 7; rel(mix(6, 2, u), 2.5, mix(20, 15, u)); keepAbove(2); tgt.copy(S.pos); fov = 40;
  } else { // pull away and up
    const u = ease(clamp((t - 165) / 14, 0, 1));
    rel(mix(-25, -700, u), mix(5, 900, u ** 1.4), mix(8, 550, u)); keepAbove(2); tgt.copy(S.pos).addScaledVector(S.F, mix(20, 400, u)); fov = mix(42, 34, u); near = mix(0.3, 5, u);
  }
  camera.fov = fov; camera.near = near; camera.updateProjectionMatrix();
  camera.lookAt(tgt); camera.updateMatrixWorld();
}

// ---------- vehicle pose per frame ----------
const Sv = {};
function pose(t, m) {
  const mm = Math.max(m, 0);
  state(mm, Sv);
  V.root.position.copy(Sv.pos); V.root.quaternion.copy(Sv.q);
  // wings and fins: folded in the canister, deploy once clear of it
  const dw = sstep(M(24.5), M(29.5), m), df = sstep(M(23.5), M(26.5), m);
  for (const w of V.wings) w.rotation.y = -w.userData.side * 84 * DEG * (1 - dw);
  V.fin.rotation.x = -90 * DEG * (1 - df);
  for (const s of V.stabs) s.rotation.x = s.userData.side * 90 * DEG * (1 - df);
  // kicker
  if (m < mE.KSEP) { V.kicker.position.set(XT, 0, 0); V.kicker.quaternion.identity(); if (V.kicker.parent !== V.root) V.root.add(V.kicker); }
  else { scene.add(V.kicker); kickTrack.at(m, V.kicker); }
  const kOn = m >= 0 && m < mE.KBO ? 1 - sstep(mE.KBO - 0.25, mE.KBO, m) : 0;
  plKick.U.uInt.value = kOn * (1.1 + 0.25 * Math.sin(m * 90)) * sstep(0, 0.04, m);
  // boosters
  const sOn = m >= mE.SIGN && m < mE.SBO ? sstep(mE.SIGN, mE.SIGN + 0.15, m) * (1 - sstep(mE.SBO - 1.5, mE.SBO, m)) : 0;
  V.srbs.forEach((g, k) => {
    if (m < mE.SSEP) { if (g.parent !== V.root) V.root.add(g); g.position.copy(g.userData.home); g.rotation.set(0, g.userData.cant, 0); }
    else { scene.add(g); srbTrack[k].at(m, g); }
    plSrb[k].U.uInt.value = sOn * (1.0 + 0.2 * Math.sin(m * 70 + k * 2));
  });
  // turbojet: interburner flame from light-off until the reactor carries the load, then only faint heat
  const ibOn = sstep(E.TJ, E.TJ + 2, t) * (1 - sstep(E.CRIT + 10, 129, t));
  plJet.U.uInt.value = ibOn * 0.9 + sstep(E.TJ, E.CRIT, t) * 0.08;
  plJet.U.uLen.value = 1.6 + 2 * ibOn;
  const P = reactorPower(t, Sv);
  MAT.fuel.emissiveIntensity = P > 0 ? 0.6 + P * 0.55 : 0;
  V.nozGlow.material.color.setRGB(0.3 * ibOn + 0.02 * P / 4.3, 0.12 * ibOn + 0.005 * P / 4.3, 0.03 * ibOn);
  V.comp.rotation.x = V.turb.rotation.x = Sv.spool * Math.PI * 2 * 0.02; // strobed: real rotor speed would alias
  // glow on smoke and ground from the brightest plume
  const glowSrc = kOn > 0 ? local(Sv, XT - 2.6, 0, 0, _b) : sOn > 0 ? local(Sv, -4.6, -0.13, 0, _b) : null;
  plGlow.intensity = (kOn + sOn) * 6; if (glowSrc) plGlow.position.copy(glowSrc);
  // cutaway plane: wipes in, holds, wipes out; removes the half of the hull towards the camera (+z, vehicle right)
  const cut = sstep(105, 108.5, t) * (1 - sstep(131.5, 134.5, t));
  V.inner.visible = cut > 0.001;
  _b.copy(Sv.R).negate(); _c.copy(Sv.pos).addScaledVector(Sv.R, mix(0.6, -0.002, cut));
  clip.setFromNormalAndCoplanarPoint(_b, _c);
  flow.update(m, sstep(108, 111, t) * (1 - sstep(131, 133.5, t)));
  coverTrack(m);
  return P;
}

function labelsAt(t) {
  const on = win(t, 109, 132.5, 1.2);
  const [w, h] = st.size();
  const rows = [[], []];
  LABELS.forEach(([key], i) => {
    const el = labelEls[i], ln = lineEls[i];
    const stagger = sstep(109 + i * 0.35, 110.2 + i * 0.35, t) * on;
    el.style.opacity = String(stagger); ln.g.style.opacity = String(stagger);
    if (stagger <= 0) return;
    _c.copy(V.label[key]).applyMatrix4(V.root.matrixWorld).project(camera);
    const x = (_c.x * 0.5 + 0.5) * w, y = (-_c.y * 0.5 + 0.5) * h;
    const row = ['intake', 'turbine', 'interburner', 'nozzle'].includes(key) ? 1 : 0;
    rows[row].push({ el, ln, x, y });
  });
  rows.forEach((items, row) => {
    items.sort((a, b) => a.x - b.x);
    const margin = w * .05, slot = (w - margin * 2) / items.length;
    items.forEach(({ el, ln, x, y }, i) => {
      const lx = margin + slot * (i + .5), ly = h * (row ? .74 : .36);
      const left = lx - el.offsetWidth / 2, top = ly - (row ? 0 : el.offsetHeight);
      el.style.transform = `translate(${left}px, ${top}px)`;
      ln.l.setAttribute('x1', x); ln.l.setAttribute('y1', y);
      ln.l.setAttribute('x2', lx); ln.l.setAttribute('y2', ly);
      ln.c.setAttribute('cx', x); ln.c.setAttribute('cy', y);
    });
  });
}

function markerAt(t) {
  const on = sstep(E.WARP + 1, E.WARP + 3, t) * (1 - sstep(E.WARP + 4.5, E.WARP + 6, t));
  const mk = $('marker'); mk.style.opacity = String(on); if (on <= 0) return;
  const [w, h] = st.size(); _c.copy(V.root.position).project(camera);
  mk.style.transform = `translate(${(_c.x * 0.5 + 0.5) * w}px, ${(-_c.y * 0.5 + 0.5) * h}px)`;
}

// ---------- frame ----------
function render(t) {
  const m = M(t);
  shared.uTime.value = m;
  const P = pose(t, m);
  shot(t, m);
  V.root.updateMatrixWorld(true);
  sky.position.copy(camera.position);
  terrain.material.uniforms.uCenter.value.set(camera.position.x, camera.position.z);
  smoke.update(m);
  hud(t, m, Sv);
  labelsAt(t); markerAt(t);
  st.render(0, t);
  return P;
}

const qs = new URLSearchParams(location.search);
let ft = Number(qs.get('t') || 0);
window.__dbg = { M, mE, PATH, X2, state, terrainH };
window.__film = { ready: Promise.resolve(), seek: t => render(t), duration: DUR };
if (!qs.has('film')) {
  let last = performance.now(), paused = false;
  addEventListener('keydown', e => { if (e.code === 'Space') paused = !paused; if (e.code === 'ArrowRight') ft += 5; if (e.code === 'ArrowLeft') ft = Math.max(0, ft - 5); });
  $('tl').style.pointerEvents = 'auto';
  $('tl').addEventListener('click', e => { const r = $('tl').getBoundingClientRect(); ft = clamp((e.clientX - r.left) / r.width, 0, 1) * DUR; });
  const loop = now => { const dt = Math.min(0.1, (now - last) / 1000); last = now; if (!paused) ft = (ft + dt) % DUR; render(ft); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
} else render(ft);
