"""Trees and maize for the Razorbill film: procedural meshes, ambient occlusion baked in Cycles, exported as one GLB.

    npm run blender -- vegetation.py    # -> site/public/models/vegetation.glb

Everything is seeded, so a run gives the same plants. Metres, built Z-up in Blender, Y-up in the GLB. All colour is
in the vertices (linear RGB, AO already multiplied in), so the film needs no textures and no alpha testing. Nodes:
    crop_hero_N   maize for the few metres round the rod, where the camera sits in the furrow
    crop_field_N  the same plants with far fewer triangles, for the rest of the field
    tree_N        hedge trees, 10 m tall (the film scales them)
    tree_far_N    the same trees for the distant ones
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).parent))
from kit import Build, ROOT, UP, bake, export, mix, mix3, setup, sstep, to_object

OUT = ROOT / "site" / "public" / "models" / "vegetation.glb"
CROP_HEIGHT = 0.95  # the top of the rod's shaft once it stands in the soil


# ---------- maize ----------
LEAF_BASE, LEAF_GREEN, LEAF_DARK = (0.14, 0.24, 0.05), (0.045, 0.15, 0.02), (0.028, 0.095, 0.014)


def maize_leaf(b, r, az, height, length, width, bend, age, segs, fold):
    """One strap leaf: climbs from the stem, arches over and droops; `fold` adds the midrib crease and rippled margin."""
    tone, phase = mix(0.85, 1.15, r.random()), r.random() * 6.28
    curl, angle, p = (r.random() - 0.5) * 0.7, 0.18 + 0.2 * r.random(), Vector((0, 0, height))
    step, rows = length / segs, []
    for s in range(segs + 1):
        u = s / segs
        heading = az + curl * u
        out, side = Vector((math.cos(heading), math.sin(heading), 0)), Vector((-math.sin(heading), math.cos(heading), 0))
        t = out * math.sin(angle) + UP * math.cos(angle)
        n = side.cross(t).normalized()
        if n.z < 0:
            n = -n
        w = width * max(0.02, math.sin(math.pi * min(1.0, 0.1 + 0.92 * u ** 0.8)) ** 0.7)
        ripple = 0.16 * w * math.sin(u * 15 + phase) * sstep(0.2, 0.7, u) if fold else 0.0
        c = mix3(LEAF_BASE, LEAF_GREEN, sstep(0.0, 0.3, u))
        c = mix3(c, LEAF_DARK, sstep(0.55, 1.0, u) * 0.7)
        c = mix3(c, (0.2, 0.2, 0.05), age * sstep(0.72, 1.0, u)) # the oldest leaves yellow at the tip
        c = tuple(x * tone for x in c)
        left = b.vert(p + side * w + n * (0.22 * w + ripple), c)
        right = b.vert(p - side * w + n * (0.22 * w - ripple), c)
        if fold:
            mid = b.vert(p, tuple(x * 1.55 for x in c)) # the pale midrib, sitting in the crease
            rows.append((left, mid, right, n))
        else:
            rows.append((left, right, n))
        p = p + t * step
        angle += bend * mix(1.5, 0.75, u) / segs
    for ra, rb in zip(rows, rows[1:]):
        for k in range(len(ra) - 2):
            b.quad(ra[k], ra[k + 1], rb[k + 1], rb[k], ra[-1])


def maize(seed, hero):
    """A stem with leaves up its length, as tall as the rod planted in the field; narrow enough to leave the furrows open."""
    r, b = random.Random(seed), Build()
    leaves, az = 11 if hero else 8, r.random() * 6.28
    for i in range(leaves):
        v = i / (leaves - 1)  # 0 = oldest, lowest; 1 = youngest, the upright top
        maize_leaf(b, r, az + i * math.pi + (r.random() - 0.5) * 0.9, mix(0.07, 0.68, v), mix(0.62, 0.42, abs(v - 0.4) * 1.6) * mix(0.9, 1.1, r.random()),
                   mix(0.026, 0.033, r.random()) * (1.0 if hero else 1.8), mix(2.0, 0.9, v) * mix(0.85, 1.15, r.random()), mix(0.75, 0.0, v * 2.2) if v < 0.45 else 0.0,
                   6 if hero else 2, hero)
    heights = (-0.01, 0.25, 0.5, 0.74) if hero else (-0.01, 0.74)
    stem = [Vector((0, 0, h)) for h in heights]
    b.tube(stem, [mix(0.014, 0.006, max(h, 0) / 0.74) for h in heights], 6 if hero else 3, lambda s, i: (0.075, 0.15, 0.035))
    # keep the furrow from closing over completely, and bring the tallest point to CROP_HEIGHT
    reach = max(math.hypot(v[0], v[1]) for v in b.verts)
    across, up = min(1.0, 0.27 / reach), CROP_HEIGHT / max(v[2] for v in b.verts)
    b.verts = [(v[0] * across, v[1] * across, v[2] * up) for v in b.verts]
    return b


# ---------- trees ----------
SPECIES = [
    # broad crown; ash-like oval; irregular field maple
    dict(seed=51, crown=(4.8, 3.5), trunk=2.9, lean=0.1, spread=(38, 62), rise=0.05, kids=4, green=(0.07, 0.165, 0.03)),
    dict(seed=52, crown=(3.0, 4.2), trunk=1.9, lean=0.06, spread=(22, 42), rise=0.28, kids=3, green=(0.065, 0.185, 0.04)),
    dict(seed=53, crown=(3.9, 3.8), trunk=2.3, lean=0.16, spread=(32, 58), rise=0.14, kids=4, green=(0.085, 0.175, 0.03)),
]
BARK = (0.055, 0.04, 0.03)


def tree(spec, far):
    r, b = random.Random(spec["seed"]), Build()
    rxy, rz = spec["crown"]
    centre = Vector((0, 0, spec["trunk"] + rz * 0.92))
    bark = lambda s, i: tuple(x * (0.72 + 0.56 * ((s * 7 + i * 3) % 5) / 4) for x in BARK)
    clumps, levels = [], 3

    def branch(p, d, length, rad, level):
        segs = 4 if level == 0 else 3
        points, radii, end = [p], [rad], rad * (0.72 if level == 0 else 0.5)
        for s in range(segs):
            jitter = Vector((r.random() - 0.5, r.random() - 0.5, r.random() - 0.5))
            d = (d + jitter * (0.1 if level == 0 else 0.34) + UP * spec["rise"] * 0.5).normalized()
            points.append(points[-1] + d * length / segs)
            radii.append(mix(rad, end, (s + 1) / segs))
        if not far or level < 2:
            b.tube(points, radii, (8 if level == 0 else 5 if level == 1 else 3) if not far else 3, bark)
        if level == levels:
            clumps.append(points[-1])
            clumps.append(points[-2])
            return
        count = spec["kids"] if level else spec["kids"] + 2
        turn = r.random() * 6.28
        for k in range(count):
            turn += 2.4 + r.random() * 0.5
            at = 1.0 if level == 0 else mix(0.5, 1.0, (k + 1) / count)
            start = points[min(segs, round(at * segs))]
            side = d.orthogonal().normalized()
            side.rotate(Quaternion(d, turn))
            a = math.radians(mix(*spec["spread"], r.random()))
            kid = (d * math.cos(a) + side * math.sin(a)).normalized()
            # reach about to the crown's edge, wherever that lies in this direction
            q = start - centre
            scale = Vector((kid.x / rxy, kid.y / rxy, kid.z / rz))
            pos = Vector((q.x / rxy, q.y / rxy, q.z / rz))
            aa, bb, cc = scale.dot(scale), 2 * pos.dot(scale), pos.dot(pos) - 1
            room = (-bb + math.sqrt(max(0.0, bb * bb - 4 * aa * cc))) / (2 * aa)
            share = {0: 0.52, 1: 0.62, 2: 1.0}[level]
            branch(start, kid, max(0.35, room * share * mix(0.72, 0.98, r.random())), max(0.012, end * 0.68), level + 1)

    branch(Vector((0, 0, -0.2)), (UP + Vector((r.random() - 0.5, r.random() - 0.5, 0)) * spec["lean"]).normalized(), spec["trunk"] + 0.2, 0.2, 0)

    total, size = (420, 1.25) if far else (5600, 0.44)
    per, green = max(4, total // len(clumps)), spec["green"]
    for index, c in enumerate(clumps):
        tone = mix(0.82, 1.2, r.random())
        hue = r.random() * 0.25
        rc = mix(0.78, 1.25, r.random())
        if not far or index % 3 == 0:
            q = c - centre
            outer = Vector((q.x / rxy ** 2, q.y / rxy ** 2, q.z / rz ** 2)).normalized()
            core = tuple(x * tone * 0.5 for x in green)
            b.blob(c, (rc * (0.95 if far else 0.72), rc * (0.8 if far else 0.6)), r, core, lambda d, o=outer: tuple((d * 0.55 + o * 0.65 + UP * 0.18).normalized()))
        for _ in range(per):
            v = Vector((r.gauss(0, 1), r.gauss(0, 1), r.gauss(0, 1))).normalized()
            if v.z < 0:
                v.z *= 0.55 # clumps are flatter underneath
            p = c + v * rc * mix(0.48, 1.0, r.random() ** 0.5)
            q = p - centre
            outer = Vector((q.x / rxy ** 2, q.y / rxy ** 2, q.z / rz ** 2)).normalized()
            # a soft field over the crown rather than each leaf's own normal: clumps read as volumes, not as noise
            shade = (v * 0.55 + outer * 0.65 + UP * 0.18).normalized()
            n = (shade * 1.1 + Vector((r.gauss(0, 1), r.gauss(0, 1), r.gauss(0, 1))) * 0.42).normalized()
            along = n.orthogonal().normalized()
            along.rotate(Quaternion(n, r.random() * 6.28))
            across = n.cross(along)
            s = size * mix(0.75, 1.2, r.random())
            sun = mix(0.72, 1.28, sstep(-0.3, 0.8, q.z / rz))
            leaf = tuple(x * tone * sun * mix(0.85, 1.15, r.random()) for x in mix3(green, (0.095, 0.13, 0.022), hue))
            i0 = b.vert(p - along * s * 0.5, leaf, shade)
            i1 = b.vert(p + across * s * 0.3 - n * s * 0.06, leaf, shade)
            i2 = b.vert(p + along * s * 0.5, leaf, shade)
            i3 = b.vert(p - across * s * 0.3 - n * s * 0.06, leaf, shade)
            b.quad(i0, i1, i2, i3, n)
    b.fit(10.0 / max(v[2] for v in b.verts))
    return b


# ---------- Blender: AO bake, export ----------
def main():
    _, material = setup()
    parts = []
    for n in range(3):
        parts.append((f"crop_hero_{n}", maize(100 + n, True), 0.55, 0.4, 0.38))
        parts.append((f"crop_field_{n}", maize(100 + n, False), 0.55, 0.4, 0.38))
        parts.append((f"tree_{n}", tree(SPECIES[n], False), None, 3.0, 0.22))
        parts.append((f"tree_far_{n}", tree(SPECIES[n], True), None, 3.5, 0.3))
    objects = []
    for name, b, soften, distance, floor in parts:
        obj = to_object(name, b, soften)
        mean = bake(obj, b, distance, floor, material)
        obj.hide_render = True # they all stand at the origin: keep this one out of the next one's bake
        objects.append(obj)
        print(f"{name}: {len(b.verts)} verts, {sum(len(f) - 2 for f in b.faces)} tris, mean AO {mean:.2f}", flush=True)
    export(objects, OUT)


main()
