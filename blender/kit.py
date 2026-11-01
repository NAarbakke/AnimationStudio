"""What the procedural model scripts share: a mesh builder, the AO bake into vertex colours, and the GLB export."""
from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
UP = Vector((0, 0, 1))


def mix(a, b, u):
    return a + (b - a) * u


def mix3(a, b, u):
    return tuple(mix(x, y, u) for x, y in zip(a, b))


def sstep(a, b, x):
    u = min(1.0, max(0.0, (x - a) / (b - a)))
    return u * u * (3 - 2 * u)


class Build:
    """Vertices, faces, and a colour and an optional shading normal per vertex."""

    def __init__(self):
        self.verts, self.faces, self.colors, self.normals = [], [], [], []

    def vert(self, p, color, normal=None):
        self.verts.append(tuple(p))
        self.colors.append(color)
        self.normals.append(normal)
        return len(self.verts) - 1

    def quad(self, a, b, c, d, facing=None):
        """Winding follows `facing`, so the side that faces it is the front face in the film's double-sided material."""
        if facing is not None:
            n = (Vector(self.verts[b]) - Vector(self.verts[a])).cross(Vector(self.verts[d]) - Vector(self.verts[a]))
            if n.dot(facing) < 0:
                a, b, c, d = a, d, c, b
        self.faces.append((a, b, c, d))

    def tube(self, points, radii, sides, color):
        """A tapered tube along a polyline, using a transported frame so it does not twist."""
        side = points[1] - points[0]
        side = (side.orthogonal() if side.length else Vector((1, 0, 0))).normalized()
        rings = []
        for i, p in enumerate(points):
            t = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
            side = (side - t * side.dot(t)).normalized()
            other = t.cross(side)
            ring = []
            for s in range(sides):
                a = 2 * math.pi * s / sides
                n = side * math.cos(a) + other * math.sin(a)
                ring.append(self.vert(p + n * radii[i], color(s, i), n))
            rings.append(ring)
        for ra, rb in zip(rings, rings[1:]):
            for s in range(sides):
                self.quad(ra[s], ra[(s + 1) % sides], rb[(s + 1) % sides], rb[s])

    def blob(self, centre, radii, jitter, color, normal):
        """A low icosahedron: the dark mass inside a leaf clump, which stops the sky showing through the crown."""
        g = (1 + math.sqrt(5)) / 2
        ico = [(-1, g, 0), (1, g, 0), (-1, -g, 0), (1, -g, 0), (0, -1, g), (0, 1, g), (0, -1, -g), (0, 1, -g), (g, 0, -1), (g, 0, 1), (-g, 0, -1), (-g, 0, 1)]
        base = len(self.verts)
        for v in ico:
            d = Vector(v).normalized()
            k = 1 + (jitter.random() - 0.5) * 0.35
            self.vert(centre + Vector((d.x * radii[0], d.y * radii[0], d.z * radii[1])) * k, color, normal(d))
        for f in ((0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
                  (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)):
            self.faces.append(tuple(base + i for i in f))

    def fit(self, scale):
        self.verts = [tuple(c * scale for c in v) for v in self.verts]


def to_object(name, b, soften_up):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(b.verts, [], b.faces)
    mesh.update()
    mesh.shade_smooth()
    normals = []
    for computed, given in zip(mesh.vertex_normals, b.normals):
        n = Vector(given) if given is not None else computed.vector.copy()
        if soften_up is not None and given is None:
            if n.z < 0:
                n = -n
            n = (n + UP * soften_up).normalized() # low plants shade like a soft canopy under the sun
        normals.append(tuple(n))
    mesh.normals_split_custom_set_from_vertices(normals)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def setup(samples=48):
    """An empty Cycles scene with a big ground plane; returns the plane and the material the exporter needs to see."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    material = bpy.data.materials.new("plant")
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new("world")
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    plane = bpy.data.meshes.new("ground")
    plane.from_pydata([(-200, -200, 0), (200, -200, 0), (200, 200, 0), (-200, 200, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new("ground", plane)
    scene.collection.objects.link(ground)
    return ground, material


def bake(obj, b, distance, floor, material):
    """Bake AO over whatever else renders into a temporary attribute, then multiply it into the vertex colours."""
    bpy.context.scene.world.light_settings.distance = distance
    ao = obj.data.color_attributes.new("ao", "FLOAT_COLOR", "POINT")
    obj.data.color_attributes.active_color = ao
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.materials.append(material)
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS", use_clear=True)
    shade = [0.0] * (len(ao.data) * 4)
    ao.data.foreach_get("color", shade)
    obj.data.color_attributes.remove(ao)
    out = obj.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    obj.data.color_attributes.active_color = out
    rgba = []
    for i, c in enumerate(b.colors):
        k = mix(floor, 1.0, shade[i * 4])
        rgba += [c[0] * k, c[1] * k, c[2] * k, 1.0]
    out.data.foreach_set("color", rgba)
    return sum(shade[i * 4] for i in range(len(b.colors))) / len(b.colors)


def export(objects, out):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", use_selection=True, export_yup=True, export_materials="EXPORT",
                              export_normals=True, export_texcoords=False, export_animations=False, export_vertex_color="NAME",
                              export_vertex_color_name="Col", export_all_vertex_colors=False)
    print(f"{out.name} written: {out.stat().st_size / 1e6:.1f} MB", flush=True)
