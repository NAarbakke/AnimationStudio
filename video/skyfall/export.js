// Operation SKYFALL programme film: title, phase 1 (design) and phase 2 (assembly) from the Anatomy plate, phase 3 (field
// tests) from the Razorbill drop film, an end card, and the programme timeline over all of it.
//   npm run video:skyfall                 -> video/out/operation-skyfall-programme.mp4 (77.4 s, 1080p, 30 fps)
//   node video/skyfall/export.js --reuse  keep the pieces already in video/out/skyfall-work/, redo only what is missing
//   node video/skyfall/export.js --three  phase 3 from the three.js film even when the Blender one (field-blender.mp4) exists
// Running order and words: phases.mjs. The field film is rendered once (the slow part, three.js) and kept; --field redoes it.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';
import { chromium } from 'playwright';
import { renderVideo } from '../render.js';
import { PHASES, END, FIELD, BLEND, LENGTH } from './phases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const work = join(root, 'video/out/skyfall-work');
const out = join(root, 'video/out/operation-skyfall-programme.mp4');
const ffmpeg = process.env.FFMPEG_PATH || ffmpegStatic;
const FPS = 30;
const STRIP = { y: 860, h: 220 };
const reuse = process.argv.includes('--reuse');
mkdirSync(work, { recursive: true });

const fresh = file => !(reuse && existsSync(file));
function run(args) {
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status})`);
}

// 1. the plate: everything before the field film, and the end card, from one page on one clock
if (spawnSync(process.execPath, [join(here, 'build.mjs')], { stdio: 'inherit' }).status !== 0) throw new Error('plate build failed');
const plateRoot = join(root, 'video/out/skyfall-plate');
const head = join(work, 'plate.mp4'), tail = join(work, 'end.mp4');
const P3 = PHASES[2];
// the plate runs half a dissolve past the phase boundary, the field film starts half a dissolve before it
if (fresh(head)) await renderVideo({ page: 'index.html', siteRoot: plateRoot, out: head, duration: P3.from + BLEND / 2, fps: FPS });
if (fresh(tail)) await renderVideo({ page: 'index.html', siteRoot: plateRoot, out: tail, start: END.from, duration: END.to - END.from, fps: FPS });

// 2. the field tests: the drop film without its own title card. The Blender render of it (npm run video:skyfall:field,
// hours) when there is one, unless --three; otherwise the three.js film itself, kept between runs (11 min to render) and
// re-rendered with --field, or when FIELD.page changes
const blenderField = join(work, 'field-blender.mp4');
let field = blenderField;
if (process.argv.includes('--three') || !existsSync(blenderField)) {
  field = join(work, 'field.mp4');
  const fieldKey = join(work, 'field.txt');
  const fieldStale = !existsSync(field) || !existsSync(fieldKey) || readFileSync(fieldKey, 'utf8') !== FIELD.page;
  if (process.argv.includes('--field') || fieldStale) {
    await renderVideo({ page: FIELD.page, out: field, duration: FIELD.length, fps: FPS });
    writeFileSync(fieldKey, FIELD.page);
  }
}
console.log(`field tests from ${field === blenderField ? 'the Blender render' : 'the three.js film'}`);
if (Math.abs(P3.from - BLEND / 2 + FIELD.length - END.from) > 1e-6) throw new Error('the end card must start when the field film ends (phases.mjs)');

// 3. the timeline strip, captured with alpha
const strip = join(work, 'timeline.mov');
if (fresh(strip)) {
  for (const f of ['ibm-plex-mono-400-latin.woff2', 'ibm-plex-mono-500-latin.woff2', 'saira-condensed-600-latin.woff2']) copyFileSync(join(root, 'site/src/shared/fonts', f), join(work, f));
  const page = join(work, 'timeline.html');
  writeFileSync(page, readFileSync(join(here, 'timeline.html'), 'utf8').replace('<script>', `<script>window.SKYFALL = ${JSON.stringify({ PHASES, END })};</script>\n<script>`));
  const browser = await chromium.launch({ channel: 'chrome' });
  const enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', '-c:v', 'png', '-pix_fmt', 'rgba', strip], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = once(enc, 'close');
  try {
    const tab = await browser.newPage({ viewport: { width: 1920, height: STRIP.h } });
    await tab.goto(pathToFileURL(page).href);
    await tab.evaluate(() => window.__film.ready);
    const cdp = await tab.context().newCDPSession(tab);
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const frames = Math.round(LENGTH * FPS);
    for (let i = 0; i < frames; i++) {
      await tab.evaluate(t => window.__film.seek(t), i / FPS);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
      if (!enc.stdin.write(Buffer.from(data, 'base64'))) await once(enc.stdin, 'drain');
      if (i % 300 === 0) console.log(`timeline ${i}/${frames}`);
    }
  } finally {
    enc.stdin.end();
    await browser.close();
  }
  const [code] = await done;
  if (code !== 0) throw new Error(`timeline encode failed (${code})`);
}

// 4. cut and lay the strip over: plate, dissolve into the field film, end card; timeline on top
run(['-i', head, '-i', field, '-i', tail, '-i', strip, '-filter_complex',
  `[0:v]fps=${FPS},setsar=1[a];[1:v]fps=${FPS},setsar=1[b];[2:v]fps=${FPS},setsar=1[c];` +
  `[a][b]xfade=transition=fade:duration=${BLEND}:offset=${P3.from - BLEND / 2}[ab];[ab][c]concat=n=2:v=1:a=0[cut];` +
  `[cut][3:v]overlay=0:${STRIP.y}:format=auto,format=yuv420p[v]`,
  '-map', '[v]', '-t', String(LENGTH), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
console.log(out);
