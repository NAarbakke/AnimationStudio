// Bakes the Razorbill drop film (site/src/drone/main.js) for Blender: the choreography stays in the film, Blender only renders it.
//   node video/skyfall/field/bake.js [--force]   -> video/out/skyfall-work/blender/{scene.json, plants.bin, frames.bin, skin.png}
// The film is posed frame by frame without drawing (window.__bake.pose) and read back in three.js's frame (Y up);
// blender/razorbill/skyfall_field.py turns that into Blender's (Z up). Per frame, in this order (float32, FRAME_FLOATS long):
//   camera matrixWorld (16), vertical fov in degrees, near
//   world matrix of every moving mesh in scene.json "meshes" (16 each): the drone's parts, the rotor discs, the rod's parts
//   rotor disc angles (4)
//   per larva: visible (1), then (RINGS+1)*(SIDES+1) vertex positions (3 each)
//   clods: 18 world matrices (16 each)
//   dust: 140 x (x, y, z, diameter, alpha)
//   world time, drone position (3), rotor wash, kick age, impact age, reveal
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { FIELD } from '../phases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const out = join(root, 'video/out/skyfall-work/blender');
const FPS = 30;
mkdirSync(out, { recursive: true });
// the bake only changes with the film: skip it when it was made from this page (--force redoes it after editing main.js)
const done = ['scene.json', 'plants.bin', 'frames.bin', 'skin.png'].every(f => existsSync(join(out, f)))
  && existsSync(join(out, 'page.txt')) && readFileSync(join(out, 'page.txt'), 'utf8') === FIELD.page;
if (done && !process.argv.includes('--force')) { console.log(`bake up to date (${out}); --force to redo it`); process.exit(0); }

const server = await (await createServer({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn' })).listen();
const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.error(`[page] ${e.message}`));
  await page.goto(new URL(FIELD.page, server.resolvedUrls.local[0]).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bake && window.__film, null, { timeout: 60_000 });
  await page.evaluate(() => window.__film.ready);

  // ---- once: what stands still, and the layout of a frame
  const scene = await page.evaluate(() => {
    const B = window.__bake, arr = a => Array.from(a, x => Math.round(x * 1e5) / 1e5);
    B.pose(0);
    const meshes = [];
    for (const group of [B.D.root, B.arrow]) group.traverse(o => { if (o.isMesh) meshes.push(o.name); });
    // the instanced plants and trees: position on the ground, heading, scale, tint; the reveal set fades in the strike shot
    const plants = [];
    B.scene.traverse(o => {
      if (!o.isInstancedMesh || !/^(crop|tree)_/.test(o.name)) return;
      const m = new o.matrixWorld.constructor(), p = o.position.clone(), q = o.quaternion.clone(), s = o.scale.clone();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); m.decompose(p, q, s);
        const c = o.instanceColor ? [o.instanceColor.getX(i), o.instanceColor.getY(i), o.instanceColor.getZ(i)] : [1, 1, 1];
        plants.push([o.name, o.material.transparent ? 1 : 0, p.x, p.z, 2 * Math.atan2(q.y, q.w), s.x, s.y, ...c]);
      }
    });
    const L = B.LARVAE[0].mesh.geometry;
    const lump = B.clods.geometry.attributes.position;
    return {
      meshes, plants,
      larva: { count: B.LARVAE.length, uv: arr(L.attributes.uv.array), index: Array.from(L.index.array), rings: B.RINGS, sides: B.SIDES },
      clod: { position: arr(lump.array), count: B.clods.count },
      dust: { count: B.dust.geometry.attributes.seed.count },
      sun: B.SUN.toArray(), fog: B.FOG.toArray(), fogDensity: B.scene.fog.density,
      impact: B.IMPACT.toArray(), reveal: B.REVEAL, row: B.ROW, plantsArea: B.PLANTS, field: B.FIELD,
      duration: B.DUR, skin: B.skin.image.toDataURL('image/png'),
      plot: { signal: arr(B.SIGNAL), t: B.T_PLOT, box: B.PLOT },
    };
  });
  const plants = scene.plants; delete scene.plants;
  // plants.bin: per plant 9 float32 (variant, fades, x, z, heading, scale, height scale, r, g, b) after a variant name table in scene.json
  const variants = [...new Set(plants.map(p => p[0]))].sort();
  const pb = new Float32Array(plants.length * 10);
  plants.forEach((p, i) => pb.set([variants.indexOf(p[0]), ...p.slice(1)], i * 10));
  writeFileSync(join(out, 'plants.bin'), Buffer.from(pb.buffer));
  scene.variants = variants; scene.plantCount = plants.length;
  writeFileSync(join(out, 'skin.png'), Buffer.from(scene.skin.split(',')[1], 'base64')); delete scene.skin;
  const verts = (scene.larva.rings + 1) * (scene.larva.sides + 1);
  scene.frameFloats = 18 + scene.meshes.length * 16 + 4 + scene.larva.count * (1 + verts * 3) + scene.clod.count * 16 + scene.dust.count * 5 + 8;
  scene.fps = FPS; scene.frames = Math.round(scene.duration * FPS);
  writeFileSync(join(out, 'scene.json'), JSON.stringify(scene));
  console.log(`scene: ${scene.meshes.length} moving meshes, ${plants.length} plants in ${variants.length} variants, ${scene.frameFloats} floats a frame`);

  // ---- every frame
  const frames = new Float32Array(scene.frames * scene.frameFloats);
  const CHUNK = 30;
  for (let f0 = 0; f0 < scene.frames; f0 += CHUNK) {
    const chunk = await page.evaluate(([f0, n, fps, names]) => {
      const B = window.__bake, out = [];
      const byName = {}; for (const g of [B.D.root, B.arrow]) g.traverse(o => { if (o.isMesh) byName[o.name] = o; });
      const seeds = B.dust.geometry.attributes.seed.array;
      for (let f = f0; f < f0 + n; f++) {
        B.pose(f / fps);
        B.scene.updateMatrixWorld(true);
        const c = B.camera;
        out.push(...c.matrixWorld.elements, c.fov, c.near);
        for (const name of names) out.push(...byName[name].matrixWorld.elements);
        for (let i = 0; i < 4; i++) out.push(byName[`disc_${i}`].material.uniforms.uAng.value);
        for (const l of B.LARVAE) { out.push(l.mesh.visible ? 1 : 0); const p = l.mesh.geometry.attributes.position.array; for (let i = 0; i < p.length; i++) out.push(p[i]); }
        const im = B.clods.instanceMatrix.array; for (let i = 0; i < im.length; i++) out.push(im[i]);
        // the dust puff, as its shader places it (main.js): world-space size, so no camera in it
        const age = B.dustU.uAge.value, o = B.dustU.uOrigin.value, a = Math.max(age, 0), k = 2.6, travel = (1 - Math.exp(-k * a)) / k;
        const sm = (e0, e1, x) => { const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };
        for (let i = 0; i < seeds.length; i += 4) {
          const [sx, sy, sz, sw] = [seeds[i], seeds[i + 1], seeds[i + 2], seeds[i + 3]];
          const az = sx * 6.2832, sp = 0.12 + (0.6 - 0.12) * sy, up = 0.4 + (1.4 - 0.4) * sz;
          const y = Math.max(o.y + up * sp * travel * 0.9 - 0.05 * a * a + 0.01, 0.005);
          const alpha = (age < 0 ? 0 : 1) * sm(0, 0.04, a) * (1 - sm(0.4, 2.2 + sw, a));
          out.push(o.x + Math.cos(az) * sp * travel, y, o.z + Math.sin(az) * sp * travel, (0.05 + 0.2 * a * (0.6 + sw)) * (0.6 + sy), alpha * 0.09);
        }
        out.push(B.shared.uTime.value, ...B.droneU.value.toArray(), B.washU.value, B.kickU.value, B.impactU.value.z, B.revealU.value);
      }
      return out;
    }, [f0, Math.min(CHUNK, scene.frames - f0), FPS, scene.meshes]);
    if (chunk.length !== Math.min(CHUNK, scene.frames - f0) * scene.frameFloats) throw new Error(`frame layout mismatch at ${f0}`);
    frames.set(chunk, f0 * scene.frameFloats);
    if (f0 % 300 === 0) console.log(`bake ${f0}/${scene.frames}`);
  }
  writeFileSync(join(out, 'frames.bin'), Buffer.from(frames.buffer));
  writeFileSync(join(out, 'page.txt'), FIELD.page);
  console.log(`${out}: ${scene.frames} frames`);
} finally {
  await browser.close();
  await server.close();
}
