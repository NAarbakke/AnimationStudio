"""Operation SKYFALL field tests in Blender: the Razorbill drop film (site/src/drone/main.js) rendered properly, from its own bake.

    node video/skyfall/field/bake.js            # the film's choreography -> video/out/skyfall-work/blender/
    npm run blender -- razorbill/skyfall_field.py         # -> video/out/skyfall-work/blender/frames/NNNN.png

Nothing moves on its own here: every frame poses the scene from frames.bin (camera, drone parts, rod, larvae, clods, dust)
and the rest follows the film's shaders, ported to nodes (ground, sky, fog) and numpy (the crops swaying in wind and downwash,
the plants fading round the rod). The bake is in three.js's frame, Y up; Blender's is Z up: (x, y, z) -> (x, -z, y).

Environment:
    FIELD_ENGINE    eevee (default) or cycles
    FIELD_SAMPLES   samples per pixel (default 8 for eevee: ~25 s a frame on a Quadro P520; 48 for cycles, denoised)
    FIELD_SIZE      WxH (default 1920x1080)
    FIELD_FRAMES    "all" (default), "even", "N-M", or a list ("0,300,620")
    FIELD_OUT       output folder (default video/out/skyfall-work/blender/frames)
Frames already on disk are skipped, so a stopped render resumes. Delete the folder after changing the look.
"""
from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parent.parent.parent
BAKE = ROOT / "video" / "out" / "skyfall-work" / "blender"
OUT = ROOT / os.environ.get("FIELD_OUT", BAKE / "frames")  # relative to the repo
ENGINE = os.environ.get("FIELD_ENGINE", "eevee").lower()
SAMPLES = int(os.environ.get("FIELD_SAMPLES", "8" if ENGINE == "eevee" else "48"))
WIDE, HIGH = (int(v) for v in os.environ.get("FIELD_SIZE", "1920x1080").split("x"))

S = json.loads((BAKE / "scene.json").read_text())
FRAMES = np.memmap(BAKE / "frames.bin", dtype=np.float32, mode="r").reshape(S["frames"], S["frameFloats"])
PLANTS = np.fromfile(BAKE / "plants.bin", dtype=np.float32).reshape(-1, 10)

C = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)  # three -> Blender


def to_b(p):
    p = np.asarray(p, dtype=np.float64)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1)


def mat(elements, camera=False):
    """A three.js matrixWorld (column-major) as a Blender matrix_world. Meshes imported from the GLB were converted the
    same way, so they take C M C^-1; the camera looks down its own -Z in both, so it takes C M."""
    m = np.asarray(elements, dtype=np.float64).reshape(4, 4).T
    return Matrix((C @ m if camera else C @ m @ C.T).tolist())


def linear(hex_colour):
    out = []
    for shift in (16, 8, 0):
        c = ((hex_colour >> shift) & 255) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


# ---------------------------------------------------------------- node maths, for porting the film's GLSL
class Nodes:
    """Builds a node tree from expressions: every method takes floats or sockets and returns a socket."""

    def __init__(self, tree):
        self.tree, self.n, self.l = tree, tree.nodes, tree.links

    def node(self, kind, **props):
        nd = self.n.new(kind)
        for k, v in props.items():
            setattr(nd, k, v)
        return nd

    def put(self, sock, v):
        if isinstance(v, (int, float)):
            sock.default_value = v
        elif isinstance(v, (tuple, list)):
            sock.default_value = v if len(sock.default_value) == len(v) else (*v, 1)
        else:
            self.l.new(v, sock)

    def m(self, op, a, b=0.0, c=0.0):
        nd = self.node("ShaderNodeMath", operation=op)
        for i, v in enumerate((a, b, c)):
            self.put(nd.inputs[i], v)
        return nd.outputs[0]

    def add(self, a, b): return self.m("ADD", a, b)
    def sub(self, a, b): return self.m("SUBTRACT", a, b)
    def mul(self, a, b): return self.m("MULTIPLY", a, b)
    def div(self, a, b): return self.m("DIVIDE", a, b)
    def mad(self, a, b, c): return self.m("MULTIPLY_ADD", a, b, c)
    def abs(self, a): return self.m("ABSOLUTE", a)
    def fract(self, a): return self.m("FRACT", a)
    def fmod(self, a, b): return self.m("FLOORED_MODULO", a, b)
    def min(self, a, b): return self.m("MINIMUM", a, b)
    def max(self, a, b): return self.m("MAXIMUM", a, b)
    def pow(self, a, b): return self.m("POWER", a, b)
    def floor(self, a): return self.m("FLOOR", a)
    def gt(self, a, b): return self.m("GREATER_THAN", a, b)
    def lt(self, a, b): return self.m("LESS_THAN", a, b)
    def one_minus(self, a): return self.sub(1.0, a)

    def mix(self, a, b, u):
        return self.add(a, self.mul(self.sub(b, a), u))

    def ss(self, e0, e1, x):
        nd = self.node("ShaderNodeMapRange", data_type="FLOAT", interpolation_type="SMOOTHSTEP", clamp=True)
        for name, v in (("From Min", e0), ("From Max", e1), ("To Min", 0.0), ("To Max", 1.0), ("Value", x)):
            self.put(nd.inputs[name], v)
        return nd.outputs["Result"]

    def band(self, d, hw, aa):
        return self.one_minus(self.ss(self.sub(hw, aa), self.add(hw, aa), d))

    def vec(self, x, y, z):
        nd = self.node("ShaderNodeCombineXYZ")
        for i, v in enumerate((x, y, z)):
            self.put(nd.inputs[i], v)
        return nd.outputs[0]

    def xyz(self, v):
        nd = self.node("ShaderNodeSeparateXYZ")
        self.put(nd.inputs[0], v)
        return nd.outputs[0], nd.outputs[1], nd.outputs[2]

    def noise(self, x, y, z, gain=2.4):
        """the film's snoise (simplex, -1..1) as Blender's Perlin noise, rescaled to about the same spread"""
        nd = self.node("ShaderNodeTexNoise", noise_dimensions="3D")
        nd.inputs["Scale"].default_value = 1.0
        nd.inputs["Detail"].default_value = 0.0
        nd.inputs["Roughness"].default_value = 0.0
        self.put(nd.inputs["Vector"], self.vec(x, y, z))
        return self.mul(self.sub(nd.outputs["Fac"], 0.5), gain)

    def hash(self, x, y):
        nd = self.node("ShaderNodeTexWhiteNoise", noise_dimensions="2D")
        self.put(nd.inputs["Vector"], self.vec(x, y, 0.0))
        return nd.outputs["Value"]

    def vmath(self, op, a, b=None, scale=None):
        nd = self.node("ShaderNodeVectorMath", operation=op)
        self.put(nd.inputs[0], a)
        if b is not None:
            self.put(nd.inputs[1], b)
        if scale is not None:
            self.put(nd.inputs["Scale"], scale)
        return nd.outputs["Value" if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else "Vector"]

    def cmix(self, a, b, u):
        """colours (vectors) a -> b by u"""
        nd = self.node("ShaderNodeMix", data_type="VECTOR", clamp_factor=False)
        self.put(nd.inputs[0], u)
        self.put(nd.inputs[4], a)
        self.put(nd.inputs[5], b)
        return nd.outputs[1]

    def cscale(self, a, k): return self.vmath("SCALE", a, scale=k)
    def cadd(self, a, b): return self.vmath("ADD", a, b)

    def value(self, v=0.0):
        nd = self.node("ShaderNodeValue")
        nd.outputs[0].default_value = v
        return nd.outputs[0]


def material(name):
    mt = bpy.data.materials.new(name)
    mt.use_nodes = True
    mt.node_tree.nodes.clear()
    return mt, Nodes(mt.node_tree)


def principled(g, color=None, rough=0.5, metal=0.0, alpha=None, out=True, **extra):
    b = g.node("ShaderNodeBsdfPrincipled")
    if color is not None:
        g.put(b.inputs["Base Color"], color)
    g.put(b.inputs["Roughness"], rough)
    g.put(b.inputs["Metallic"], metal)
    if alpha is not None:
        g.put(b.inputs["Alpha"], alpha)
    for k, v in extra.items():
        g.put(b.inputs[k], v)
    return b.outputs[0]


FOG_RGB = S["fog"]
FOG_D = S["fogDensity"]


def fogged(g, shader):
    """three's FogExp2 on top of the lit surface: fog colour by 1 - exp(-(density * distance)^2)"""
    cam = g.node("ShaderNodeCameraData")
    f = g.one_minus(g.m("EXPONENT", g.mul(-1.0, g.pow(g.mul(cam.outputs["View Distance"], FOG_D), 2.0))))
    emit = g.node("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*FOG_RGB, 1)
    mix = g.node("ShaderNodeMixShader")
    g.put(mix.inputs[0], f)
    g.put(mix.inputs[1], shader)
    g.l.new(emit.outputs[0], mix.inputs[2])
    return mix.outputs[0]


def output(g, shader):
    o = g.node("ShaderNodeOutputMaterial")
    g.l.new(shader, o.inputs["Surface"])


# ---------------------------------------------------------------- ground: the film's fieldColor()
ROW, PL, FL = S["row"], S["plantsArea"], S["field"]
IMPACT = S["impact"]  # three (x, y, z); the ground is three's (x, z) = Blender's (x, -y)


def ground_material(ctl):
    mt, g = material("ground")
    ctl["pix"], ctl["impact_on"], ctl["grow"] = g.value(0.001), g.value(0.0), g.value(0.0)  # set every frame
    pos = g.node("ShaderNodeNewGeometry")
    bx, by, _ = g.xyz(pos.outputs["Position"])
    px, py = bx, g.mul(by, -1.0)
    # fwidth(p): the pixel footprint on the ground, from the distance, the lens (ctl["pix"]) and the grazing angle
    cam = g.node("ShaderNodeCameraData")
    _, _, iz = g.xyz(pos.outputs["Incoming"])
    fw = g.mul(g.mul(cam.outputs["View Distance"], ctl["pix"]), g.mul(0.7, g.add(1.0, g.div(1.0, g.max(g.abs(iz), 0.02)))))
    ctl["fw_debug"] = fw

    def soil(scale_noise=1.0):
        n = g.mul(g.noise(g.mul(px, 0.31), g.mul(py, 0.31), 0.0), 0.5)
        for f, z, w, a, b in ((1.9, 3.0, 0.3, 0.04, 0.3), (11.0, 7.0, 0.25, 0.008, 0.05), (47.0, 11.0, 0.34, 0.002, 0.012), (170.0, 13.0, 0.26, 0.0008, 0.004)):
            n = g.add(n, g.mul(g.mul(g.noise(g.mul(px, f), g.mul(py, f), z), w), g.one_minus(g.ss(a, b, fw))))
        u = g.m("MULTIPLY_ADD", n, 0.7, 0.5)
        u = g.min(g.max(u, 0.0), 1.0)
        return g.cmix((0.045, 0.027, 0.015), (0.125, 0.08, 0.046), u)

    s = soil()
    d = g.mul(g.abs(g.sub(g.fract(g.add(g.div(py, ROW), 0.5)), 0.5)), ROW)
    tm = g.abs(g.sub(g.fmod(g.sub(py, 12.0), 24.0), 12.0))
    hw = g.add(g.add(0.15, g.mul(0.035, g.noise(g.mul(px, 0.9), g.mul(py, 0.9), 2.0))), g.mul(0.03, g.noise(g.mul(px, 3.1), g.mul(py, 0.2), 4.0)))
    cov = g.band(d, hw, g.max(fw, 0.003))
    cov = g.mix(cov, 0.4, g.ss(0.1, 0.4, fw))
    cov = g.mul(cov, g.ss(1.15, 1.35, tm))
    green = g.cmix((0.02, 0.06, 0.012), (0.045, 0.12, 0.02), g.m("MULTIPLY_ADD", g.noise(g.mul(px, 0.045), g.mul(py, 0.045), 5.0), 0.5, 0.5))
    under = g.mul(g.mul(g.m("GREATER_THAN", px, PL["x0"]), g.lt(px, PL["x1"])), g.lt(g.abs(py), PL["z"]))
    tufts = g.ss(-0.35, 0.35, g.noise(g.mul(px, 3.6), g.mul(py, 1.3), 9.0))
    cov = g.mul(cov, g.mix(tufts, 1.0, g.ss(0.03, 0.12, fw)))
    cov = g.mul(cov, g.mix(1.0, 0.35, under))
    r = g.vmath("LENGTH", g.vec(g.sub(px, IMPACT[0]), g.sub(py, IMPACT[2]), 0.0))
    cov = g.mul(cov, g.mix(1.0, g.ss(0.5, 1.2, r), ctl["impact_on"]))  # no painted tufts in the clearing the macro shot looks at
    green = g.cscale(green, g.mix(1.0, 0.5, under))
    far = g.mul(g.ss(0.05, 0.25, fw), g.one_minus(under))
    c = g.cmix(s, green, g.mul(cov, g.mix(1.0, 0.7, far)))
    c = g.cscale(c, g.mix(1.0, 0.8, g.mul(g.ss(0.02, 0.15, fw), g.one_minus(under))))
    rut = g.mul(g.band(g.abs(g.sub(tm, 0.9)), 0.17, g.max(fw, 0.02)), g.one_minus(g.ss(0.2, 0.6, fw)))
    crop = g.cmix(c, g.cadd(g.cscale(s, 0.72), (0.02, 0.016, 0.01)), rut)

    # outside the main field: hedge, verge, then a patchwork of other fields
    out_ = g.max(g.max(g.sub(FL["x0"], px), g.sub(px, FL["x1"])), g.max(g.sub(FL["z0"], py), g.sub(py, FL["z1"])))
    hedge = g.cscale((0.02, 0.05, 0.015), g.add(0.8, g.mul(0.4, g.noise(g.mul(px, 0.3), g.mul(py, 0.3), 1.0))))
    verge = g.cscale((0.3, 0.25, 0.18), g.add(0.85, g.mul(0.25, g.noise(g.mul(px, 0.5), g.mul(py, 0.5), 2.0))))
    verge = g.cmix(verge, (0.08, 0.15, 0.04), g.band(g.abs(g.sub(out_, 5.15)), 0.5, 0.2))
    qx, qy = g.div(g.add(px, 37.0), 260.0), g.div(g.add(py, 11.0), 210.0)
    ix, iy = g.floor(qx), g.floor(qy)
    fx, fy = g.mul(g.fract(qx), 260.0), g.mul(g.fract(qy), 210.0)
    h, h2 = g.hash(ix, iy), g.hash(g.add(ix, 17.0), g.add(iy, 17.0))
    ry = g.mix(px, py, g.gt(h2, 0.5))  # r.y: rows run one way or the other
    tone = g.m("MULTIPLY_ADD", g.noise(g.mul(px, 0.012), g.mul(py, 0.012), g.mul(h, 9.0)), 0.5, 0.5)
    cereal = g.cscale(g.cmix((0.36, 0.25, 0.08), (0.52, 0.38, 0.13), tone), g.sub(1.0, g.mul(0.18, g.band(g.abs(g.sub(g.fmod(ry, 24.0), 12.0)), 0.5, g.max(fw, 0.05)))))
    plough_k = g.mix(g.sub(1.0, g.mul(0.35, g.band(g.abs(g.sub(g.fract(g.div(ry, 0.4)), 0.5)), 0.18, g.max(g.div(fw, 0.4), 0.02)))), 0.88, g.ss(0.05, 0.25, fw))
    plough = g.cscale(g.cscale(soil(), 1.1), plough_k)
    sinr = g.m("SINE", g.mul(ry, math.pi / 6))
    pasture = g.cscale(g.cmix((0.06, 0.14, 0.03), (0.11, 0.21, 0.045), tone), g.add(1.0, g.mul(0.12, g.m("SIGN", sinr))))
    rape = g.cmix((0.45, 0.37, 0.03), (0.62, 0.52, 0.05), tone)
    oc = g.cmix(cereal, plough, g.gt(h, 0.3))
    oc = g.cmix(oc, pasture, g.gt(h, 0.5))
    oc = g.cmix(oc, rape, g.gt(h, 0.78))
    e = g.min(g.min(fx, g.sub(260.0, fx)), g.min(fy, g.sub(210.0, fy)))
    oc = g.cmix(oc, (0.1, 0.16, 0.05), g.one_minus(g.ss(4.0, 5.0, e)))
    oc = g.cmix(oc, hedge, g.one_minus(g.ss(2.0, 2.6, e)))
    col = g.cmix(crop, hedge, g.m("GREATER_THAN", out_, -0.0001))
    col = g.cmix(col, verge, g.gt(out_, 2.8))
    col = g.cmix(col, oc, g.gt(out_, 7.5))
    # scuffed soil where the rod went in
    scuff = g.one_minus(g.ss(0.02, g.add(0.07, g.mul(0.03, g.noise(g.mul(px, 60.0), g.mul(py, 60.0), 1.0))), r))
    col = g.cscale(col, g.sub(1.0, g.mul(g.mul(0.45, ctl["grow"]), scuff)))
    output(g, fogged(g, principled(g, col, rough=0.97)))
    return mt


# ---------------------------------------------------------------- sky: the film's skyColor(), as the world
def world(sun_b):
    w = bpy.data.worlds.new("sky")
    w.use_nodes = True
    w.node_tree.nodes.clear()
    g = Nodes(w.node_tree)
    tc = g.node("ShaderNodeTexCoord")
    d = g.vmath("NORMALIZE", tc.outputs["Generated"])
    dx, dy, dz = g.xyz(d)
    e = g.min(g.max(dz, 0.0), 1.0)
    mu = g.max(g.vmath("DOT_PRODUCT", d, tuple(sun_b)), 0.0)
    col = g.cmix((0.66, 0.68, 0.70), (0.10, 0.25, 0.60), g.pow(e, 0.5))
    col = g.cadd(col, g.cscale((1.0, 0.68, 0.38), g.mul(g.mul(g.pow(mu, 5.0), 0.45), g.one_minus(e))))
    col = g.cadd(col, g.cscale((1.0, 0.86, 0.62), g.mul(g.pow(mu, 80.0), 0.8)))
    below = g.cmix((0.66, 0.68, 0.70), (0.4, 0.4, 0.36), g.min(g.max(g.mul(dz, -6.0), 0.0), 1.0))
    col = g.cmix(col, below, g.lt(dz, 0.0))
    # the sun's disc only for the camera: the sun lamp does the lighting
    lp = g.node("ShaderNodeLightPath")
    disc = g.mul(g.mul(g.ss(0.99985, 0.99992, mu), 30.0), lp.outputs["Is Camera Ray"])
    col = g.cadd(col, g.cscale((1.0, 0.92, 0.8), disc))
    bg = g.node("ShaderNodeBackground")
    g.put(bg.inputs["Color"], col)
    o = g.node("ShaderNodeOutputWorld")
    g.l.new(bg.outputs[0], o.inputs["Surface"])
    return w


# ---------------------------------------------------------------- the scene
def lcg(seed):
    def r():
        nonlocal seed
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
        return seed / 4294967296
    return r


def mesh_object(name, verts, faces, mat=None, smooth=True, collection=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    if smooth:
        me.shade_smooth()
    if mat is not None:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def hills(mat):
    segs, rings, r = 256, 8, lcg(7)
    ph = [r() * 6.28 for _ in range(6)]
    verts, faces = [], []
    for j in range(rings + 1):
        for i in range(segs + 1):
            a, u = i / segs * math.pi * 2, j / rings
            rad = 2600 + (5200 - 2600) * u
            h = 0.55 * (60 + 70 * math.sin(3 * a + ph[0]) * math.sin(5 * a + ph[1]) + 35 * math.sin(11 * a + ph[2]) + 15 * math.sin(23 * a + ph[3])) * math.sin(math.pi * min(1, u * 1.6)) + 20 * u
            verts.append((math.cos(a) * rad, -math.sin(a) * rad, max(-5, h * (1 + u))))
    for j in range(rings):
        for i in range(segs):
            a = j * (segs + 1) + i
            b = a + segs + 1
            faces.append((a, a + 1, b + 1, b))
    return mesh_object("hills", verts, faces, mat)


def farmyard(mats):
    """the film's farmyard: two barns with prism roofs and a silo, built in three's frame and converted"""
    group = Matrix.Translation(Vector(to_b((300, 0, -230)).tolist())) @ Matrix.Rotation(0.35, 4, "Z")

    def put(name, verts, faces, m):
        ob = mesh_object(name, [to_b(v) for v in verts], faces, m, smooth=False)
        ob.matrix_world = group
        return ob

    def box(w, h, d, x, z):
        vs = [(x + sx * w / 2, sy * h, z + sz * d / 2) for sx in (-1, 1) for sy in (0, 1) for sz in (-1, 1)]
        fs = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        return vs, fs

    def roof(w, h, d, x, z):
        rr = d * 0.62
        vs = []
        for yy in (-w / 2, w / 2):
            for k in range(3):
                th = k * 2 * math.pi / 3
                v = Vector((rr * math.sin(th), yy, rr * math.cos(th)))
                v = Vector((-v.y, v.x, v.z))  # rotateZ(pi/2)
                c, s_ = math.cos(math.pi / 6), math.sin(math.pi / 6)
                v = Vector((v.x, v.y * c - v.z * s_, v.y * s_ + v.z * c))  # rotateX(pi/6)
                vs.append((v.x + x, v.y * 0.55 + h + d * 0.16, v.z + z))
        fs = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
        return vs, fs

    for i, (w, h, d, x, z) in enumerate(((30, 8, 14, 0, 0), (18, 6, 10, 28, 14))):
        put(f"barn_{i}", *box(w, h, d, x, z), mats["barn"])
        put(f"roof_{i}", *roof(w, h, d, x, z), mats["roof"])
    vs, fs = [], []
    for k in range(20):
        th = k / 20 * 2 * math.pi
        vs += [(-22 + 3.2 * math.sin(th), 0, 6 + 3.2 * math.cos(th)), (-22 + 3.2 * math.sin(th), 16, 6 + 3.2 * math.cos(th))]
    fs = [(2 * k, 2 * ((k + 1) % 20), 2 * ((k + 1) % 20) + 1, 2 * k + 1) for k in range(20)] + [tuple(2 * k + 1 for k in range(20))]
    silo = put("silo", vs, fs, mats["silo"])
    silo.data.shade_smooth()


MAT = {  # the film's MAT table: colour, roughness, metalness (prop opacity 0.55)
    "hub": (0x1c1d20, 0.42, 0.35), "top": (0x232427, 0.4, 0.35), "battery": (0xdcdcd8, 0.55, 0.05), "arm": (0x141517, 0.36, 0.4),
    "leg": (0xd6d9dc, 0.45, 0.1), "motor": (0x34373c, 0.3, 0.85), "prop": (0x0f1012, 0.4, 0.1), "release": (0xb8bcc1, 0.28, 0.9),
    "rod_shaft": (0x4d5056, 0.55, 0.45), "rod_tape": (0xf0f1f2, 0.22, 1), "rod_cone": (0x1c1d20, 0.45, 0.2), "rod_cap": (0x1c1d20, 0.45, 0.2),
    "rod_fins": (0xb8410a, 0.68, 0), "rod_ring": (0xc8ccd0, 0.25, 1),  # fins a shade darker than the film: full sun would wash them salmon
}


def plant_material(name, color_attr, fades):
    mt, g = material(name)
    col = g.node("ShaderNodeAttribute", attribute_type="GEOMETRY", attribute_name=color_attr)
    tint = g.node("ShaderNodeAttribute", attribute_type="INSTANCER", attribute_name="tint")
    base = g.vmath("MULTIPLY", col.outputs["Vector"], tint.outputs["Vector"])
    alpha = None
    if fades:
        fade = g.node("ShaderNodeAttribute", attribute_type="INSTANCER", attribute_name="fade")
        alpha = fade.outputs["Fac"]
    # leaves pass some light: a little translucency from behind, which the film's double-sided standard material lacks
    sh = principled(g, base, rough=0.88 if name == "crop" else 0.85, alpha=alpha, **{"Specular IOR Level": 0.3})
    trans = g.node("ShaderNodeBsdfTranslucent")
    g.put(trans.inputs["Color"], g.cscale(base, 0.6))
    mix = g.node("ShaderNodeMixShader")
    mix.inputs[0].default_value = 0.18
    g.l.new(sh, mix.inputs[1])
    g.l.new(trans.outputs[0], mix.inputs[2])
    shader = mix.outputs[0]
    if fades:  # the translucency must fade with the leaf too
        tr = g.node("ShaderNodeBsdfTransparent")
        m2 = g.node("ShaderNodeMixShader")
        g.put(m2.inputs[0], alpha)
        g.l.new(tr.outputs[0], m2.inputs[1])
        g.l.new(shader, m2.inputs[2])
        shader = m2.outputs[0]
    output(g, fogged(g, shader))
    mt.surface_render_method = "DITHERED"
    return mt


def instancer_group(source):
    ng = bpy.data.node_groups.new(f"plants_{source.name}", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    n, l = ng.nodes, ng.links
    gi, go = n.new("NodeGroupInput"), n.new("NodeGroupOutput")
    info = n.new("GeometryNodeObjectInfo")
    info.transform_space = "ORIGINAL"
    iop = n.new("GeometryNodeInstanceOnPoints")
    rot, scl = n.new("GeometryNodeInputNamedAttribute"), n.new("GeometryNodeInputNamedAttribute")
    for a, name in ((rot, "rot"), (scl, "scl")):
        a.data_type = "FLOAT_VECTOR"
        a.inputs["Name"].default_value = name
    euler = n.new("FunctionNodeEulerToRotation")
    info.inputs["Object"].default_value = source
    l.new(gi.outputs["Geometry"], iop.inputs["Points"])
    l.new(info.outputs["Geometry"], iop.inputs["Instance"])
    l.new(rot.outputs["Attribute"], euler.inputs["Euler"])
    l.new(euler.outputs["Rotation"], iop.inputs["Rotation"])
    l.new(scl.outputs["Attribute"], iop.inputs["Scale"])
    l.new(iop.outputs["Instances"], go.inputs["Geometry"])
    return ng


class Plants:
    """One point cloud per plant variant, instancing it; heading and the sway are per-point rotations set every frame."""

    def __init__(self, sources, mats):
        """The few plants that fade in the strike shot get their own clouds and a transparent copy of their source: alpha
        on all 300 000 would make every crop pixel a transparent one, and the render three times slower."""
        self.clouds = []
        for vi, variant in enumerate(S["variants"]):
            for fading in (False, True):
                rows = PLANTS[(PLANTS[:, 0] == vi) & ((PLANTS[:, 1] > 0.5) == fading)]
                if not len(rows):
                    continue
                src = sources[variant]
                if fading:
                    src = src.copy()
                    src.data = src.data.copy()
                    bpy.context.scene.collection.objects.link(src)
                    src.hide_render = True
                    src.name = f"{variant}_fade"
                self._cloud(src, rows, mats["crop_fade" if fading else "crop" if variant.startswith("crop") else "tree"])

    def _cloud(self, src, rows, mat):
        name = src.name
        if True:
            x, z, yaw = rows[:, 2].astype(np.float64), rows[:, 3].astype(np.float64), rows[:, 4].astype(np.float64)
            me = bpy.data.meshes.new(f"pts_{name}")
            me.vertices.add(len(rows))
            me.vertices.foreach_set("co", np.stack([x, -z, np.zeros_like(x)], 1).ravel().astype(np.float32))
            for attr, kind in (("rot", "FLOAT_VECTOR"), ("scl", "FLOAT_VECTOR"), ("tint", "FLOAT_VECTOR"), ("fade", "FLOAT")):
                me.attributes.new(attr, kind, "POINT")
            me.attributes["scl"].data.foreach_set("vector", np.stack([rows[:, 5], rows[:, 5], rows[:, 6]], 1).ravel())
            me.attributes["tint"].data.foreach_set("vector", rows[:, 7:10].ravel())
            fades = rows[:, 1] > 0.5
            rn = np.modf(np.sin(x * 127.1 + z * 311.7) * 43758.5453)[0] % 1.0
            key = np.hypot(x - IMPACT[0], z - IMPACT[2]) / S["reveal"]["length"] + 0.35 * rn
            ob = bpy.data.objects.new(f"plants_{name}", me)
            bpy.context.scene.collection.objects.link(ob)
            mod = ob.modifiers.new("plants", "NODES")
            mod.node_group = instancer_group(src)
            src.data.materials.clear()  # instances draw with their source's material
            src.data.materials.append(mat)
            self.clouds.append(dict(ob=ob, me=me, x=x, z=z, yaw=yaw, h=rows[:, 6].astype(np.float64), fades=fades, key=key,
                                    crop=name.startswith("crop"), n=len(rows)))
            print(f"plants {name}: {len(rows)}", flush=True)

    def pose(self, w, drone, wash, kick, reveal):
        for c in self.clouds:
            x, z, n = c["x"], c["z"], c["n"]
            if c["crop"]:  # the film's sway shader: wind, the rotor downwash and the rod punching in, as a tilt at the base
                wx = 0.025 * np.sin(w * 1.6 + x * 0.31 + z * 0.17) + 0.01 * np.sin(w * 4.1 + z * 2.3)
                wz = 0.012 * np.sin(w * 1.3 + x * 0.2)
                dx, dz = x - drone[0], z - drone[2]
                dist = np.hypot(dx, dz)
                wv = wash * np.exp(-dist * dist / 1.6) * min(1.5, max(0.0, 3.2 / max(drone[1], 0.5)))
                k = wv * (0.06 + 0.035 * np.sin(w * 17.0 + dist * 9.0 + x * 13.0)) / (dist + 0.25)
                wx, wz = wx + dx * k, wz + dz * k
                if kick >= 0:
                    kx, kz = x - IMPACT[0], z - IMPACT[2]
                    rk = np.hypot(kx, kz)
                    kk = 0.1 * np.exp(-rk * rk / 0.5) * math.exp(-kick * 3.0) * np.sin(kick * 26.0 - rk * 9.0) / (rk + 0.1)
                    wx, wz = wx + kx * kk, wz + kz * kk
                # the top moves 2.5 wd in the film; tilt so that most of the plant follows: Blender (wx, -wz), into the plant's frame
                bx, by = wx, -wz
                cy, sy = np.cos(c["yaw"]), np.sin(c["yaw"])
                lx, ly = cy * bx + sy * by, -sy * bx + cy * by
                a = 0.8 * 2.5 / (0.95 * c["h"])
                rot = np.stack([-a * ly, a * lx, c["yaw"]], 1)
            else:
                rot = np.stack([np.zeros(n), np.zeros(n), c["yaw"]], 1)
            c["me"].attributes["rot"].data.foreach_set("vector", rot.ravel().astype(np.float32))
            fade = np.ones(n)
            if c["fades"].any():
                u = np.clip((reveal * 1.7 - c["key"]) / 0.3, 0, 1)
                fade = np.where(c["fades"], 1 - u * u * (3 - 2 * u), 1.0)
            c["me"].attributes["fade"].data.foreach_set("value", fade.astype(np.float32))
            c["me"].update()


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 0, S["frames"] - 1
    sun_b = to_b(S["sun"])
    sun_b = sun_b / np.linalg.norm(sun_b)
    scene.world = world(sun_b)

    # the drone and its rod, as the GLB has them; posed every frame from the bake
    bpy.ops.import_scene.gltf(filepath=str(ROOT / "site" / "public" / "models" / "razorbill.glb"))
    drone = {o.name: o for o in scene.objects if o.type == "MESH"}
    mats = {}
    for key, (hx, rough, metal) in MAT.items():
        mt, g = material(key)
        extra = {"Alpha": 0.55} if key == "prop" else {}
        output(g, fogged(g, principled(g, linear(hx), rough, metal, **extra)))
        if key == "prop":
            mt.surface_render_method = "BLENDED"
        mats[key] = mt
    for name, o in drone.items():
        o.parent = None
        o.data.materials.clear()
        o.data.materials.append(mats.get(name, mats.get(name.split("_")[0], mats["hub"])))
        o.animation_data_clear()

    # rotor discs: the film's blur shader on a plane the size of each prop, in the drone's frame
    ctl = {"discs": []}
    for n in range(4):
        motor, prop = drone[f"motor_{n}"], drone[f"prop_{n}"]
        corners = [motor.matrix_world @ Vector(c) for c in motor.bound_box]
        mc = sum(corners, Vector()) / 8
        rad = max(math.hypot((prop.matrix_world @ v.co).x - mc.x, (prop.matrix_world @ v.co).y - mc.y) for v in prop.data.vertices)
        mt, g = material(f"disc_{n}")
        tc = g.node("ShaderNodeTexCoord")
        ux, uy, _ = g.xyz(g.vmath("SUBTRACT", g.vmath("SCALE", tc.outputs["UV"], scale=2.0), (1.0, 1.0, 0.0)))
        r = g.vmath("LENGTH", g.vec(ux, uy, 0.0))
        ang = g.value()
        a = g.sub(g.m("ARCTAN2", uy, ux), ang)
        s_ = g.pow(g.add(0.5, g.mul(0.5, g.m("COSINE", g.mul(a, 2.0)))), 10.0)
        al = g.mul(g.mul(g.add(0.07, g.mul(0.2, s_)), g.ss(1.0, 0.9, r)), g.ss(0.14, 0.3, r))
        al = g.mul(al, g.mul(g.lt(r, 1.0), g.gt(r, 0.14)))
        sh = principled(g, (0.0042, 0.0042, 0.0042), rough=0.5, alpha=al, **{"Specular IOR Level": 0.0})
        output(g, sh)
        mt.surface_render_method = "BLENDED"
        me = bpy.data.meshes.new(f"disc_{n}")
        me.from_pydata([(-rad, -rad, 0), (rad, -rad, 0), (rad, rad, 0), (-rad, rad, 0)], [], [(0, 1, 2, 3)])
        uv = me.uv_layers.new(name="UV")
        for loop, (u, v) in zip(uv.data, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop.uv = (u, v)
        me.materials.append(mt)
        ob = bpy.data.objects.new(f"disc_{n}", me)
        scene.collection.objects.link(ob)
        ob.visible_shadow = False
        drone[f"disc_{n}"] = ob
        ctl["discs"].append(ang)
    missing = [m for m in S["meshes"] if m not in drone]
    if missing:
        raise RuntimeError(f"meshes in the bake but not in the scene: {missing}")
    ctl["moving"] = [drone[m] for m in S["meshes"]]

    # vegetation: the film's plants, as instance sources
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / "site" / "public" / "models" / "vegetation.glb"))
    sources = {o.name: o for o in set(bpy.data.objects) - before if o.type == "MESH"}
    for o in set(bpy.data.objects) - before:
        o.hide_render = True
        o.hide_set(True)
    color_attr = next(iter(sources.values())).data.color_attributes[0].name
    pm = {"crop": plant_material("crop", color_attr, False), "crop_fade": plant_material("crop", color_attr, True), "tree": plant_material("tree", color_attr, False)}
    ctl["plants"] = Plants(sources, pm)

    # ground, hills, farmyard
    ground = ground_material(ctl)
    mesh_object("ground", [(-7000, -7000, 0), (7000, -7000, 0), (7000, 7000, 0), (-7000, 7000, 0)], [(0, 1, 2, 3)], ground, smooth=False)
    hm, g = material("hills")
    output(g, fogged(g, principled(g, linear(0x45583a), rough=1.0)))
    hills(hm)
    yard = {}
    for key, hx, rough, metal in (("barn", 0x7a2a1e, 0.8, 0), ("roof", 0x3b3d40, 0.6, 0), ("silo", 0xb9bcbf, 0.4, 0.6)):
        mt, g = material(key)
        output(g, fogged(g, principled(g, linear(hx), rough, metal)))
        yard[key] = mt
    farmyard(yard)

    # larvae: the film's tube meshes, re-posed every frame, with its skin
    skin = bpy.data.images.load(str(BAKE / "skin.png"))
    mt, g = material("larva")
    tex = g.node("ShaderNodeTexImage", image=skin)
    tc = g.node("ShaderNodeTexCoord")
    g.l.new(tc.outputs["UV"], tex.inputs["Vector"])
    output(g, principled(g, tex.outputs["Color"], rough=0.42, **{"Subsurface Weight": 0.25, "Subsurface Scale": 0.0015}))
    L = S["larva"]
    nv = (L["rings"] + 1) * (L["sides"] + 1)
    tris = np.array(L["index"]).reshape(-1, 3)
    uvs = np.array(L["uv"]).reshape(-1, 2)
    ctl["larvae"] = []
    for i in range(L["count"]):
        ob = mesh_object(f"larva_{i}", [(0, 0, 0)] * nv, tris.tolist(), mt)
        uv = ob.data.uv_layers.new(name="UV")
        uv.data.foreach_set("uv", uvs[tris.ravel()].ravel())
        ctl["larvae"].append(ob)

    # clods and the dust puff
    lump = np.array(S["clod"]["position"]).reshape(-1, 3, 3)
    mt, g = material("clod")
    output(g, principled(g, linear(0x2c1e12), rough=1.0))
    lump_me = bpy.data.meshes.new("clod")
    lump_me.from_pydata([tuple(v) for v in to_b(lump.reshape(-1, 3))], [], [(3 * k, 3 * k + 1, 3 * k + 2) for k in range(len(lump))])
    lump_me.materials.append(mt)
    ctl["clods"] = []
    for i in range(S["clod"]["count"]):
        ob = bpy.data.objects.new(f"clod_{i}", lump_me)
        scene.collection.objects.link(ob)
        ctl["clods"].append(ob)
    mt, g = material("dust")
    info = g.node("ShaderNodeObjectInfo")
    lw = g.node("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    soft = g.pow(g.one_minus(lw.outputs["Facing"]), 2.0)
    dsh = principled(g, info.outputs["Color"], rough=1.0, alpha=g.min(g.mul(info.outputs["Alpha"], g.mul(soft, 2.2)), 1.0))
    output(g, dsh)
    mt.surface_render_method = "BLENDED"
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.5)
    puff = bpy.context.active_object
    puff.data.materials.append(mt)
    puff.data.shade_smooth()
    ctl["dust"] = []
    for i in range(S["dust"]["count"]):
        ob = puff.copy()
        scene.collection.objects.link(ob)
        ob.visible_shadow = False
        ctl["dust"].append(ob)
    bpy.data.objects.remove(puff)

    # the sun, from the film's direction; its strength makes up for three's legacy light units (x pi)
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 2.7 * math.pi
    sun_data.color = linear(0xffe7c4)
    sun_data.angle = math.radians(0.6)
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = Vector(sun_b.tolist()).to_track_quat("Z", "Y").to_euler()

    cam_data = bpy.data.cameras.new("camera")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.sensor_height = 24
    cam_data.clip_end = 9000
    camera = bpy.data.objects.new("camera", cam_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    ctl["camera"] = camera

    render = scene.render
    render.resolution_x, render.resolution_y, render.resolution_percentage = WIDE, HIGH, 100
    render.fps = S["fps"]
    render.image_settings.file_format = "PNG"
    render.image_settings.color_depth = "16"
    # PBR Neutral keeps the fins orange and the crop green (AgX turns saturated orange salmon); FIELD_VIEW / FIELD_EXPOSURE to try others
    view = os.environ.get("FIELD_VIEW", "Khronos PBR Neutral").split("|")
    scene.view_settings.view_transform = view[0]
    if len(view) > 1:
        scene.view_settings.look = view[1]
    scene.view_settings.exposure = float(os.environ.get("FIELD_EXPOSURE", "0.35"))
    if ENGINE == "cycles":
        render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = SAMPLES
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = 0.03
        scene.cycles.use_denoising = True
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
        scene.cycles.max_bounces = 6
        scene.cycles.diffuse_bounces = 2
        scene.cycles.glossy_bounces = 2
        scene.cycles.transparent_max_bounces = 16
        scene.cycles.sample_clamp_indirect = 6
        render.use_persistent_data = True
    else:
        render.engine = "BLENDER_EEVEE"
        scene.eevee.taa_render_samples = SAMPLES
        scene.eevee.use_shadows = True
        scene.eevee.use_raytracing = False  # nothing here needs ray-traced reflections; screen-space is the cost
        scene.eevee.shadow_resolution_scale = 1.0
    return scene, ctl


def pose(scene, ctl, f):
    row = np.asarray(FRAMES[f], dtype=np.float64)
    cam = ctl["camera"]
    cam.matrix_world = mat(row[0:16], camera=True)
    fov, near = row[16], row[17]
    cam.data.lens = cam.data.sensor_height / 2 / math.tan(math.radians(fov) / 2)
    cam.data.clip_start = max(0.005, near)
    ctl["pix"].default_value = 2 * math.tan(math.radians(fov) / 2) / HIGH
    i = 18
    for ob in ctl["moving"]:
        ob.matrix_world = mat(row[i:i + 16])
        i += 16
    for ang in ctl["discs"]:
        ang.default_value = row[i]
        i += 1
    L = S["larva"]
    nv = (L["rings"] + 1) * (L["sides"] + 1)
    for ob in ctl["larvae"]:
        visible = bool(row[i] > 0.5)
        i += 1
        ob.hide_render = bool(not visible)
        if visible:
            ob.data.vertices.foreach_set("co", to_b(row[i:i + nv * 3].reshape(-1, 3)).ravel().astype(np.float32))
            ob.data.update()
        i += nv * 3
    for ob in ctl["clods"]:
        m = row[i:i + 16]
        i += 16
        live = bool(abs(np.linalg.det(m.reshape(4, 4)[:3, :3])) > 1e-12)
        ob.hide_render = bool(not live)
        if live:
            ob.matrix_world = mat(m)
    for n, ob in enumerate(ctl["dust"]):
        x, y, z, diameter, alpha = row[i:i + 5]
        i += 5
        ob.hide_render = bool(alpha < 1e-4)
        if not ob.hide_render:
            ob.location = to_b((x, y, z)).tolist()
            ob.scale = (diameter,) * 3
            k = 0.5 + 0.08 * (n % 3)
            ob.color = (k * 0.84, k * 0.66, k * 0.44, alpha)
    w, dx, dy, dz, wash, kick, impact, reveal = row[i:i + 8]
    ctl["impact_on"].default_value = 1.0 if impact >= 0 else 0.0
    ctl["grow"].default_value = min(1.0, max(0.0, impact / 0.05)) ** 2 * (3 - 2 * min(1.0, max(0.0, impact / 0.05))) if impact >= 0 else 0.0
    ctl["plants"].pose(w, (dx, dy, dz), wash, kick, reveal)


def wanted_frames():
    spec = os.environ.get("FIELD_FRAMES", "all")
    n = S["frames"]
    if spec == "all":
        return list(range(n))
    if spec == "even":
        return list(range(0, n, 2))
    if "-" in spec and "," not in spec:
        a, b = (int(v) for v in spec.split("-"))
        return list(range(a, min(b, n - 1) + 1))
    return [int(v) for v in spec.split(",")]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    todo = [f for f in wanted_frames() if not (OUT / f"{f:04d}.png").exists()]
    if not todo:
        print("FIELD nothing to render", flush=True)
        return
    t0 = time.time()
    scene, ctl = build()
    print(f"FIELD built in {time.time() - t0:.1f} s, {len(todo)} frames to render with {ENGINE}", flush=True)
    started = time.time()
    for done, f in enumerate(todo, 1):
        t1 = time.time()
        scene.frame_set(f)
        pose(scene, ctl, f)
        bpy.context.evaluated_depsgraph_get().update()
        t2 = time.time()
        scene.render.filepath = str(OUT / f"{f:04d}.png")
        bpy.ops.render.render(write_still=True)
        left = (time.time() - started) / done * (len(todo) - done) / 60
        print(f"FIELD frame {f}: {time.time() - t1:.1f} s (pose {t2 - t1:.1f} s), {done}/{len(todo)}, about {left:.0f} min left", flush=True)


if __name__ == "__main__":
    main()
