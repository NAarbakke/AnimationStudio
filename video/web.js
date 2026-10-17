// Makes streaming copies of finished videos: smaller H.264 at the same size and frame rate, metadata and chapters
// kept, moov atom up front so playback starts before the download finishes. The masters in video/out/ are untouched.
//   npm run video:web                          every .mp4 directly in video/out/ → video/out/web/
//   npm run video:web -- showcase.mp4 --crf 24  just these, at another quality (lower = bigger and sharper)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { crf: { type: 'string', default: '26' }, out: { type: 'string', short: 'o' } } });
const src = resolve(root, 'video/out');
const out = resolve(root, v.out ?? 'video/out/web');
const files = positionals.length ? positionals.map(f => resolve(src, f)) : readdirSync(src).filter(f => f.endsWith('.mp4')).map(f => resolve(src, f));
mkdirSync(out, { recursive: true });

const mb = f => (statSync(f).size / 1e6).toFixed(1) + ' MB';
for (const file of files) {
  const target = resolve(out, basename(file));
  console.log(`${basename(file)} (${mb(file)}) …`);
  const { status } = spawnSync(process.env.FFMPEG_PATH || ffmpegStatic, [
    '-y', '-v', 'error', '-stats', '-i', file, '-map', '0:v', '-map', '0:a?', '-map_metadata', '0', '-map_chapters', '0',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', v.crf, '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', target,
  ], { stdio: 'inherit' });
  if (status !== 0) throw new Error(`ffmpeg failed on ${file}`);
  console.log(`  → ${target} (${mb(target)})`);
}
