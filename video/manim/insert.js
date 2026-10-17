// Makes the ManimGX films, rendered once at 4K: site/public/videos/{srm,engine}-math.mp4 at 3840x2160 for the maths page
// (sharp full screen on any monitor), and video/clips/{srm,engine}-math.mp4 scaled to 1080p for the showcase edit
// (both git-ignored).
//   npm run insert              export the labs' physics, render both scenes, write the clips
//   npm run insert -- inspect   storyboards + layout checks only (video/manim/*.storyboard.png), no video
//   npm run insert -- engine    one scene only (srm or engine), with or without inspect
// ManimGX encodes a still picture as one long frame (a closing wait is a single frame lasting the whole wait).
// HyperFrames counts frames and rejects that, so the last frame is repeated out to the file's real duration.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const here = dirname(fileURLToPath(import.meta.url));
const manimgx = resolve(here, '.venv', process.platform === 'win32' ? 'Scripts/manimgx.exe' : 'bin/manimgx');
const env = { ...process.env, PYTHONIOENCODING: 'utf-8' }; // the scenes' captions use Δ, ε…; the Windows console would choke
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', env });
const args = process.argv.slice(2);
const scenes = ['srm', 'engine'].filter(s => !args.some(a => a === 'srm' || a === 'engine') || args.includes(s));

run(process.execPath, [resolve(here, 'export.js')]);
for (const name of scenes) {
  const scene = resolve(here, `${name}.py`);
  if (args.includes('inspect')) { run(manimgx, ['inspect', scene]); continue; }
  const vfr = resolve(here, `out/${name}-vfr.mp4`), out = resolve(here, `../clips/${name}-math.mp4`);
  const site = resolve(here, `../../site/public/videos/${name}-math.mp4`);
  for (const f of [vfr, out, site]) mkdirSync(dirname(f), { recursive: true });
  run(manimgx, ['render', scene, '-o', vfr, '-r', '3840x2160', '--fps', '30', '--crf', '12']);
  const duration = execFileSync(process.env.FFPROBE_PATH || ffprobeStatic.path, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', vfr,
  ]).toString().trim();
  const cfr = 'fps=30,tpad=stop_mode=clone:stop=-1';
  run(process.env.FFMPEG_PATH || ffmpegStatic, [
    // -t is per output: without it on both, the clone-padding repeats the last frame for ever
    '-y', '-loglevel', 'error', '-i', vfr,
    '-t', duration, '-vf', cfr, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', site,
    '-t', duration, '-vf', `${cfr},scale=1920:1080:flags=lanczos`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ]);
  rmSync(vfr);
  console.log(`${out} (+ ${site}): ${Number(duration).toFixed(2)} s, constant 30 fps`);
}
