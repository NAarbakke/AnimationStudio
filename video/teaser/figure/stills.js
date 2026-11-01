// Single frames of the illustrated teaser, for checking shots: node video/teaser/figure/stills.js <out dir> <seconds>...
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const [out, ...times] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => console.error(`[page] ${e.message}`));
await page.goto(pathToFileURL(resolve('video/out/teaser-figure/index.html')).href);
await page.evaluate(() => window.__film.ready);
for (const t of times) {
  const t0 = Date.now();
  await page.evaluate(x => window.__film.seek(x), Number(t));
  await page.screenshot({ path: resolve(out, `f${String(t).padStart(5, '0')}.png`) });
  console.log(t, Date.now() - t0, 'ms');
}
await browser.close();
