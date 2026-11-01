"""Models for the Burevestnik film: exterior shell, launch site and rocks, procedural with AO baked in Cycles.

    npm run blender -- burevestnik.py    # -> site/public/models/burevestnik.glb

Metres, built in the film's frame (+x forward, +y up, +z right) and turned Z-up only for Blender. Outer proportions follow
Hecla & Kemp, Figures 2-3 and Table 1, as the film did before; seams, rivets and all of the site are visual interpretation,
not engineering geometry. The film's internals for the cutaway stay in site/src/conops/main.js. Nodes:
    skin, wing_R, wing_L, fin, stab_R, stab_L, kicker, booster_R, booster_L
        colour is AO and weathering only (grey); the film's materials set the paint. Each moves about its own origin.
    canister, launcher, shelter, rails, wall, building_a, building_b, mast, container, drums, barrier
        full colour in the vertices; origin on the ground, except the canister, which is centred on its axis
    rock_N
        unit rocks, scaled and scattered by the film
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from kit import Build, ROOT, bake, export, mix, setup, sstep, to_object

OUT = ROOT / "site" / "public" / "models" / "burevestnik.glb"
LEN, HW, HH = 9.51, 0.423, 0.2805
XN, XT = LEN / 2, -LEN / 2
TAU = 2 * math.pi


def srgb(h, k=1.0):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin((h >> s) & 255) * k for s in (16, 8, 0))



class Shape(Build):
    """Build plus solids with hard edges: every face gets its own vertices and normal."""

    def face(self, a, b, c, d, color, seg=None):
        """A quad in the order a b c d; `seg` metres between extra grid lines, so the AO bake has somewhere to land."""
        a, b, c, d = Vector(a), Vector(b), Vector(c), Vector(d)
        n = (b - a).cross(d - a).normalized()
        nu = max(1, round((b - a).length / seg)) if seg else 1
        nv = max(1, round((d - a).length / seg)) if seg else 1
        col = color if callable(color) else (lambda p: color)
        base = len(self.verts)
        for j in range(nv + 1):
            for i in range(nu + 1):
                p = (a.lerp(b, i / nu)).lerp(d.lerp(c, i / nu), j / nv)
                self.vert(p, col(p), tuple(n))
        for j in range(nv):
            for i in range(nu):
                k = base + j * (nu + 1) + i
                self.faces.append((k, k + 1, k + nu + 2, k + nu + 1))

    def box(self, lo, hi, color, seg=None):
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        self.face((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), color, seg)  # +z
        self.face((x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0), color, seg)  # -z
        self.face((x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1), color, seg)  # +x
        self.face((x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0), color, seg)  # -x
        self.face((x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0), color, seg)  # +y
        self.face((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), color, seg)  # -y

    def beam(self, p0, p1, w, h, color, up=(0, 1, 0)):
        """A square bar from p0 to p1."""
        p0, p1 = Vector(p0), Vector(p1)
        t = (p1 - p0).normalized()
        u = Vector(up)
        if abs(t.dot(u)) > 0.98:
            u = Vector((1, 0, 0))
        s = t.cross(u).normalized() * (w / 2)
        v = s.cross(t).normalized() * (h / 2)
        c = [p0 - s - v, p0 + s - v, p0 + s + v, p0 - s + v, p1 - s - v, p1 + s - v, p1 + s + v, p1 - s + v]
        for f in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (3, 2, 1, 0), (4, 5, 6, 7)):
            self.face(*(c[i] for i in f), color)

    def lathe(self, profile, sides, color, along=Vector((1, 0, 0)), at=Vector((0, 0, 0)), ref=Vector((0, 1, 0))):
        """Surface of revolution about `along` through `at`. profile: (distance, radius, [smooth=True]); False starts a hard edge."""
        side = (ref - along * ref.dot(along)).normalized()
        other = along.cross(side)
        rows = []
        for k, row in enumerate(profile):
            rows.append((row[0], row[1], row[2] if len(row) > 2 else True))
        rings = []
        for k, (d, r, _) in enumerate(rows):
            before, after = rows[max(k - 1, 0)], rows[min(k + 1, len(rows) - 1)]
            slope = Vector(((after[0] - before[0]), (after[1] - before[1])))
            ring = []
            for s in range(sides + 1):
                a = TAU * s / sides
                e = side * math.cos(a) + other * math.sin(a)
                n = (e * slope.x - along * slope.y).normalized() if slope.length > 1e-6 else e
                p = at + along * d + e * r
                ring.append(self.vert(p, color(p) if callable(color) else color, tuple(n)))
            rings.append(ring)
        for ra, rb in zip(rings, rings[1:]):
            for s in range(sides):
                self.faces.append((ra[s], ra[s + 1], rb[s + 1], rb[s]))

    def cyl(self, p0, p1, r0, r1, sides, color, caps=True):
        """A tapered cylinder between two points, with hard-edged end caps."""
        p0, p1 = Vector(p0), Vector(p1)
        t = (p1 - p0)
        length = t.length
        t = t.normalized()
        ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
        if caps:
            self.lathe([(0, 1e-4), (0, r0)], sides, color, t, p0, ref)
            self.lathe([(length, r1), (length, 1e-4)], sides, color, t, p0, ref)
        self.lathe([(0, r0), (length, r1)], sides, color, t, p0, ref)


# ---------- missile exterior ----------
SHELL = [
    (XT, 0.19, -0.18, HW * 0.80), (XT + 0.5, 0.21, -0.23, HW * 0.88),
    (-2.1, 0.33, -0.43, HW), (-1.6, 0.33, -0.43, HW), (-1.35, HH, -HH, HW),
    (XN - 1.15, HH, -HH, HW), (XN - 0.7, 0.24, -0.25, HW * 0.86),
    (XN - 0.28, 0.13, -0.16, HW * 0.48), (XN - 0.08, 0.045, -0.075, HW * 0.20), (XN, -0.015, -0.015, 0),
]
RINGS = [3.6, 2.8, 1.15, -0.65, -1.35, -1.6, -2.1, -3.45, -4.35]     # panel seams round the hull
LONGS = [0.3, math.pi - 0.3, math.pi + 0.3, TAU - 0.3]               # seams along it
# angles at which the squared section passes a given fraction of its side wall (ang_side) or roof (ang_top)
ang_side = lambda t, right=True: (math.asin(abs(t) ** 3.125) * (1 if t >= 0 else -1) if right else math.pi - math.asin(abs(t) ** 3.125) * (1 if t >= 0 else -1)) % TAU
ang_top = lambda t, up=True: (math.pi / 2 - math.asin(abs(t) ** 3.125) * (1 if t >= 0 else -1) if up else 3 * math.pi / 2 + math.asin(abs(t) ** 3.125) * (1 if t >= 0 else -1)) % TAU
PANELS = [  # (x0, x1, a0, a1): access panels on both flanks and along the back
    (1.73, 2.37, ang_side(-0.36), ang_side(0.36)), (-0.47, 0.17, ang_side(-0.36), ang_side(0.36)),
    (1.73, 2.37, ang_side(0.36, False), ang_side(-0.36, False)), (-0.47, 0.17, ang_side(0.36, False), ang_side(-0.36, False)),
    (-1.2, -0.75, ang_top(0.45), ang_top(-0.45)), (1.3, 1.95, ang_top(0.45), ang_top(-0.45)), (-3.3, -2.5, ang_top(0.4), ang_top(-0.4)),
]


def shell(x, a, off=0.0):
    i = 1
    while i < len(SHELL) - 1 and x > SHELL[i][0]:
        i += 1
    p, q = SHELL[i - 1], SHELL[i]
    u = min(1.0, max(0.0, (x - p[0]) / (q[0] - p[0])))
    top, bottom, width = mix(p[1], q[1], u), mix(p[2], q[2], u), mix(p[3], q[3], u)
    sn, cs = math.sin(a), math.cos(a)
    y = (top + bottom) / 2 + math.copysign(abs(sn) ** 0.32, sn) * (top - bottom) / 2
    z = math.copysign(abs(cs) ** 0.32, cs) * width
    return Vector((x, y + math.copysign(abs(sn) ** 0.32, sn) * off, z + math.copysign(abs(cs) ** 0.32, cs) * off))


def noise1(x, seed):
    return math.sin(x * 2.1 + seed) * 0.5 + math.sin(x * 5.3 + seed * 2.1) * 0.3 + math.sin(x * 11.7 + seed * 0.7) * 0.2


def hull():
    """The fuselage on a grid whose rows and columns land exactly on the seams, which are cut into it and darkened."""
    b = Shape()
    stations = {round(mix(XT, XN, i / 320), 4) for i in range(321)}
    GAP = 0.007
    for x in RINGS + [e for p in PANELS for e in p[:2]]:
        stations |= {round(x - GAP, 4), round(x, 4), round(x + GAP, 4)}
    stations = sorted(stations)
    # columns evenly spaced by arc length on the mid-body section, then the seam columns
    dense = [i / 6000 * TAU for i in range(6001)]
    pts = [shell(0.0, a) for a in dense]
    arcs = [0.0]
    for p, q in zip(pts, pts[1:]):
        arcs.append(arcs[-1] + (q - p).length)
    columns, k = [], 0
    for n in range(150):
        want = arcs[-1] * n / 150
        while arcs[k] < want:
            k += 1
        columns.append(dense[k])
    seam_columns = {round(a, 5) for a in LONGS} | {round(e, 5) for p in PANELS for e in p[2:]}
    columns = sorted(set(round(a, 5) for a in columns) | seam_columns)
    ncol = len(columns)
    ring_set = {round(x, 4) for x in RINGS}
    def seam(x, a):
        if round(x, 4) in ring_set and x > XT + 0.05:
            return True
        ra = round(a, 5)
        if ra in {round(v, 5) for v in LONGS} and XT + 0.06 < x < XN - 0.25:
            return True
        for x0, x1, a0, a1 in PANELS:
            lo, hi = sorted((round(a0, 5), round(a1, 5)))
            wide = hi - lo > math.pi  # the panel straddles angle 0
            inside = (ra >= hi or ra <= lo) if wide else lo <= ra <= hi
            if inside and (abs(x - x0) < 1e-3 or abs(x - x1) < 1e-3):
                return True
            if x0 <= x <= x1 and ra in (round(a0, 5), round(a1, 5)):
                return True
        return False
    for x in stations:
        soot = sstep(XT + 1.5, XT, x)
        for a in columns:
            s = seam(x, a)
            wear = 0.94 + 0.05 * noise1(a * 7, 1.3) + 0.03 * noise1(x * 3 + a * 2, 4.1)      # panels vary a little
            under = sstep(-0.1, -0.95, math.sin(a))                                           # the belly stays darker
            k = wear * (1 - 0.12 * under) * (1 - 0.5 * soot * (0.7 + 0.3 * noise1(a * 11, 2.2)))
            k *= 0.4 if s else 1.0
            b.vert(shell(x, a, -0.0035 if s else 0.0), (k, k, k))
    n = len(stations)
    for i in range(n - 1):
        for j in range(ncol):
            p, q = i * ncol + j, i * ncol + (j + 1) % ncol
            b.faces.append((p, q, q + ncol, p + ncol))
    # rivets along the ring seams and the flank seams
    def rivet(p, out):
        e = out.orthogonal().normalized() * 0.006
        o = out.cross(e)  # same length as e, out being a unit vector
        tip = b.vert(p + out * 0.004, (0.8, 0.8, 0.8), tuple(out))
        rim = [b.vert(p + e * math.cos(s / 6 * TAU) + o * math.sin(s / 6 * TAU), (0.55, 0.55, 0.55), tuple(out)) for s in range(6)]
        for s in range(6):
            b.faces.append((rim[s], rim[(s + 1) % 6], tip))
    for x in RINGS:
        for side in (-0.02, 0.02):
            for q in range(44):
                a = columns[q * ncol // 44]
                p = shell(x + side, a)
                rivet(p, (shell(x + side, a, 0.01) - p).normalized())
    for a in LONGS:
        for q in range(120):
            x = mix(XT + 0.3, XN - 0.5, q / 119)
            p = shell(x, a + 0.012)
            rivet(p, (shell(x, a + 0.012, 0.01) - p).normalized())
    return b


def surface(rootle, tiple, tipte, rootte, thick, side=1, groove=None):
    """A lifting surface from a planform (x, span) with a symmetric aerofoil section, closing to nothing at the tip."""
    b = Shape()
    NS, NC = 28, 22
    chord_at = [((1 - math.cos(math.pi * i / NC)) / 2) for i in range(NC + 1)]      # bunched at the nose and tail
    def section(c):
        return 5 * (0.2969 * math.sqrt(c) - 0.1260 * c - 0.3516 * c ** 2 + 0.2843 * c ** 3 - 0.1036 * c ** 4)
    grid = []
    for j in range(NS + 1):
        v = j / NS
        lex, tex = mix(rootle[0], tiple[0], v), mix(rootte[0], tipte[0], v)
        s = mix(rootle[1], tiple[1], v)
        tip = math.sqrt(max(0.0, 1 - sstep(0.96, 1.0, v))) * 0.92 + 0.08     # a rounded tip that stays closed
        rowt, rowb = [], []
        for i, c in enumerate(chord_at):
            x = mix(lex, tex, c)
            h = section(c) * thick * tip * mix(1.0, 0.7, v)
            dark = 0.45 if groove and abs(c - groove) < 0.025 and 0.08 < v < 0.92 else 1.0
            k = dark * (0.96 + 0.04 * noise1(c * 9 + v * 3, 5.1)) * (1 - 0.08 * c)
            rowt.append(b.vert((x, h, s * side), (k, k, k)))
            rowb.append(b.vert((x, -h, s * side), (k * 0.92, k * 0.92, k * 0.92)))
        grid.append((rowt, rowb))
    for j in range(NS):
        for i in range(NC):
            t0, b0 = grid[j]
            t1, b1 = grid[j + 1]
            top = (t0[i], t0[i + 1], t1[i + 1], t1[i])
            bot = (b0[i], b1[i], b1[i + 1], b0[i + 1])
            if side < 0:
                top, bot = top[::-1], bot[::-1]
            b.faces.append(top)
            b.faces.append(bot)
    return b


def wing(side):
    b = surface((0.36, 0), (0.36 - 2.75 * 0.306, 2.75), (0.36 - 2.75 * 0.306 - 0.46, 2.75), (-0.35, 0), 0.042, side, groove=0.72)
    b.lathe([(-0.02, 0.0), (-0.02, 0.16), (0.03, 0.14), (0.03, 0.0)], 40, (0.85, 0.85, 0.85), Vector((0, 1, 0)))  # the pivot
    return b


def fin():
    return surface((0.0, 0), (-0.32, 0.95), (-0.72, 0.95), (-0.48, 0), 0.04, 1, groove=0.68)


def stab(side):
    return surface((0.0, 0), (-0.3, 0.77), (-0.55, 0.77), (-0.5, 0), 0.036, side, groove=0.66)


def booster(side):
    b = Shape()
    body = (1.0, 1.0, 1.0)
    def shade(p):
        scorch = sstep(-1.7, -2.45, p.x)
        return tuple(c * (0.97 + 0.03 * noise1(p.x * 4, 1.1)) * (1 - 0.45 * scorch) for c in body)
    prof = [(-2.45, 0.0), (-2.45, 0.18)]
    for x in (-2.4, -1.4, 1.35, 2.42):                 # raised joint bands
        prof += [(x - 0.018, 0.18), (x - 0.018, 0.184), (x + 0.018, 0.184), (x + 0.018, 0.18)]
    prof += [(2.45, 0.18)]
    for i in range(1, 17):                             # ogive nose
        u = i / 16
        prof.append((2.45 + 0.43 * u, 0.18 * math.sqrt(max(0.0, 1 - u * u))))
    b.lathe(prof, 40, shade)
    b.lathe([(-2.72, 0.15), (-2.62, 0.115), (-2.5, 0.085), (-2.44, 0.1)], 28, lambda p: (0.28, 0.28, 0.28))  # nozzle, outside
    b.lathe([(-2.44, 0.07), (-2.5, 0.075), (-2.62, 0.105), (-2.72, 0.142)], 28, lambda p: (0.06, 0.06, 0.06))  # and in
    b.lathe([(-2.72, 0.142), (-2.72, 0.15)], 28, lambda p: (0.4, 0.4, 0.4))
    # attachment fittings on the side facing the hull, and a cable run along the top
    for x in (1.35, -1.4):
        b.box((x - 0.07, 0.02, -side * 0.235 if side > 0 else 0.1), (x + 0.07, 0.1, -0.1 if side > 0 else 0.235), (0.42, 0.42, 0.42))
    b.box((-2.0, 0.175, -0.018), (2.0, 0.2, 0.018), (0.6, 0.6, 0.6))
    return b


def kicker():
    b = Shape()
    shade = lambda p: tuple([0.9 + 0.08 * noise1(p.x * 5, 3.1)] * 3)
    prof = [(0.0, 0.0), (0.0, 0.31)]
    for x in (-0.03, -0.5, -0.95, -1.4):
        prof += [(x + 0.03, 0.31), (x + 0.03, 0.33 if x == -0.03 else 0.316), (x - 0.03, 0.33 if x == -0.03 else 0.316), (x - 0.03, 0.31)]
    prof += [(-1.45, 0.31), (-1.5, 0.26), (-1.5, 0.16)]
    b.lathe(prof[::-1], 40, shade)                     # low x to high x, so the surface faces outward
    b.lathe([(-1.8, 0.26), (-1.65, 0.19), (-1.45, 0.14)], 32, lambda p: (0.34, 0.34, 0.34))
    b.lathe([(-1.45, 0.11), (-1.65, 0.165), (-1.8, 0.245)], 32, lambda p: (0.05, 0.05, 0.05))
    b.lathe([(-1.8, 0.245), (-1.8, 0.26)], 32, lambda p: (0.45, 0.45, 0.45))
    b.box((-1.35, 0.305, -0.022), (-0.1, 0.335, 0.022), (0.55, 0.55, 0.55))
    return b


# ---------- launch site ----------
OLIVE, STEEL, DARK = srgb(0x4a544d), srgb(0x565b54), srgb(0x25282a)
CONC, SNOW, RUST = srgb(0x8c8980), srgb(0xc9d6df), srgb(0x5b4032)
YEL = srgb(0xb08a1e)


def grimy(base, seed=0, ground=0.0, amount=0.16):
    """Streaks running down from the top, stains rising from the ground: the colour varies, and it depends only on position."""
    def col(p):
        s = 1 - amount * (0.5 + 0.5 * noise1(p.x * 1.7 + p.z * 1.3, seed)) * (0.6 + 0.4 * noise1(p.y * 3.1, seed + 2))
        s *= 1 - 0.28 * sstep(ground + 0.8, ground, p.y)
        return tuple(c * s for c in base)
    return col


def canister():
    b, L, W, H, T = Shape(), 11.8, 2.0, 1.15, 0.06
    skin = grimy(OLIVE, 3, -9, 0.2)
    b.box((-L / 2, H / 2, -W / 2), (L / 2, H / 2 + T, W / 2), skin, 0.25)
    b.box((-L / 2, -H / 2 - T, -W / 2), (L / 2, -H / 2, W / 2), skin, 0.25)
    b.box((-L / 2, -H / 2, W / 2), (L / 2, H / 2, W / 2 + T), skin, 0.25)
    b.box((-L / 2, -H / 2, -W / 2 - T), (L / 2, H / 2, -W / 2), skin, 0.25)
    frame = grimy(srgb(0x3f4943), 5, -9, 0.2)
    x = -L / 2 + 0.3
    while x < L / 2:                                   # hat-section frames all the way along, heavier at the lifting points
        heavy = any(abs(x - h) < 0.45 for h in (-3.4, 3.4))
        d = 0.09 if heavy else 0.045
        w = 0.14 if heavy else 0.07
        b.box((x, H / 2 + T, -W / 2 - T - d), (x + w, H / 2 + T + d, W / 2 + T + d), frame)
        b.box((x, -H / 2 - T - d, -W / 2 - T - d), (x + w, -H / 2 - T, W / 2 + T + d), frame)
        b.box((x, -H / 2 - T, W / 2 + T), (x + w, H / 2 + T, W / 2 + T + d), frame)
        b.box((x, -H / 2 - T, -W / 2 - T - d), (x + w, H / 2 + T, -W / 2 - T), frame)
        x += 0.8
    for y, z in ((H / 2 + T, W / 2 + T), (H / 2 + T, -W / 2 - T), (-H / 2 - T, W / 2 + T), (-H / 2 - T, -W / 2 - T)):   # corner stringers
        b.box((-L / 2, y - 0.05, z - 0.05), (L / 2, y + 0.05, z + 0.05), frame)
    # end frames: a heavy flange at the mouth, a flared one at the rear
    for x0, x1, k in ((L / 2 - 0.18, L / 2, 0.12), (-L / 2, -L / 2 + 0.22, 0.16)):
        b.box((x0, H / 2 + T, -W / 2 - T - k), (x1, H / 2 + T + k, W / 2 + T + k), frame)
        b.box((x0, -H / 2 - T - k, -W / 2 - T - k), (x1, -H / 2 - T, W / 2 + T + k), frame)
        b.box((x0, -H / 2 - T, W / 2 + T), (x1, H / 2 + T, W / 2 + T + k), frame)
        b.box((x0, -H / 2 - T, -W / 2 - T - k), (x1, H / 2 + T, -W / 2 - T), frame)
    # the cover's hinge and latches, a cable tray and lifting lugs along the top, yellow hazard marks at the mouth
    for z in (-0.7, 0.7):
        b.cyl((L / 2 + 0.01, H / 2 + T + 0.04, z - 0.16), (L / 2 + 0.01, H / 2 + T + 0.04, z + 0.16), 0.04, 0.04, 10, STEEL)
    for side in (-1, 1):
        for y in (-0.3, 0.3):
            b.box((L / 2 - 0.3, y - 0.06, side * (W / 2 + T + 0.1)), (L / 2 - 0.05, y + 0.06, side * (W / 2 + T + 0.17)), STEEL)
    b.box((-L / 2 + 0.4, H / 2 + T + 0.03, 0.6), (L / 2 - 0.4, H / 2 + T + 0.11, 0.74), DARK)
    for x in (-3.4, 3.4):
        for z in (-0.72, 0.72):
            b.cyl((x, H / 2 + T + 0.09, z), (x, H / 2 + T + 0.22, z), 0.05, 0.05, 10, DARK)
    for i in range(5):
        z = mix(-0.8, 0.8, i / 4)
        b.box((L / 2 - 0.58, H / 2 + T + 0.002, z - 0.09), (L / 2 - 0.26, H / 2 + T + 0.006, z + 0.09), YEL)
    return b


def launcher():
    """In world x and z, with its base on y = 0 (the film puts it on the apron, y = 6). The canister's own frame is at 18 degrees."""
    b = Shape()
    frame = grimy(STEEL, 7, 0, 0.14)
    ELEV = math.radians(18)
    under = lambda x: (9.4 - 6) + x * math.tan(ELEV) - (0.575 + 0.16) / math.cos(ELEV)   # underside of the canister, at world x
    for z in (-1.35, 1.35):                            # two I-beams and their cross members
        b.box((-7.5, 0.0, z - 0.2), (6.5, 0.07, z + 0.2), frame, 1.0)
        b.box((-7.5, 0.07, z - 0.04), (6.5, 0.53, z + 0.04), frame, 1.0)
        b.box((-7.5, 0.53, z - 0.2), (6.5, 0.6, z + 0.2), frame, 1.0)
    for x in [-7.4 + i * 1.33 for i in range(11)]:
        b.box((x, 0.1, -1.35), (x + 0.14, 0.5, 1.35), frame)
    b.box((-7.5, 0.6, -1.6), (6.5, 0.625, 1.6), grimy(srgb(0x3f423f), 9, 0, 0.1), 0.5)  # deck plate
    for x in (-6.9, 5.9):                              # outriggers on jack pads
        for side in (-1, 1):
            b.box((x - 0.14, 0.2, side * 1.35), (x + 0.14, 0.5, side * 2.5), frame)
            b.cyl((x, 0.5, side * 2.42), (x, 0.08, side * 2.42), 0.09, 0.07, 12, srgb(0x9c9e98))
            b.box((x - 0.35, 0.0, side * 2.42 - 0.35), (x + 0.35, 0.08, side * 2.42 + 0.35), DARK)
    # rear trunnion with its brackets, and the cradle the canister rests on
    b.cyl((-4.2, 1.4, -1.5), (-4.2, 1.4, 1.5), 0.2, 0.2, 18, srgb(0x8b8e88))
    for z in (-1.15, 1.15):
        b.face((-5.1, 0.625, z - 0.1), (-3.3, 0.625, z - 0.1), (-3.95, 1.55, z - 0.1), (-4.45, 1.55, z - 0.1), frame)
        b.face((-3.3, 0.625, z + 0.1), (-5.1, 0.625, z + 0.1), (-4.45, 1.55, z + 0.1), (-3.95, 1.55, z + 0.1), frame)
        b.box((-4.45, 1.55, z - 0.1), (-3.95, 1.62, z + 0.1), frame)
        b.face((-3.3, 0.625, z - 0.1), (-3.3, 0.625, z + 0.1), (-3.95, 1.55, z + 0.1), (-3.95, 1.55, z - 0.1), frame)
        b.face((-5.1, 0.625, z + 0.1), (-5.1, 0.625, z - 0.1), (-4.45, 1.55, z - 0.1), (-4.45, 1.55, z + 0.1), frame)
        b.beam((-4.2, under(-4.2) + 0.02, z), (5.0, under(5.0) + 0.02, z), 0.22, 0.22, frame)     # cradle rail under the canister
    for x in (-3.0, -0.8, 1.4, 3.6):
        b.beam((x, under(x), -1.15), (x, under(x), 1.15), 0.14, 0.14, frame)
    # two elevating rams, chrome rod out of a dark cylinder, each with a brace
    for z in (-1.1, 1.1):
        foot, head = Vector((1.1, 0.8, z)), Vector((3.6, under(3.6) - 0.03, z))
        mid = foot.lerp(head, 0.52)
        b.cyl(foot, mid, 0.14, 0.14, 16, srgb(0x2f3330))
        b.cyl(mid, head, 0.075, 0.075, 12, srgb(0xc4c7c4))
        b.box((0.75, 0.625, z - 0.16), (1.45, 0.82, z + 0.16), frame)
        b.beam((5.2, 0.625, z), (3.6, under(3.6) - 0.02, z), 0.14, 0.14, frame)
        b.beam((3.5, 0.625, z), (3.6, under(3.6) - 0.02, z), 0.18, 0.18, frame)
    b.beam((3.6, 1.8, -1.1), (3.6, 1.8, 1.1), 0.1, 0.1, frame)
    b.beam((3.6, 1.8, -1.1), (3.6, under(3.6) - 0.05, 1.1), 0.07, 0.07, frame)
    b.beam((3.6, 1.8, 1.1), (3.6, under(3.6) - 0.05, -1.1), 0.07, 0.07, frame)
    # walkway railing, a ladder, a control cabinet, a hydraulic unit with its hoses and a cable drum
    rail = srgb(0xa89030)
    for z in (-1.58, 1.58):
        for x in [-7.2 + i * 1.5 for i in range(10)]:
            b.cyl((x, 0.625, z), (x, 1.65, z), 0.025, 0.025, 6, rail, caps=False)
        for y in (1.15, 1.65):
            b.cyl((-7.2, y, z), (6.3, y, z), 0.022, 0.022, 6, rail, caps=False)
    b.box((-6.6, 0.625, -1.45), (-5.7, 2.1, -0.75), srgb(0x5a625c))
    b.box((-6.62, 1.2, -1.32), (-6.6, 1.9, -0.88), DARK)
    b.box((-2.8, 0.625, 0.55), (-1.4, 1.5, 1.45), srgb(0x4e5550))
    for i, (x, y) in enumerate(((-2.6, 1.5), (-2.2, 1.5), (-1.8, 1.5))):
        b.cyl((x, y, 1.0), (x, y + 0.28, 1.0), 0.09, 0.09, 12, srgb(0x6a6e68))
    b.cyl((-1.4, 1.2, 0.8), (0.9, 1.0, 1.05), 0.03, 0.03, 8, DARK)
    b.cyl((-1.4, 1.1, 1.2), (0.9, 0.95, 1.15), 0.03, 0.03, 8, DARK)
    return b


def corrugated(b, x0, x1, y0, y1, z, color, pitch=0.44):
    x = x0
    sign = 1 if z >= 0 else -1
    b.box((x0, y0, z - 0.03), (x1, y1, z + 0.03), color, 1.0)
    while x < x1 - 0.05:
        b.box((x, y0, z + sign * 0.03), (x + 0.11, y1, z + sign * 0.075), color)
        x += pitch


def shelter():
    """The roll-back shelter: open at +x, centred on x and z, on bogies riding the rails."""
    b = Shape()
    W, H, L = 9.0, 7.0, 18.0
    wall = grimy(srgb(0x606b70), 13, 0, 0.2)
    frame = grimy(srgb(0x444a4c), 14, 0, 0.14)
    for side in (-1, 1):
        corrugated(b, -L / 2, L / 2, 0.6, H, side * W / 2, wall)
        for x in [-L / 2 + i * L / 6 for i in range(7)]:                  # portal frames
            z0, z1 = sorted((side * (W / 2 - 0.3), side * (W / 2 - 0.02)))
            b.box((x - 0.14, 0.45, z0), (x + 0.14, H + 0.08, z1), frame)
            b.beam((x, H - 0.06, -W / 2), (x, H - 0.06, W / 2), 0.26, 0.26, frame)
        b.box((-L / 2, 0.42, side * W / 2 - 0.15), (L / 2, 0.62, side * W / 2 + 0.15), frame)   # sole beam
        for x in (-L / 2 + 1.4, -L / 2 + 5.0, L / 2 - 5.0, L / 2 - 1.4):  # bogie and wheels on the rail at z = +-3.2
            rail = side * 3.2
            b.box((x - 0.8, 0.25, rail - 0.18), (x + 0.8, 0.5, rail + 0.18), DARK)
            b.beam((x - 0.5, 0.42, rail), (x - 0.5, 0.42, side * (W / 2 - 0.05)), 0.2, 0.14, frame)
            b.beam((x + 0.5, 0.42, rail), (x + 0.5, 0.42, side * (W / 2 - 0.05)), 0.2, 0.14, frame)
            for dx in (-0.5, 0.5):
                b.cyl((x + dx, 0.2, rail - 0.1), (x + dx, 0.2, rail + 0.1), 0.17, 0.17, 16, srgb(0x33363a))
    # roof, back wall with a door, snow lying on the roof, an awning over the open front
    b.box((-L / 2 - 0.2, H + 0.08, -W / 2 - 0.25), (L / 2 + 0.2, H + 0.2, W / 2 + 0.25), wall, 1.0)
    b.box((-L / 2, 0.6, -W / 2), (-L / 2 + 0.2, H, W / 2), wall, 1.0)
    b.box((-L / 2 - 0.02, 0.62, 1.2), (-L / 2 + 0.02, 2.8, 2.5), DARK)
    b.box((L / 2 - 0.3, H - 0.8, -W / 2 - 0.1), (L / 2 + 0.05, H + 0.08, W / 2 + 0.1), wall, 1.0)
    nx, nz = 54, 28
    grid = []
    for j in range(nz + 1):
        row = []
        for i in range(nx + 1):
            x, z = mix(-L / 2 - 0.05, L / 2 + 0.05, i / nx), mix(-W / 2 - 0.1, W / 2 + 0.1, j / nz)
            edge = min(i, nx - i, j, nz - j) / 4
            d = (0.09 + 0.05 * noise1(x * 0.8, 1.4) + 0.05 * noise1(z * 1.1 + x * 0.2, 7.1)) * min(1.0, edge)
            row.append(b.vert((x, H + 0.2 + d, z), SNOW))
        grid.append(row)
    for j in range(nz):
        for i in range(nx):
            b.faces.append((grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]))
    return b


def rails():
    b = Shape()
    steel = srgb(0x6a6d6a)
    for z in (-3.2, 3.2):
        b.box((-50, 0.0, z - 0.09), (10, 0.02, z + 0.09), DARK, 2.0)
        b.box((-50, 0.02, z - 0.02), (10, 0.12, z + 0.02), steel, 2.0)
        b.box((-50, 0.12, z - 0.04), (10, 0.15, z + 0.04), srgb(0xa0a3a0), 2.0)
    x = -49.5
    while x < 10:                                      # sleepers
        b.box((x, 0.0, -3.5), (x + 0.26, 0.03, -2.9), CONC)
        b.box((x, 0.0, 2.9), (x + 0.26, 0.03, 3.5), CONC)
        x += 1.1
    return b


def blast_wall():
    """A row of precast T-wall segments along z, centred on x = z = 0, base on y = 0."""
    b = Shape()
    for i in range(9):
        z0 = -13 + i * 26 / 9
        z1 = z0 + 26 / 9 - 0.05
        c = grimy(tuple(v * (0.92 + 0.1 * ((i * 7) % 3) / 2) for v in CONC), 20 + i, 0, 0.2)
        b.box((-0.2, 0.3, z0), (0.2, 4.0, z1), c, 0.45)
        b.box((-1.0, 0.0, z0), (1.0, 0.3, z1), c, 0.45)
        b.face((-0.2, 0.3, z1), (0.2, 0.3, z1), (0.2, 0.3, z0), (-0.2, 0.3, z0), c)
        for side in (-1, 1):                           # lifting eyes
            zm = (z0 + z1) / 2 + side * 0.7
            b.lathe([(0, 0.03), (0.12, 0.03), (0.12, 0.001)], 8, RUST, Vector((0, 1, 0)), Vector((0, 4.0, zm)))
        b.box((-0.205, 0.3, z0), (0.205, 0.5, z1), srgb(0x5d5c56))   # damp at the foot
    # snow driven against the sea side
    grid = []
    nz, nx = 60, 6
    for j in range(nz + 1):
        z = mix(-13, 13, j / nz)
        row = []
        for i in range(nx + 1):
            u = i / nx
            h = (0.55 + 0.3 * noise1(z * 0.7, 3.3)) * (1 - u) ** 1.4
            row.append(b.vert((1.0 - 0.8 * (1 - u) + u * 2.6 * (0.8 + 0.3 * noise1(z * 0.4, 8)), 0.28 + h, z), SNOW))
        grid.append(row)
    for j in range(nz):
        for i in range(nx):
            b.faces.append((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    return b


def building(w, h, d, base, seed):
    """A steel-clad industrial shed, w along x, d along z, centred on x and z, floor on y = 0."""
    b = Shape()
    clad = grimy(base, seed, 0, 0.22)
    trim = srgb(0x3d3f3c)
    b.box((-w / 2, 0, -d / 2), (w / 2, 0.45, d / 2), grimy(CONC, seed + 1, 0, 0.1), 1.0)
    b.box((-w / 2 + 0.05, 0.45, -d / 2 + 0.05), (w / 2 - 0.05, h, d / 2 - 0.05), clad, 0.6)
    for side in (-1, 1):
        x = -w / 2 + 0.1
        while x < w / 2:                               # vertical cladding ribs
            z0, z1 = sorted((side * (d / 2 - 0.05), side * (d / 2 - 0.05 + 0.025)))
            b.box((x, 0.45, z0), (x + 0.05, h, z1), clad)
            x += 0.6
    b.box((-w / 2 - 0.15, h, -d / 2 - 0.15), (w / 2 + 0.15, h + 0.22, d / 2 + 0.15), trim, 1.0)        # roof edge
    b.box((-w / 2 + 0.2, h + 0.22, -d / 2 + 0.2), (w / 2 - 0.2, h + 0.3, d / 2 - 0.2), SNOW, 1.0)      # snow
    # a roller door and a personnel door on the +x end, vents and a stack on the roof, a pipe run down one side
    rd = min(d * 0.5, 4.2)
    b.box((w / 2 - 0.05, 0.45, -rd / 2), (w / 2 + 0.03, min(h - 0.8, 3.7), rd / 2), srgb(0x6f7476), 0.3)
    for y in [0.45 + i * 0.28 for i in range(int((min(h - 0.8, 3.7) - 0.45) / 0.28))]:
        b.box((w / 2 + 0.03, y, -rd / 2), (w / 2 + 0.05, y + 0.04, rd / 2), srgb(0x4a4e50))
    b.box((w / 2 - 0.05, 0.45, rd / 2 + 0.5), (w / 2 + 0.03, 2.5, rd / 2 + 1.4), DARK)
    b.box((w / 2 + 0.03, 2.7, rd / 2 + 0.3), (w / 2 + 0.5, 2.8, rd / 2 + 1.6), trim)
    for i in range(3):
        x = mix(-w / 2 + 1.5, w / 2 - 1.5, i / 2)
        b.box((x - 0.35, h + 0.3, -0.35), (x + 0.35, h + 0.8, 0.35), srgb(0x6a6e6e))
        b.box((x - 0.45, h + 0.8, -0.45), (x + 0.45, h + 0.9, 0.45), trim)
    b.cyl((-w / 2 + 1, h + 0.2, d / 2 - 1), (-w / 2 + 1, h + 2.8, d / 2 - 1), 0.16, 0.13, 12, RUST)
    b.cyl((-w / 2 - 0.25, 0.8, d / 2 + 0.2), (w / 2 + 0.25, 0.8, d / 2 + 0.2), 0.08, 0.08, 10, srgb(0x777a74))
    return b


def mast():
    """A 22 m triangular lattice light mast with a lamp head; base on y = 0."""
    b = Shape()
    steel = srgb(0x72766f)
    H, R = 22.0, 0.34
    leg = [Vector((math.cos(a) * R, 0, math.sin(a) * R)) for a in (0, TAU / 3, 2 * TAU / 3)]
    taper = lambda p, y: Vector((p.x * mix(1, 0.5, y / H), y, p.z * mix(1, 0.5, y / H)))
    for p in leg:
        b.cyl(taper(p, 0), taper(p, H), 0.035, 0.024, 6, steel, caps=False)
    y, step, flip = 0.0, 1.1, 0
    while y < H - 0.1:
        for k in range(3):
            p, q = leg[k], leg[(k + 1) % 3]
            b.cyl(taper(p, y), taper(q, y), 0.012, 0.012, 4, steel, caps=False)
            a, c = (p, q) if flip % 2 else (q, p)
            b.cyl(taper(a, y), taper(c, y + step), 0.011, 0.011, 4, steel, caps=False)
        y += step
        flip += 1
    b.box((-0.75, 0.0, -0.75), (0.75, 0.45, 0.75), grimy(CONC, 31, 0, 0.1))
    # the head: a platform with a rail and a bank of four floodlights
    b.box((-0.8, H, -0.5), (0.8, H + 0.06, 0.5), steel)
    for x in (-0.55, -0.18, 0.18, 0.55):
        b.cyl((x, H + 0.06, 0.05), (x, H + 0.45, 0.05), 0.02, 0.02, 5, steel, caps=False)
        b.box((x - 0.15, H + 0.42, -0.06), (x + 0.15, H + 0.72, 0.08), DARK)
        b.box((x - 0.12, H + 0.44, -0.07), (x + 0.12, H + 0.7, -0.058), srgb(0xd8d8c8))
    return b


def container():
    """A 20 ft ISO container, long way along x, centred on x and z, floor on y = 0."""
    b = Shape()
    L, H, W = 6.06, 2.59, 2.44
    c = grimy(srgb(0x4f5e55), 41, 0, 0.26)
    frame = grimy(srgb(0x3a463f), 42, 0, 0.18)
    b.box((-L / 2 + 0.06, 0.05, -W / 2 + 0.02), (L / 2 - 0.06, H - 0.05, W / 2 - 0.02), c, 0.6)
    for side in (-1, 1):
        x = -L / 2 + 0.15
        while x < L / 2 - 0.2:
            z0, z1 = sorted((side * (W / 2 - 0.02), side * (W / 2 + 0.015)))
            b.box((x, 0.12, z0), (x + 0.12, H - 0.12, z1), c)
            x += 0.28
    for x0, x1 in ((-L / 2, -L / 2 + 0.1), (L / 2 - 0.1, L / 2)):
        for z in (-W / 2, W / 2 - 0.1):
            b.box((x0, 0, z), (x1, H, z + 0.1), frame)
    for z0, z1 in ((-W / 2, -W / 2 + 0.08), (W / 2 - 0.08, W / 2)):
        b.box((-L / 2, 0, z0), (L / 2, 0.12, z1), frame)
        b.box((-L / 2, H - 0.1, z0), (L / 2, H, z1), frame)
    for z in (-0.5, 0.5):                              # door bars on the +x end
        b.cyl((L / 2 + 0.03, 0.15, z), (L / 2 + 0.03, H - 0.15, z), 0.018, 0.018, 6, srgb(0xa0a5a0), caps=False)
    b.box((-L / 2 + 0.3, H - 0.02, -W / 2 + 0.2), (L / 2 - 0.3, H + 0.1, W / 2 - 0.2), SNOW, 0.6)
    return b


def drums():
    b, r = Shape(), random.Random(9)
    for i in range(9):
        x, z = (i % 3) * 0.72 + r.uniform(-0.05, 0.05), (i // 3) * 0.72 + r.uniform(-0.05, 0.05)
        c = grimy(srgb(r.choice((0x47545a, 0x5a4a34, 0x4a5240))), 50 + i, 0, 0.25)
        prof = [(0, 0.0), (0, 0.29), (0.02, 0.3), (0.3, 0.29), (0.31, 0.3), (0.32, 0.29), (0.6, 0.29), (0.61, 0.3), (0.62, 0.29), (0.86, 0.29), (0.88, 0.3), (0.89, 0.0)]
        b.lathe(prof, 16, c, Vector((0, 1, 0)), Vector((x, 0, z)))
    return b


def barrier():
    """A precast traffic barrier, 3 m along x, centred, on y = 0."""
    b = Shape()
    c = grimy(CONC, 61, 0, 0.2)
    s = [(0.3, 0.0), (0.3, 0.08), (0.11, 0.3), (0.08, 0.82), (-0.08, 0.82), (-0.11, 0.3), (-0.3, 0.08), (-0.3, 0.0)]
    for (z0, y0), (z1, y1) in zip(s, s[1:]):
        b.face((1.5, y0, z0), (1.5, y1, z1), (-1.5, y1, z1), (-1.5, y0, z0), c, 0.3)
    for x, sign in ((1.5, 1), (-1.5, -1)):
        p = [(x, y, z) for z, y in s]
        c0 = Vector((x, 0.35, 0))
        for q, w in zip(p, p[1:]):
            if sign > 0:
                b.face(w, q, c0, c0, c)
            else:
                b.face(q, w, c0, c0, c)
    return b


def rock(seed):
    """A unit rock: a subdivided icosahedron pushed about by a few directions' worth of noise, with a flattish base."""
    r, b = random.Random(seed), Build()
    g = (1 + math.sqrt(5)) / 2
    verts = [Vector(v).normalized() for v in ((-1, g, 0), (1, g, 0), (-1, -g, 0), (1, -g, 0), (0, -1, g), (0, 1, g), (0, -1, -g), (0, 1, -g), (g, 0, -1), (g, 0, 1), (-g, 0, -1), (-g, 0, 1))]
    faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
             (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(2):
        cache, out = {}, []
        def midpoint(i, j):
            key = (min(i, j), max(i, j))
            if key not in cache:
                cache[key] = len(verts)
                verts.append((verts[i] + verts[j]).normalized())
            return cache[key]
        for a, c, d in faces:
            ab, cd, da = midpoint(a, c), midpoint(c, d), midpoint(d, a)
            out += [(a, ab, da), (c, cd, ab), (d, da, cd), (ab, cd, da)]
        faces = out
    # cut planes give flat fractured faces; what they leave is the rock
    planes = [(Vector((r.gauss(0, 1), r.gauss(0, 1) * 0.7, r.gauss(0, 1))).normalized(), r.uniform(0.55, 0.92)) for _ in range(11)]
    tone = r.uniform(0.85, 1.15)
    for v in verts:
        p = v.copy()
        for n, d in planes:
            h = p.dot(n)
            if h > d:
                p -= n * (h - d)
        p.y = max(p.y, -0.42)
        lichen = sstep(0.55, 0.95, noise1(p.x * 3 + p.z * 2, seed) + 0.4 * noise1(p.y * 5, seed + 1)) * sstep(0.0, 0.5, p.y)
        strata = 0.88 + 0.12 * math.sin(p.y * 22 + p.x * 3 + seed)
        col = tuple(c * strata * tone for c in srgb(0x6e7276))
        col = tuple(mix(c, l, lichen * 0.55) for c, l in zip(col, srgb(0x5d5a36)))
        b.vert(p, col)
    b.faces = [tuple(f) for f in faces]
    return b


# ---------- Blender ----------
def z_up(b):
    b.verts = [(x, -z, y) for x, y, z in b.verts]
    b.normals = [None if n is None else (n[0], -n[2], n[1]) for n in b.normals]
    return b


def main():
    ground, material = setup()
    # name, mesh, AO distance, AO floor, whether the ground plane occludes
    parts = [
        ("skin", hull(), 0.12, 0.3, False), ("wing_R", wing(1), 0.2, 0.55, False), ("wing_L", wing(-1), 0.2, 0.55, False),
        ("fin", fin(), 0.2, 0.55, False), ("stab_R", stab(1), 0.2, 0.55, False), ("stab_L", stab(-1), 0.2, 0.55, False),
        ("kicker", kicker(), 0.2, 0.4, False), ("booster_R", booster(1), 0.15, 0.4, False), ("booster_L", booster(-1), 0.15, 0.4, False),
        ("canister", canister(), 0.5, 0.25, False), ("launcher", launcher(), 1.4, 0.28, True), ("shelter", shelter(), 3.0, 0.2, True),
        ("rails", rails(), 0.3, 0.4, True), ("wall", blast_wall(), 1.5, 0.3, True), ("building_a", building(14, 6, 10, srgb(0x8a8574), 71), 1.5, 0.3, True),
        ("building_b", building(8, 4, 8, srgb(0x6f6c60), 72), 1.5, 0.3, True), ("mast", mast(), 0.5, 0.45, True), ("container", container(), 0.5, 0.3, True),
        ("drums", drums(), 0.4, 0.3, True), ("barrier", barrier(), 0.4, 0.35, True),
    ] + [(f"rock_{n}", rock(200 + n), 0.8, 0.35, True) for n in range(4)]
    objects = []
    for name, b, distance, floor, on_ground in parts:
        obj = to_object(name, z_up(b), None)
        ground.hide_render = not on_ground
        mean = bake(obj, b, distance, floor, material)
        obj.hide_render = True
        objects.append(obj)
        print(f"{name}: {len(b.verts)} verts, {sum(len(f) - 2 for f in b.faces)} tris, mean AO {mean:.2f}", flush=True)
    export(objects, OUT)


main()
