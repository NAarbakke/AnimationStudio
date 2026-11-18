// Single frames of the plate, for checking shots: node video/skyfall/stills.js <seconds>...  -> video/out/skyfall-stills/
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const out = resolve('video/out/skyfall-stills');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => console.error(`[page] ${e.message}`));
await page.goto(pathToFileURL(resolve('video/out/skyfall-plate/index.html')).href);
await page.evaluate(() => window.__film.ready);
for (const t of process.argv.slice(2)) {
  await page.evaluate(x => window.__film.seek(x), Number(t));
  await page.screenshot({ path: resolve(out, `p${String(t).padStart(5, '0')}.png`) });
}
await browser.close();
console.log(out);
