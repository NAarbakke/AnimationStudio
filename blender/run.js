// Runs a script from blender/ in headless Blender: npm run blender -- vegetation.py
// The BLENDER environment variable overrides the path of blender.exe.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const base = 'C:/Program Files/Blender Foundation';
const found = existsSync(base) ? readdirSync(base).sort().reverse().map(d => join(base, d, 'blender.exe')).find(existsSync) : null;
const blender = process.env.BLENDER ?? found ?? 'blender';

const script = process.argv[2];
if (!script) { console.error('usage: npm run blender -- <script in blender/>'); process.exit(1); }
const { status, error } = spawnSync(blender, ['-b', '--factory-startup', '--python-exit-code', '1', '-P', join(here, script)], { stdio: 'inherit' });
if (error) { console.error(`could not start ${blender}: ${error.message}`); process.exit(1); }
process.exit(status);
