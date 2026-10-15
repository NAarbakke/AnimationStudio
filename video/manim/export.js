// Exports the labs' own physics for the ManimGX inserts: srm.json (solid motor) and engine.json (liquid engine).
//   node video/manim/export.js [--grain bates|star|finocyl|endburner]
// The physics stays in the labs: this loads each page headless and reads the hooks it exposes
// (srm.html?film → window.__film, engine.html → window.__engine).
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const { values: o } = parseArgs({ options: { grain: { type: 'string', default: 'bates' } } });
const r4 = x => Math.round(x * 1e4) / 1e4;

const server = await (await createServer({ configFile: resolve(here, '../../vite.config.ts'), logLevel: 'warn' })).listen();
const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const open = async (path, ready) => {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error(`[page] ${e.message}`));
  await page.goto(new URL(path, server.resolvedUrls.local[0]).href, { waitUntil: 'load' });
  await page.waitForFunction(ready, null, { timeout: 60_000 });
  return page;
};
const write = (name, data) => { const f = resolve(here, name); writeFileSync(f, JSON.stringify(data, null, 1)); return f; };

try {
  // solid motor: the burn over time, and the propellant constants behind it
  const srm = await open(`srm.html?film&grain=${o.grain}`, () => window.__film?.sim);
  const s = await srm.evaluate(() => {
    const s = window.__film.sim, p = window.__film.prop, res = window.__film.res, geom = window.__film.geom, r = x => Math.round(x * 1e4) / 1e4;
    return {
      t: Array.from(s.t, r), F: Array.from(s.F, r), pc: Array.from(s.pc, r), kn: Array.from(s.kn, r), Ab: Array.from(s.kn, k => r(k * s.At)), // Ab in m²
      w: Array.from(s.w, r), // web burned, m
      // the motor as the lab draws it: per axial slice of the grain, its port radius and the web at which it opens and burns out
      slices: { oy: res.oy, h: res.h, portR: Array.from(res.portR, r), minD: Array.from(res.minD, r), maxD: Array.from(res.maxD, r), R: window.__film.motor.R },
      geom: { caseR: geom.caseR, caseY0: geom.caseY0, caseY1: geom.caseY1, rt: geom.rt, re: geom.re, ye: geom.ye, nozzle: { y: Array.from(geom.nozzle.y, r), r: Array.from(geom.nozzle.r, r) } },
      tb: s.tb, tEnd: s.tEnd, It: s.It, isp: s.isp, pcMax: s.pcMax, mprop: s.mprop, cls: s.cls, shape: s.shape, At: s.At, eps: s.eps,
      prop: { name: p.name, rho: p.rho, a: p.rRef / Math.pow(p.pRef, p.n), n: p.n, cstar: p.cstar, g: p.g },
    };
  });
  const f1 = write('srm.json', { grain: o.grain, ...s });
  console.log(`${f1}: ${s.prop.name} ${o.grain}, ${s.shape}, burn ${s.tb.toFixed(2)} s, peak ${(Math.max(...s.F) / 1000).toFixed(2)} kN, It ${(s.It / 1000).toFixed(1)} kN·s`);

  // liquid engine: the steady state at sea level, the flow along the nozzle, and Isp from sea level to vacuum
  const eng = await open('engine.html', () => window.__engine?.snapshot().Es);
  const e = await eng.evaluate(() => {
    const { S, P, Es, G, prof, AT, PC_NOM, G0, RHO_OX, tp } = window.__engine.snapshot();
    const alt = Array.from({ length: 61 }, (_, i) => i * 2);
    return {
      prop: { name: P.name, rhoF: P.rhoF, g: P.g }, of: S.of, thr: S.thr, eps: S.eps, AT, PC_NOM, G0, RHO_OX, Le: -G.ye,
      Es: Object.fromEntries(Object.entries(Es).filter(([, v]) => typeof v !== 'object')),
      tp: { ...tp, rpm: 36000 * Math.sqrt(S.thr) },
      prof: Object.fromEntries(['y', 'r', 'M', 'T', 'p', 'v'].map(k => [k, Array.from(prof[k])])),
      alt, isp: alt.map(km => window.__engine.solveAt(km).Isp), thrust: alt.map(km => window.__engine.solveAt(km).F),
    };
  });
  for (const k of ['y', 'r', 'M', 'T', 'p', 'v']) e.prof[k] = e.prof[k].map(r4);
  const f2 = write('engine.json', e);
  console.log(`${f2}: ${e.prop.name}, Pc ${(e.Es.Pc / 1e5).toFixed(0)} bar, F ${(e.Es.F / 1000).toFixed(0)} kN, Isp ${e.Es.Isp.toFixed(0)} s, ε ${e.eps}, ${e.prof.y.length} profile points`);
} finally {
  await browser.close();
  await server.close();
}
