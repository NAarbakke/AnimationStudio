// The maths page: the ManimGX scenes from video/manim, drawn live by ManimGX's browser player.
// The scenes import kit.py and read the labs' exported data (srm.json, engine.json, from video/manim/export.js),
// so each film's source is assembled here: kit becomes an in-memory module whose load() reads inlined JSON.
import 'manimgx';
import kit from '../../../video/manim/kit.py?raw';
import srmScene from '../../../video/manim/srm.py?raw';
import engineScene from '../../../video/manim/engine.py?raw';
import srmData from '../../../video/manim/srm.json?raw';
import engineData from '../../../video/manim/engine.json?raw';

const DATA: Record<string, string> = { 'srm.json': srmData, 'engine.json': engineData };

// JSON string literals are valid Python string literals, so the files go in as they are
function film(scene: string): string {
  return [
    'import json, sys, types',
    '_kit = types.ModuleType("kit")',
    `exec(${JSON.stringify(kit)}, _kit.__dict__)`,
    `_DATA = {${Object.entries(DATA).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`,
    '_kit.load = lambda name: json.loads(_DATA[name])',
    'sys.modules["kit"] = _kit',
    scene,
  ].join('\n');
}

const sources: Record<string, string> = { engine: engineScene, srm: srmScene };
const players = [...document.querySelectorAll('manimgx-player')];

if (!('gpu' in navigator)) {
  for (const p of players) p.nextElementSibling!.textContent = 'This browser has no WebGPU. Open the page in Chrome or Edge 113+, or Safari 26.';
} else {
  // a film is made when it scrolls into view: each player runs Python in a worker of its own, so not both at once on load
  const seen = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const p = e.target as HTMLElement & { source: string | null };
      seen.unobserve(p);
      p.nextElementSibling!.toggleAttribute('hidden', true);
      p.source = film(sources[p.id]);
    }
  }, { threshold: 0.35 });
  for (const p of players) seen.observe(p);
}
