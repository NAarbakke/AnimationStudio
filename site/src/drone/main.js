// Razorbill farm drone, 36 s: flies in low over a crop field, flares to a hover and drops an arrow into a furrow.
// World units are metres: the drone flies roughly along +x, +y is up, crop rows run along x and repeat every 0.75 m in z.
// The drop point is near the origin. Everything is a pure function of film time t, so any frame renders on its own
// (drone.html?film for video/render.js, ?t=20 to preview from a given second; space pauses, arrows skip).
// Model: cad/razorbill.py turns cad/imports/2000_Razorbill_farm_drone.STEP into /models/razorbill.glb.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createStage, lin, NOISE } from '../shared/stage';

const DUR = 36, G = 9.81, DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const mix = (a, b, u) => a + (b - a) * u;
const ease = u => { u = clamp(u, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------- film time → world time (slow motion around the drop) ----------
const RATE = [[0, 1], [18.9, 1], [19.4, 0.4], [22.9, 0.4], [23.7, 1], [DUR, 1]];
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
const ROW = 0.75;                                  // crop rows at z = k·ROW, furrows halfway between
const TRAM = z => Math.abs(((z - 12) % 24 + 36) % 24 - 12); // distance from the nearest tramline centre (z = 12 + 24k)
const PLANTS = { x0: -165, x1: 110, z: 30 };       // where real plant meshes stand; beyond that the shader paints the rows
const FIELD = { x0: -420, x1: 240, z0: -140, z1: 120 };
const Z_DROP = ROW / 2;                            // land the arrow in a furrow

// ---------- flight path ----------
const ARROW_Z = -0.0035;                           // arrow axis offset from the drone centreline (model z)
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
  o.c = (o.c || V3()).copy(o.pos).addScaledVector(o.U, 0.12); // body centre
  o.speed = speed(w);
  return o;
}
const S = state(0), S2 = state(0);

// ---------- arrow flight ----------
// Held under the belly along the drone's x axis, tip forward: the latch at the tip end opens first, the arrow swings
// nose-down about the rear bracket, slips off it, falls weather-vaning toward vertical and sticks in the furrow.
const TIP = 0.34, NOCK = -0.40, PIVOT = V3(-0.084, 0.125, ARROW_Z), HOLD = V3(0, 0.1205, ARROW_Z);
const TA = 0.35, THA = 45 * DEG, PHT = 78 * DEG, KD = 5, PEN = 0.13;
function arrowLocal(theta, out = new THREE.Matrix4()) { // arrow → drone frame while still on the bracket
  const r = new THREE.Matrix4().makeRotationZ(-theta);
  return out.makeTranslation(PIVOT.x, PIVOT.y, PIVOT.z).multiply(r).multiply(new THREE.Matrix4().makeTranslation(HOLD.x - PIVOT.x, HOLD.y - PIVOT.y, HOLD.z - PIVOT.z));
}
const FALL = (() => {
  const at = tau => state(W_REL + tau, {}).m.clone().multiply(arrowLocal(THA * (tau / TA) ** 2));
  const m0 = at(TA), m1 = at(TA - 1e-3);
  const p0 = V3().setFromMatrixPosition(m0), q0 = new THREE.Quaternion().setFromRotationMatrix(m0);
  const v0 = p0.clone().sub(V3().setFromMatrixPosition(m1)).divideScalar(1e-3);
  const d0 = V3(1, 0, 0).applyQuaternion(q0), ph0 = Math.asin(-d0.y), w0 = 2 * THA / TA;
  const h = V3(d0.x, 0, d0.z).normalize(), k = V3().crossVectors(h, V3(0, -1, 0)).normalize();
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
  if (tau < TA) return out.copy(droneM).multiply(arrowLocal(tau <= 0 ? 0 : THA * (tau / TA) ** 2));
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
const st = createStage(canvas, document.body);
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
  sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(SUN, 150);
  const c = sun.shadow.camera; c.left = c.bottom = -size; c.right = c.top = size; c.near = 1; c.far = 400; c.updateProjectionMatrix();
}

const skyMat = new THREE.ShaderMaterial({
  uniforms: shared, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
  fragmentShader: SKY_GLSL + `varying vec3 vDir; void main(){ vec3 d = normalize(vDir); vec3 c = skyColor(d);
    float mu = dot(d, uSun); c += vec3(1.0,0.92,0.8)*smoothstep(0.99985, 0.99992, mu)*30.0; gl_FragColor = vec4(c, 1.0); }`,
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
          + snoise(vec3(p*11.0, 7.0))*0.25*(1.0 - smoothstep(0.008, 0.05, fw));
  return mix(vec3(0.07, 0.042, 0.022), vec3(0.19, 0.12, 0.068), clamp(0.5 + 0.7*n, 0.0, 1.0));
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

// ---------- crops: instanced leafy tufts in rows, swaying in the wind and the rotor downwash ----------
function tuftGeometry() {
  const pos = [], idx = [], r = rng(3), LEAVES = 5, SEG = 3;
  for (let l = 0; l < LEAVES; l++) {
    const az = (l / LEAVES) * Math.PI * 2 + r() * 0.8, len = 0.17 + r() * 0.1, lean = 0.5 + r() * 0.6, wid = 0.022 + r() * 0.012;
    const dir = [Math.cos(az), Math.sin(az)], side = [-dir[1], dir[0]], base = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const u = s / SEG, reach = len * Math.sin(lean) * (0.4 * u + 0.6 * u * u), hgt = len * Math.cos(lean * 0.6) * (u - 0.35 * u * u * lean);
      const w = wid * Math.sin(Math.PI * Math.min(1, u * 0.85 + 0.12));
      pos.push(dir[0] * reach + side[0] * w, hgt, dir[1] * reach + side[1] * w, dir[0] * reach - side[0] * w, hgt, dir[1] * reach - side[1] * w);
    }
    for (let s = 0; s < SEG; s++) { const a = base + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const n = g.attributes.normal; for (let i = 0; i < n.count; i++) { _v.fromBufferAttribute(n, i); if (_v.y < 0) _v.negate(); _v.y += 0.8; _v.normalize(); n.setXYZ(i, _v.x, _v.y, _v.z); }
  return g;
}
const droneU = { value: V3() }, washU = { value: 0 };
const cropMat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
cropMat.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, { uDrone: droneU, uWash: washU, uTime: shared.uTime });
  sh.vertexShader = 'uniform vec3 uDrone; uniform float uWash; uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vec3 ib = (modelMatrix*instanceMatrix*vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float k = position.y/0.25; k *= k;
    vec2 dw = ib.xz - uDrone.xz; float dist = length(dw);
    float wash = uWash*exp(-dist*dist/1.6)*clamp(3.2/max(uDrone.y - ib.y, 0.5), 0.0, 1.5);
    vec3 wd = vec3(0.025*sin(uTime*1.6 + ib.x*0.31 + ib.z*0.17) + 0.01*sin(uTime*4.1 + ib.z*2.3), 0.0, 0.012*sin(uTime*1.3 + ib.x*0.2));
    wd.xz += dw/(dist + 0.25)*wash*(0.06 + 0.035*sin(uTime*17.0 + dist*9.0 + ib.x*13.0));
    wd.y -= wash*0.03;
    mat3 im = mat3(instanceMatrix);
    transformed += transpose(im)*wd*k/dot(im[0], im[0]);`);
};
{
  const r = rng(11), list = [];
  for (let k = Math.ceil(-PLANTS.z / ROW); k <= Math.floor(PLANTS.z / ROW); k++) {
    const z = k * ROW; if (TRAM(z) < 1.3) continue;
    for (let x = PLANTS.x0; x < PLANTS.x1; x += 0.24 + r() * 0.08) list.push([x + (r() - 0.5) * 0.06, z + (r() - 0.5) * 0.07]);
  }
  const mesh = new THREE.InstancedMesh(tuftGeometry(), cropMat, list.length);
  const c = new THREE.Color(), q = new THREE.Quaternion(), up = V3(0, 1, 0);
  list.forEach(([x, z], i) => {
    const edge = Math.min(x - PLANTS.x0, PLANTS.x1 - x, PLANTS.z - Math.abs(z)), s = (0.8 + r() * 0.5) * mix(0.35, 1, sstep(0, 10, edge));
    mesh.setMatrixAt(i, _m.compose(_v.set(x, 0, z), q.setFromAxisAngle(up, r() * 6.283), V3(s, s * (0.85 + r() * 0.3), s)));
    mesh.setColorAt(i, c.setRGB(mix(0.03, 0.065, r()), mix(0.1, 0.18, r()), mix(0.015, 0.035, r())));
  });
  mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
  scene.add(mesh);
}

// ---------- trees along the hedges, a farmyard ----------
{
  const r = rng(5), spots = [];
  for (let x = FIELD.x0 - 30; x < FIELD.x1 + 30; x += 7 + r() * 9) spots.push([x, FIELD.z0 - 3.5 - r() * 3]);
  for (let x = FIELD.x0; x < FIELD.x1; x += 18 + r() * 40) spots.push([x, FIELD.z1 + 3.5 + r() * 2]);
  for (let z = FIELD.z0; z < FIELD.z1; z += 10 + r() * 25) spots.push([FIELD.x1 + 3.5 + r() * 2, z], [FIELD.x0 - 3.5 - r() * 2, z]);
  for (let n = 0; n < 160; n++) { const a = r() * 6.283, d = 700 + r() * 1500; spots.push([Math.cos(a) * d, Math.sin(a) * d]); }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.3, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: lin(0x3a2c20), roughness: 0.9 }), spots.length);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshStandardMaterial({ roughness: 0.95 }), spots.length * 3);
  const q = new THREE.Quaternion(), c = new THREE.Color();
  let ci = 0;
  spots.forEach(([x, z], i) => {
    const h = 7 + r() * 8, w = h * (0.32 + r() * 0.12);
    trunks.setMatrixAt(i, _m.compose(_v.set(x, 0, z), q.identity(), V3(1, h * 0.55, 1)));
    for (let b = 0; b < 3; b++) {
      const s = w * (1 - b * 0.22);
      crowns.setMatrixAt(ci, _m.compose(V3(x + (r() - 0.5) * w * 0.8, h * (0.55 + b * 0.16) + (r() - 0.5), z + (r() - 0.5) * w * 0.8), q.setFromAxisAngle(V3(0, 1, 0), r() * 6), V3(s, s * 0.85, s)));
      crowns.setColorAt(ci++, c.setRGB(mix(0.03, 0.07, r()), mix(0.07, 0.13, r()), mix(0.02, 0.035, r())));
    }
  });
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);

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

// ---------- arrow: carbon shaft, steel broadhead, orange/white vanes ----------
function makeArrow() {
  const g = new THREE.Group();
  const std = (hex, rough, metal) => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: rough, metalness: metal, side: THREE.DoubleSide });
  const carbon = std(0x18191b, 0.35, 0.3), steel = std(0xc8ccd0, 0.22, 1), orange = std(0xff6a13, 0.55, 0), white = std(0xf2f0ea, 0.5, 0);
  const alongX = geo => geo.rotateZ(-Math.PI / 2);
  const shaftL = TIP - 0.055 - NOCK - 0.012;
  const shaft = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.0042, 0.0042, shaftL, 12)), carbon); shaft.position.x = NOCK + 0.012 + shaftL / 2;
  const insert = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 12)), steel); insert.position.x = TIP - 0.065;
  const ferrule = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.0022, 0.0048, 0.045, 12)), steel); ferrule.position.x = TIP - 0.0225;
  const nock = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.0048, 0.0042, 0.016, 12)), orange); nock.position.x = NOCK + 0.008;
  const wrap = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.0046, 0.0046, 0.11, 12)), white); wrap.position.x = NOCK + 0.075;
  g.add(shaft, insert, ferrule, nock, wrap);
  const blade = new THREE.Shape(); blade.moveTo(0, 0); blade.lineTo(0.042, 0); blade.lineTo(0, 0.013); blade.lineTo(0, 0);
  const vane = new THREE.Shape(); vane.moveTo(0, 0); vane.lineTo(0.095, 0); vane.bezierCurveTo(0.07, 0.012, 0.035, 0.02, 0.008, 0.021); vane.lineTo(0, 0);
  for (let k = 0; k < 3; k++) {
    const a = k * 2 * Math.PI / 3;
    const b = new THREE.Mesh(new THREE.ShapeGeometry(blade), steel); b.position.x = TIP - 0.044; b.rotation.x = a; b.children; g.add(b);
    const v = new THREE.Mesh(new THREE.ShapeGeometry(vane), k ? orange : white); v.position.x = NOCK + 0.03; v.rotation.x = a + Math.PI / 2;
    v.geometry.translate(0, 0.0042, 0); g.add(v);
  }
  g.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
  g.matrixAutoUpdate = false;
  return g;
}
const arrow = makeArrow(); scene.add(arrow);

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
        float a = max(uAge, 0.0), az = seed.x*6.2832, sp = mix(0.25, 1.1, seed.y), up = mix(0.25, 1.0, seed.z);
        float k = 2.6, travel = (1.0 - exp(-k*a))/k;
        vec3 p = uOrigin + vec3(cos(az)*sp*travel, up*sp*travel*0.9 - 0.05*a*a + 0.01, sin(az)*sp*travel);
        p.y = max(p.y, 0.005);
        vA = (uAge < 0.0 ? 0.0 : 1.0)*smoothstep(0.0, 0.04, a)*(1.0 - smoothstep(0.4, 2.2 + seed.w, a));
        vS = seed.w;
        vec4 mv = modelViewMatrix*vec4(p, 1.0);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = uScale*(0.03 + 0.11*a*(0.6 + seed.w))*(0.6 + seed.y)/-mv.z;
      }`,
    fragmentShader: `varying float vA; varying float vS;
      void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c)*2.0; if (r > 1.0) discard;
        gl_FragColor = vec4(mix(vec3(0.42, 0.33, 0.22), vec3(0.58, 0.48, 0.36), vS), vA*0.38*(1.0 - r*r)); }`,
  }));
  pts.frustumCulled = false; scene.add(pts);
  return pts;
})();
const clods = (() => {
  const N = 18, r = rng(33), m = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: lin(0x3d2a19), roughness: 1 }), N);
  m.userData.seed = Array.from({ length: N }, () => [r() * 6.283, 0.4 + r() * 1.0, 1.0 + r() * 1.6, 0.004 + r() * 0.006]);
  m.castShadow = true; m.frustumCulled = false; scene.add(m); return m;
})();
function impactAt(age) {
  impactU.value.z = age;
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
const D = { root: new THREE.Group(), props: [], discs: [], latch: null, horn: null };
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
const loaded = new GLTFLoader().loadAsync('/models/razorbill.glb').then(gltf => {
  const model = gltf.scene.getObjectByName('razorbill') ?? gltf.scene.children[0];
  model.quaternion.identity(); // the STEP is already Y-up; undo the exporter's Z-up → Y-up turn
  D.root.add(model); model.updateMatrixWorld(true);
  const std = (hex, rough, metal, extra = {}) => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: rough, metalness: metal, ...extra });
  const MAT = {
    hub: std(0x1c1d20, 0.42, 0.35), top: std(0x232427, 0.4, 0.35), battery: std(0xe2741f, 0.5, 0.05), arm: std(0x141517, 0.36, 0.4),
    leg: std(0xd6d9dc, 0.45, 0.1), motor: std(0x34373c, 0.3, 0.85), prop: std(0x0f1012, 0.4, 0.1, { transparent: true, opacity: 0.55 }), release: std(0xb8bcc1, 0.28, 0.9),
  };
  const meshes = {};
  model.traverse(o => { if (o.isMesh) { const n = (o.name || o.parent.name).toLowerCase(); meshes[n] = o; o.material = MAT[n.split('_')[0]] ?? MAT.hub; o.castShadow = o.receiveShadow = true; } });
  model.children.forEach(c => { if (!c.isMesh && c.name) c.traverse(o => { if (o.isMesh) meshes[c.name.toLowerCase()] = o; }); });
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
  D.latch = model.getObjectByName('release_latch'); D.latchQ = D.latch.quaternion.clone();
  D.horn = model.getObjectByName('release_horn'); D.hornQ = D.horn.quaternion.clone();
});

function poseDrone(w) {
  state(w, S);
  D.root.matrixAutoUpdate = false; D.root.matrix.copy(S.m); D.root.matrixWorldNeedsUpdate = true;
  // props: a slow forward "strobe" turn per frame at 30 fps, like filmed rotors, plus the blur disc
  const turns = 30 * 3.07;
  D.props.forEach((p, i) => { const a = p.dir * (2 * Math.PI * turns * w + p.ph); p.pivot.rotation.y = a; D.discs[i].material.uniforms.uAng.value = -a; });
  const open = sstep(W_REL - 0.12, W_REL + 0.04, w);
  if (D.latch) D.latch.quaternion.copy(D.latchQ).multiply(_q.setFromAxisAngle(V3(0, 0, 1), -1.3 * open));
  if (D.horn) D.horn.quaternion.copy(D.hornQ).multiply(_q.setFromAxisAngle(V3(0, 1, 0), 1.4 * sstep(W_REL - 0.25, W_REL, w)));
  arrowPose(w, S.m, arrow.matrix); arrow.matrixWorldNeedsUpdate = true;
  droneU.value.copy(S.pos); washU.value = 1;
}

// ---------- shots ----------
// Close shots dominate; three wide ones open, sit mid-approach and close the film.
const shake = (t, a) => V3(Math.sin(t * 1.7) + 0.5 * Math.sin(t * 4.3 + 1), Math.sin(t * 1.3 + 2) + 0.5 * Math.sin(t * 3.7), Math.sin(t * 1.1 + 4) + 0.4 * Math.sin(t * 5.1 + 3)).multiplyScalar(a);
const HOV = state(W_REL, {}).pos.clone(), arrowP = V3();
const SHOTS = [
  { t: 0, wide: true, f(t, S) { // establishing: high and broad, the drone crossing the field
    const u = t / 4.4;
    camera.position.copy(state(W(2.2), S2).pos).add(V3(mix(-11, -3, u), mix(13, 11, u), mix(-20, -18, u)));
    camera.lookAt(_v.copy(S.c).addScaledVector(S.Fh, 4).add(V3(0, -1.2, 0)));
    camera.fov = 34; return [S.c, 30];
  } },
  { t: 4.4, f(t, S) { // chase, rear quarter: crops streaming under the drone
    const u = ease((t - 4.4) / 5.2);
    camera.position.copy(S.c).addScaledVector(S.Fh, mix(-2.3, -1.6, u)).addScaledVector(S.Rh, mix(1.1, -0.7, u)).add(V3(0, mix(0.6, 0.35, u), 0)).add(shake(t, 0.025));
    camera.lookAt(_v.copy(S.c).addScaledVector(S.Fh, 0.7));
    camera.fov = 42; return [S.c, 3];
  } },
  { t: 9.6, f(t, S) { // low side track: the arrow clipped under the belly
    const u = ease((t - 9.6) / 3.6);
    camera.position.copy(S.c).addScaledVector(S.Rh, mix(1.25, 1.05, u)).addScaledVector(S.Fh, mix(1.0, -0.8, u)).add(V3(0, -0.2, 0)).add(shake(t, 0.015));
    camera.lookAt(_v.copy(S.c).add(V3(0, -0.04, 0)));
    camera.fov = 36; return [S.c, 2.5];
  } },
  { t: 13.2, wide: true, f(t, S) { // high overhead: rows, tramlines, the drone and its shadow sliding toward the drop
    const u = (t - 13.2) / 3.4;
    camera.position.set(HOV.x + mix(-26, -14, u), mix(30, 27, u), HOV.z + 7);
    camera.lookAt(_v.set(S.pos.x + 2, 0, S.pos.z + 1));
    camera.fov = 34; return [V3(S.pos.x + 2, 0, S.pos.z), 34];
  } },
  { t: 16.6, f(t, S) { // front, at eye level with the drone: the flare into the hover, field behind
    const u = (t - 16.6) / 2.55;
    camera.position.copy(HOV).add(V3(mix(2.0, 1.65, u), mix(0.75, 0.5, u), mix(-1.55, -1.25, u))).add(shake(t, 0.008));
    camera.lookAt(_v.copy(S.c).add(V3(0, -0.06, 0)));
    camera.fov = 32; return [S.c, 2.5];
  } },
  { t: 19.15, f(t, S, w) { // under the belly: the latch opens, the arrow tips and drops away
    const u = ease((t - 19.15) / 2.1);
    camera.position.copy(HOV).add(V3(0.6, mix(-0.55, -0.75, u), 0.95));
    arrowP.setFromMatrixPosition(arrow.matrix);
    camera.lookAt(_v.copy(HOV).add(V3(0, 0.1, 0)).lerp(arrowP, 0.35 * sstep(W_REL + 0.2, W_REL + 0.9, w)));
    camera.fov = 40; return [S.c, 2.5];
  } },
  { t: 21.25, f(t) { // down in the furrow, looking along it: the arrow strikes, dust, quiver
    const u = (t - 21.25) / 3.6;
    camera.position.copy(IMPACT).add(V3(mix(-1.75, -1.6, u), 0.2, 0.02));
    camera.lookAt(_v.copy(IMPACT).add(V3(0, 0.27, 0)));
    camera.fov = 34; return [IMPACT, 3];
  } },
  { t: 24.85, f(t) { // slow orbit round the arrow standing in the soil
    const u = (t - 24.85) / 3.0, a = mix(-2.2, -2.75, u), r = mix(1.3, 1.05, u);
    camera.position.copy(IMPACT).add(V3(Math.cos(a) * r, mix(0.42, 0.34, u), Math.sin(a) * r)).add(shake(t, 0.004));
    camera.lookAt(_v.copy(IMPACT).add(V3(0, 0.3, 0)));
    camera.fov = 34; return [IMPACT, 3];
  } },
  { t: 27.85, f(t, S) { // arrow in the foreground, the drone climbing away beyond it
    const u = (t - 27.85) / 2.65;
    camera.position.copy(IMPACT).add(V3(mix(-1.5, -1.65, u), 0.32, mix(0.75, 0.8, u)));
    camera.lookAt(_v.copy(IMPACT).add(V3(0, 0.4, 0)).lerp(S.c, 0.45));
    camera.fov = 44; return [IMPACT, 4];
  } },
  { t: 30.5, wide: true, f(t, S) { // crane up and out to the whole field
    const u = ease((t - 30.5) / 5.5);
    camera.position.copy(IMPACT).add(V3(mix(-2, -50, u), mix(1.2, 46, u), mix(1.8, 52, u)));
    camera.lookAt(_v.copy(IMPACT).add(V3(0, 0.3, 0)).lerp(V3(IMPACT.x + 30, 4, IMPACT.z - 10), sstep(0.15, 1, u)));
    camera.fov = mix(36, 40, u); return [IMPACT, mix(3, 45, u)];
  } },
];

const $ = id => document.getElementById(id);
function overlays(t) {
  const fade = Math.max(1 - sstep(0, 0.8, t), sstep(DUR - 1.2, DUR, t));
  $('fade').style.opacity = String(fade);
  $('intro').style.opacity = String(sstep(0.8, 1.6, t) * (1 - sstep(3.6, 4.3, t)));
  $('end').style.opacity = String(sstep(32.2, 33.2, t) * (1 - sstep(DUR - 1.4, DUR - 0.6, t)));
}

// ---------- frame ----------
function render(t) {
  const w = W(t);
  shared.uTime.value = w;
  poseDrone(w);
  impactAt(w >= W_HIT ? w - W_HIT : -1);
  let k = 0; while (k + 1 < SHOTS.length && t >= SHOTS[k + 1].t) k++;
  const [focus, size] = SHOTS[k].f(t, S, w);
  camera.updateProjectionMatrix();
  shadowAt(focus, size);
  sky.position.copy(camera.position);
  overlays(t);
  st.render(0, t);
}

const qs = new URLSearchParams(location.search);
let ft = Number(qs.get('t') || 0);
window.__dbg = { W, W_REL, W_HIT, IMPACT, FALL, state, HOV };
window.__film = { ready: loaded, seek: t => render(t), duration: DUR };
loaded.then(() => {
  if (qs.has('film')) return render(ft);
  let last = performance.now(), paused = false;
  addEventListener('keydown', e => { if (e.code === 'Space') paused = !paused; if (e.code === 'ArrowRight') ft += 2; if (e.code === 'ArrowLeft') ft = Math.max(0, ft - 2); });
  const loop = now => { const dt = Math.min(0.1, (now - last) / 1000); last = now; if (!paused) ft = (ft + dt) % DUR; render(ft); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
