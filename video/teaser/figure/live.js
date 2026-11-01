// The film's clock: every frame is a pure function of t, told to the page by video/render.js through window.__film.seek(t).
(() => {
  const F = window.FIG;
  const film = document.getElementById('film');
  const art = document.getElementById('art');
  const items = [...art.children].map(node => ({ node, asm: node.dataset.asm, k: +node.dataset.k }));
  const blades = [...art.querySelectorAll('.blades')].map(node => {
    const [x, y] = node.dataset.pivot.split(' ').map(Number);
    return { node, x, y, dir: +node.dataset.dir };
  });
  const discs = [...art.querySelectorAll('.spin-disc')];
  const $ = id => document.getElementById(id);
  const slitGrad = $('slitGrad'), wakeGrad = $('wakeGrad');

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * u * (u * (6 * u - 15) + 10); };
  const mix = (a, b, u) => a + (b - a) * u;

  // beats shared with the Blender teaser and the soundtrack
  const CUT = [3.75, 7.5, 11.5, 16.5];

  // assemblies close in this order, outside parts last: a share of 1 is apart, 0 is home
  const ORDER = ['rod', 'hook', 'release', 'leg0', 'leg1', 'leg2', 'leg3', 'board', 'arm0', 'arm1', 'arm2', 'arm3', 'motor0', 'motor1', 'motor2', 'motor3', 'top', 'prop0', 'prop1', 'prop2', 'prop3', 'battery', 'frame'];
  const shareOf = (asm, t) => {
    const u = ORDER.indexOf(asm) / ORDER.length;
    const start = 11.7 + u * 2.3;
    return 1 - smooth(start, start + 1.5, t);
  };

  // each shot: where the camera looks, its zoom over the sheet, and the slit's path in sheet y
  const S = F.spots;
  function shot(t) {
    if (t < CUT[0]) {
      const u = t / CUT[0];
      return { c: [mix(S.rotor2[0] - 20, S.rotor2[0] + 22, u), mix(S.rotor2[1] + 15, S.rotor2[1] - 5, u)], w: mix(620, 500, smooth(0, 1, u)), slit: mix(S.rotor2[1] - 290, S.rotor2[1] + 300, smooth(0.1, 0.92, u)), band: 230, beam: 0.8 };
    }
    if (t < CUT[1]) {
      const u = (t - CUT[0]) / (CUT[1] - CUT[0]);
      return { c: [mix(S.heart[0] + 14, S.heart[0] - 16, u), mix(S.heart[1] - 40, S.heart[1] + 40, u)], w: mix(860, 1040, smooth(0, 1, u)), slit: mix(S.heart[1] - 520, S.heart[1] + 480, smooth(0.04, 0.96, u)), band: 260, beam: 0.8 };
    }
    if (t < CUT[2]) {
      const u = (t - CUT[1]) / (CUT[2] - CUT[1]);
      const v = smooth(0, 1, u);
      return { c: [mix(S.fins[0], S.strip[0], v), mix(S.fins[1] + 60, S.strip[1], v)], w: mix(520, 660, v), slit: mix(S.fins[1] - 240, S.strip[1] + 230, smooth(0.02, 0.98, u)), band: 190, beam: 0.8 };
    }
    const u = (t - CUT[2]) / (CUT[3] - CUT[2]);
    const fit = mix(3700, 3250, smooth(0, 1, u));
    return { c: [S.whole[0], mix(S.whole[1] + 30, S.whole[1] - 30, smooth(0, 1, u))], w: fit, slit: mix(S.whole[1] + 1450, S.whole[1] - 1050, smooth(0.0, 0.7, u)), band: 620, beam: 0.65 * (1 - smooth(0.62, 0.72, u)) };
  }

  let order = '';
  function seek(t) {
    const s = shot(t);
    const h = s.w * 9 / 16;
    film.setAttribute('viewBox', `${(s.c[0] - s.w / 2).toFixed(2)} ${(s.c[1] - h / 2).toFixed(2)} ${s.w.toFixed(2)} ${h.toFixed(2)}`);

    // parts: translate by the assembly's exploded offset, and re-sort only when the painter's order changes
    const shares = {};
    for (const it of items) {
      const share = shares[it.asm] ??= shareOf(it.asm, t);
      const m = F.moves[it.asm];
      it.sort = it.k + m.lift * share;
      it.node.setAttribute('transform', share > 1e-4 ? `translate(${(m.s[0] * share).toFixed(2)} ${(m.s[1] * share).toFixed(2)})` : '');
    }
    const sorted = [...items].sort((a, b) => a.sort - b.sort);
    const key = sorted.map(x => x.node.dataset.i).join();
    if (key !== order) { order = key; const frag = document.createDocumentFragment(); sorted.forEach(x => frag.appendChild(x.node)); art.appendChild(frag); }

    // props: a turn about z is an affine map of the screen, A R(θ) A⁻¹ with A the floor plane's screen axes
    const turns = 0.18 * t + 44 * Math.pow(clamp((t - 12.6) / (CUT[3] - 12.6)), 3.1);
    const [ax, ay] = F.floorX, [bx, by] = F.floorY;
    const det = ax * by - ay * bx;
    const whirl = smooth(14.4, 16, t);
    for (const b of blades) {
      const th = b.dir * 2 * Math.PI * turns, c = Math.cos(th), sn = Math.sin(th);
      // A R A⁻¹
      const m00 = (ax * c + bx * sn) * by / det - (-ax * sn + bx * c) * ay / det;
      const m01 = -(ax * c + bx * sn) * bx / det + (-ax * sn + bx * c) * ax / det;
      const m10 = (ay * c + by * sn) * by / det - (-ay * sn + by * c) * ay / det;
      const m11 = -(ay * c + by * sn) * bx / det + (-ay * sn + by * c) * ax / det;
      const e = b.x - m00 * b.x - m01 * b.y, f = b.y - m10 * b.x - m11 * b.y;
      b.node.setAttribute('transform', `matrix(${m00.toFixed(5)} ${m10.toFixed(5)} ${m01.toFixed(5)} ${m11.toFixed(5)} ${e.toFixed(2)} ${f.toFixed(2)})`);
      b.node.setAttribute('opacity', (1 - 0.72 * whirl).toFixed(3));
    }
    discs.forEach(d => d.setAttribute('fill-opacity', (0.16 * whirl).toFixed(3)));

    // light: a band that moves down the sheet, a dim wake behind it, and a line in the air where it is
    const b = s.band;
    slitGrad.setAttribute('y1', (s.slit - b).toFixed(1)); slitGrad.setAttribute('y2', (s.slit + b * 0.5).toFixed(1));
    wakeGrad.setAttribute('y1', (s.slit - 60).toFixed(1)); wakeGrad.setAttribute('y2', (s.slit + 60).toFixed(1));
    const up = t >= CUT[2];
    if (up) { // the last pass climbs: what it has left behind is below it
      wakeGrad.setAttribute('y1', (s.slit + 60).toFixed(1)); wakeGrad.setAttribute('y2', (s.slit - 60).toFixed(1));
    }
    const beat = t < CUT[0] ? [0, CUT[0]] : t < CUT[1] ? [CUT[0], CUT[1]] : t < CUT[2] ? [CUT[1], CUT[2]] : [CUT[2], CUT[3]];
    const inOut = smooth(beat[0], beat[0] + 0.35, t) * (1 - smooth(beat[1] - 0.3, beat[1], t));
    $('lit').setAttribute('opacity', (up ? 1 - 0.0 * inOut : inOut).toFixed(3));
    $('wake').setAttribute('opacity', ((up ? 0.85 : 0.75) * inOut).toFixed(3));
    const beam = $('beam');
    beam.setAttribute('y', (s.slit - 1.5 * s.w / 1920).toFixed(1));
    beam.setAttribute('height', (3 * s.w / 1920).toFixed(2));
    beam.setAttribute('opacity', (s.beam * inOut).toFixed(3));

    // the end: everything goes dark against a rising glow, a silhouette like the path-traced cut
    const rise = smooth(13.6, 16.3, t) * (t < CUT[3] ? 1 : 0);
    const glow = $('glow');
    glow.setAttribute('cx', S.heart[0]); glow.setAttribute('cy', S.heart[1] + 60);
    glow.setAttribute('r', mix(620, 1500, rise).toFixed(1));
    glow.setAttribute('opacity', rise.toFixed(3));

    const stop = t >= CUT[3];
    $('black').style.opacity = stop ? 1 : 0;
    const corners = smooth(0.8, 1.6, t) * (1 - smooth(CUT[3] - 0.6, CUT[3] - 0.2, t));
    document.querySelectorAll('.corner').forEach(c => { c.style.opacity = stop ? 0 : corners * 0.85; });
    const mm = (F.zero[1] - s.slit) / -F.up[1];
    $('readout').textContent = `scan z ${mm >= 0 ? '+' : '-'}${String(Math.abs(Math.round(mm))).padStart(4, '0')} mm`;
  }
  window.__film = { ready: document.fonts.ready, seek };
  seek(new URLSearchParams(location.search).has('t') ? +new URLSearchParams(location.search).get('t') : 0);
})();
