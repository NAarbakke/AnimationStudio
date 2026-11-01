// Operation SKYFALL, 39 s: the Razorbill farm drone flies in over a crop field, its fishhook releases the sensor rod, the rod
// lands in a furrow, the crop fades back and larvae climb the rod; each crossing of the spiral sensor strip spikes the plot.
// World units are metres: the drone flies roughly along +x, +y is up, crop rows run along x and repeat every 0.42 m in z.
// The drop point is near the origin. Everything is a pure function of film time t, so any frame renders on its own
// (drone.html?film for video/render.js, ?t=20 to preview from a given second; space pauses, arrows skip).
// Model: blender/razorbill.py turns cad/imports/2000_Razorbill_farm_drone.glb into /models/razorbill.glb.
// Trees and crops: blender/vegetation.py makes /models/vegetation.glb.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createStage, lin, NOISE } from '../shared/stage';

const DUR = 39, G = 9.81, DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const mix = (a, b, u) => a + (b - a) * u;
const ease = u => { u = clamp(u, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------- film time → world time (slow motion around the drop) ----------
const RATE = [[0, 1], [18.6, 1], [19, 0.4], [20.6, 0.4], [20.8, 0.7], [21.5, 0.7], [21.7, 0.3], [22.8, 0.3], [23.4, 1], [DUR, 1]];
const FDT = 1 / 240;
const WT = (() => {
  const n = Math.ceil(DUR / FDT) + 2, a = new Float64Array(n);
  const rate = t => { for (let i = 1; i < RATE.length; i++) if (t <= RATE[i][0]) { const [t0, r0] = RATE[i - 1], [t1, r1] = RATE[i]; return mix(r0, r1, (t - t0) / (t1 - t0)); } return 1; };
  for (let i = 1; i < n; i++) a[i] = a[i - 1] + rate((i - 0.5) * FDT) * FDT;
  return a;
})();
const W = t => { const f = clamp(t, 0, DUR) / FDT, i = Math.floor(f); return mix(WT[i], WT[i + 1], f - i); };

// world-time events (s)
const W_DECEL = 11, W_HOV = 17.6, W_REL = W(19.7), W_DEP = W_REL + 2.7, V_IN = 10, V_OUT = 11;

// ---------- field layout (mirrored in the ground shader) ----------
const ROW = 0.42;                                  // crop rows at z = k·ROW, furrows halfway between
const TRAM = z => Math.abs(((z - 12) % 24 + 36) % 24 - 12); // distance from the nearest tramline centre (z = 12 + 24k)
const PLANTS = { x0: -165, x1: 110, z: 30 };       // where real plant meshes stand; beyond that the shader paints the rows
const FIELD = { x0: -420, x1: 240, z0: -140, z1: 120 };
const Z_DROP = ROW / 2;                            // land the arrow in a furrow

// ---------- flight path ----------
const ARROW_Z = 0;                                 // rod axis offset from the drone centreline (model z)
const approach = new THREE.CatmullRomCurve3([V3(-330, 18, 48), V3(-230, 12, 30), V3(-140, 8.5, -4), V3(-70, 7, 6), V3(-25, 5.8, Z_DROP - ARROW_Z + 1.1), V3(0, 5.2, Z_DROP - ARROW_Z)], false, 'centripetal');
const depart = new THREE.CatmullRomCurve3([V3(0, 5.2, Z_DROP - ARROW_Z), V3(14, 6.5, -1), V3(55, 14, -14), V3(130, 28, -45), V3(260, 48, -95), V3(450, 75, -170)], false, 'centripetal');
approach.arcLengthDivisions = depart.arcLengthDivisions = 4000;
const L1 = approach.getLength(), L2 = depart.getLength();
const speed = w => w < W_HOV ? V_IN * (1 - sstep(W_DECEL, W_HOV, w)) : w < W_DEP ? 0 : V_OUT * sstep(W_DEP, W_DEP + 5, w);

const DW = 1 / 120, W_END = W(DUR) + 1, NP = Math.ceil(W_END / DW) + 2;
const PATH = (() => {
  const S = new Float64Array(NP); // distance flown
  for (let i = 1; i < NP; i++) S[i] = S[i - 1] + speed((i - 0.5) * DW) * DW;
  const sHov = S[Math.round(W_HOV / DW)], sDep = S[Math.round(W_DEP / DW)];
  const P = { x: new Float64Array(NP), y: new Float64Array(NP), z: new Float64Array(NP), up: new Float32Array(NP * 3), yaw: new Float32Array(NP) };
  const p = V3();
  for (let i = 0; i < NP; i++) {
    const w = i * DW;
    if (w <= W_HOV) approach.getPointAt(clamp((L1 - (sHov - S[i])) / L1, 0, 1), p);
    else depart.getPointAt(clamp((S[i] - sDep) / L2, 0, 1), p);
    const hov = sstep(W_HOV - 1.5, W_HOV + 0.5, w) * (1 - sstep(W_DEP - 0.5, W_DEP + 1.5, w));
    p.x += hov * 0.035 * Math.sin(1.3 * w); p.y += hov * 0.045 * Math.sin(0.9 * w + 1); p.z += hov * 0.03 * Math.sin(1.1 * w + 2);
    p.y += 0.14 * sstep(W_REL + 0.2, W_REL + 1.2, w) * (1 - sstep(W_DEP, W_DEP + 2, w)); // lighter without the arrow
    P.x[i] = p.x; P.y[i] = p.y; P.z[i] = p.z;
  }
  // thrust axis from the smoothed acceleration plus gravity and a little drag; heading from the ground track
  const vel = i => { const a = Math.max(0, i - 1), b = Math.min(NP - 1, i + 1); return V3(P.x[b] - P.x[a], P.y[b] - P.y[a], P.z[b] - P.z[a]).divideScalar((b - a) * DW); };
  const V = Array.from({ length: NP }, (_, i) => vel(i));
  const A = V.map((_, i) => { const a = Math.max(0, i - 1), b = Math.min(NP - 1, i + 1); return V[b].clone().sub(V[a]).divideScalar((b - a) * DW); });
  const sig = 0.22 / DW, R = Math.ceil(sig * 3), ker = Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-((k - R) ** 2) / (2 * sig * sig)));
  let yaw = 0;
  for (let i = 0; i < NP; i++) {
    const a = V3(); let ws = 0;
    for (let k = -R; k <= R; k++) { const j = clamp(i + k, 0, NP - 1); a.addScaledVector(A[j], ker[k + R]); ws += ker[k + R]; }
    a.divideScalar(ws).add(V3(0, G, 0)).addScaledVector(V[i], 0.2).normalize();
    P.up.set([a.x, a.y, a.z], i * 3);
    const hv = Math.hypot(V[i].x, V[i].z);
    if (hv > 0.4) { let y = Math.atan2(-V[i].z, V[i].x); while (y - yaw > Math.PI) y -= 2 * Math.PI; while (y - yaw < -Math.PI) y += 2 * Math.PI; yaw = i ? mix(yaw, y, clamp(hv / 3, 0, 1) * 0.08) : y; }
    P.yaw[i] = yaw;
  }
  return P;
})();

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = V3();
/** Drone state at world time w: position (feet), unit basis F (nose), U (thrust), R (right), Fh/Rh level heading, matrix. */
function state(w, o = {}) {
  const f = clamp(w / DW, 0, NP - 2), i = Math.floor(f), k = f - i, L = a => mix(a[i], a[i + 1], k);
  o.pos = (o.pos || V3()).set(L(PATH.x), L(PATH.y), L(PATH.z));
  o.U = (o.U || V3()).set(mix(PATH.up[i * 3], PATH.up[i * 3 + 3], k), mix(PATH.up[i * 3 + 1], PATH.up[i * 3 + 4], k), mix(PATH.up[i * 3 + 2], PATH.up[i * 3 + 5], k)).normalize();
  const yaw = L(PATH.yaw);
  o.Fh = (o.Fh || V3()).set(Math.cos(yaw), 0, -Math.sin(yaw));
  o.Rh = (o.Rh || V3()).set(Math.sin(yaw), 0, Math.cos(yaw));
  o.R = (o.R || V3()).crossVectors(o.Fh, o.U).normalize();
  o.F = (o.F || V3()).crossVectors(o.U, o.R).normalize();
  o.q = (o.q || new THREE.Quaternion()).setFromRotationMatrix(_m.makeBasis(o.F, o.U, o.R));
  o.m = (o.m || new THREE.Matrix4()).compose(o.pos, o.q, _v.set(1, 1, 1));
  o.c = (o.c || V3()).copy(o.pos).addScaledVector(o.U, 0.15); // body centre
  o.speed = speed(w);
  return o;
}
const S = state(0), S2 = state(0);

// ---------- rod flight ----------
// The rod hangs from the fishhook by its wire ring, straight down the thrust axis (which is where a hanging weight settles).
// The servo turns the hook until the ring slips off the tip, and the rod falls nose first, fins keeping it nearly vertical.
// The "arrow" frame has +x toward the nose and its origin halfway along the rod; TIP is the nose, numbers from razorbill.py.
const TIP = 0.556, HOLD_Y = -0.8;
const TA = 0.18, PHT = 85 * DEG, KD = 5, PEN = 0.13;
const ARROW_LOCAL = new THREE.Matrix4().makeTranslation(0, HOLD_Y, ARROW_Z).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)); // arrow → drone frame on the hook
const FALL = (() => {
  const at = tau => state(W_REL + tau, {}).m.clone().multiply(ARROW_LOCAL);
  const m0 = at(TA), m1 = at(TA - 1e-3);
  const p0 = V3().setFromMatrixPosition(m0), q0 = new THREE.Quaternion().setFromRotationMatrix(m0);
  const v0 = p0.clone().sub(V3().setFromMatrixPosition(m1)).divideScalar(1e-3);
  const d0 = V3(1, 0, 0).applyQuaternion(q0), ph0 = Math.asin(-d0.y), w0 = 0;
  const h = Math.hypot(d0.x, d0.z) > 1e-4 ? V3(d0.x, 0, d0.z).normalize() : V3(1, 0, 0), k = V3().crossVectors(h, V3(0, -1, 0)).normalize();
  const F = { p0, v0, q0, ph0, w0, h, k };
  F.phi = tau => PHT + (ph0 - PHT + (w0 + KD * (ph0 - PHT)) * tau) * Math.exp(-KD * tau);
  F.pose = (tau, p = V3(), q = new THREE.Quaternion()) => {
    p.copy(p0).addScaledVector(v0, tau); p.y -= 0.5 * G * tau * tau;
    q.setFromAxisAngle(k, F.phi(tau) - ph0).multiply(q0);
    return [p, q];
  };
  let tau = 0; const p = V3(), q = new THREE.Quaternion();
  for (; tau < 4; tau += 5e-4) { F.pose(tau, p, q); if (p.y + V3(TIP, 0, 0).applyQuaternion(q).y <= 0) break; }
  F.hit = tau; F.pose(tau, p, q);
  F.qHit = q.clone(); F.dHit = V3(1, 0, 0).applyQuaternion(q); F.tipHit = p.clone().addScaledVector(F.dHit, TIP);
  F.side = V3().crossVectors(F.dHit, k).normalize();
  return F;
})();
const W_HIT = W_REL + TA + FALL.hit, IMPACT = FALL.tipHit.clone().setY(0);
/** Arrow world matrix at world time w (needs the drone matrix at w while it is still attached). */
function arrowPose(w, droneM, out) {
  const tau = w - W_REL;
  if (tau < TA) return out.copy(droneM).multiply(ARROW_LOCAL);
  const tb = tau - TA;
  if (tb < FALL.hit) { const [p, q] = FALL.pose(tb); return out.compose(p, q, _v.set(1, 1, 1)); }
  const a = tb - FALL.hit; // stuck: drive in, then quiver about the buried tip
  const tip = FALL.tipHit.clone().addScaledVector(FALL.dHit, PEN * (1 - Math.exp(-a / 0.008)));
  const q = new THREE.Quaternion().setFromAxisAngle(FALL.k, 0.085 * Math.exp(-3.2 * a) * Math.sin(2 * Math.PI * 7 * a))
    .multiply(new THREE.Quaternion().setFromAxisAngle(FALL.side, 0.03 * Math.exp(-3.5 * a) * Math.sin(2 * Math.PI * 6.3 * a + 1))).multiply(FALL.qHit);
  const p = tip.addScaledVector(V3(1, 0, 0).applyQuaternion(q), -TIP);
  return out.compose(p, q, _v.set(1, 1, 1));
}

// ---------- stage ----------
const canvas = document.getElementById('c');
const st = createStage(canvas, document.body, { depth24: true }); // plants a few cm off the ground, tens of metres away
if (!st) { document.getElementById('err').hidden = false; throw new Error('WebGL unavailable'); }
const { renderer, scene, camera, controls } = st;
controls.enabled = false;
camera.near = 0.02; camera.far = 9000; camera.updateProjectionMatrix();
scene.background = null;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
st.bloom.strength = 0.25; st.bloom.threshold = 0.95;

const SUN = V3(0.42, 0.5, -0.76).normalize();
const SKY_GLSL = `
uniform vec3 uSun;
vec3 skyColor(vec3 d){
  float e = clamp(d.y, 0.0, 1.0), mu = max(dot(d, uSun), 0.0);
  vec3 col = mix(vec3(0.66, 0.68, 0.70), vec3(0.10, 0.25, 0.60), pow(e, 0.5));
  col += vec3(1.0, 0.68, 0.38)*pow(mu, 5.0)*0.45*(1.0 - e);
  col += vec3(1.0, 0.86, 0.62)*pow(mu, 80.0)*0.8;
  if (d.y < 0.0) col = mix(vec3(0.66, 0.68, 0.70), vec3(0.4, 0.4, 0.36), clamp(-d.y*6.0, 0.0, 1.0));
  return col;
}`;
const FOG = new THREE.Color(0.6, 0.63, 0.66);
scene.fog = new THREE.FogExp2(FOG, 0.00022);
const shared = { uSun: { value: SUN }, uTime: { value: 0 } };

const sun = new THREE.DirectionalLight(lin(0xffe7c4), 2.7);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.015;
const hemi = new THREE.HemisphereLight(lin(0xb4c8e8), lin(0x6b5a3e), 0.6);
scene.add(sun, sun.target, hemi);
function shadowAt(focus, size) {
  sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(SUN, 150); sun.shadow.normalBias = size < 2 ? 0.003 : 0.015;
  const c = sun.shadow.camera; c.left = c.bottom = -size; c.right = c.top = size; c.near = 1; c.far = 400; c.updateProjectionMatrix();
}

const skyMat = new THREE.ShaderMaterial({
  uniforms: shared, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
  fragmentShader: SKY_GLSL + `varying vec3 vDir; void main(){ vec3 d = normalize(vDir); vec3 c = skyColor(d);
    float mu = dot(d, uSun); c += vec3(1.0,0.92,0.8)*smoothstep(0.99985, 0.99992, mu)*30.0;
    c += (fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5)*0.012; gl_FragColor = vec4(c, 1.0); }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 48, 24), skyMat);
sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
{
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.1, 0.06) }));
  ground.position.y = -2; envScene.add(ground);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0, 0.1, 1000).texture;
}

// ---------- ground: one big plane, field pattern in the fragment shader, lit and shadowed by three ----------
const impactU = { value: new THREE.Vector4(IMPACT.x, IMPACT.z, -1, 0) };
const GROUND_GLSL = NOISE + `
uniform vec4 uImpact;
varying vec3 vWP;
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
float band(float d, float hw, float aa){ return 1.0 - smoothstep(hw - aa, hw + aa, d); }
vec3 soil(vec2 p, float fw){
  float n = snoise(vec3(p*0.31, 0.0))*0.5
          + snoise(vec3(p*1.9, 3.0))*0.3*(1.0 - smoothstep(0.04, 0.3, fw))
          + snoise(vec3(p*11.0, 7.0))*0.25*(1.0 - smoothstep(0.008, 0.05, fw))
          + snoise(vec3(p*47.0, 11.0))*0.34*(1.0 - smoothstep(0.002, 0.012, fw))
          + snoise(vec3(p*170.0, 13.0))*0.26*(1.0 - smoothstep(0.0008, 0.004, fw));
  return mix(vec3(0.045, 0.027, 0.015), vec3(0.125, 0.08, 0.046), clamp(0.5 + 0.7*n, 0.0, 1.0));
}
vec3 cropField(vec2 p, float fw){
  vec3 s = soil(p, fw);
  float d = abs(fract(p.y/${ROW.toFixed(2)} + 0.5) - 0.5)*${ROW.toFixed(2)};
  float tm = abs(mod(p.y - 12.0, 24.0) - 12.0);
  float hw = 0.15 + 0.035*snoise(vec3(p*0.9, 2.0)) + 0.03*snoise(vec3(p.x*3.1, p.y*0.2, 4.0));
  float cov = band(d, hw, max(fw, 0.003));
  cov = mix(cov, 0.4, smoothstep(0.1, 0.4, fw));
  cov *= smoothstep(1.15, 1.35, tm);
  vec3 green = mix(vec3(0.02, 0.06, 0.012), vec3(0.045, 0.12, 0.02), 0.5 + 0.5*snoise(vec3(p*0.045, 5.0)));
  float under = step(${PLANTS.x0.toFixed(1)}, p.x)*step(p.x, ${PLANTS.x1.toFixed(1)})*step(abs(p.y), ${PLANTS.z.toFixed(1)});
  // painted rows break up into tufts up close; under the real plants only a faint canopy shadow is left
  cov *= mix(smoothstep(-0.35, 0.35, snoise(vec3(p.x*3.6, p.y*1.3, 9.0))), 1.0, smoothstep(0.03, 0.12, fw));
  cov *= mix(1.0, 0.35, under);
  if (uImpact.z >= 0.0) cov *= smoothstep(0.5, 1.2, length(p - uImpact.xy)); // no painted tufts in the clearing the macro shot looks at
  green *= mix(1.0, 0.5, under);
  vec3 c = mix(s, green, cov*mix(1.0, 0.7, smoothstep(0.05, 0.25, fw)*(1.0 - under)));
  c *= mix(1.0, 0.8, smoothstep(0.02, 0.15, fw)*(1.0 - under)); // the plant patch reads darker from afar (self-shadowed)
  float rut = band(abs(tm - 0.9), 0.17, max(fw, 0.02))*(1.0 - smoothstep(0.2, 0.6, fw));
  return mix(c, s*0.72 + vec3(0.02, 0.016, 0.01), rut);
}
vec3 outer(vec2 p, float fw){
  vec2 cs = vec2(260.0, 210.0), q = (p + vec2(37.0, 11.0))/cs, id = floor(q), f = fract(q)*cs;
  float h = hash21(id), h2 = hash21(id + 17.0);
  vec2 r = h2 > 0.5 ? p : p.yx;
  vec3 c;
  float tone = snoise(vec3(p*0.012, h*9.0))*0.5 + 0.5;
  if (h < 0.3) {        // ripe cereal
    c = mix(vec3(0.36, 0.25, 0.08), vec3(0.52, 0.38, 0.13), tone);
    c *= 1.0 - 0.18*band(abs(mod(r.y, 24.0) - 12.0), 0.5, max(fw, 0.05));
  } else if (h < 0.5) { // ploughed
    c = soil(p, fw)*1.1;
    c *= mix(1.0 - 0.35*band(abs(fract(r.y/0.4) - 0.5), 0.18, max(fw/0.4, 0.02)), 0.88, smoothstep(0.05, 0.25, fw));
  } else if (h < 0.78) { // pasture, mown in stripes
    c = mix(vec3(0.06, 0.14, 0.03), vec3(0.11, 0.21, 0.045), tone);
    c *= 1.0 + 0.12*sign(sin(r.y*3.14159/6.0));
  } else {               // rapeseed
    c = mix(vec3(0.45, 0.37, 0.03), vec3(0.62, 0.52, 0.05), tone);
  }
  float e = min(min(f.x, cs.x - f.x), min(f.y, cs.y - f.y));
  c = mix(c, vec3(0.1, 0.16, 0.05), 1.0 - smoothstep(4.0, 5.0, e));
  c = mix(c, vec3(0.02, 0.05, 0.015)*(0.8 + 0.4*snoise(vec3(p*0.3, 1.0))), 1.0 - smoothstep(2.0, 2.6, e));
  return c;
}
vec3 fieldColor(vec2 p){
  float fw = length(fwidth(p));
  vec2 lo = vec2(${FIELD.x0.toFixed(1)}, ${FIELD.z0.toFixed(1)}), hi = vec2(${FIELD.x1.toFixed(1)}, ${FIELD.z1.toFixed(1)});
  vec2 dd = max(lo - p, p - hi); float out_ = max(dd.x, dd.y); // > 0 outside the main field
  vec3 c;
  if (out_ < 0.0) c = cropField(p, fw);
  else if (out_ < 2.8) c = vec3(0.02, 0.05, 0.015)*(0.8 + 0.4*snoise(vec3(p*0.3, 1.0)));
  else if (out_ < 7.5) { c = vec3(0.3, 0.25, 0.18)*(0.85 + 0.25*snoise(vec3(p*0.5, 2.0))); c = mix(c, vec3(0.08, 0.15, 0.04), band(abs(out_ - 5.15), 0.5, 0.2)); }
  else c = outer(p, fw);
  if (uImpact.z >= 0.0) { // scuffed soil where the arrow went in
    float r = length(p - uImpact.xy), grow = smoothstep(0.0, 0.05, uImpact.z);
    c *= 1.0 - 0.45*grow*(1.0 - smoothstep(0.02, 0.07 + 0.03*snoise(vec3(p*60.0, 1.0)), r));
  }
  return c;
}`;
const groundMat = new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0 });
groundMat.onBeforeCompile = sh => {
  sh.uniforms.uImpact = impactU;
  sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix*vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = GROUND_GLSL + '\n' + sh.fragmentShader.replace('#include <color_fragment>', 'diffuseColor.rgb = fieldColor(vWP.xz);');
};
const ground = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2), groundMat);
ground.receiveShadow = true; scene.add(ground);

// distant hills, mostly fog
{
  const segs = 256, rings = 8, pos = [], idx = [], r = rng(7);
  const ph = Array.from({ length: 6 }, () => r() * 6.28);
  for (let j = 0; j <= rings; j++) for (let i = 0; i <= segs; i++) {
    const a = i / segs * Math.PI * 2, u = j / rings, rad = mix(2600, 5200, u);
    const h = 0.55 * (60 + 70 * Math.sin(3 * a + ph[0]) * Math.sin(5 * a + ph[1]) + 35 * Math.sin(11 * a + ph[2]) + 15 * Math.sin(23 * a + ph[3])) * Math.sin(Math.PI * Math.min(1, u * 1.6)) + 20 * u;
    pos.push(Math.cos(a) * rad, Math.max(-5, h * (1 + u)), Math.sin(a) * rad);
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) { const a = j * (segs + 1) + i, b = a + segs + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: lin(0x45583a) })));
}

// ---------- crops: instanced maize in rows (blender/vegetation.py), swaying in the wind and the rotor downwash ----------
const HERO_R = 12;                                 // detailed plants this close to the arrow, where the camera gets down in the furrow
const CAM_DIR = V3(0.25, 0, -1).normalize();       // from the rod toward the camera in the macro shot, with the sun over its shoulder
const IMPACT_CAM = { d: 1.9, y: 1.12 };           // where the strike shot starts
const REVEAL = { circle: 0.8, lane: 0.5, length: 3.2 }; // the plants that fade: round the rod, and in a lane toward the camera
const droneU = { value: V3() }, washU = { value: 0 }, kickU = { value: -1 }, revealU = { value: 0 }, impactXZ = { value: new THREE.Vector2(IMPACT.x, IMPACT.z) };
const cropMat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, side: THREE.DoubleSide, vertexColors: true });
const FADE_GLSL = `
  float rd = length(ib.xz - uImpactXZ), rn = fract(sin(dot(ib.xz, vec2(127.1, 311.7)))*43758.5453);
  float plantFade = 1.0 - smoothstep(0.0, 0.3, uReveal*1.7 - (rd/${REVEAL.length.toFixed(1)} + 0.35*rn));`;
const sway = sh => {
  Object.assign(sh.uniforms, { uDrone: droneU, uWash: washU, uTime: shared.uTime, uKick: kickU, uImpactXZ: impactXZ });
  sh.vertexShader = 'uniform vec3 uDrone; uniform float uWash; uniform float uTime; uniform float uKick; uniform vec2 uImpactXZ;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vec3 ib = (modelMatrix*instanceMatrix*vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float k = position.y/0.95; k *= 2.5*k;
    vec2 dw = ib.xz - uDrone.xz; float dist = length(dw);
    float wash = uWash*exp(-dist*dist/1.6)*clamp(3.2/max(uDrone.y - ib.y, 0.5), 0.0, 1.5);
    vec3 wd = vec3(0.025*sin(uTime*1.6 + ib.x*0.31 + ib.z*0.17) + 0.01*sin(uTime*4.1 + ib.z*2.3), 0.0, 0.012*sin(uTime*1.3 + ib.x*0.2));
    wd.xz += dw/(dist + 0.25)*wash*(0.06 + 0.035*sin(uTime*17.0 + dist*9.0 + ib.x*13.0));
    wd.y -= wash*0.03;
    if (uKick >= 0.0) { vec2 dk = ib.xz - uImpactXZ; float rk = length(dk); wd.xz += dk/(rk + 0.1)*0.1*exp(-rk*rk/0.5)*exp(-uKick*3.0)*sin(uKick*26.0 - rk*9.0); } // the rod punching through
    mat3 im = mat3(instanceMatrix);
    transformed += transpose(im)*wd*k/dot(im[0], im[0]);`);
};
cropMat.onBeforeCompile = sway;
// the plants that fade are drawn back to front from the macro camera, and their shadow shrinks away with them
const revealMat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, side: THREE.DoubleSide, vertexColors: true, transparent: true });
revealMat.onBeforeCompile = sh => {
  sway(sh);
  sh.uniforms.uReveal = revealU;
  sh.vertexShader = 'uniform float uReveal; varying float vFade;\n' + sh.vertexShader.replace('mat3 im = mat3(instanceMatrix);', `{ ${FADE_GLSL} vFade = plantFade; }
    mat3 im = mat3(instanceMatrix);`);
  sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vFade; if (diffuseColor.a < 0.01) discard;');
};
const revealDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
revealDepth.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, { uReveal: revealU, uImpactXZ: impactXZ });
  sh.vertexShader = 'uniform float uReveal; uniform vec2 uImpactXZ;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vec3 ib = (modelMatrix*instanceMatrix*vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    ${FADE_GLSL}
    transformed *= plantFade;`);
};
/** One InstancedMesh per model: batches maps a node name in the GLB to its [matrix, colour] pairs. */
function addInstances(gltf, batches, material, shadows) {
  const meshes = [];
  for (const [name, list] of Object.entries(batches)) {
    const mesh = new THREE.InstancedMesh(gltf.scene.getObjectByName(name).geometry, material, list.length);
    list.forEach(([m, c], i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, c); });
    mesh.castShadow = mesh.receiveShadow = shadows; mesh.frustumCulled = false;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}
function addCrops(gltf) {
  const r = rng(11), list = [], batches = {}, reveal = {};
  for (let k = Math.ceil(-PLANTS.z / ROW); k <= Math.floor(PLANTS.z / ROW); k++) {
    const z = k * ROW; if (TRAM(z) < 1.3) continue;
    for (let x = PLANTS.x0; x < PLANTS.x1; x += 0.09 + r() * 0.05) list.push([x + (r() - 0.5) * 0.06, z + (r() - 0.5) * 0.07]);
  }
  const q = new THREE.Quaternion(), up = V3(0, 1, 0), cam = V3().copy(IMPACT).addScaledVector(CAM_DIR, IMPACT_CAM.d);
  for (const [x, z] of list) {
    const edge = Math.min(x - PLANTS.x0, PLANTS.x1 - x, PLANTS.z - Math.abs(z)), s = (0.9 + r() * 0.15) * mix(0.35, 1, sstep(0, 10, edge));
    const m = new THREE.Matrix4().compose(_v.set(x, 0, z), q.setFromAxisAngle(up, r() * 6.283), V3(s, mix(0.35, 1, sstep(0, 10, edge)) * (0.93 + r() * 0.12), s));
    const c = new THREE.Color(mix(0.75, 1.2, r()), mix(0.82, 1.18, r()), mix(0.7, 1.1, r()));
    const dx = x - IMPACT.x, dz = z - IMPACT.z, name = `crop_${Math.hypot(dx, dz) < HERO_R ? 'hero' : 'field'}_${Math.floor(r() * 3)}`;
    if (Math.hypot(x - cam.x, z - cam.z) < 0.5) continue; // nothing right in front of the lens in the strike shot
    const along = clamp(dx * CAM_DIR.x + dz * CAM_DIR.z, 0, REVEAL.length), lane = Math.hypot(dx - CAM_DIR.x * along, dz - CAM_DIR.z * along);
    const fades = lane < REVEAL.lane || Math.hypot(dx, dz) < REVEAL.circle;
    (((fades ? reveal : batches)[name]) ??= []).push([m, c]);
  }
  addInstances(gltf, batches, cropMat, true);
  const far = ([a], [b]) => _v.setFromMatrixPosition(b).distanceToSquared(cam) - _v.setFromMatrixPosition(a).distanceToSquared(cam);
  Object.values(reveal).forEach(list => list.sort(far));
  addInstances(gltf, reveal, revealMat, true).forEach(mesh => { mesh.customDepthMaterial = revealDepth; mesh.renderOrder = 1; });
}

// ---------- trees along the hedges (blender/vegetation.py), a farmyard ----------
function addTrees(gltf) {
  const r = rng(5), spots = [], batches = {};
  for (let x = FIELD.x0 - 30; x < FIELD.x1 + 30; x += 7 + r() * 9) spots.push([x, FIELD.z0 - 3.5 - r() * 3]);
  for (let x = FIELD.x0; x < FIELD.x1; x += 18 + r() * 40) spots.push([x, FIELD.z1 + 3.5 + r() * 2]);
  for (let z = FIELD.z0; z < FIELD.z1; z += 10 + r() * 25) spots.push([FIELD.x1 + 3.5 + r() * 2, z], [FIELD.x0 - 3.5 - r() * 2, z]);
  const near = spots.length;
  for (let n = 0; n < 160; n++) { const a = r() * 6.283, d = 700 + r() * 1500; spots.push([Math.cos(a) * d, Math.sin(a) * d]); }
  const q = new THREE.Quaternion(), up = V3(0, 1, 0);
  spots.forEach(([x, z], i) => {
    const h = (7 + r() * 8) / 10, w = h * mix(0.9, 1.15, r());
    const m = new THREE.Matrix4().compose(_v.set(x, 0, z), q.setFromAxisAngle(up, r() * 6.283), V3(w, h, w));
    const c = new THREE.Color(mix(0.8, 1.2, r()), mix(0.85, 1.15, r()), mix(0.8, 1.1, r()));
    (batches[`tree_${i < near ? '' : 'far_'}${Math.floor(r() * 3)}`] ??= []).push([m, c]);
  });
  // the shadow map only ever covers the middle of the field, so the trees can't reach it; their shading is baked instead
  addInstances(gltf, batches, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide, vertexColors: true }), false);
}
{
  const yard = new THREE.Group(); yard.position.set(300, 0, -230); yard.rotation.y = 0.35;
  const barnMat = new THREE.MeshStandardMaterial({ color: lin(0x7a2a1e), roughness: 0.8 }), roofMat = new THREE.MeshStandardMaterial({ color: lin(0x3b3d40), roughness: 0.6 });
  const barn = (w, h, d, x, z) => {
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), barnMat); body.position.set(x, 0, z);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.62, d * 0.62, w, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6).scale(1, 0.55, 1), roofMat);
    roof.position.set(x, h + d * 0.16, z); yard.add(body, roof);
  };
  barn(30, 8, 14, 0, 0); barn(18, 6, 10, 28, 14);
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 16, 20).translate(0, 8, 0), new THREE.MeshStandardMaterial({ color: lin(0xb9bcbf), roughness: 0.4, metalness: 0.6 }));
  silo.position.set(-22, 0, 6); yard.add(silo);
  yard.traverse(o => { o.castShadow = o.receiveShadow = true; });
  scene.add(yard);
}

// ---------- rod: its parts come with the drone model, see the loader below ----------
const arrow = new THREE.Group(); arrow.matrixAutoUpdate = false; scene.add(arrow);

// ---------- impact: dust puff and clods, pure functions of the time since the hit ----------
const dustU = { uAge: { value: -1 }, uOrigin: { value: IMPACT.clone() }, uScale: { value: 1 } };
const dust = (() => {
  const N = 140, r = rng(21), seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) seed.set([r(), r(), r(), r()], i * 4);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3)); g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 4));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: dustU, transparent: true, depthWrite: false,
    vertexShader: `uniform float uAge, uScale; uniform vec3 uOrigin; attribute vec4 seed; varying float vA; varying float vS;
      void main(){
        float a = max(uAge, 0.0), az = seed.x*6.2832, sp = mix(0.12, 0.6, seed.y), up = mix(0.4, 1.4, seed.z);
        float k = 2.6, travel = (1.0 - exp(-k*a))/k;
        vec3 p = uOrigin + vec3(cos(az)*sp*travel, up*sp*travel*0.9 - 0.05*a*a + 0.01, sin(az)*sp*travel);
        p.y = max(p.y, 0.005);
        vA = (uAge < 0.0 ? 0.0 : 1.0)*smoothstep(0.0, 0.04, a)*(1.0 - smoothstep(0.4, 2.2 + seed.w, a));
        vS = seed.w;
        vec4 mv = modelViewMatrix*vec4(p, 1.0);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = uScale*(0.05 + 0.2*a*(0.6 + seed.w))*(0.6 + seed.y)/-mv.z;
      }`,
    fragmentShader: `varying float vA; varying float vS;
      void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c)*2.0; if (r > 1.0) discard;
        gl_FragColor = vec4(mix(vec3(0.42, 0.33, 0.22), vec3(0.58, 0.48, 0.36), vS), vA*0.09*(1.0 - r)*(1.0 - r)); }`,
  }));
  pts.frustumCulled = false; pts.renderOrder = 2; scene.add(pts);
  return pts;
})();
const clods = (() => {
  const lump = new THREE.IcosahedronGeometry(1, 2), P = lump.attributes.position;
  for (let i = 0; i < P.count; i++) { _v.fromBufferAttribute(P, i); const k = 0.72 + 0.2 * Math.sin(_v.x * 4.1 + 1) * Math.sin(_v.y * 3.3) + 0.12 * Math.sin(_v.z * 7.3 + _v.x * 5); P.setXYZ(i, _v.x * k, _v.y * k * 0.75, _v.z * k); }
  lump.computeVertexNormals();
  const N = 18, r = rng(33), m = new THREE.InstancedMesh(lump, new THREE.MeshStandardMaterial({ color: lin(0x2c1e12), roughness: 1, flatShading: true }), N);
  m.userData.seed = Array.from({ length: N }, () => [r() * 6.283, 0.4 + r() * 1.0, 1.0 + r() * 1.6, 0.002 + r() * 0.004]);
  m.castShadow = true; m.frustumCulled = false; scene.add(m); return m;
})();
function impactAt(age) {
  impactU.value.z = age; kickU.value = age;
  dustU.uAge.value = age;
  dustU.uScale.value = st.size()[1] * 0.5 / Math.tan(camera.fov * DEG / 2);
  const q = new THREE.Quaternion();
  clods.userData.seed.forEach(([az, sp, vu, s], i) => {
    const a = Math.max(0, age), tl = 2 * vu / G, tt = Math.min(a, tl), h = vu * tt - 0.5 * G * tt * tt;
    _v.set(IMPACT.x + Math.cos(az) * sp * 0.35 * tt, Math.max(s * 0.6, h + 0.01), IMPACT.z + Math.sin(az) * sp * 0.35 * tt);
    clods.setMatrixAt(i, _m.compose(_v, q.setFromAxisAngle(V3(1, 0.3, 0.2).normalize(), az + tt * 9), V3(1, 1, 1).multiplyScalar(age < 0 ? 0 : s)));
  });
  clods.instanceMatrix.needsUpdate = true;
}

// ---------- drone ----------
const D = { root: new THREE.Group(), props: [], discs: [], hook: null, horn: null, lever: null };
const HOOK_PIVOT = [0.095, 0.002], HOOK_ARM = 0.022, HOOK_OPEN = 0.7; // y, z in the drone frame; arm length up to the lever; radians
scene.add(D.root);
const discMat = new THREE.ShaderMaterial({
  uniforms: { uAng: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv*2.0 - 1.0; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0); }`,
  fragmentShader: `uniform float uAng; varying vec2 vUv;
    void main(){ float r = length(vUv); if (r > 1.0 || r < 0.14) discard;
      float a = atan(vUv.y, vUv.x) - uAng, s = pow(0.5 + 0.5*cos(2.0*a), 10.0);
      float al = (0.07 + 0.2*s)*smoothstep(1.0, 0.9, r)*smoothstep(0.14, 0.3, r);
      gl_FragColor = vec4(vec3(0.05), al); }`,
});
const vegetation = new GLTFLoader().loadAsync('/models/vegetation.glb').then(gltf => { addCrops(gltf); addTrees(gltf); });
const razorbill = new GLTFLoader().loadAsync('/models/razorbill.glb').then(gltf => {
  const model = gltf.scene;
  D.root.add(model); D.root.updateMatrixWorld(true);
  const std = (hex, rough, metal, extra = {}) => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: rough, metalness: metal, ...extra });
  const MAT = {
    hub: std(0x1c1d20, 0.42, 0.35), top: std(0x232427, 0.4, 0.35), battery: std(0xdcdcd8, 0.55, 0.05), arm: std(0x141517, 0.36, 0.4),
    leg: std(0xd6d9dc, 0.45, 0.1), motor: std(0x34373c, 0.3, 0.85), prop: std(0x0f1012, 0.4, 0.1, { transparent: true, opacity: 0.55 }), release: std(0xb8bcc1, 0.28, 0.9),
    rod_shaft: std(0x4d5056, 0.55, 0.45), rod_tape: std(0xf0f1f2, 0.22, 1), rod_cone: std(0x1c1d20, 0.45, 0.2), rod_cap: std(0x1c1d20, 0.45, 0.2),
    rod_fins: std(0xd94f08, 0.6, 0, { side: THREE.DoubleSide }), rod_ring: std(0xc8ccd0, 0.25, 1),
  };
  model.traverse(o => { if (o.isMesh) { const n = o.name.toLowerCase(); o.material = MAT[n] ?? MAT[n.split('_')[0]] ?? MAT.hub; o.castShadow = o.receiveShadow = true; } });
  const box = new THREE.Box3();
  for (let n = 0; n < 4; n++) {
    const prop = model.getObjectByName(`prop_${n}`), motor = model.getObjectByName(`motor_${n}`);
    const mc = box.setFromObject(motor).getCenter(V3()), pb = box.setFromObject(prop);
    const pivot = new THREE.Group(); pivot.position.set(mc.x, 0, mc.z); model.add(pivot); pivot.updateMatrixWorld(true); pivot.attach(prop);
    let rad = 0; prop.traverse(o => { if (o.isMesh) { const p = o.geometry.attributes.position; o.updateMatrixWorld(true); for (let i = 0; i < p.count; i += 3) { _v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); rad = Math.max(rad, Math.hypot(_v.x - mc.x, _v.z - mc.z)); } } });
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(2 * rad, 2 * rad).rotateX(-Math.PI / 2), discMat.clone());
    disc.position.set(mc.x, (pb.min.y + pb.max.y) / 2, mc.z); disc.renderOrder = 2; model.add(disc);
    D.props.push({ pivot, dir: n % 2 ? 1 : -1, ph: n * 1.3 }); D.discs.push(disc);
  }
  // the rod leaves the drone: its nodes keep their places in the drone frame, inside a group that undoes ARROW_LOCAL
  const rod = new THREE.Group(); rod.applyMatrix4(ARROW_LOCAL.clone().invert()); arrow.add(rod);
  model.children.filter(c => c.name.startsWith('rod_')).forEach(c => rod.add(c));
  // the release is a parallelogram: the horn and the hook turn together about their own pivots, the lever between them only shifts
  const onPivot = (name, y, z) => {
    const pivot = new THREE.Group(); pivot.position.set(0, y, z); model.add(pivot); model.updateMatrixWorld(true); pivot.attach(model.getObjectByName(name));
    return pivot;
  };
  D.hook = onPivot('release_hook', HOOK_PIVOT[0], HOOK_PIVOT[1]); D.horn = onPivot('release_horn', 0.092, 0.036);
  D.lever = model.getObjectByName('release_lever'); D.leverP = D.lever.position.clone();
});
const loaded = Promise.all([razorbill, vegetation]);

function poseDrone(w) {
  state(w, S);
  D.root.matrixAutoUpdate = false; D.root.matrix.copy(S.m); D.root.matrixWorldNeedsUpdate = true;
  // props: a slow forward "strobe" turn per frame at 30 fps, like filmed rotors, plus the blur disc
  const turns = 30 * 3.07;
  D.props.forEach((p, i) => { const a = p.dir * (2 * Math.PI * turns * w + p.ph); p.pivot.rotation.y = a; D.discs[i].material.uniforms.uAng.value = -a; });
  const a = -HOOK_OPEN * sstep(W_REL - 0.25, W_REL + 0.1, w);
  D.hook.rotation.x = D.horn.rotation.x = a;
  D.lever.position.copy(D.leverP).add(_v.set(0, HOOK_ARM * (Math.cos(a) - 1), HOOK_ARM * Math.sin(a)));
  arrowPose(w, S.m, arrow.matrix); arrow.matrixWorldNeedsUpdate = true;
  droneU.value.copy(S.pos); washU.value = 1;
}

// ---------- larvae on the rod ----------
// A larva crawls a path measured along the rod from the soil (s > 0), or across the soil toward the rod (s < 0).
// The numbers below come from the model: rod_tape is a spiral strip, 12.5 mm wide with a 60 mm pitch.
const ROD_R = 0.0111, ROD_NOSE = TIP - HOLD_Y, TAPE_PITCH = 0.06, TAPE_LOW = -1.271, TAPE_W = 0.0125, V_LARVA = 0.024;
const ROD_UP = FALL.dHit.clone().negate();
const around = (th, out = V3()) => out.set(0, Math.cos(th), Math.sin(th)).applyQuaternion(FALL.qHit); // th is the model's atan2(z, x)
const TH_CAM = (() => { const v = CAM_DIR.clone().applyQuaternion(FALL.qHit.clone().invert()); return Math.atan2(v.z, v.y); })();
const LARVAE = [[23.6, -48, 0.036, 1], [25.33, 12, 0.033, 0.82], [27.17, 52, 0.038, 0.93], [28.13, -14, 0.03, 0.72]]
  .map(([t0, off, len, amp], i) => ({ t0, th: TH_CAM + off * DEG, len, amp, i }));
const larvaS = (l, t, u) => V_LARVA * (t - l.t0) - 0.03 + 0.0012 * Math.sin(6.9 * (t - l.t0)) - l.len * u * (1 + 0.07 * Math.sin(6.9 * t - 9.4 * u + l.i));
const larvaTh = (l, s) => l.th + (s > 0 ? 0.16 * Math.sin(s * 24 + l.i * 1.7) : 0);
/** How much of the larva's body is on the strip right now, as a spike from 0 up to its amp and back. */
function larvaSignal(l, t) {
  const s = larvaS(l, t, 0.45);
  if (s <= 0) return 0;
  const centre = TAPE_LOW + TAPE_W / 2 - larvaTh(l, s) / DEG / 90 * (TAPE_PITCH / 4), y = -ROD_NOSE + PEN + s;
  const d = ((y - centre) % TAPE_PITCH + TAPE_PITCH * 1.5) % TAPE_PITCH - TAPE_PITCH / 2;
  return l.amp * Math.exp(-((d / 0.0048) ** 2));
}
const T_PLOT = [25.2, 37.4], SIGNAL = (() => {
  const n = Math.round((T_PLOT[1] - T_PLOT[0]) * 60), a = new Float32Array(n + 1), r = rng(77);
  for (let i = 0; i <= n; i++) { const t = T_PLOT[0] + i / 60; a[i] = LARVAE.reduce((v, l) => v + larvaSignal(l, t), 0) + 0.018 * (r() - 0.5) + 0.012 * Math.sin(t * 2.3) + 0.008 * Math.sin(t * 7.1); }
  return a;
})();
const skin = (() => { // head at the left; the top of the image (v near 0.75) runs along the back
  const W = 1024, H = 256, c = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = c.getContext('2d'), im = g.createImageData(W, H), r = rng(91);
  const mixc = (a, b, u) => a.map((x, i) => mix(x, b[i], u));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, phi = (1 - y / H) * 2 * Math.PI, back = Math.abs(((phi - Math.PI / 2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI), seg = (u - 0.085) * 12.2, fs = seg - Math.floor(seg);
    let col = [104, 86, 58];
    col = mixc(col, [50, 38, 27], 1 - sstep(0.28, 0.5, Math.abs(back - 0.78)));  // dark band either side of the back
    col = mixc(col, [176, 164, 124], 1 - sstep(0.07, 0.15, back));               // pale line down the back
    col = mixc(col, [162, 142, 92], 1 - sstep(0.12, 0.24, Math.abs(back - 1.62))); // pale line along the side
    col = mixc(col, [134, 124, 92], sstep(2.1, 2.5, back));                      // pale belly
    col = col.map(v => v * (0.82 + 0.3 * sstep(0, 0.14, fs) * (1 - sstep(0.86, 1, fs))));  // creases between the segments
    for (const [ba, fa] of [[0.34, 0.38], [0.95, 0.62]]) {                       // the dark raised spots on each segment
      const d = Math.hypot((back - ba) * 0.13, (fs - fa) / 12.2) * W / 8;
      col = mixc(col, [18, 13, 10], 1 - sstep(0.55, 0.95, d));
    }
    if (u < 0.085) {                                                             // head capsule, with the pale inverted Y on its front
      col = mixc([104, 62, 26], [58, 32, 14], 0.5 + 0.5 * Math.sin(x * 0.7 + y * 0.42));
      if (Math.min(Math.abs(back - (0.085 - u) * 6), back < 0.1 && u > 0.04 ? 0 : 9) < 0.09) col = [198, 182, 138];
    }
    const k = 0.93 + 0.14 * r(), i = (y * W + x) * 4;
    im.data[i] = col[0] * k; im.data[i + 1] = col[1] * k; im.data[i + 2] = col[2] * k; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
  return t;
})();
const RINGS = 96, SIDES = 20, LEGS = [0.11, 0.15, 0.19, 0.5, 0.57, 0.64, 0.71, 0.95];
LARVAE.forEach(l => {
  const g = new THREE.BufferGeometry(), uv = [], idx = [];
  for (let j = 0; j <= RINGS; j++) for (let i = 0; i <= SIDES; i++) uv.push(j / RINGS, i / SIDES);
  for (let j = 0; j < RINGS; j++) for (let i = 0; i < SIDES; i++) { const a = j * (SIDES + 1) + i, b = a + 1, c = a + SIDES + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RINGS + 1) * (SIDES + 1) * 3), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  l.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: skin, roughness: 0.42, metalness: 0 }));
  l.mesh.castShadow = l.mesh.receiveShadow = true; l.mesh.frustumCulled = false; l.mesh.visible = false;
  scene.add(l.mesh);
});
const _pa = V3(), _pb = V3(), _pc = V3(), _e = V3(), _n = V3(), _t = V3(), _b = V3(), _w = V3(), UP = V3(0, 1, 0);
/** Point on the crawl path and the outward direction there, rounding the corner where the soil meets the rod. */
function pathAt(l, s, p, n) {
  const e = around(larvaTh(l, s), _e), f = sstep(-0.006, 0.006, s), up = Math.max(s, 0), out = Math.max(-s, 0);
  p.copy(FALL.tipHit).addScaledVector(ROD_UP, up).addScaledVector(e, ROD_R + out); p.y = Math.max(p.y, 0.001);
  if (n) n.copy(UP).lerp(e, f).normalize();
  return p;
}
function poseLarvae(t) {
  for (const l of LARVAE) {
    if (!(l.mesh.visible = t >= l.t0)) continue;
    const P = l.mesh.geometry.attributes.position, R = l.len * 0.085;
    for (let j = 0; j <= RINGS; j++) {
      const u = j / RINGS, s = larvaS(l, t, u);
      pathAt(l, s, _pa, _n);
      pathAt(l, s - 0.0015, _pb); pathAt(l, s + 0.0015, _pc); _t.copy(_pb).sub(_pc).normalize();   // toward the tail
      _n.addScaledVector(_t, -_n.dot(_t)).normalize(); _b.crossVectors(_n, _t).normalize();
      const r = R * Math.sqrt(sstep(0, 0.05, u)) * Math.sqrt(1 - sstep(0.92, 1, u)) * mix(0.8, 1, sstep(0.06, 0.15, u)) * mix(1, 0.8, sstep(0.72, 0.95, u));
      const lift = R * 0.16 * Math.max(0, Math.sin(6.9 * t - 9.4 * u + l.i)), rib = u > 0.085 ? 1 + 0.06 * Math.abs(Math.cos(Math.PI * (u - 0.085) * 12.2)) : 1;
      _w.copy(_pa).addScaledVector(_n, r * 0.8 + lift);
      for (let i = 0; i <= SIDES; i++) {
        const phi = i / SIDES * 2 * Math.PI, c = Math.cos(phi), d = Math.sin(phi); // phi = pi/2 is the back, away from the rod
        let leg = 0; for (const k of LEGS) { const dphi = Math.min(Math.abs(phi - 3.75), Math.abs(phi - 5.67)); leg = Math.max(leg, Math.exp(-(((u - k) / 0.013) ** 2)) * Math.exp(-((dphi / 0.32) ** 2))); }
        const rr = r * rib * (1 + 0.32 * leg);
        P.setXYZ(j * (SIDES + 1) + i, _w.x + _b.x * c * rr + _n.x * d * rr, _w.y + _b.y * c * rr + _n.y * d * rr, _w.z + _b.z * c * rr + _n.z * d * rr);
      }
    }
    P.needsUpdate = true; l.mesh.geometry.computeVertexNormals();
  }
}

// ---------- shots ----------
// Title over a wide, one long scan round the drone and rod in flight, the release, the fall, a cut to the strike, then in to the rod.
const shake = (t, a) => V3(Math.sin(t * 1.7) + 0.5 * Math.sin(t * 4.3 + 1), Math.sin(t * 1.3 + 2) + 0.5 * Math.sin(t * 3.7), Math.sin(t * 1.1 + 4) + 0.4 * Math.sin(t * 5.1 + 3)).multiplyScalar(a);
const HOV = state(W_REL, {}).pos.clone(), arrowP = V3();
/** Camera round the drone: azimuth from behind, distance, height over the feet, looking at a height on the same axis. */
const orbit = (S, az, r, y, look) => {
  camera.position.copy(S.pos).addScaledVector(S.Fh, -Math.cos(az) * r).addScaledVector(S.Rh, Math.sin(az) * r).add(_v.set(0, y, 0));
  camera.lookAt(_v.copy(S.pos).addScaledVector(S.U, look));
};
// the scan up to the release: film time, then azimuth (keeps turning the same way), distance, height and aim above the feet, lens
const SCAN = [
  [4.4, 0.5, 6.0, 0.6, -0.45, 34], [5.4, 0.62, 5.8, 0.55, -0.45, 34],
  [8.0, 1.6, 0.85, -1.28, -1.28, 30], [10.0, 3.1, 0.7, -0.98, -0.98, 30], [12.2, 4.6, 0.7, -0.45, -0.45, 30],
  [13.6, 5.9, 1.25, 0.15, -0.1, 34], [15.3, 7.1, 1.35, 0.55, 0.1, 34],
  [16.8, 7.95, 1.05, -0.12, -0.03, 32], [18.6, 2.3 + 2 * Math.PI, 0.5, -0.13, -0.04, 26],
];
/** Smooth curve through keyframes [t, ...values] (Catmull-Rom on the uneven times), at rest at both ends. */
function keyed(keys, t) {
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1], h = b[0] - a[0], u = clamp((t - a[0]) / h, 0, 1);
  const slope = (k, n) => (k <= 0 || k >= keys.length - 1) ? 0 : (keys[k + 1][n] - keys[k - 1][n]) / (keys[k + 1][0] - keys[k - 1][0]);
  return a.slice(1).map((_, c) => {
    const n = c + 1, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * a[n] + (u3 - 2 * u2 + u) * h * slope(i, n) + (-2 * u3 + 3 * u2) * b[n] + (u3 - u2) * h * slope(i + 1, n);
  });
}
const SHOTS = [
  { t: 0, wide: true, f(t, S) { // establishing: high and broad, the drone crossing the field under the title
    const u = t / 4.4;
    camera.position.copy(state(W(2.2), S2).pos).add(V3(mix(-11, -3, u), mix(13, 11, u), mix(-20, -18, u)));
    camera.lookAt(_v.copy(S.c).addScaledVector(S.Fh, 4).add(V3(0, -1.2, 0)));
    camera.fov = 34; return [S.c, 30];
  } },
  { t: 4.4, f(t, S) { // one move: wide, in to the rod's nose, up the rod while circling it, the drone close, back to the hook
    const [az, r, y, look, fov] = keyed(SCAN, t);
    orbit(S, az, r, y, look);
    camera.fov = fov; return [S.c, 3];
  } },
  { t: 18.6, f(t, S) { // the release, close: the hook turns and the ring slips off its tip
    const u = (t - 18.6) / 2;
    orbit(S, 2.3, mix(0.5, 0.46, u), -0.13, -0.04);
    camera.fov = 26; return [S.c, 2];
  } },
  { t: 20.6, f(t) { // falling with the rod: the crop coming up behind it
    arrowP.setFromMatrixPosition(arrow.matrix);
    const u = (t - 20.6) / 0.85;
    camera.position.copy(arrowP).add(V3(mix(-1.7, -1.55, u), mix(0.75, 0.55, u), mix(-1.0, -0.9, u)));
    camera.lookAt(arrowP);
    camera.fov = 38; return [arrowP, 4];
  } },
  { t: 21.45, f(t) { // the strike, then one push: through the crop as it fades, down to the rod, which sits left of the plot
    const u = ease((t - 22.6) / 3.2);
    const h = Math.max(0.07, 0.08 + V_LARVA * (t - 31)), mid = _pa.copy(FALL.tipHit).addScaledVector(ROD_UP, h);
    const side = _pb.crossVectors(UP, CAM_DIR).normalize();
    camera.position.copy(FALL.tipHit).addScaledVector(CAM_DIR, mix(IMPACT_CAM.d, 0.31, u));
    camera.position.y = mix(IMPACT_CAM.y, h + 0.035, u);
    camera.lookAt(_v.copy(FALL.tipHit).add(_pc.set(0, 0.62, 0)).lerp(mid, u).addScaledVector(side, 0.075 * u));
    camera.fov = 30; return [IMPACT, mix(3, 1.2, u)];
  } },
];

const $ = id => document.getElementById(id);
const PLOT = { x0: 96, x1: 824, y0: 400, y1: 60 };
function overlays(t) {
  $('fade').style.opacity = String(Math.max(1 - sstep(0, 0.8, t), sstep(DUR - 1.1, DUR - 0.1, t)));
  $('intro').style.opacity = String(sstep(0.7, 1.4, t) * (1 - sstep(3.7, 4.3, t)));
  $('plot').style.opacity = String(sstep(T_PLOT[0] - 0.5, T_PLOT[0] + 0.1, t));
  if (t < T_PLOT[0] - 0.5) return;
  const u = clamp((t - T_PLOT[0]) / (T_PLOT[1] - T_PLOT[0]), 0, 1), last = u * (SIGNAL.length - 1);
  const X = i => mix(PLOT.x0, PLOT.x1, i / (SIGNAL.length - 1)), Y = v => mix(PLOT.y0, PLOT.y1, v / 1.25);
  let d = `M${X(0).toFixed(1)} ${Y(SIGNAL[0]).toFixed(1)}`;
  for (let i = 1; i <= last; i++) d += `L${X(i).toFixed(1)} ${Y(SIGNAL[i]).toFixed(1)}`;
  $('trace').setAttribute('d', d);
  const i = Math.floor(last), v = mix(SIGNAL[i], SIGNAL[Math.min(i + 1, SIGNAL.length - 1)], last - i);
  $('head').setAttribute('cx', X(last).toFixed(1)); $('head').setAttribute('cy', Y(v).toFixed(1));
}

// ---------- frame ----------
function render(t) {
  const w = W(t);
  shared.uTime.value = w;
  poseDrone(w);
  impactAt(w >= W_HIT ? w - W_HIT : -1);
  let k = 0; while (k + 1 < SHOTS.length && t >= SHOTS[k + 1].t) k++;
  const [focus, size] = SHOTS[k].f(t, S, w);
  // near plane from what is actually close: at a fixed 0.02 the ground plane out-votes the plants in the depth test from 25 m up
  const clear = Math.min(camera.position.y - 0.4, camera.position.distanceTo(S.c) - 1.2, camera.position.distanceTo(_v.setFromMatrixPosition(arrow.matrix)) - 0.8);
  camera.near = clamp(clear * 0.5, 0.02, 5);
  camera.updateProjectionMatrix();
  shadowAt(focus, size);
  sky.position.copy(camera.position);
  poseLarvae(t);
  revealU.value = sstep(22.2, 24.6, t);
  overlays(t);
  st.render(0, t);
}

const qs = new URLSearchParams(location.search);
let ft = Number(qs.get('t') || 0);
window.__dbg = { W, W_REL, W_HIT, IMPACT, FALL, state, HOV, SIGNAL, T_PLOT };
window.__film = { ready: loaded, seek: t => render(t), duration: DUR };
if (!qs.has('film')) $('labs').hidden = false;
loaded.then(() => {
  if (qs.has('film')) return render(ft);
  let last = performance.now(), paused = false;
  addEventListener('keydown', e => { if (e.code === 'Space') paused = !paused; if (e.code === 'ArrowRight') ft += 2; if (e.code === 'ArrowLeft') ft = Math.max(0, ft - 2); });
  const loop = now => { const dt = Math.min(0.1, (now - last) / 1000); last = now; if (!paused) ft = (ft + dt) % DUR; render(ft); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
