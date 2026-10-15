// Grabs single frames from a film-mode page at chosen times, for checking shots without a full render.
//   node video/stills.js "conops.html?film" 10 30 95 --out video/out/stills --size 1280x720
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string', short: 'o' }, size: { type: 'string' }, channel: { type: 'string' } } });
const [target, ...times] = positionals;
const out = resolve(root, v.out ?? 'video/out/stills');
const [width, height] = (v.size ?? '1280x720').split('x').map(Number);
mkdirSync(out, { recursive: true });

const server = await (await createServer({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn' })).listen();
const browser = await chromium.launch({ channel: v.channel ?? 'chrome', args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error(`[page] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error(`[console] ${m.text()}`); });
  await page.goto(new URL(target, server.resolvedUrls.local[0]).href, { waitUntil: 'load' });
  await page.evaluate(() => window.__film.ready);
  await page.evaluate(() => document.fonts.ready);
  for (const t of times) {
    await page.evaluate(t => window.__film.seek(t), Number(t));
    const file = resolve(out, `t${String(t).padStart(6, '0')}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
} finally {
  await browser.close();
  await server.close();
}
