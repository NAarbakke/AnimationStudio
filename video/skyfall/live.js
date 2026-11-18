// The plate's clock, in programme seconds (video/skyfall/phases.mjs): every frame is a pure function of t,
// told to the page by video/render.js through window.__film.seek(t). Open index.html?t=14 to look at one moment.
(() => {
  const F = window.FIG;
  const [P1, P2] = F.phases;
  const film = document.getElementById('film');
  const art = document.getElementById('art');
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const items = [...art.children].map(node => ({ node, asm: node.dataset.asm, k: +node.dataset.k }));
  const blades = [...art.querySelectorAll('.blades')].map(node => {
    const [x, y] = node.dataset.pivot.split(' ').map(Number);
    return { node, x, y, dir: +node.dataset.dir };
  });
  const discs = [...art.querySelectorAll('.spin-disc')];

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * u * (u * (6 * u - 15) + 10); };
  const mix = (a, b, u) => a + (b - a) * u;
  const window_ = (t, a, b, fade = 0.4) => smooth(a, a + fade, t) * (1 - smooth(b - fade, b, t));

  // ---- palettes: phase 1 is a blueprint, phase 2 the same drawing as a shaded model on the bench
  const BLUE = {
    paper: '#0c1d33', face: '#10243d', top: '#13294a', 'shade-0': '#0a1729', 'shade-1': '#0c1b30', 'shade-2': '#0f2038', 'shade-3': '#112540',
    'lit-top': '#1a355c', 'lit-shade': '#132a47', hi: '#e3efff', mid: '#8fb2dc', lo: '#557aa6', faint: '#2f4d73', lit: '#ffffff', dot: '#cfe3ff', red: '#ff9a4d',
    tape: '#9cc3f0', ember: '#3a1d10',
  };
  const SHOP = {
    paper: '#0a0c11', face: '#1b2029', top: '#2a3140', 'shade-0': '#0d1016', 'shade-1': '#151924', 'shade-2': '#1e2431', 'shade-3': '#272e3d',
    'lit-top': '#4a5468', 'lit-shade': '#2c3442', hi: '#eef3fb', mid: '#9aa6ba', lo: '#5a6476', faint: '#343b48', lit: '#ffffff', dot: '#e6ecf7', red: '#ff6a1f',
    tape: '#f2f6ff', ember: '#8a2c08',
  };
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  function palette(u) {
    for (const key of Object.keys(BLUE)) {
      const a = rgb(BLUE[key]), b = rgb(SHOP[key]);
      const v = hex(a.map((x, i) => mix(x, b[i], u)));
      film.style.setProperty(key === 'tape' || key === 'ember' ? `--${key}` : `--anatomy-${key}`, v);
    }
  }

  // ---- the sketch draws the airframe from the inside out; assembly closes it outside parts last, as in the teaser
  const DRAW = ['frame', 'board', 'top', 'arm0', 'arm1', 'arm2', 'arm3', 'motor0', 'motor1', 'motor2', 'motor3', 'leg0', 'leg1', 'leg2', 'leg3', 'battery', 'release', 'hook', 'rod', 'prop0', 'prop1', 'prop2', 'prop3'];
  const CLOSE = ['rod', 'hook', 'release', 'leg0', 'leg1', 'leg2', 'leg3', 'board', 'arm0', 'arm1', 'arm2', 'arm3', 'motor0', 'motor1', 'motor2', 'motor3', 'top', 'prop0', 'prop1', 'prop2', 'prop3', 'battery', 'frame'];
  const SKETCH = [P1.from + 0.6, P1.from + 5.2]; // outlines drawn on
  const SOLID = [P1.from + 5.8, P1.from + 8.0];  // faces filled in
  const BURST = [P2.from + 0.7, P2.from + 2.6];  // flies apart
  const BUILD = [P2.from + 4.4, P2.from + 9.6];  // comes together
  const SPIN = P2.from + 10.2;
  const LIFT = P2.to - 2.4; // rises off the bench, then the field film dissolves in over it

  function look(asm, t) {
    const i = DRAW.indexOf(asm) / DRAW.length;
    const s0 = mix(SKETCH[0], SKETCH[1] - 1.3, i), f0 = mix(SOLID[0], SOLID[1] - 0.9, i);
    return { draw: 1 - smooth(s0, s0 + 1.3, t), ink: smooth(s0 + 0.5, s0 + 1.1, t), solid: smooth(f0, f0 + 0.9, t) };
  }
  function shareOf(asm, t) {
    const out = smooth(BURST[0] + (1 - CLOSE.indexOf(asm) / CLOSE.length) * 0.5, BURST[1], t);
    const u = CLOSE.indexOf(asm) / CLOSE.length, s = mix(BUILD[0], BUILD[1] - 1.4, u);
    return out * (1 - smooth(s, s + 1.4, t));
  }

  // ---- camera: [time, centre x, centre y, viewBox width]; eased between keys
  const S = F.spots;
  const CAM = [
    [0, S.heart[0], S.heart[1] + 80, 2700],
    [P1.from + 7.8, S.heart[0], S.heart[1] + 60, 2450],
    [P1.from + 11.0, S.heart[0], S.heart[1] + 50, 2400],
    [P1.from + 11.8, S.rod[0], S.rod[1] + 90, 3400],
    [P1.from + 13.5, S.rod[0], S.rod[1] + 60, 3350],
    [P1.from + 15.3, S.low[0], S.low[1] + 330, 5400],
    [P2.from + 0.6, S.low[0], S.low[1] + 300, 5300],
    [P2.from + 2.8, S.heart[0], S.heart[1] + 360, 4400],
    [P2.from + 4.4, S.heart[0], S.heart[1] + 350, 4300],
    [P2.from + 10.0, S.heart[0], S.heart[1] + 380, 3300],
    [P2.to, S.heart[0], S.heart[1] + 260, 2900],
  ];
  function camera(t) {
    let i = 0; while (i + 1 < CAM.length && t >= CAM[i + 1][0]) i++;
    const a = CAM[i], b = CAM[Math.min(i + 1, CAM.length - 1)];
    const u = b === a ? 0 : smooth(a[0], b[0], t);
    return { c: [mix(a[1], b[1], u), mix(a[2], b[2], u)], w: mix(a[3], b[3], u) };
  }

  // ---- annotations in screen pixels, so the type stays the same size while the camera moves
  const el = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent?.appendChild(n); return n; };
  const notes = F.callouts.map(c => {
    const g = el('g', {}, $('notes'));
    return { c, g, lead: el('path', { class: 'lead' }, g), ring: el('circle', { class: 'ring', r: 7 }, g), pin: el('circle', { class: 'pin', r: 2.6 }, g),
      t: Object.assign(el('text', { class: 't' }, g), { textContent: c.text }), s: Object.assign(el('text', { class: 's' }, g), { textContent: c.sub }) };
  });
  const dims = F.dims.map(d => {
    const g = el('g', {}, $('dims'));
    return { d, g, e1: el('line', { class: 'ext' }, g), e2: el('line', { class: 'ext' }, g), line: el('path', { class: 'dim' }, g), bg: el('rect', { class: 'dbg', rx: 3 }, g), t: Object.assign(el('text', { class: 'dt', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g), { textContent: d.text }) };
  });
  const axes = Object.entries(F.axes).map(([asm, a]) => ({ asm, a, line: el('line', { class: 'axis' }, $('axes')) }));

  const STEPS = [
    [P1.from + 0.4, '01', 'Concept sketch'], [SOLID[0] - 0.2, '02', 'Solid model'], [P1.from + 8.5, '03', 'Dimensions and interfaces'],
    [P1.from + 13.9, '04', 'Design freeze'], [P2.from + 0.4, '05', 'Exploded view'], [BUILD[0] - 0.3, '06', 'Assembly'], [SPIN - 0.3, '07', 'Bench spin-up'], [LIFT, '08', 'Lift-off'],
  ];

  let order = '';
  let stepKey = '';
  function seek(t) {
    const cam = camera(t);
    // lift-off: the camera sinks (the drone rises) and closes in a little, to meet the field film's first frame
    const up = smooth(LIFT, P2.to + 0.8, t);
    cam.c[1] += 110 * up; cam.w *= 1 - 0.05 * up;
    const h = cam.w * 9 / 16, x0 = cam.c[0] - cam.w / 2, y0 = cam.c[1] - h / 2, k = 1920 / cam.w;
    film.setAttribute('viewBox', `${x0.toFixed(2)} ${y0.toFixed(2)} ${cam.w.toFixed(2)} ${h.toFixed(2)}`);
    const scr = p => [(p[0] - x0) * k, (p[1] - y0) * k];

    // backgrounds and colours
    const shop = smooth(P2.from - 0.2, P2.from + 1.2, t);
    palette(shop);
    $('paper').style.opacity = smooth(P1.from - 0.3, P1.from + 0.6, t) * (1 - shop);
    $('shop').style.opacity = shop;
    $('gridRect').style.opacity = (smooth(P1.from - 0.2, P1.from + 0.8, t) * (1 - shop)).toFixed(3);

    // parts: sketch, solid, and the exploded offset; re-sort only when the painter's order changes
    const state = {};
    for (const it of items) {
      const s = state[it.asm] ??= { ...look(it.asm, t), share: shareOf(it.asm, t) };
      const m = F.moves[it.asm];
      it.sort = it.k + m.lift * s.share;
      it.node.style.setProperty('--draw', s.draw.toFixed(4));
      it.node.style.setProperty('--ink', s.ink.toFixed(3));
      it.node.style.setProperty('--solid', s.solid.toFixed(3));
      it.node.style.opacity = s.draw >= 0.9999 ? 0 : 1;
      it.node.setAttribute('transform', s.share > 1e-4 ? `translate(${(m.s[0] * s.share).toFixed(2)} ${(m.s[1] * s.share).toFixed(2)})` : '');
    }
    const sorted = [...items].sort((a, b) => a.sort - b.sort);
    const key = sorted.map(x => x.node.dataset.i).join();
    if (key !== order) { order = key; const frag = document.createDocumentFragment(); sorted.forEach(x => frag.appendChild(x.node)); art.appendChild(frag); }

    // props: idle in the drawing, spun up on the bench (a turn about z is A R(θ) A⁻¹ on screen, A the floor's screen axes)
    const turns = 0.04 * t + 38 * Math.pow(clamp((t - SPIN) / (P2.to - SPIN)), 2.4);
    const [ax, ay] = F.floorX, [bx, by] = F.floorY;
    const det = ax * by - ay * bx;
    const whirl = smooth(SPIN + 1.2, SPIN + 3.2, t);
    for (const b of blades) {
      const th = b.dir * 2 * Math.PI * turns, c = Math.cos(th), sn = Math.sin(th);
      const m00 = (ax * c + bx * sn) * by / det - (-ax * sn + bx * c) * ay / det;
      const m01 = -(ax * c + bx * sn) * bx / det + (-ax * sn + bx * c) * ax / det;
      const m10 = (ay * c + by * sn) * by / det - (-ay * sn + by * c) * ay / det;
      const m11 = -(ay * c + by * sn) * bx / det + (-ay * sn + by * c) * ax / det;
      const e = b.x - m00 * b.x - m01 * b.y, f = b.y - m10 * b.x - m11 * b.y;
      b.node.setAttribute('transform', `matrix(${m00.toFixed(5)} ${m10.toFixed(5)} ${m01.toFixed(5)} ${m11.toFixed(5)} ${e.toFixed(2)} ${f.toFixed(2)})`);
      b.node.setAttribute('opacity', (1 - 0.75 * whirl).toFixed(3));
    }
    discs.forEach(d => d.setAttribute('fill-opacity', (0.18 * whirl).toFixed(3)));

    // callouts and dimensions: phase 1 only
    const out = c => 1 - smooth(c.until - 0.3, c.until + 0.2, t);
    for (const n of notes) {
      const a = smooth(n.c.t, n.c.t + 0.5, t) * out(n.c);
      n.g.style.opacity = a.toFixed(3);
      if (a <= 0) continue;
      const [px, py] = scr(n.c.at);
      const grow = smooth(n.c.t, n.c.t + 0.45, t);
      const ex = px + n.c.dx * grow, ey = py + n.c.dy * grow, side = Math.sign(n.c.dx) || 1, run = 34 * side;
      n.lead.setAttribute('d', `M${px.toFixed(1)} ${py.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}h${run}`);
      for (const c of [n.ring, n.pin]) { c.setAttribute('cx', px.toFixed(1)); c.setAttribute('cy', py.toFixed(1)); }
      const tx = ex + run + 10 * side, anchor = side > 0 ? 'start' : 'end';
      for (const [node, dy] of [[n.t, -4], [n.s, 18]]) { node.setAttribute('x', tx.toFixed(1)); node.setAttribute('y', (ey + dy).toFixed(1)); node.setAttribute('text-anchor', anchor); }
    }
    for (const d of dims) {
      const a = smooth(d.d.t, d.d.t + 0.5, t) * out(d.d);
      d.g.style.opacity = a.toFixed(3);
      if (a <= 0) continue;
      const A = scr(d.d.a), B = scr(d.d.b);
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const nx = -(B[1] - A[1]) / len * d.d.off, ny = (B[0] - A[0]) / len * d.d.off;
      const grow = smooth(d.d.t, d.d.t + 0.6, t);
      const a1 = [A[0] + nx, A[1] + ny], b1 = [mix(A[0], B[0], grow) + nx, mix(A[1], B[1], grow) + ny];
      d.e1.setAttribute('x1', A[0]); d.e1.setAttribute('y1', A[1]); d.e1.setAttribute('x2', a1[0]); d.e1.setAttribute('y2', a1[1]);
      d.e2.setAttribute('x1', B[0]); d.e2.setAttribute('y1', B[1]); d.e2.setAttribute('x2', B[0] + nx); d.e2.setAttribute('y2', B[1] + ny);
      d.e2.style.opacity = grow > 0.98 ? 1 : 0;
      // the line with closed arrowheads at both ends
      const ux = (b1[0] - a1[0]) / Math.max(1, Math.hypot(b1[0] - a1[0], b1[1] - a1[1])), uy = (b1[1] - a1[1]) / Math.max(1, Math.hypot(b1[0] - a1[0], b1[1] - a1[1]));
      const head = (p, s) => `M${p[0] + s * (ux * 12 - uy * 4)} ${p[1] + s * (uy * 12 + ux * 4)}L${p[0]} ${p[1]}L${p[0] + s * (ux * 12 + uy * 4)} ${p[1] + s * (uy * 12 - ux * 4)}`;
      d.line.setAttribute('d', `M${a1[0]} ${a1[1]}L${b1[0]} ${b1[1]}${head(a1, 1)}${grow > 0.98 ? head(b1, -1) : ''}`);
      const mid = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
      d.t.setAttribute('x', mid[0]); d.t.setAttribute('y', mid[1]);
      d.t.style.opacity = grow > 0.98 ? 1 : 0;
      const wbg = d.d.text.length * 10.6 + 16;
      d.bg.setAttribute('x', mid[0] - wbg / 2); d.bg.setAttribute('y', mid[1] - 14); d.bg.setAttribute('width', wbg); d.bg.setAttribute('height', 28);
      d.bg.style.opacity = grow > 0.98 ? 1 : 0;
    }

    // assembly axes: from where a part belongs to where it hangs in the exploded view
    const axesOn = smooth(BURST[1] - 0.6, BURST[1] + 0.2, t);
    for (const x of axes) {
      const sh = shareOf(x.asm, t);
      const len = Math.hypot(...x.a.s);
      const A = scr(x.a.home), B = scr([x.a.home[0] + x.a.s[0] * sh, x.a.home[1] + x.a.s[1] * sh]);
      x.line.setAttribute('x1', A[0].toFixed(1)); x.line.setAttribute('y1', A[1].toFixed(1)); x.line.setAttribute('x2', B[0].toFixed(1)); x.line.setAttribute('y2', B[1].toFixed(1));
      x.line.style.opacity = (len > 1 ? axesOn * clamp(sh * 4) : 0).toFixed(3);
    }

    // captions: the step, the title block (changes revision as the design moves on), the freeze stamp
    let step = null; for (const s of STEPS) if (t >= s[0]) step = s;
    const live = window_(t, P1.from + 0.2, P2.to - 0.5, 0.4);
    $('step').style.opacity = step ? live.toFixed(3) : 0;
    if (step && step[1] !== stepKey) { stepKey = step[1]; $('step').querySelector('b').textContent = step[1]; $('step').querySelector('span').textContent = step[2]; }
    $('block').style.opacity = window_(t, P1.from + 0.5, P2.to - 0.5, 0.5).toFixed(3);
    const rev = t < SOLID[0] - 0.2 ? 'A' : t < P1.from + 13.9 ? 'B' : 'C';
    $('rev').textContent = `REV ${rev}`;
    const inShop = t >= P2.from;
    $('sheet').textContent = inShop ? 'Build sheet · unit 01' : 'General arrangement';
    $('where').textContent = inShop ? P2.where : P1.where;
    $('block').style.borderColor = inShop ? '#4a5466' : '#5f84b5';
    $('block').style.background = inShop ? 'rgba(12, 14, 19, .72)' : 'rgba(8, 22, 42, .7)';
    const stamp = window_(t, P1.from + 14.1, P1.to - 0.1, 0.25);
    $('stamp').style.opacity = stamp.toFixed(3);
    $('stamp').style.transform = `rotate(-6deg) scale(${mix(1.35, 1, smooth(P1.from + 14.1, P1.from + 14.4, t)).toFixed(3)})`;

    // title and end cards, and a dip to black into the field film
    $('card').style.opacity = (t < P1.from + 0.6 ? 1 - smooth(P1.from - 0.6, P1.from + 0.4, t) : 0).toFixed(3);
    for (const [sel, a] of [['#card p', smooth(0.2, 0.9, t)], ['#card h1', smooth(0.5, 1.3, t)], ['#card i', smooth(1.0, 1.6, t)], ['#card small', smooth(1.3, 2.0, t)]]) {
      document.querySelector(sel).style.opacity = a.toFixed(3);
    }
    const endOn = smooth(F.end, F.end + 0.8, t);
    $('end').style.opacity = endOn.toFixed(3);
    const black = Math.max(t < 0.2 ? 1 - smooth(0, 0.2, t) : 0, smooth(F.endTo - 0.8, F.endTo, t));
    $('black').style.opacity = black.toFixed(3);
  }
  window.__film = { ready: document.fonts.ready, seek };
  const q = new URLSearchParams(location.search);
  seek(q.has('t') ? +q.get('t') : 0);
})();
