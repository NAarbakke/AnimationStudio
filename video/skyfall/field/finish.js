// Finishes the Blender field film for the programme: the rendered frames, the ManimGX signal plot over them, the fade out.
//   node video/skyfall/field/finish.js     -> video/out/skyfall-work/field-blender.mp4 (39 s, 1080p, 30 fps)
// Before it: node video/skyfall/field/bake.js, then npm run blender -- razorbill/skyfall_field.py (hours; resumes where it stopped).
// ManimGX only writes opaque video, so the plot is rendered on black and on white: where the two differ is how see-through
// it is (white - black = 1 - alpha), and on black it is already its colour times alpha. Over the film: film x (1 - alpha) + black.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const work = join(root, 'video/out/skyfall-work');
const bake = join(work, 'blender');
const frames = join(bake, 'frames');
const out = join(work, 'field-blender.mp4');
const ffmpeg = process.env.FFMPEG_PATH || ffmpegStatic;
const manim = join(root, 'video/manim/.venv', process.platform === 'win32' ? 'Scripts/manimgx.exe' : 'bin/manimgx');
const scene = JSON.parse(readFileSync(join(bake, 'scene.json'), 'utf8'));
const FPS = scene.fps, DUR = scene.duration;

const have = existsSync(frames) ? readdirSync(frames).filter(f => /^\d{4}\.png$/.test(f)).length : 0;
if (have < scene.frames) {
  console.error(`only ${have} of ${scene.frames} Blender frames in ${frames}: run npm run blender -- razorbill/skyfall_field.py (it resumes)`);
  process.exit(1);
}

mkdirSync(work, { recursive: true });
const plot = bg => join(work, `plot-${bg}.mp4`);
for (const [bg, colour] of [['black', '#000000'], ['white', '#ffffff']]) {
  execFileSync(manim, ['render', join(root, 'video/manim/signal.py'), '-o', plot(bg), '-r', '1920x1080', '--fps', String(FPS), '--crf', '4'],
    { stdio: 'inherit', env: { ...process.env, PLOT_BG: colour, PYTHONIOENCODING: 'utf-8' } });
}

// ManimGX writes a held picture as one long frame: back to a steady 30 fps, padded to the film's length
const cfr = `fps=${FPS},tpad=stop_mode=clone:stop=-1,trim=duration=${DUR},setpts=PTS-STARTPTS,format=gbrp`;
const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', join(frames, '%04d.png'), '-i', plot('black'), '-i', plot('white'),
  '-filter_complex',
  `[0:v]format=gbrp,setsar=1[film];[1:v]${cfr},split[b1][b2];[2:v]${cfr}[w];` +
  `[w][b1]blend=all_mode=difference[clear];[film][clear]blend=all_mode=multiply[under];[under][b2]blend=all_mode=addition,` +
  `fade=t=out:st=${DUR - 1.1}:d=1,format=yuv420p[v]`,
  '-map', '[v]', '-t', String(DUR), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
  { stdio: 'inherit' });
if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status})`);
console.log(out);
