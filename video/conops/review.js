// Samples the complete timeline and checks cutaway labels before the full export.
//   npm run video:conops:review   (stills and checks.json go to video/out/conops-review)
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, 'video/out/conops-review');
mkdirSync(out, { recursive: true });
const server = await (await createServer({ configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn' })).listen();
const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
  await page.goto(new URL('conops.html?film', server.resolvedUrls.local[0]).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.__film.ready);
  const cdp = await page.context().newCDPSession(page);
  const snapshots = new Set([8, 20, 28, 40, 60, 80, 97, 112, 125, 145, 154, 176]);
  const times = [...new Set([...Array.from({ length: 91 }, (_, i) => i * 2), ...snapshots])].sort((a,b) => a-b);
  for (const t of times) {
    await page.evaluate(t => { window.__film.seek(t); const c=document.getElementById('c'); const gl=c.getContext('webgl2') || c.getContext('webgl'); gl.finish(); }, t);
    if (t >= 109 && t <= 132.5) {
      const faults = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.lbl')].filter(e => Number(e.style.opacity) > .1).map(e => ({ name: e.textContent, r: e.getBoundingClientRect() }));
        const faults = [];
        for (let i = 0; i < labels.length; i++) {
          const { name, r } = labels[i];
          if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) faults.push(`Outside frame: ${name}`);
          for (let j = i + 1; j < labels.length; j++) {
            const b = labels[j].r;
            if (r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) faults.push(`Overlapping: ${name}, ${labels[j].name}`);
          }
        }
        return faults;
      });
      errors.push(...faults.map(f => `${t}s: ${f}`));
    }
    if (snapshots.has(t)) { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true }); writeFileSync(resolve(out, 't'+t+'.png'), Buffer.from(data, 'base64')); }
    if (t % 20 === 0) console.log('Reviewed '+t+'/180 seconds');
  }
  writeFileSync(resolve(out, 'checks.json'), JSON.stringify({ sampledFrames: times.length, errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Passed: Full timeline sampled, no runtime/shader errors or overlapping cutaway labels. Stills: ${out}`);
} finally {
  await browser.close();
  await server.close();
}
