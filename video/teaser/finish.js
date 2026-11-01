// Finishes either Razorbill teaser: the same titles, soundtrack and grade over the film.
//   node video/teaser/finish.js shoot    Blender frames (blender/razorbill_teaser.py) -> video/out/razorbill-teaser-shoot.mp4
//   node video/teaser/finish.js figure   the Anatomy illustration (video/teaser/figure/) -> video/out/razorbill-teaser-figure.mp4
// Add --reuse to keep the last base render and redo only the grade, titles and audio.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';
import { chromium } from 'playwright';
import { renderVideo } from '../render.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const work = join(root, 'video/out/teaser-work');
const ffmpeg = process.env.FFMPEG_PATH || ffmpegStatic;
const mode = process.argv[2];
if (!['shoot', 'figure'].includes(mode)) { console.error('usage: node video/teaser/finish.js shoot|figure'); process.exit(1); }
mkdirSync(work, { recursive: true });

// The whole script of the teaser. No date and no claims: change the words here.
const TITLES = [
  { from: 4.7, to: 7.2, html: '<p class="line">The field keeps secrets.</p>' },
  { from: 9.0, to: 11.2, html: '<p class="line">Soon, it won’t.</p>' },
  { from: 17.15, to: 20.6, html: '<h1>RAZORBILL</h1><i></i><p class="sub">Coming soon</p>' },
];
const LENGTH = 21;

function run(args) {
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status})`);
}

async function titles() {
  const fonts = pathToFileURL(join(root, 'site/src/shared/fonts')).href;
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [i, title] of TITLES.entries()) {
    await page.goto(pathToFileURL(join(here, 'title.html')).href);
    await page.evaluate(([html, f]) => {
      const style = document.createElement('style');
      style.textContent = `@font-face{font-family:Saira;font-weight:400;src:url(${f}/saira-condensed-400-latin.woff2)}@font-face{font-family:Plex;src:url(${f}/ibm-plex-mono-400-latin.woff2)}`;
      document.head.append(style);
      document.body.innerHTML = html;
      return document.fonts.ready;
    }, [title.html, fonts]);
    await page.evaluate(() => Promise.all([document.fonts.load('400 40px Saira'), document.fonts.load('400 20px Plex')]));
    await page.screenshot({ path: join(work, `title${i}.png`), omitBackground: true });
  }
  await browser.close();
}

// Blender frames come at every second frame; each shot is interpolated on its own so nothing smears across a cut.
function shootBase() {
  const frames = join(root, 'video/out/teaser-frames');
  const SHOTS = [[0, 90], [90, 180], [180, 276], [276, 396]];
  const parts = SHOTS.map(([a, b], i) => {
    const out = join(work, `shot${i}.mkv`);
    // the numbered-image input stops at the first gap, so the frames are listed
    const list = [];
    for (let f = a; f < b; f += 2) list.push(`file '${join(frames, String(f).padStart(4, '0') + '.png').replaceAll('\\', '/')}'`, 'duration 0.0833333');
    list.push(list.at(-2));
    const listFile = join(work, `shot${i}.txt`);
    writeFileSync(listFile, ['ffconcat version 1.0', ...list, ''].join('\n'));
    run(['-f', 'concat', '-safe', '0', '-i', listFile, '-fps_mode', 'passthrough',
      '-vf', 'fps=12,format=yuv444p,minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none,tpad=stop_mode=clone:stop_duration=0.5,scale=1920:1080:flags=lanczos',
      '-frames:v', String(b - a), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv444p', out]);
    return out;
  });
  const out = join(work, 'shoot-base.mkv');
  const inputs = parts.flatMap(p => ['-i', p]);
  const chain = parts.map((_, i) => `[${i}:v]`).join('');
  run([...inputs, '-filter_complex', `${chain}concat=n=${parts.length}:v=1:a=0,fps=24,tpad=stop_mode=add:stop_duration=${LENGTH - 16.5}:color=black[v]`, '-map', '[v]', '-t', String(LENGTH), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv444p', out]);
  return out;
}

async function figureBase() {
  spawnSync(process.execPath, [join(here, 'figure/build.mjs')], { stdio: 'inherit' });
  const out = join(work, 'figure-base.mp4');
  await renderVideo({ page: 'index.html', siteRoot: join(root, 'video/out/teaser-figure'), out, duration: LENGTH, fps: 24 });
  return out;
}

const python = process.env.PYTHON || 'python';
const wav = join(work, 'audio.wav');
if (spawnSync(python, [join(here, 'audio.py'), wav], { stdio: 'inherit' }).status !== 0) throw new Error('audio failed');
await titles();
const reuse = join(work, mode === 'shoot' ? 'shoot-base.mkv' : 'figure-base.mp4');
const base = process.argv.includes('--reuse') && existsSync(reuse) ? reuse : mode === 'shoot' ? shootBase() : await figureBase();

// grade: bloom off the highlights, a vignette, a little lift-free contrast and film grain; then the titles with slow fades
const bloom = mode === 'shoot' ? '0.34' : '0.55';
const grain = mode === 'shoot' ? 3 : 2;
const filters = [`[0:v]format=gbrp,split[a][b];[b]curves=all='0/0 0.55/0 1/1',gblur=sigma=26[g];[a][g]blend=all_mode=screen:all_opacity=${bloom},vignette=PI/4.6,format=yuv420p[graded]`];
let last = 'graded';
TITLES.forEach((title, i) => {
  const input = i + 2, fade = 0.9;
  filters.push(`[${input}:v]format=rgba,fade=t=in:st=${title.from}:d=${fade}:alpha=1,fade=t=out:st=${title.to - fade}:d=${fade}:alpha=1[t${i}]`);
  filters.push(`[${last}][t${i}]overlay=0:0:enable='between(t,${title.from},${title.to})'[v${i}]`);
  last = `v${i}`;
});
filters.push(`[${last}]noise=alls=${grain}:allf=t,format=yuv420p[out]`);
const titleInputs = TITLES.flatMap((_, i) => ['-loop', '1', '-framerate', '24', '-t', String(LENGTH), '-i', join(work, `title${i}.png`)]);
const out = join(root, `video/out/razorbill-teaser-${mode}.mp4`);
run(['-i', base, '-i', wav, ...titleInputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-map', '1:a', '-t', String(LENGTH),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out]);
console.log(out);
if (existsSync(out) && process.argv.includes('--clean')) rmSync(work, { recursive: true, force: true });
