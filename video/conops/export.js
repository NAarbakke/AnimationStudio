// Full delivery: deterministic 180-second picture, a quiet synthesized ambient bed,
// chapter markers and a probed H.264/AAC MP4. Re-run with npm run video:conops
// (--resume reuses the newest saved 30 s sections, --mux-only redoes just the audio and chapters).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, unlinkSync, cpSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { renderVideo } from '../render.js';

const out = resolve('video/out/burevestnik-conops.mp4');
const picture = resolve('video/out/burevestnik-conops-picture.mp4');
const metadata = resolve('video/out/conops-chapters.ffmeta');
mkdirSync(resolve('video/out'), { recursive: true });
const chapters = [[0, 'A notional concept of operations'], [16, 'Canister launch'], [37, 'Separation and boost'], [86, 'Booster separation'], [104, 'Engine changeover'], [135, 'Nuclear cruise'], [170, 'Sources and limitations']];
writeFileSync(metadata, ';FFMETADATA1\ntitle=Burevestnik - A Notional Concept of Operations\ncomment=Illustrative reconstruction after Hecla and Kemp, Figure 4. Booster use remains uncertain. Synthesized ambient soundtrack.\n' + chapters.map(([t, title], i) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${t * 1000}\nEND=${(chapters[i + 1]?.[0] ?? 180) * 1000}\ntitle=${title}\n`).join(''));

function run(exe, args, capture = false) {
  return new Promise((resolveRun, reject) => {
    const p = spawn(exe, args, { windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'inherit'] : ['ignore', 'inherit', 'inherit'] });
    let data = '';
    if (capture) p.stdout.on('data', chunk => { data += chunk; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolveRun(data) : reject(new Error(`Media tool exited ${code}`)));
  });
}

function requireSavedParts() {
  const base = resolve('video/out');
  const dirs = readdirSync(base).filter(n => n.startsWith('conops-parts-')).map(n => resolve(base, n));
  dirs.sort((a,b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!dirs.length) throw new Error('No saved render found');
  return dirs[0];
}

if (!process.argv.includes('--mux-only')) {
  const siteRoot = resolve('video/conops-site');
  const resume = process.argv.includes('--resume');
  if (!resume) cpSync(resolve('dist'), siteRoot, { recursive: true });
  const hash = createHash('sha256');
  for (const f of ['site/conops.html', 'site/src/conops/main.js', 'site/src/conops/arctic.js', 'site/src/shared/stage.ts', 'video/render.js']) hash.update(readFileSync(f));
  const freshParts = resolve('video/out/conops-parts-' + hash.digest('hex').slice(0, 10));
  const saved = resume ? requireSavedParts() : null;
  const parts = saved ?? freshParts;
  mkdirSync(parts, { recursive: true });
  const files = [];
  for (let start = 0; start < 180; start += 30) {
    const file = resolve(parts, 'part-' + start + '.mp4');
    let valid = false;
    if (existsSync(file)) {
      try {
        const info = JSON.parse(await run(ffprobe.path, ['-v','error','-show_streams','-of','json',file], true));
        const stream = info.streams.find(s => s.codec_type === 'video');
        valid = stream?.nb_frames === '900' && stream?.width === 1920 && stream?.height === 1080;
      } catch {}
    }
    console.log((valid ? 'Reusing' : 'Rendering') + ' section ' + start + '-' + (start + 30) + ' seconds');
    if (!valid) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { await renderVideo({ page: 'conops.html?film', siteRoot, out: file, start, duration: 30, fps: 30, width: 1920, height: 1080, captureFormat: 'jpeg' }); break; }
        catch (error) { if (attempt === 3) throw error; console.log('Retrying section after browser error: '+error.message); }
      }
    }
    files.push(file);
  }
  const list = resolve(parts, 'concat.txt');
  writeFileSync(list, files.map(file => "file '" + file.replaceAll('\\', '/') + "'").join('\n'));
  await run(ffmpeg, ['-y','-v','error','-f','concat','-safe','0','-i',list,'-c','copy',picture]);
}
// Soft sustained chords, with a breath between changes; no simulated weapon sounds.
const root = '(110*lt(t,45)+87.307*gte(t,45)*lt(t,90)+97.999*gte(t,90)*lt(t,135)+82.407*gte(t,135))';
const bed = `0.025*pow(sin(PI*mod(t,45)/45),0.3)*(sin(2*PI*${root}*t)+0.5*sin(2*PI*${root}*1.5*t)+0.25*sin(2*PI*${root}*2*t))`;
await run(ffmpeg, ['-y', '-v', 'error', '-i', picture, '-f', 'lavfi', '-i', `aevalsrc=${bed.replaceAll(',', '\\,')}:s=48000:d=180`, '-f', 'ffmetadata', '-i', metadata, '-map', '0:v:0', '-map', '1:a:0', '-map_metadata', '2', '-map_chapters', '2', '-c:v', 'copy', '-af', 'afade=t=in:d=3,afade=t=out:st=175:d=5,pan=stereo|c0=c0|c1=c0', '-c:a', 'aac', '-b:a', '160k', '-t', '180', '-movflags', '+faststart', out]);
const info = JSON.parse(await run(ffprobe.path, ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', out], true));
const video = info.streams.find(s => s.codec_type === 'video');
const audio = info.streams.find(s => s.codec_type === 'audio');
if (Math.abs(Number(info.format.duration) - 180) > .05 || video?.width !== 1920 || video?.height !== 1080 || video?.nb_frames !== '5400' || !audio) throw new Error('Final media validation failed');
writeFileSync(resolve('video/out/burevestnik-conops.validation.json'), JSON.stringify(info, null, 2));
unlinkSync(picture);
console.log(`Finished: ${out} (180 seconds, 1920x1080, 30 fps, H.264 + AAC)`);
