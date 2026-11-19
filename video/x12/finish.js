// Finishes the Blender X-12 film: the film's HTML layer (cards, radar, stepper, titles, fades) laid over the Cycles frames,
// the EO/IR shot turned thermal, a light lens finish, then a master and a copy under 100 MB.
//   node video/x12/finish.js            -> video/out/x12-autonomous.mp4 (two-pass, ≤ 100 MB) and x12-autonomous-master.mp4
//   node video/x12/finish.js --reuse    keep overlay frames already captured
//   node video/x12/finish.js --overlay-only   just capture the overlay frames
// Frames come from blender/x12/x12_film.py (video/out/x12-work/frames/NNNN.png, 24 fps); the overlay is captured here from
// x12.html?film&overlay on a transparent page, frame for frame, so its leader lines meet the parts Blender drew.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const work = join(root, 'video/out/x12-work');
const frames = join(work, 'frames'), overlay = join(work, 'overlay');
const scene = JSON.parse(readFileSync(join(work, 'bake/scene.json'), 'utf8'));
const { fps: FPS, frames: NF, duration: DUR } = scene;
const EO = [scene.shots.find(s => s.eoir).t, scene.shots[scene.shots.findIndex(s => s.eoir) + 1].t];
const out = join(root, 'video/out/x12-autonomous.mp4'), master = join(root, 'video/out/x12-autonomous-master.mp4');
const ffmpeg = process.env.FFMPEG_PATH || ffmpegStatic;
const LIMIT = 100e6;
mkdirSync(overlay, { recursive: true });

// ---- 1. the HTML layer, transparent, one PNG per frame
const reuse = process.argv.includes('--reuse');
const haveOverlay = f => existsSync(join(overlay, `${String(f).padStart(4, '0')}.png`));
if (!reuse || ![...Array(NF).keys()].every(haveOverlay)) {
  const server = await (await createServer({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn', server: { hmr: false, watch: null } })).listen();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', e => console.error(`[page] ${e.message}`));
    await page.goto(new URL('x12.html?film&overlay', server.resolvedUrls.local[0]).href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__film, null, { timeout: 120_000 });
    await page.evaluate(() => Promise.all([window.__film.ready, document.fonts.ready]));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    for (let f = 0; f < NF; f++) {
      if (reuse && haveOverlay(f)) continue;
      await page.evaluate(t => window.__film.seek(t), f / FPS);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(overlay, `${String(f).padStart(4, '0')}.png`), Buffer.from(data, 'base64'));
      if (f % 240 === 0) console.log(`overlay ${f}/${NF}`);
    }
  } finally { await browser.close(); await server.close(); }
}

// ---- 2. composite and finish (needs every Blender frame)
if (process.argv.includes('--overlay-only')) process.exit(0);
const missing = [];
for (let f = 0; f < NF; f++) if (!existsSync(join(frames, `${String(f).padStart(4, '0')}.png`))) missing.push(f);
if (missing.length) { console.error(`${missing.length} of ${NF} Blender frames missing (first: ${missing.slice(0, 8).join(', ')})`); process.exit(1); }
const eo = `between(t,${EO[0].toFixed(3)},${(EO[1] - 0.001).toFixed(3)})`;
// the EO/IR view as the film had it (CSS grayscale, invert, brightness .62, contrast 2.1): hot drone white on a cold sky
const thermal = `hue=s=0:enable='${eo}',lutrgb=r='clip(((255-val)*0.62-127.5)*2.1+127.5,0,255)':g='clip(((255-val)*0.62-127.5)*2.1+127.5,0,255)':b='clip(((255-val)*0.62-127.5)*2.1+127.5,0,255)':enable='${eo}'`;
const graph = [
  `[0:v]format=rgb24,${thermal},split[base][hi]`,
  // a soft bloom from the brightest parts only: sun glints, the flash, the fireball
  `[hi]lutrgb=r='max(val-205,0)*5':g='max(val-205,0)*5':b='max(val-205,0)*5',gblur=sigma=26[glow]`,
  `[base][glow]blend=all_mode=screen:all_opacity=0.32,vignette=angle=PI/5.5,noise=alls=3:allf=t+u[img]`,
  `[img][1:v]overlay=format=auto,format=yuv420p[v]`,
].join(';');
const inputs = ['-framerate', String(FPS), '-i', join(frames, '%04d.png'), '-framerate', String(FPS), '-i', join(overlay, '%04d.png')];
function run(args) { const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit', cwd: work }); if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status})`); }

run([...inputs, '-filter_complex', graph, '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-movflags', '+faststart', master]);
console.log(`${master}: ${(statSync(master).size / 1e6).toFixed(1)} MB`);
// the copy to send: two-pass at the bitrate that lands just under the limit
const kbps = Math.floor(LIMIT * 0.97 * 8 / DUR / 1000);
const enc = ['-i', master, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.6)}k`, '-bufsize', `${kbps * 3}k`, '-pix_fmt', 'yuv420p'];
run([...enc, '-pass', '1', '-passlogfile', 'x264pass', '-an', '-f', 'mp4', process.platform === 'win32' ? 'NUL' : '/dev/null']);
run([...enc, '-pass', '2', '-passlogfile', 'x264pass', '-movflags', '+faststart', out]);
console.log(`${out}: ${(statSync(out).size / 1e6).toFixed(1)} MB at ${kbps} kb/s`);
