// Fetches the CC0 assets the Blender X-12 film uses from Poly Haven (polyhaven.com, public domain) into video/out/x12-work/assets/.
//   node video/x12/assets.js        files already on disk are kept
// The sky is a real photographed HDRI (sun and clouds, ground removed); the textures dress the procedural fjord.
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, 'video/out/x12-work/assets');
mkdirSync(dir, { recursive: true });

const HDRI = { id: 'table_mountain_1_puresky', res: '8k' };
const TEXTURES = [
  { id: 'aerial_rocks_04', res: '4k', maps: ['Diffuse', 'nor_gl', 'Rough'] },     // 80 m tile: mountain faces from afar
  { id: 'rock_face_03', res: '4k', maps: ['Diffuse', 'nor_gl', 'Rough'] },        // 2.7 m tile: rock close to the camera
  { id: 'snow_field_aerial', res: '4k', maps: ['Diffuse', 'nor_gl', 'Rough'] },   // 80 m tile: snowfields with rock through
  { id: 'aerial_grass_rock', res: '4k', maps: ['Diffuse', 'nor_gl', 'Rough'] },   // 15 m tile: heath and scrub low down
];

const UA = { 'User-Agent': 'x12-film-asset-fetch' };
async function files(id) { const r = await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA }); if (!r.ok) throw new Error(`${id}: ${r.status}`); return r.json(); }
async function get(url, file) {
  if (existsSync(file)) return;
  const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`${url}: ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file + '.part'));
  const { renameSync } = await import('node:fs'); renameSync(file + '.part', file);
  console.log(`  ${file}`);
}

const h = await files(HDRI.id);
await get(h.hdri[HDRI.res].hdr.url, join(dir, `${HDRI.id}_${HDRI.res}.hdr`));
for (const t of TEXTURES) {
  const f = await files(t.id);
  for (const m of t.maps) {
    const e = f[m][t.res], fmt = e.jpg ? 'jpg' : 'png';
    await get(e[fmt].url, join(dir, `${t.id}_${m.toLowerCase()}_${t.res}.${fmt}`));
  }
}
console.log(`assets in ${dir}`);
