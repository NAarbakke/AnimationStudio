// Bakes the X-12 film (site/src/x12/main.js) for Blender: the choreography stays in the film, Blender only renders it.
//   node video/x12/bake.js [--force]   -> video/out/x12-work/bake/{scene.json, frames.bin, terrain.bin, boat.glb}
// The film is posed frame by frame without drawing (window.__bake.pose) and read back in three.js's frame (Y up);
// blender/x12/x12_film.py turns that into Blender's (Z up). Per frame (float32, scene.frameFloats long, layout in scene.layout):
//   camera matrixWorld (16), vertical fov (deg), shot index, EO/IR shot
//   boat matrix (16), speed, bow vertical speed
//   rig angles: nav radar, gimbal pan, gimbal tilt, port train, port elevation, starboard train, starboard elevation
//   drone: visible, matrixWorld (16), propeller angle;  interceptor: visible, matrixWorld (16)
//   18 debris pieces: visible, matrixWorld (16);  3 escorts: matrixWorld (16)
//   wake trail: TRAIL_N x (x, z, age, speed);  film time
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(root, 'video/out/x12-work/bake');
const src = join(root, 'site/src/x12/main.js');
export const FPS = 24;
const TER_STEP = 8;
mkdirSync(out, { recursive: true });
const files = ['scene.json', 'frames.bin', 'terrain.bin', 'boat.glb'];
const done = files.every(f => existsSync(join(out, f))) && statSync(join(out, 'frames.bin')).mtimeMs > statSync(src).mtimeMs;
if (done && !process.argv.includes('--force')) { console.log(`bake up to date (${out}); --force to redo it`); process.exit(0); }

const server = await (await createServer({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn', server: { hmr: false, watch: null } })).listen();
const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.error(`[page] ${e.message}`));
  await page.goto(new URL('x12.html?film&overlay', server.resolvedUrls.local[0]).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bake && window.__film, null, { timeout: 120_000 });
  await page.evaluate(() => window.__film.ready);

  // ---- once: the boat with its rigs, and everything that does not change per frame
  const glb = await page.evaluate(() => window.__bake.exportBoat());
  writeFileSync(join(out, 'boat.glb'), Buffer.from(glb, 'base64'));
  const scene = await page.evaluate(([TER_STEP]) => {
    const K = window.__bake, r = x => Math.round(x * 1e5) / 1e5, arr = a => Array.from(a, r), v3 = v => v.toArray().map(r);
    const boat = {}; for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'v', 'bowV']) boat[k] = arr(K.BOAT[k]);
    const DE = K.DEBRIS.map(d => ({ size: d.mesh.geometry.parameters ? [d.mesh.geometry.parameters.width, d.mesh.geometry.parameters.height, d.mesh.geometry.parameters.depth] : [0.3, 0.1, 0.2],
      v: v3(d.v), spin: v3(d.spin), w: d.w, drag: d.drag, fire: d.fire, splash: d.splash, splashP: v3(d.splashP) }));
    return {
      fps: 0, duration: K.T.DUR, T: K.T, DW: K.DW, boat,
      waves: K.WAVES.map(w => ({ L: w.L, k: w.k, A: w.A, w: w.w, dx: w.dx, dz: w.dz, Q: w.Q, ph: w.ph })),
      sun: v3(K.SUN), wind: v3(K.WIND), iPt: v3(K.I_PT), dirIn: v3(K.DIR_IN), side3: v3(K.SIDE3), junction: v3(K.JUNCTION),
      msl: { p0: v3(K.MSL.p0), back: v3(K.MSL.back), d0: v3(K.MSL.d0), p1: v3(K.MSL.p1), p2: v3(K.MSL.p2), T: K.MSL.T },
      debris: DE, ships: K.SHIPS.map(s => ({ kind: s.kind, L: s.L, B: s.B })),
      trail: { n: K.TRAIL_N, dt: K.TRAIL_DT },
      shots: K.SHOTS.map(s => ({ t: s.t, eoir: !!s.eoir })), chapters: K.CHAPTERS.map(c => ({ t: c.t, end: c.end, g: c.g, anchor: c.anchor })),
      ter: { x0: K.TER.x0, x1: K.TER.x1, z0: K.TER.z0, z1: K.TER.z1, step: TER_STEP },
    };
  }, [TER_STEP]);
  scene.fps = FPS; scene.frames = Math.round(scene.duration * FPS);
  scene.layout = { cam: 0, fov: 16, shot: 17, eoir: 18, boat: 19, v: 35, bowV: 36, rig: 37, drone: 44, prop: 61, missile: 62, debris: 79, ships: 79 + 18 * 17, trail: 79 + 18 * 17 + 48 };
  scene.layout.t = scene.layout.trail + scene.trail.n * 4;
  scene.frameFloats = scene.layout.t + 1;

  // ---- the terrain heights on a finer grid than the film's mesh, row by row along z
  const nx = Math.round((scene.ter.x1 - scene.ter.x0) / TER_STEP) + 1, nz = Math.round((scene.ter.z1 - scene.ter.z0) / TER_STEP) + 1;
  scene.ter.nx = nx; scene.ter.nz = nz;
  const H = new Float32Array(nx * nz);
  for (let j0 = 0; j0 < nz; j0 += 128) {
    const rows = await page.evaluate(([j0, n, nx, t]) => {
      const K = window.__bake, o = [];
      for (let j = j0; j < j0 + n; j++) for (let i = 0; i < nx; i++) o.push(K.terrainH(t.x0 + i * t.step, t.z0 + j * t.step));
      return o;
    }, [j0, Math.min(128, nz - j0), nx, scene.ter]);
    H.set(rows, j0 * nx);
  }
  writeFileSync(join(out, 'terrain.bin'), Buffer.from(H.buffer));
  writeFileSync(join(out, 'scene.json'), JSON.stringify(scene));
  console.log(`terrain ${nx}x${nz}; ${scene.frames} frames of ${scene.frameFloats} floats`);

  // ---- every frame
  const frames = new Float32Array(scene.frames * scene.frameFloats);
  const CHUNK = 48;
  for (let f0 = 0; f0 < scene.frames; f0 += CHUNK) {
    const n = Math.min(CHUNK, scene.frames - f0);
    const chunk = await page.evaluate(([f0, n, fps]) => {
      const K = window.__bake, o = [], M = obj => { obj.updateMatrixWorld(true); o.push(...obj.matrixWorld.elements); };
      for (let f = f0; f < f0 + n; f++) {
        const t = f / fps;
        K.pose(t);
        let shot = 0; while (shot + 1 < K.SHOTS.length && t >= K.SHOTS[shot + 1].t) shot++;
        K.camera.updateMatrixWorld(true);
        o.push(...K.camera.matrixWorld.elements, K.camera.fov, shot, K.SHOTS[shot].eoir ? 1 : 0);
        o.push(...K.B.m.elements, K.B.v, K.B.bowV);
        const G = K.BOATG, P = K.LAUNCH.port, S = K.LAUNCH.starboard;
        o.push(G.nav.rotation.y, G.gim.rotation.y, G.gimT.rotation.z, P.train.rotation.y, P.elev.rotation.z, S.train.rotation.y, S.elev.rotation.z);
        o.push(K.drone.visible ? 1 : 0); M(K.drone); o.push(K.drone.children[K.drone.children.length - 1].rotation.x);
        o.push(K.missile.visible ? 1 : 0); M(K.missile);
        for (const d of K.DEBRIS) { o.push(d.mesh.visible ? 1 : 0); M(d.mesh); }
        for (const s of K.SHIPS) M(s.obj);
        for (const v of K.waterU.uTrail.value) o.push(v.x, v.y, v.z, v.w);
        o.push(t);
      }
      return o;
    }, [f0, n, FPS]);
    if (chunk.length !== n * scene.frameFloats) throw new Error(`frame layout mismatch at ${f0}: ${chunk.length / n} floats a frame, expected ${scene.frameFloats}`);
    frames.set(chunk, f0 * scene.frameFloats);
    if (f0 % 480 === 0) console.log(`bake ${f0}/${scene.frames}`);
  }
  writeFileSync(join(out, 'frames.bin'), Buffer.from(frames.buffer));
  console.log(`${out}: ${scene.frames} frames`);
} finally {
  await browser.close();
  await server.close();
}
