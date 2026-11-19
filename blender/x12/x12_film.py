"""X-12 Autonomous investor film in Blender Cycles: the three.js film's choreography (site/src/x12/main.js), rendered for real.

    node video/x12/assets.js                 # once: CC0 sky and textures from Poly Haven
    node video/x12/bake.js                   # the film's choreography -> video/out/x12-work/bake/
    npm run blender -- x12/x12_film.py           # -> video/out/x12-work/frames/NNNN.png
    node video/x12/finish.js                 # overlays, grade, encode -> video/out/x12-autonomous.mp4

Nothing is choreographed here. Camera, boat, rigs, drone, interceptor, debris and escorts are keyframed from the bake (so
Cycles motion-blurs them); the sea is the film's own Gerstner swell (plus short chop) as true displacement, so the hull
sits in the water exactly where the film put it; spray, smoke and fire are the film's emitters, ported to numpy and
rendered as droplets and volumes. The bake is in three.js's frame, Y up; Blender's is Z up: (x, y, z) -> (x, -z, y).

Environment:
    X12_DEVICE    auto (default: OptiX, CUDA, HIP, oneAPI, Metal, else CPU) or one of those names
    X12_SAMPLES   samples per pixel, adaptive, denoised (default 128)
    X12_SIZE      WxH (default 1920x1080)
    X12_FRAMES    "all" (default), "N-M", "every:K", or a list ("0,300,620")
    X12_TIMES     seconds instead of frames ("4,16.5,30"), for stills
    X12_OUT       output folder (default video/out/x12-work/frames)
    X12_DICING    adaptive subdivision pixel size (default 1; 2 for quick looks)
    X12_SAVE      also save the built scene to this .blend
Frames already on disk are skipped and a frame being rendered is claimed with a .lock file, so a stopped render resumes and
several processes (one per GPU: CUDA_VISIBLE_DEVICES) or machines can share one output folder.
"""
from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parent.parent.parent
WORK = ROOT / "video" / "out" / "x12-work"
BAKE, ASSETS = WORK / "bake", WORK / "assets"
OUT = Path(os.environ.get("X12_OUT", WORK / "frames"))
OUT = OUT if OUT.is_absolute() else ROOT / OUT
SAMPLES = int(os.environ.get("X12_SAMPLES", "128"))
WIDE, HIGH = (int(v) for v in os.environ.get("X12_SIZE", "1920x1080").split("x"))
DICING = float(os.environ.get("X12_DICING", "1"))
HDRI = ASSETS / "table_mountain_1_puresky_8k.hdr"

S = json.loads((BAKE / "scene.json").read_text())
FR = np.fromfile(BAKE / "frames.bin", dtype=np.float32).reshape(S["frames"], S["frameFloats"]).astype(np.float64)
LAY, FPS, NF, T = S["layout"], S["fps"], S["frames"], S["T"]
G = 9.81
RNG = np.random.default_rng(12)


def clamp(x, a, b):
    return np.minimum(b, np.maximum(a, x))


def sstep(a, b, x):
    u = clamp((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return u * u * (3 - 2 * u)


def mixf(a, b, u):
    return a + (b - a) * u


# ---------------------------------------------------------------- frames: three.js (Y up) -> Blender (Z up)
C4 = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
C4i = C4.inverted()


def m3(e):
    """three.js Matrix4.elements (column-major) -> mathutils Matrix."""
    return Matrix(((e[0], e[4], e[8], e[12]), (e[1], e[5], e[9], e[13]), (e[2], e[6], e[10], e[14]), (e[3], e[7], e[11], e[15])))


def obj_m(e):
    return C4 @ m3(e) @ C4i


def cam_m(e):
    return C4 @ m3(e)


def b3(p):
    """three.js point(s) -> Blender."""
    p = np.asarray(p, float)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1)


def row(f, key, n=1):
    i = LAY[key]
    return FR[f, i:i + n]


# ---------------------------------------------------------------- the film's sea and boat table, in numpy (three.js frame)
WV = S["waves"]
WK, WA, WW, WDX, WDZ, WQ, WPH = (np.array([w[k] for w in WV]) for k in ("k", "A", "w", "dx", "dz", "Q", "ph"))


def wave_disp(x, z, t):
    f = np.multiply.outer(WK * WDX, x) + np.multiply.outer(WK * WDZ, z) - np.multiply.outer(WW, t) + WPH.reshape(-1, *([1] * np.ndim(x)))
    c, s = np.cos(f), np.sin(f)
    qa = (WQ * WA).reshape(-1, *([1] * np.ndim(x)))
    return (qa * WDX.reshape(qa.shape) * c).sum(0), (WA.reshape(qa.shape) * s).sum(0), (qa * WDZ.reshape(qa.shape) * c).sum(0)


def sea_h(x, z, t):
    x, z = np.asarray(x, float), np.asarray(z, float)
    t = np.broadcast_to(np.asarray(t, float), x.shape)
    px, pz = x.copy(), z.copy()
    for _ in range(4):
        dx, _, dz = wave_disp(px, pz, t)
        px, pz = x - dx, z - dz
    return wave_disp(px, pz, t)[1]


BT = {k: np.array(v) for k, v in S["boat"].items()}
DW, NPB = S["DW"], len(S["boat"]["x"])


def boat_at(w):
    w = np.asarray(w, float)
    f = clamp(w / DW, 0, NPB - 2.0001)
    i = np.floor(f).astype(int)
    k = f - i
    st = {key: a[i] + (a[i + 1] - a[i]) * k for key, a in BT.items()}
    y, p, r = -st["yaw"], st["pitch"], st["roll"]
    cy, sy, cp, sp, cr, sr = np.cos(y), np.sin(y), np.cos(p), np.sin(p), np.cos(r), np.sin(r)
    z0, o1 = np.zeros_like(cy), np.ones_like(cy)
    Ry = np.stack([np.stack([cy, z0, sy], -1), np.stack([z0, o1, z0], -1), np.stack([-sy, z0, cy], -1)], -2)
    Rz = np.stack([np.stack([cp, -sp, z0], -1), np.stack([sp, cp, z0], -1), np.stack([z0, z0, o1], -1)], -2)
    Rx = np.stack([np.stack([o1, z0, z0], -1), np.stack([z0, cr, -sr], -1), np.stack([z0, sr, cr], -1)], -2)
    st["R"] = Ry @ Rz @ Rx  # three.js Euler 'YZX'
    st["pos"] = np.stack([st["x"], st["y"], st["z"]], -1)
    st["Fh"] = np.stack([np.cos(st["yaw"]), z0, np.sin(st["yaw"])], -1)
    st["Rh"] = np.stack([-np.sin(st["yaw"]), z0, np.cos(st["yaw"])], -1)
    return st


def to_world(st, local):
    return st["pos"] + np.einsum("...ij,...j->...i", st["R"], local)


# ---------------------------------------------------------------- node helpers
def sock(sockets, ident):
    for s in sockets:
        if s.identifier == ident:
            return s
    raise KeyError(ident)


class Tree:
    def __init__(self, nt):
        self.nt, self.n, self.l = nt, nt.nodes, nt.links

    def set(self, s, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.l.new(v, s)
        elif isinstance(v, bpy.types.Node):
            self.l.new(v.outputs[0], s)
        elif v is not None:
            s.default_value = v

    def new(self, typ, ins=None, **props):
        node = self.n.new(typ)
        for k, v in props.items():
            setattr(node, k, v)
        for k, v in (ins or {}).items():
            self.set(node.inputs[k], v)
        return node

    def math(self, op, a, b=0.0, c=0.0, clamp=False):
        node = self.new("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.set(node.inputs[0], a); self.set(node.inputs[1], b); self.set(node.inputs[2], c)
        return node.outputs[0]

    def add(self, a, b): return self.math("ADD", a, b)
    def sub(self, a, b): return self.math("SUBTRACT", a, b)
    def mul(self, a, b): return self.math("MULTIPLY", a, b)
    def mad(self, a, b, c): return self.math("MULTIPLY_ADD", a, b, c)
    def mx(self, a, b): return self.math("MAXIMUM", a, b)
    def mn(self, a, b): return self.math("MINIMUM", a, b)

    def vec(self, op, a, b=(0, 0, 0), c=(0, 0, 0), scale=None):
        node = self.new("ShaderNodeVectorMath", operation=op)
        self.set(node.inputs[0], a); self.set(node.inputs[1], b); self.set(node.inputs[2], c)
        if scale is not None:
            self.set(node.inputs[3], scale)
        return node.outputs["Value"] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else node.outputs["Vector"]

    def xyz(self, x=0.0, y=0.0, z=0.0):
        node = self.new("ShaderNodeCombineXYZ")
        self.set(node.inputs[0], x); self.set(node.inputs[1], y); self.set(node.inputs[2], z)
        return node.outputs[0]

    def sep(self, v):
        node = self.new("ShaderNodeSeparateXYZ")
        self.set(node.inputs[0], v)
        return node.outputs

    def value(self, v, name=None):
        node = self.new("ShaderNodeValue")
        node.outputs[0].default_value = v
        if name:
            node.name = node.label = name
        return node.outputs[0]

    def ss(self, e0, e1, x, lo=0.0, hi=1.0):
        node = self.new("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        for i, v in enumerate((x, e0, e1, lo, hi)):
            self.set(node.inputs[i], v)
        return node.outputs[0]

    def lerp(self, a, b, u):
        return self.mad(self.sub(b, a), u, a)

    def rgb(self, fac, a, b, blend="MIX"):
        node = self.new("ShaderNodeMix", data_type="RGBA", blend_type=blend, clamp_result=True)
        self.set(sock(node.inputs, "Factor_Float"), fac); self.set(sock(node.inputs, "A_Color"), a); self.set(sock(node.inputs, "B_Color"), b)
        return sock(node.outputs, "Result_Color")

    def shmix(self, fac, a, b):
        node = self.new("ShaderNodeMixShader")
        self.set(node.inputs[0], fac); self.set(node.inputs[1], a); self.set(node.inputs[2], b)
        return node.outputs[0]

    def noise(self, vec, scale, detail=2.0, rough=0.5, w=None, dist=0.0):
        node = self.new("ShaderNodeTexNoise", noise_dimensions="4D" if w is not None else "3D")
        self.set(node.inputs["Vector"], vec); self.set(node.inputs["Scale"], scale); self.set(node.inputs["Detail"], detail)
        self.set(node.inputs["Roughness"], rough); self.set(node.inputs["Distortion"], dist)
        if w is not None:
            self.set(node.inputs["W"], w)
        return node.outputs["Fac"]

    def image(self, img, vec, proj="FLAT", blend=0.0, ext="REPEAT", interp="Linear"):
        node = self.new("ShaderNodeTexImage", image=img, projection=proj, extension=ext, interpolation=interp)
        if proj == "BOX":
            node.projection_blend = blend
        self.set(node.inputs[0], vec)
        return node


def new_material(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    t = Tree(m.node_tree)
    out = t.new("ShaderNodeOutputMaterial", target="CYCLES")
    return m, t, out


def group_tree(name, ins, outs, kind="ShaderNodeTree"):
    ng = bpy.data.node_groups.new(name, kind)
    for n, st in ins:
        ng.interface.new_socket(n, in_out="INPUT", socket_type=st)
    for n, st in outs:
        ng.interface.new_socket(n, in_out="OUTPUT", socket_type=st)
    t = Tree(ng)
    return ng, t, t.new("NodeGroupInput"), t.new("NodeGroupOutput")


def load_image(path, non_color=False):
    img = bpy.data.images.load(str(path), check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def bake_keys(idb, path, values, frames, interp=1):
    """Key `path` on `idb` at every frame in one go: values (n, k); interp 0 constant, 1 linear."""
    values = np.asarray(values, float).reshape(len(frames), -1)
    for i in range(values.shape[1]):
        idb.keyframe_insert(path, index=i if values.shape[1] > 1 or path in ("location", "rotation_quaternion", "rotation_euler", "scale") else -1, frame=float(frames[0]))
    from bpy_extras import anim_utils
    cb = anim_utils.action_get_channelbag_for_slot(idb.animation_data.action, idb.animation_data.action_slot)
    for i in range(values.shape[1]):
        fc = cb.fcurves.find(path, index=i)
        kp = fc.keyframe_points
        kp.clear()
        kp.add(len(frames))
        co = np.empty(2 * len(frames))
        co[0::2], co[1::2] = frames, values[:, i]
        kp.foreach_set("co", co)
        kp.foreach_set("interpolation", np.full(len(frames), interp, dtype=np.int32))
        fc.update()


# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 0, NF - 1
COLL = scene.collection


def link(ob, parent=None):
    COLL.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


# ---- sky: the photographed HDRI, turned so its sun sits where the film's sun was (azimuth); its own elevation kept
# low over the open sea in the west-southwest, so it lights down the fjord instead of hiding behind its south wall
target_az = math.radians(float(os.environ.get("X12_SUN_AZ", "182")))
hdr = load_image(HDRI)
probe = hdr.copy()
probe.scale(512, 256)
px = np.empty(512 * 256 * 4, np.float32)
probe.pixels.foreach_get(px)
px = px.reshape(256, 512, 4)[..., :3]
lum = px @ np.array([0.2126, 0.7152, 0.0722])
vj, ui = np.unravel_index(np.argmax(lum), lum.shape)
u, v = (ui + 0.5) / 512, (vj + 0.5) / 256
hdr_az, hdr_el = (0.5 - u) * 2 * math.pi, (v - 0.5) * math.pi
ROT_Z = hdr_az - target_az
# the haze colour: the sky just above the horizon, away from and toward the sun
band = px[int(256 * 0.505):int(256 * 0.55)]
HAZE = band.reshape(-1, 3).mean(0)
HAZE_SUN = band[:, max(0, ui - 20):ui + 20].reshape(-1, 3).mean(0)
bpy.data.images.remove(probe)
SUN_DIR = Vector((math.cos(hdr_el) * math.cos(target_az), math.cos(hdr_el) * math.sin(target_az), math.sin(hdr_el)))
print(f"sky: sun at {math.degrees(hdr_el):.1f} deg elevation, peak {lum.max():.0f}; haze {HAZE.round(3)}, toward the sun {HAZE_SUN.round(3)}")

world = bpy.data.worlds.new("Fjord sky")
scene.world = world
world.use_nodes = True
world.node_tree.nodes.clear()
wt = Tree(world.node_tree)
wmap = wt.new("ShaderNodeMapping", {"Rotation": (0, 0, ROT_Z)})
wt.set(wmap.inputs["Vector"], wt.new("ShaderNodeTexCoord").outputs["Generated"])
env = wt.new("ShaderNodeTexEnvironment", image=hdr, interpolation="Cubic")
wt.set(env.inputs[0], wmap.outputs[0])
bg = wt.new("ShaderNodeBackground", {"Color": env.outputs[0], "Strength": 1.0})
wt.set(wt.new("ShaderNodeOutputWorld").inputs["Surface"], bg)
world.cycles.sampling_method = "MANUAL"
world.cycles.sample_map_resolution = 4096

# ---- aerial haze: far surfaces fade toward the horizon sky, brighter toward the sun, thinner up the mountains
haze_g, ht, hin, hout = group_tree("X12 Haze", [("Shader", "NodeSocketShader"), ("Amount", "NodeSocketFloat")], [("Shader", "NodeSocketShader")])
hin_def = haze_g.interface.items_tree["Amount"]
hin_def.default_value = 1.0
cd = ht.new("ShaderNodeCameraData")
geo = ht.new("ShaderNodeNewGeometry")
z = ht.sep(geo.outputs["Position"])[2]
ext = ht.mul(cd.outputs["View Distance"], ht.lerp(1.0 / 11000, 1.0 / 26000, ht.ss(0, 1100, z)))
h = ht.mul(ht.sub(1.0, ht.math("EXPONENT", ht.mul(ext, -1.0))), hin.outputs["Amount"])
sunward = ht.math("POWER", ht.mx(ht.vec("DOT_PRODUCT", ht.vec("SCALE", geo.outputs["Incoming"], scale=-1.0), tuple(SUN_DIR)), 0.0), 6.0)
hcol = ht.rgb(sunward, (*HAZE, 1), (*(HAZE_SUN * 1.15), 1))
hem = ht.new("ShaderNodeEmission", {"Color": hcol, "Strength": 1.0})
ht.set(hout.inputs[0], ht.shmix(h, hin.outputs["Shader"], hem.outputs[0]))


def hazed(t, shader, amount=1.0):
    g = t.new("ShaderNodeGroup", node_tree=haze_g)
    t.set(g.inputs[0], shader)
    t.set(g.inputs[1], amount)
    return g.outputs[0]


# ---------------------------------------------------------------- boat
bpy.ops.import_scene.gltf(filepath=str(BAKE / "boat.glb"))
imported = list(bpy.context.selected_objects)
X12 = link(bpy.data.objects.new("X12", None))
for ob in imported:
    if ob.parent is None:
        ob.parent = X12
for ob in imported:
    if ob.type == "MESH" and ob.data.materials and ob.data.materials[0] and ob.data.materials[0].name.startswith("Material"):
        ob.hide_render = True  # a stray default cube in the CAD export
RIG = {ob.name.split(".")[0]: ob for ob in imported if ob.name.startswith("rig_")}
PART = {ob.name.replace("_", " "): ob for ob in imported}  # the exporter writes spaces as underscores
print("rig nodes:", sorted(RIG))


def boat_local_verts(names, zmax=None):
    pts = []
    inv = X12.matrix_world.inverted()
    for name in names:
        root = PART.get(name)
        if root is None:
            continue
        for ob in [root, *root.children_recursive]:
            if ob.type != "MESH":
                continue
            m = inv @ ob.matrix_world
            co = np.empty(len(ob.data.vertices) * 3)
            ob.data.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3) @ np.array(m.to_3x3()).T + np.array(m.translation)
            pts.append(co if zmax is None else co[co[:, 2] < zmax])
    return np.concatenate(pts)


bpy.context.view_layer.update()
# beam of the hull along its length (half-width), for the sea's hull cut-out and the waterline foam
BEAM = np.zeros(128)
for name, zmax in (("Tube collar", 0.75), ("Hull", None)):
    p = boat_local_verts([name], zmax)
    b = np.clip(((p[:, 0] + 6.2) / 12.4 * 128).astype(int), 0, 127)
    np.maximum.at(BEAM, b, np.abs(p[:, 1]))
BEAM = np.maximum(BEAM, 0.5 * (np.roll(BEAM, 1) + np.roll(BEAM, -1))) - 0.08
beam_img = bpy.data.images.new("x12_beam", 128, 1, float_buffer=True, alpha=False)
beam_img.colorspace_settings.name = "Non-Color"
beam_img.pixels.foreach_set(np.repeat(np.maximum(BEAM, 0), 4).astype(np.float32))
beam_img.pack()


def surface_detail(t, base_rough, bevel=0.006, ao_dist=0.35, grime=0.35, streaks=0.0, wet=0.0, obj_coords=None):
    """Shared weathering: rounded edges (bevel normal), dirt in the corners (AO), vertical salt streaks, a wet lower hull.
    Returns (normal, darken factor, roughness)."""
    co = obj_coords or t.new("ShaderNodeTexCoord").outputs["Object"]
    bev = t.new("ShaderNodeBevel", {"Radius": bevel}, samples=6)
    ao = t.new("ShaderNodeAmbientOcclusion", {"Distance": ao_dist}, samples=8, only_local=True)
    dirt = t.mul(t.sub(1.0, ao.outputs["AO"]), grime)
    n1 = t.noise(t.vec("MULTIPLY", co, (22, 22, 1.4)), 1.0, 4.0, 0.6)
    st = t.mul(t.ss(0.48, 0.75, n1), streaks)
    dark = t.mx(dirt, st)
    rough = t.lerp(base_rough, min(1.0, base_rough + 0.25), dark)
    if wet:
        zz = t.sep(co)[2]
        wn = t.noise(t.vec("MULTIPLY", co, (3, 3, 8)), 1.0, 3.0)
        w = t.mul(t.ss(0.95, 0.15, t.add(zz, t.mul(t.sub(wn, 0.5), 0.5))), wet)
        rough = t.lerp(rough, 0.08, w)
        dark = t.mx(dark, t.mul(w, 0.35))
    return bev.outputs["Normal"], dark, rough


def boat_material(m):
    """Rebuild an imported CAD material as a weathered, physically based one, by its name."""
    name = m.name.split(".")[0]
    base = m.node_tree.nodes.get("Principled BSDF")
    col0 = tuple(base.inputs["Base Color"].default_value) if base else (0.5, 0.5, 0.5, 1)
    m.node_tree.nodes.clear()
    t = Tree(m.node_tree)
    out = t.new("ShaderNodeOutputMaterial", target="CYCLES")
    co = t.new("ShaderNodeTexCoord").outputs["Object"]
    p = t.new("ShaderNodeBsdfPrincipled")
    spec = dict(rough=0.5, metal=0.0, coat=0.0, coat_r=0.05, bevel=0.006, grime=0.3, streaks=0.0, wet=0.0, bump=None, col=col0,
                sheen=0.0, film=0.0, trans=0.0, ior=1.5, emit=None)
    if name == "White gelcoat":
        spec.update(col=(0.80, 0.81, 0.80, 1), rough=0.22, coat=0.4, grime=0.4, streaks=0.18, wet=0.6, bump=("orange", 0.004))
    elif name == "Non-skid deck":
        spec.update(col=(0.42, 0.43, 0.43, 1), rough=0.85, grime=0.45, bump=("diamond", 0.6))
    elif name == "Non-slip sole":
        spec.update(rough=0.88, grime=0.4, bump=("diamond", 0.6))
    elif name == "Hypalon":
        spec.update(col=(0.016, 0.017, 0.019, 1), rough=0.58, sheen=0.35, grime=0.25, streaks=0.25, wet=0.9, bump=("fabric", 0.25), bevel=0.0)
    elif name in ("Rubber", "Tube wear patch"):
        spec.update(rough=0.8, wet=0.9, bevel=0.0, bump=("fabric", 0.15))
    elif name == "Haze grey":
        spec.update(col=(0.15, 0.165, 0.178, 1), rough=0.42, coat=0.15, grime=0.45, streaks=0.3, bump=("orange", 0.006))
    elif name == "Stainless":
        spec.update(col=(0.62, 0.62, 0.62, 1), rough=0.16, metal=1.0, grime=0.25)
    elif name in ("Sensor window", "Display screen"):
        spec.update(col=(0.002, 0.002, 0.003, 1), rough=0.03, coat=1.0, film=320.0, bevel=0.002, grime=0.05)
        if name == "Display screen":
            spec.update(emit=((0.05, 0.16, 0.3, 1), 1.5))
    elif name in ("Smoked acrylic", "Tinted glass"):
        spec.update(col=(0.05, 0.06, 0.07, 1), rough=0.02, trans=1.0, bevel=0.002, grime=0.0)
    elif name.startswith("Engine"):
        spec.update(rough=0.32, coat=1.0, coat_r=0.03, grime=0.15, streaks=0.15, wet=0.4, metal=0.3 if "trim" in name else 0.0)
    elif name == "Array face":
        spec.update(rough=0.55, grime=0.3, bump=("tiles", 0.3))
    elif name == "Radome grey":
        spec.update(col=(0.44, 0.45, 0.44, 1), rough=0.55, grime=0.4, streaks=0.3)
    elif name == "Canister":
        spec.update(col=(0.075, 0.085, 0.06, 1), rough=0.6, grime=0.5, streaks=0.35, bump=("orange", 0.008))
    elif name == "Carbon dash":
        spec.update(rough=0.3, coat=1.0, bump=("tiles", 0.1))
    else:
        spec.update(rough=0.5, grime=0.35)
    nrm, dark, rough = surface_detail(t, spec["rough"], spec["bevel"] or 0.0005, grime=spec["grime"], streaks=spec["streaks"], wet=spec["wet"], obj_coords=co)
    if spec["bump"]:
        kind, strength = spec["bump"]
        if kind == "orange":
            hgt = t.noise(co, 350.0, 2.0)
        elif kind == "diamond":
            d1 = t.new("ShaderNodeTexWave", {"Vector": co, "Scale": 90.0}, wave_type="BANDS", bands_direction="DIAGONAL", wave_profile="SAW").outputs["Fac"]
            d2 = t.new("ShaderNodeTexWave", {"Vector": t.vec("MULTIPLY", co, (-1, 1, 1)), "Scale": 90.0}, wave_type="BANDS", bands_direction="DIAGONAL", wave_profile="SAW").outputs["Fac"]
            hgt = t.add(t.mul(t.ss(0.35, 0.65, d1), t.ss(0.35, 0.65, d2)), t.mul(t.noise(co, 220.0), 0.3))
        elif kind == "fabric":
            hgt = t.add(t.noise(co, 900.0, 1.0), t.mul(t.noise(co, 30.0, 3.0), 0.5))
        else:  # tiles
            hgt = t.new("ShaderNodeTexBrick", {"Vector": co, "Scale": 16.0, "Mortar Size": 0.04}).outputs["Fac"]
        nrm = t.new("ShaderNodeBump", {"Strength": strength, "Distance": 0.002, "Height": hgt, "Normal": nrm}).outputs["Normal"]
    col = t.rgb(dark, spec["col"], tuple(c * 0.45 for c in spec["col"][:3]) + (1,))
    t.set(p.inputs["Base Color"], col)
    t.set(p.inputs["Roughness"], rough)
    t.set(p.inputs["Metallic"], spec["metal"])
    t.set(p.inputs["Normal"], nrm)
    t.set(p.inputs["Coat Weight"], spec["coat"])
    t.set(p.inputs["Coat Roughness"], spec["coat_r"])
    t.set(p.inputs["Sheen Weight"], spec["sheen"])
    t.set(p.inputs["Thin Film Thickness"], spec["film"])
    t.set(p.inputs["Transmission Weight"], spec["trans"])
    t.set(p.inputs["IOR"], spec["ior"])
    if spec["emit"]:
        t.set(p.inputs["Emission Color"], spec["emit"][0]); t.set(p.inputs["Emission Strength"], spec["emit"][1])
    t.set(out.inputs["Surface"], p.outputs[0])


for m in {s.material for ob in imported if ob.type == "MESH" for s in ob.material_slots if s.material}:
    boat_material(m)
# the hull below the waterline in antifouling, a boot stripe on the line
hull_mats = set()
for ob in [PART.get("Hull"), *(PART["Hull"].children_recursive if PART.get("Hull") else [])]:
    if ob is not None and ob.type == "MESH":
        for s in ob.material_slots:
            if s.material and s.material not in hull_mats:
                hm = s.material.copy(); hm.name = "Hull gelcoat"
                ht2 = Tree(hm.node_tree)
                pr = next(n for n in hm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
                zc = ht2.sep(ht2.new("ShaderNodeTexCoord").outputs["Object"])[2]
                below = ht2.ss(0.06, 0.03, zc)
                stripe = ht2.mul(ht2.ss(0.06, 0.075, zc), ht2.ss(0.13, 0.115, zc))
                c1 = ht2.rgb(below, pr.inputs["Base Color"].links[0].from_socket if pr.inputs["Base Color"].is_linked else (0.8, 0.8, 0.8, 1), (0.018, 0.02, 0.024, 1))
                c2 = ht2.rgb(stripe, c1, (0.012, 0.013, 0.015, 1))
                ht2.set(pr.inputs["Base Color"], c2)
                s.material = hm
                hull_mats.add(hm)

# hull numbers on the tubes, shrink-wrapped onto them like vinyl
vinyl, vt, vout = new_material("Hull number vinyl")
vt.set(vout.inputs["Surface"], vt.new("ShaderNodeBsdfPrincipled", {"Base Color": (0.55, 0.56, 0.55, 1), "Roughness": 0.45}).outputs[0])
tube = PART.get("Tube collar")
tube_mesh = next((o for o in ([tube] + list(tube.children_recursive) if tube else []) if o.type == "MESH"), None)
if tube_mesh is not None:
    tp_ = boat_local_verts(["Tube collar"])
    for side in (1, -1):
        sel = tp_[(np.abs(tp_[:, 0] - 2.6) < 0.3) & (tp_[:, 1] * side > 0)]
        ymax, zc = np.abs(sel[:, 1]).max(), sel[np.abs(sel[:, 1]).argmax(), 2]
        cu = bpy.data.curves.new(f"hull number {side}", "FONT")
        cu.body, cu.size, cu.align_x, cu.align_y = "X-12", 0.34, "CENTER", "CENTER"
        tob = bpy.data.objects.new("tmp", cu)
        COLL.objects.link(tob)
        bpy.context.view_layer.update()
        me = bpy.data.meshes.new_from_object(tob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        bpy.data.objects.remove(tob)
        me.materials.clear(); me.materials.append(vinyl)
        hn = link(bpy.data.objects.new(f"hull number {side}", me), X12)
        hn.location = (2.6, side * (ymax + 0.05), zc)
        hn.rotation_euler = (math.pi / 2, 0, math.pi if side > 0 else 0.0)  # read left to right from each side
        ss_ = hn.modifiers.new("fine", "SUBSURF"); ss_.subdivision_type = "SIMPLE"; ss_.levels = ss_.render_levels = 3
        sw = hn.modifiers.new("wrap", "SHRINKWRAP"); sw.target = tube_mesh; sw.wrap_method = "NEAREST_SURFACEPOINT"; sw.offset = 0.003

# ---------------------------------------------------------------- ocean: the film's swell plus short chop, as true displacement
CHOP = []
crng = np.random.default_rng(5)
for i in range(26):
    L = 0.55 * (9.0 / 0.55) ** (i / 25)
    k = 2 * math.pi / L
    ang = math.radians(180 + crng.normal(0, 38))
    A = (0.055 + 0.02 * crng.random()) / k
    CHOP.append(dict(L=L, k=k, A=A, w=math.sqrt(G * k), dx=math.cos(ang), dz=math.sin(ang), Q=0.014 / (k * A), ph=crng.random() * 6.283))
ALLW = list(WV) + CHOP

waves_g, wt2, win, wout = group_tree("X12 Waves", [("P0", "NodeSocketVector"), ("Time", "NodeSocketFloat"), ("Dist", "NodeSocketFloat")],
                                     [("Disp", "NodeSocketVector"), ("Jac", "NodeSocketFloat"), ("Height", "NodeSocketFloat")])
acc, J = (0.0, 0.0, 0.0), (1.0, 1.0, 0.0)
for w in ALLW:
    k, A, Q = w["k"], w["A"], w["Q"]
    f = wt2.add(wt2.vec("DOT_PRODUCT", win.outputs["P0"], (k * w["dx"], -k * w["dz"], 0.0)), wt2.mad(win.outputs["Time"], -w["w"], w["ph"]))
    amp = wt2.ss(w["L"] * 40, w["L"] * 120, win.outputs["Dist"], A, 0.0)
    ac, as_ = wt2.mul(amp, wt2.math("COSINE", f)), wt2.mul(amp, wt2.math("SINE", f))
    acc = wt2.vec("MULTIPLY_ADD", (Q * w["dx"], -Q * w["dz"], 0.0), ac, acc)
    acc = wt2.vec("MULTIPLY_ADD", (0.0, 0.0, 1.0), as_, acc)
    J = wt2.vec("MULTIPLY_ADD", (-Q * k * w["dx"] ** 2, -Q * k * w["dz"] ** 2, -Q * k * w["dx"] * w["dz"]), as_, J)
js = wt2.sep(J)
wt2.set(wout.inputs["Disp"], acc)
wt2.set(wout.inputs["Jac"], wt2.sub(wt2.mul(js[0], js[1]), wt2.mul(js[2], js[2])))
wt2.set(wout.inputs["Height"], wt2.sep(acc)[2])

RAS_N, RAS = 1024, {}
for key, size in (("near", 220.0), ("far", 2400.0)):
    img = bpy.data.images.new(f"x12_foam_{key}", RAS_N, RAS_N, float_buffer=True, alpha=True)
    img.colorspace_settings.name = "Non-Color"
    RAS[key] = dict(img=img, size=size)

ocean_m, ot, oout = new_material("Sea")
ocean_m.displacement_method = "DISPLACEMENT"
P0 = ot.new("ShaderNodeAttribute", attribute_name="p0").outputs["Vector"]
V_TIME = ot.value(0.0, "time")
V_CAM = ot.xyz(ot.value(0.0, "camx"), ot.value(0.0, "camy"), ot.value(0.0, "camz"))
dist = ot.vec("DISTANCE", P0, V_CAM)


RAS_V = {}


def raster(t, key, p0):
    if key not in RAS_V:
        RAS_V[key] = (t.xyz(t.value(0.0, f"{key}_cx"), t.value(0.0, f"{key}_cy"), 0.0), t.value(RAS[key]["size"], f"{key}_size"))
    c, s = RAS_V[key]
    uv = t.vec("ADD", t.vec("DIVIDE", t.vec("SUBTRACT", p0, c), t.xyz(s, s, 1.0)), (0.5, 0.5, 0.0))
    node = t.image(RAS[key]["img"], uv, ext="CLIP")
    uvs = t.sep(uv)
    inside = t.mul(t.mul(t.ss(0.0, 0.04, uvs[0]), t.ss(1.0, 0.96, uvs[0])), t.mul(t.ss(0.0, 0.04, uvs[1]), t.ss(1.0, 0.96, uvs[1])))
    return node.outputs["Color"], inside


def foam_raster(t, p0):
    cn, inn = raster(t, "near", p0)
    cf, _ = raster(t, "far", p0)
    return t.sep(t.rgb(inn, cf, cn))  # R foam, G age, B wake wave height


# displacement
wd = ot.new("ShaderNodeGroup", node_tree=waves_g)
ot.set(wd.inputs["P0"], P0); ot.set(wd.inputs["Time"], V_TIME); ot.set(wd.inputs["Dist"], dist)
fr_d = foam_raster(ot, P0)
disp = ot.vec("ADD", wd.outputs["Disp"], ot.xyz(0.0, 0.0, ot.add(fr_d[2], ot.mul(fr_d[0], 0.04))))
vd = ot.new("ShaderNodeVectorDisplacement", {"Vector": disp, "Midlevel": 0.0, "Scale": 1.0}, space="OBJECT")
ot.set(oout.inputs["Displacement"], vd.outputs[0])
# surface
ws = ot.new("ShaderNodeGroup", node_tree=waves_g)
ot.set(ws.inputs["P0"], P0); ot.set(ws.inputs["Time"], V_TIME); ot.set(ws.inputs["Dist"], dist)
fr = foam_raster(ot, P0)
height, jac = ws.outputs["Height"], ws.outputs["Jac"]
drift = ot.vec("ADD", P0, ot.xyz(ot.mul(V_TIME, -0.6), 0.0, 0.0))
fn = ot.add(ot.mul(ot.noise(drift, 0.35, 3.0, 0.55, w=ot.mul(V_TIME, 0.05)), 0.6), ot.mul(ot.noise(drift, 2.2, 2.0, 0.5, w=ot.mul(V_TIME, 0.2)), 0.4))
lace = ot.new("ShaderNodeTexVoronoi", {"Vector": drift, "Scale": 1.6, "Randomness": 0.9}, feature="DISTANCE_TO_EDGE").outputs["Distance"]
cap = ot.mul(ot.ss(0.8, 0.3, jac), ot.ss(-0.15, 0.7, height))
# wind streaks: foam drawn out in lines downwind (the swell runs toward -x), patchy
streak_n = ot.noise(ot.vec("MULTIPLY", ot.vec("ADD", P0, ot.xyz(ot.mul(V_TIME, -3.0), 0.0, 0.0)), (0.035, 0.6, 1.0)), 1.0, 4.0, 0.55)
streaks = ot.mul(ot.mul(ot.ss(0.62, 0.78, streak_n), ot.ss(0.45, 0.7, ot.noise(P0, 0.004, 2.0))), 0.55)
fmask = ot.mx(ot.mx(ot.mul(cap, 0.95), streaks), fr[0])
age = fr[1]
pattern = ot.lerp(ot.add(0.55, ot.mul(fn, 0.9)), ot.add(ot.mul(ot.ss(0.0, 0.09, lace), -1.0), 1.25), ot.mul(age, 0.8))
foam = ot.ss(0.28, 0.8, ot.mul(fmask, pattern))
# capillary ripples and wind texture, as a bump on top of the displaced swell
rip = ot.add(ot.noise(ot.vec("MULTIPLY", drift, (1.0, 1.6, 1.0)), 3.5, 3.0, 0.6, w=ot.mul(V_TIME, 0.6)), ot.mul(ot.noise(drift, 14.0, 2.0, 0.5, w=V_TIME), 0.35))
rip_fade = ot.ss(250.0, 30.0, dist)
bump = ot.new("ShaderNodeBump", {"Strength": ot.mul(rip_fade, 0.22), "Distance": 0.06, "Height": rip})
water = ot.new("ShaderNodeBsdfPrincipled", {"Base Color": (0.0025, 0.011, 0.014, 1), "Roughness": ot.lerp(0.02, 0.07, ot.ss(60.0, 900.0, dist)), "IOR": 1.333,
                                             "Normal": bump.outputs["Normal"], "Subsurface Weight": 0.0})
# light through the thin crests, seen only looking toward the sun
og = ot.new("ShaderNodeNewGeometry")
back = ot.math("POWER", ot.mx(ot.vec("DOT_PRODUCT", ot.vec("SCALE", og.outputs["Incoming"], scale=-1.0), tuple(SUN_DIR)), 0.0), 8.0)
crest = ot.mul(ot.mul(ot.mul(ot.ss(0.4, 1.8, height), back), ot.ss(400.0, 60.0, dist)), 0.6)
glow = ot.new("ShaderNodeEmission", {"Color": (0.02, 0.1, 0.075, 1), "Strength": crest})
water_sh = ot.new("ShaderNodeAddShader")
ot.set(water_sh.inputs[0], water.outputs[0])
ot.set(water_sh.inputs[1], glow.outputs[0])
foam_bsdf = ot.new("ShaderNodeBsdfPrincipled", {"Base Color": (0.78, 0.82, 0.84, 1), "Roughness": 0.7, "Subsurface Weight": 0.15,
                                                 "Subsurface Radius": (0.3, 0.4, 0.45), "Subsurface Scale": 0.05})
sea_sh = ot.shmix(foam, water_sh.outputs[0], foam_bsdf.outputs[0])
# inside the hull's waterplane the sea is the boat's business: no water over the cockpit sole
bl = ot.new("ShaderNodeTexCoord", object=X12).outputs["Object"]
bls = ot.sep(bl)
bx, by, bz = bls[0], ot.math("ABSOLUTE", bls[1]), bls[2]
beam_u = ot.xyz(ot.mul(ot.add(bx, 6.2), 1 / 12.4), 0.5, 0.0)
beam = ot.image(beam_img, beam_u, ext="EXTEND").outputs["Color"]
edge = ot.sub(by, ot.sep(beam)[0])
in_x = ot.mul(ot.math("GREATER_THAN", bx, -6.0), ot.math("LESS_THAN", bx, 6.1))
in_foot = ot.mul(in_x, ot.math("LESS_THAN", edge, -0.04))
hull_bot = ot.add(ot.lerp(-0.45, 0.02, ot.math("MINIMUM", ot.mul(by, 1 / 1.4), 1.0)), ot.add(ot.mul(ot.math("POWER", ot.mx(ot.sub(bx, 2.5), 0.0), 2.0), 0.14), 0.05))
cut = ot.mul(in_foot, ot.mul(ot.math("GREATER_THAN", bz, hull_bot), ot.math("LESS_THAN", bz, 1.2)))
sea_sh = ot.shmix(cut, sea_sh, ot.new("ShaderNodeBsdfTransparent").outputs[0])
ot.set(oout.inputs["Surface"], hazed(ot, sea_sh))
OCEAN_VALUES = {n.name: n for n in ocean_m.node_tree.nodes if n.type == "VALUE"}

ocean_me = bpy.data.meshes.new("Sea")
NG_O, SIZE_O = 360, 32000.0
gx = np.linspace(-SIZE_O / 2, SIZE_O / 2, NG_O + 1)
X, Y = np.meshgrid(gx, gx)
co = np.stack([X.ravel(), Y.ravel(), np.zeros(X.size)], -1)
ii = np.arange(NG_O)
q = (ii[None, :] + ii[:, None] * (NG_O + 1)).ravel()
quads = np.stack([q, q + 1, q + NG_O + 2, q + NG_O + 1], -1)


def build_mesh(me, co, quads):
    me.vertices.add(len(co))
    me.vertices.foreach_set("co", np.asarray(co, np.float32).ravel())
    me.loops.add(quads.size)
    me.loops.foreach_set("vertex_index", quads.astype(np.int32).ravel())
    me.polygons.add(len(quads))
    me.polygons.foreach_set("loop_start", np.arange(0, quads.size, quads.shape[1], dtype=np.int32))
    me.update(calc_edges=True)
    me.polygons.foreach_set("use_smooth", np.ones(len(quads), bool))


build_mesh(ocean_me, co, quads)
pa = ocean_me.attributes.new("p0", "FLOAT_VECTOR", "POINT")
pa.data.foreach_set("vector", co.astype(np.float32).ravel())
ocean_me.materials.append(ocean_m)
OCEAN = link(bpy.data.objects.new("Sea", ocean_me))
sub = OCEAN.modifiers.new("dice", "SUBSURF")
sub.subdivision_type = "SIMPLE"
sub.levels = 0
sub.render_levels = 1
sub.use_adaptive_subdivision = True
sub.adaptive_pixel_size = DICING
OCEAN.visible_shadow = False

# ---------------------------------------------------------------- terrain: the film's fjord on an 8 m grid, eroded
TER = S["ter"]
cache = WORK / "terrain_eroded.npy"
if cache.exists():
    TH, FLOW = np.load(cache)
else:
    t0 = time.time()
    H = np.fromfile(BAKE / "terrain.bin", dtype=np.float32).reshape(TER["nz"], TER["nx"]).astype(np.float64)
    step = TER["step"]
    nz_, nx_ = H.shape
    idx = np.arange(H.size).reshape(H.shape)
    nb = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    for it in range(4):
        pad = np.pad(H, 1, mode="edge")
        best, down = np.zeros_like(H), np.full(H.shape, -1)
        for dj, di in nb:
            hn = pad[1 + dj:1 + dj + nz_, 1 + di:1 + di + nx_]
            drop = (H - hn) / (step * math.hypot(di, dj))
            better = drop > best
            best[better] = drop[better]
            nj, ni = np.clip(np.arange(nz_)[:, None] + dj, 0, nz_ - 1), np.clip(np.arange(nx_)[None, :] + di, 0, nx_ - 1)
            down[better] = (nj * nx_ + ni + 0 * idx)[better]
        order = np.argsort(-H.ravel(), kind="stable").tolist()
        dl = down.ravel().tolist()
        acc = [1.0] * H.size
        for c in order:
            d = dl[c]
            if d >= 0:
                acc[d] += acc[c]
        A = np.array(acc).reshape(H.shape) * step * step
        land = sstep(3, 25, H)
        cut_ = np.minimum(0.011 * np.sqrt(A) * np.minimum(best, 1.6), 9.0) * land
        H = H - cut_
        # thermal: only spikes steeper than ~55 deg shed rock downhill; the fjord walls stay walls
        for _ in range(10):
            dh = np.zeros_like(H)
            for dj, di in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                hn = np.roll(H, (-dj, -di), axis=(0, 1))
                flux = np.maximum(H - hn - 1.4 * step, 0) * 0.1 * land
                dh -= flux
                dh += np.roll(flux, (dj, di), axis=(0, 1))
            H = H + dh
        print(f"erosion pass {it + 1}: max cut {cut_.max():.1f} m ({time.time() - t0:.0f} s)")
    FLOW = np.clip(np.log10(A) / 6.5, 0, 1)
    TH = H
    np.save(cache, np.stack([TH, FLOW]))

nz_, nx_ = TH.shape
gx = TER["x0"] + np.arange(nx_) * TER["step"]
gz = TER["z0"] + np.arange(nz_) * TER["step"]
GX, GZ = np.meshgrid(gx, gz)
tco = np.stack([GX.ravel(), -GZ.ravel(), TH.ravel()], -1)
jj, ii2 = np.meshgrid(np.arange(nz_ - 1), np.arange(nx_ - 1), indexing="ij")
q = (jj * nx_ + ii2).ravel()
tq = np.stack([q, q + nx_, q + nx_ + 1, q + 1], -1)  # z flips to -y: keep the faces pointing up
keep = TH.ravel()[tq].max(1) > -4.0
tq = tq[keep]
used = np.unique(tq)
remap = np.full(len(tco), -1)
remap[used] = np.arange(len(used))
ter_me = bpy.data.meshes.new("Fjord")
build_mesh(ter_me, tco[used], remap[tq])
fa = ter_me.attributes.new("flow", "FLOAT", "POINT")
fa.data.foreach_set("value", FLOW.ravel()[used].astype(np.float32))
TERRAIN = link(bpy.data.objects.new("Fjord", ter_me))
print(f"terrain mesh: {len(used)} vertices, {len(tq)} faces")

# far ranges beyond the mesh, open to the sea in the west (the film's ring, with more relief)
segs, rings = 720, 10
fr_rng = np.random.default_rng(9)
ph = fr_rng.random(8) * 6.283
a = np.linspace(0, 2 * math.pi, segs + 1)
uu = np.linspace(0, 1, rings + 1)
A_, U_ = np.meshgrid(a, uu)
rad = mixf(7600, 14000, U_)
west = sstep(0.35, 0.8, -np.cos(A_))
hring = (520 + 400 * np.sin(3 * A_ + ph[0]) * np.sin(7 * A_ + ph[1]) + 230 * np.sin(13 * A_ + ph[2]) + 110 * np.sin(29 * A_ + ph[3])
         + 50 * np.sin(61 * A_ + ph[4]) + 25 * np.sin(127 * A_ + ph[5])) * np.sin(np.pi * np.minimum(1, U_ * 1.4)) * (1 - 0.9 * west)
rco = np.stack([np.cos(A_) * rad, -np.sin(A_) * rad, np.maximum(-20, hring)], -1).reshape(-1, 3)
jr, ir = np.meshgrid(np.arange(rings), np.arange(segs), indexing="ij")
q = (jr * (segs + 1) + ir).ravel()
rq = np.stack([q, q + 1, q + segs + 2, q + segs + 1], -1)
ring_me = bpy.data.meshes.new("Far ranges")
build_mesh(ring_me, rco, rq)
ring_me.attributes.new("flow", "FLOAT", "POINT")
RING = link(bpy.data.objects.new("Far ranges", ring_me))

# terrain material: photographed rock, snow and heath, mixed by height, slope and the erosion's flow lines
tex = {k: load_image(ASSETS / f"{k}_diffuse_4k.jpg") for k in ("aerial_rocks_04", "rock_face_03", "snow_field_aerial", "aerial_grass_rock")}
ter_m, tt, tout = new_material("Fjord ground")
ter_m.displacement_method = "BOTH"
tco_ = tt.new("ShaderNodeTexCoord").outputs["Object"]
tg = tt.new("ShaderNodeNewGeometry")
tpos = tt.sep(tg.outputs["Position"])
tz = tpos[2]
ny = tt.sep(tg.outputs["Normal"])[2]
flow = tt.new("ShaderNodeAttribute", attribute_name="flow").outputs["Fac"]
n_big = tt.noise(tco_, 1 / 900.0, 3.0)
n_mid = tt.noise(tco_, 1 / 120.0, 4.0)
n_sm = tt.noise(tco_, 1 / 18.0, 3.0)


def tex_at(name, tile, proj="BOX"):
    v = tt.vec("SCALE", tco_, scale=1.0 / tile)
    return tt.image(tex[name], v, proj=proj, blend=0.25).outputs["Color"]


rock_far = tex_at("aerial_rocks_04", 140.0)
rock_near = tex_at("rock_face_03", 7.0)
cam_d = tt.new("ShaderNodeCameraData").outputs["View Distance"]
near_w = tt.ss(500.0, 120.0, cam_d)
rock = tt.rgb(near_w, rock_far, tt.rgb(0.5, rock_far, rock_near, "OVERLAY"))
rock = tt.new("ShaderNodeHueSaturation", {"Saturation": 0.35, "Value": 0.85, "Color": rock}).outputs["Color"]
rock = tt.rgb(1.0, rock, (0.92, 0.95, 1.0, 1), "MULTIPLY")
rock = tt.rgb(tt.mul(tt.ss(0.25, 0.7, flow), 0.45), rock, (0.02, 0.022, 0.024, 1))  # wet, dark streaks down the gullies
snow_c = tt.rgb(1.0, tex_at("snow_field_aerial", 180.0, "FLAT"), (0.95, 0.97, 1.0, 1), "MULTIPLY")
heath = tex_at("aerial_grass_rock", 22.0, "FLAT")
heath = tt.new("ShaderNodeHueSaturation", {"Hue": 0.47, "Saturation": 0.55, "Value": 0.55, "Color": heath}).outputs["Color"]  # late-winter heath: brown, not green
birch = tt.rgb(0.6, heath, (0.07, 0.055, 0.05, 1), "MULTIPLY")
line = tt.add(260.0, tt.mul(tt.sub(n_big, 0.5), 320.0))
snow = tt.mul(tt.ss(tt.sub(line, 60.0), tt.add(line, 50.0), tz), tt.ss(0.5, 0.72, tt.add(ny, tt.mul(tt.sub(n_sm, 0.5), 0.25))))
snow = tt.mx(snow, tt.mul(tt.mul(tt.ss(160.0, 320.0, tz), tt.ss(0.3, 0.6, flow)), tt.ss(0.25, 0.45, ny)))  # couloirs hold snow
snow = tt.mx(snow, tt.mul(tt.ss(120.0, 260.0, tz), tt.mul(tt.ss(0.82, 0.92, ny), tt.ss(0.4, 0.6, n_mid))))
veg = tt.mul(tt.ss(tt.add(300.0, tt.mul(n_mid, 140.0)), tt.add(120.0, tt.mul(n_mid, 140.0)), tz), tt.ss(0.6, 0.8, ny))
forest = tt.mul(tt.mul(veg, tt.ss(tt.add(160.0, tt.mul(n_sm, 80.0)), 40.0, tz)), tt.ss(0.4, 0.6, n_mid))
col = tt.rgb(veg, rock, heath)
col = tt.rgb(forest, col, birch)
weed = tt.mul(tt.ss(-1.0, 0.2, tz), tt.ss(2.6, 1.2, tz))  # the tidal band: wet rock and kelp
col = tt.rgb(tt.mul(weed, 0.9), col, (0.03, 0.026, 0.012, 1))
col = tt.rgb(snow, col, snow_c)
lum = tt.new("ShaderNodeRGBToBW", {"Color": tt.rgb(near_w, rock_far, rock_near)}).outputs["Val"]
tb = tt.new("ShaderNodeBump", {"Strength": tt.lerp(0.35, 0.15, snow), "Distance": 0.6, "Height": lum})
tp = tt.new("ShaderNodeBsdfPrincipled", {"Base Color": col, "Roughness": tt.lerp(tt.lerp(0.85, 0.3, weed), 0.55, snow), "Normal": tb.outputs["Normal"],
                                         "Subsurface Weight": tt.mul(snow, 0.25), "Subsurface Radius": (0.6, 0.8, 1.0), "Subsurface Scale": 0.08})
tt.set(tout.inputs["Surface"], hazed(tt, tp.outputs[0]))
# true relief on the near rock: the rock texture's light and dark as height, only where the camera is close
tdisp = tt.new("ShaderNodeDisplacement", {"Height": tt.mul(tt.mul(tt.sub(lum, 0.5), tt.sub(1.0, snow)), near_w), "Midlevel": 0.0, "Scale": 2.5})
tt.set(tout.inputs["Displacement"], tdisp.outputs[0])
for me in (ter_me, ring_me):
    me.materials.append(ter_m)
if os.environ.get("X12_TERRAIN_DICE"):  # true rock relief: costly, re-tessellated every frame on the CPU
    tsub = TERRAIN.modifiers.new("dice", "SUBSURF")
    tsub.subdivision_type = "SIMPLE"
    tsub.levels, tsub.render_levels = 0, 1
    tsub.use_adaptive_subdivision = True
    tsub.adaptive_pixel_size = max(2.0, DICING * 2)

# ---------------------------------------------------------------- escorts: hulls lofted from stations, superstructure, containers
def paint(name, colour, rough=0.5, rust=0.3, metal=0.0):
    m, t, out = new_material(name)
    co = t.new("ShaderNodeTexCoord").outputs["Object"]
    n1 = t.noise(t.vec("MULTIPLY", co, (1.2, 1.2, 0.08)), 1.0, 4.0, 0.6)
    streak = t.mul(t.ss(0.55, 0.8, n1), rust)
    ao = t.new("ShaderNodeAmbientOcclusion", {"Distance": 2.0}, samples=4, only_local=True)
    dirt = t.mul(t.sub(1.0, ao.outputs["AO"]), 0.4)
    c = t.rgb(streak, colour, (0.16, 0.07, 0.035, 1))
    c = t.rgb(dirt, c, (0.02, 0.02, 0.02, 1))
    p = t.new("ShaderNodeBsdfPrincipled", {"Base Color": c, "Roughness": t.lerp(rough, 0.8, streak), "Metallic": metal,
                                            "Normal": t.new("ShaderNodeBevel", {"Radius": 0.04}, samples=4).outputs["Normal"]})
    t.set(out.inputs["Surface"], hazed(t, p.outputs[0]))
    return m


def mesh_obj(name, verts, faces, mat, parent=None, bevel=0.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me), parent)
    if bevel:
        bm = ob.modifiers.new("bevel", "BEVEL")
        bm.width, bm.segments, bm.limit_method = bevel, 2, "ANGLE"
    return ob


def box(name, size, at, mat, parent, bevel=0.06, rot=0.0):
    sx, sy, sz = (s / 2 for s in size)
    v = np.array([[x, y, z] for z in (-sz, sz) for y in (-sy, sy) for x in (-sx, sx)])
    if rot:
        c, s = math.cos(rot), math.sin(rot)
        v = v @ np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]).T
    v = v + np.array(at)
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return mesh_obj(name, v, f, mat, parent, bevel)


def cyl(name, r, h, at, mat, parent, n=20, axis="Z"):
    a = np.linspace(0, 2 * math.pi, n, endpoint=False)
    ring = np.stack([np.cos(a) * r, np.sin(a) * r], -1)
    v = [(x, y, -h / 2) for x, y in ring] + [(x, y, h / 2) for x, y in ring]
    v = np.array(v)
    if axis == "X":
        v = v[:, [2, 0, 1]]
    v = v + np.array(at)
    f = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)] + [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    return mesh_obj(name, v, f, mat, parent)


def hull(name, L, B, draft, free, mat, parent, flare=0.06):
    xs = np.linspace(-L / 2, L / 2, 48)
    sec = [(1.0 + flare, free), (1.0, 0.0), (0.93, -draft * 0.6), (0.6, -draft), (0.0, -draft)]
    verts, rows = [], []
    for x in xs:
        u = (x - 0.18 * L) / (0.32 * L)
        hb = B / 2 * (math.sqrt(max(0.0, 1 - u * u)) if u > 0 else (0.86 + 0.14 * min(1, (x + L / 2) / (0.12 * L))))
        hb = max(hb, 0.02)
        rowi = []
        pts = [(1, *s) for s in sec] + [(-1, *s) for s in reversed(sec[:-1])]
        for side, fy, zz in pts:
            zz2 = zz + (0.04 * L * max(0.0, (x / (L / 2)) - 0.6) ** 2 if zz == free else 0.0)  # sheer up toward the bow
            rowi.append(len(verts))
            verts.append((x, side * hb * fy, zz2))
        rows.append(rowi)
    faces = []
    m = len(rows[0])
    for a_, b_ in zip(rows[:-1], rows[1:]):
        for i in range(m - 1):
            faces.append((a_[i], a_[i + 1], b_[i + 1], b_[i]))
        faces.append((a_[-1], a_[0], b_[0], b_[-1]))  # deck
    faces.append(tuple(rows[0]))
    faces.append(tuple(reversed(rows[-1])))
    return mesh_obj(name, verts, faces, mat, parent)


def build_ship(i, s):
    root = link(bpy.data.objects.new(f"Escort {i} {s['kind']}", None))
    L, B = s["L"], s["B"]
    free, draft = (6.0, 5.0) if s["kind"] == "cargo" else (4.2, 3.0)
    hull_c = {"cargo": (0.12, 0.025, 0.02, 1), "patrol": (0.085, 0.095, 0.105, 1), "supply": (0.018, 0.05, 0.12, 1)}[s["kind"]]
    sup_c = {"cargo": (0.75, 0.74, 0.71, 1), "patrol": (0.2, 0.22, 0.24, 1), "supply": (0.75, 0.74, 0.71, 1)}[s["kind"]]
    hm, sm = paint(f"{s['kind']} hull", hull_c, 0.45, 0.45), paint(f"{s['kind']} superstructure", sup_c, 0.4, 0.2)
    dark, glass = paint("ship dark", (0.015, 0.016, 0.018, 1), 0.5, 0.1), paint("ship glass", (0.005, 0.007, 0.009, 1), 0.08, 0.0)
    hull(f"hull {i}", L, B, draft, free, hm, root)
    d = free
    if s["kind"] == "cargo":
        box("house", (14, B * 0.86, 9), (-L / 2 + 9, 0, d + 4.5), sm, root)
        box("bridge", (9, B * 1.04, 3), (-L / 2 + 10, 0, d + 10.5), sm, root)
        box("bridge windows", (9.1, B * 1.05, 1.1), (-L / 2 + 10, 0, d + 10.7), glass, root, 0.0)
        for k in range(3):
            box(f"house windows {k}", (14.05, B * 0.87, 0.8), (-L / 2 + 9, 0, d + 2 + k * 2.6), glass, root, 0.0)
        box("funnel", (3, 3, 7), (-L / 2 + 4, 0, d + 12), sm, root)
        box("funnel top", (3.1, 3.1, 1.2), (-L / 2 + 4, 0, d + 15.3), dark, root)
        cols = [(0.32, 0.05, 0.03, 1), (0.05, 0.12, 0.26, 1), (0.08, 0.2, 0.07, 1), (0.42, 0.25, 0.04, 1), (0.25, 0.26, 0.27, 1), (0.6, 0.6, 0.58, 1)]
        cm = [paint(f"container {k}", c, 0.55, 0.35, 0.2) for k, c in enumerate(cols)]
        for k in range(7):
            for lvl in range(2 + (k % 3 == 1)):
                for side in (-1, 1):
                    box(f"box {k} {lvl} {side}", (6.0, B * 0.4, 2.55), (-L / 2 + 22 + k * 7.0, side * B * 0.21, d + 1.3 + lvl * 2.6), cm[(k * 3 + lvl + side) % 6], root, 0.03)
        box("mast", (0.6, 0.6, 8), (L * 0.42, 0, d + 4), dark, root, 0.0)
    elif s["kind"] == "patrol":
        box("house", (L * 0.32, B * 0.78, 5), (L * 0.02, 0, d + 2.5), sm, root, 0.1)
        box("bridge", (L * 0.16, B * 0.7, 2.8), (L * 0.08, 0, d + 6.4), sm, root, 0.1)
        box("bridge windows", (L * 0.161, B * 0.71, 1.0), (L * 0.08, 0, d + 6.8), glass, root, 0.0)
        box("mast", (1.4, 1.4, 9), (L * 0.02, 0, d + 12.3), sm, root, 0.1)
        box("yard", (0.3, 5.5, 0.3), (L * 0.02, 0, d + 14.5), dark, root, 0.0)
        cyl("dome", 1.3, 2.0, (L * 0.02, 0, d + 17.8), sm, root)
        box("gun house", (3.0, 3.0, 1.6), (L * 0.3, 0, d + 0.8), sm, root, 0.15)
        cyl("barrel", 0.14, 4.5, (L * 0.3 + 3.2, 0, d + 1.1), dark, root, 10, "X")
        box("rhib", (7, 2.6, 1.1), (-L * 0.2, B * 0.32, d + 0.6), dark, root, 0.2)
    else:
        box("house", (L * 0.3, B * 0.9, 7), (L * 0.22, 0, d + 3.5), sm, root)
        box("bridge", (L * 0.2, B, 2.5), (L * 0.24, 0, d + 8.25), sm, root)
        box("bridge windows", (L * 0.201, B * 1.01, 1.0), (L * 0.24, 0, d + 8.4), glass, root, 0.0)
        box("mast", (0.9, 0.9, 8), (L * 0.24, 0, d + 13.5), dark, root, 0.0)
        crane = box("crane", (1.2, 1.2, 12), (-L * 0.25 + 2.4, 0, d + 5.6), paint("crane", (0.45, 0.32, 0.02, 1), 0.5, 0.4), root, 0.0, rot=0.45)
        box("deck cargo", (8, B * 0.6, 2), (-L * 0.3, 0, d + 1), dark, root)
        del crane
    return root


SHIPS = [build_ship(i, s) for i, s in enumerate(S["ships"])]

# ---------------------------------------------------------------- drone, interceptor, debris
olive = paint("drone paint", (0.05, 0.055, 0.05, 1), 0.55, 0.15)
black = paint("drone black", (0.01, 0.01, 0.012, 1), 0.5, 0.0)
white = paint("interceptor white", (0.7, 0.71, 0.7, 1), 0.35, 0.05)
DRONE = link(bpy.data.objects.new("Drone", None))
cyl("fuselage", 0.2, 3.0, (0, 0, 0), olive, DRONE, 24, "X")
nose = cyl("nose", 0.2, 0.55, (1.77, 0, 0), olive, DRONE, 24, "X")
nv = nose.data.vertices
for vv in nv:
    if vv.co.x > 1.77:
        vv.co.y *= 0.05; vv.co.z *= 0.05
wing = [(0.7, 0), (-1.35, 1.3), (-1.55, 1.3), (-1.4, 0), (-1.55, -1.3), (-1.35, -1.3)]
wv = [(x, y, 0.0) for x, y in wing] + [(x, y, 0.05) for x, y in wing]
n = len(wing)
mesh_obj("wing", wv, [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)], olive, DRONE)
for sgn in (-1, 1):
    box(f"fin {sgn}", (0.35, 0.03, 0.45), (-1.42, sgn * 1.3, 0.2), olive, DRONE, 0.01)
cyl("hub", 0.08, 0.18, (-1.6, 0, 0), black, DRONE, 12, "X")
prop_m, pt_, pout = new_material("prop blur")
pg = pt_.new("ShaderNodeTexCoord").outputs["Object"]
pr_ = pt_.vec("LENGTH", pt_.vec("MULTIPLY", pg, (0, 1, 1)))
pa_ = pt_.mul(pt_.ss(0.45, 0.3, pr_), 0.35)
pt_.set(pout.inputs["Surface"], pt_.shmix(pa_, pt_.new("ShaderNodeBsdfTransparent").outputs[0], pt_.new("ShaderNodeBsdfPrincipled", {"Base Color": (0.01, 0.01, 0.01, 1)}).outputs[0]))
cyl("prop disc", 0.45, 0.01, (-1.72, 0, 0), prop_m, DRONE, 32, "X")

MISSILE = link(bpy.data.objects.new("Interceptor", None))
cyl("body", 0.065, 1.45, (0, 0, 0), white, MISSILE, 16, "X")
mn = cyl("nose", 0.065, 0.28, (0.865, 0, 0), white, MISSILE, 16, "X")
for vv in mn.data.vertices:
    if vv.co.x > 0.86:
        vv.co.y *= 0.05; vv.co.z *= 0.05
cyl("band", 0.067, 0.08, (0.45, 0, 0), black, MISSILE, 16, "X")
for k in range(4):
    a_ = k * math.pi / 2
    box(f"fin {k}", (0.22, 0.006, 0.13) if k % 2 == 0 else (0.22, 0.13, 0.006), (-0.6, -math.sin(a_) * 0.1, math.cos(a_) * 0.1), black, MISSILE, 0.0)
flame_m, ft_, fout = new_material("motor flame")
fg = ft_.new("ShaderNodeTexCoord").outputs["Generated"]
fx_ = ft_.sep(fg)[0]
ft_.set(fout.inputs["Surface"], ft_.new("ShaderNodeEmission", {"Color": (1.0, 0.62, 0.28, 1), "Strength": ft_.mul(ft_.ss(0.0, 1.0, fx_), 60.0)}).outputs[0])
fl = cyl("flame", 0.07, 1.2, (-1.35, 0, 0), flame_m, MISSILE, 16, "X")
for vv in fl.data.vertices:
    if vv.co.x < -1.4:
        vv.co.y *= 0.2; vv.co.z *= 0.2
flame_l = bpy.data.lights.new("motor light", "POINT")
flame_l.color, flame_l.energy, flame_l.shadow_soft_size = (1.0, 0.6, 0.3), 0.0, 0.3
link(bpy.data.objects.new("motor light", flame_l), MISSILE).location = (-1.6, 0, 0)

char = paint("char", (0.012, 0.012, 0.012, 1), 0.7, 0.0)
DEBRIS = []
for i, d in enumerate(S["debris"]):
    sx, sy, sz = d["size"]
    DEBRIS.append(box(f"debris {i}", (sx, sz, sy), (0, 0, 0), char, None, 0.0))

flash_l = bpy.data.lights.new("flash", "POINT")
flash_l.color, flash_l.energy, flash_l.shadow_soft_size = (1.0, 0.7, 0.4), 0.0, 3.0
FLASH = link(bpy.data.objects.new("flash", flash_l))
launch_l = bpy.data.lights.new("launch flash", "POINT")
launch_l.color, launch_l.energy, launch_l.shadow_soft_size = (1.0, 0.75, 0.45), 0.0, 0.4
LAUNCH_L = link(bpy.data.objects.new("launch flash", launch_l))
LAUNCH_L.location = Vector(b3(S["msl"]["back"]))
FLASH.location = Vector(b3(S["iPt"]))

# ---------------------------------------------------------------- particles: droplets and volumes, refilled every frame
def points_gn(name, volume=None, material=None):
    """A modifier that turns the object's loose vertices (with a 'radius' attribute) into points, or into a soft volume."""
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    t = Tree(ng)
    gi, go = t.new("NodeGroupInput"), t.new("NodeGroupOutput")
    rad = t.new("GeometryNodeInputNamedAttribute", {"Name": "radius"}, data_type="FLOAT").outputs["Attribute"]
    pts = t.new("GeometryNodeMeshToPoints", {"Mesh": gi.outputs[0], "Radius": rad})
    geo = pts.outputs[0]
    if volume:
        dens, voxel = volume
        p2v = t.new("GeometryNodePointsToVolume", {"Points": geo, "Density": dens, "Voxel Size": voxel, "Radius": rad})
        try:
            p2v.inputs["Resolution Mode"].default_value = "Size"
        except Exception:
            pass
        gg = t.new("GeometryNodeGetNamedGrid", {"Volume": p2v.outputs[0], "Name": "density", "Remove": True}, data_type="FLOAT")
        blur = t.new("GeometryNodeGridMean", {"Grid": gg.outputs["Grid"], "Width": 1, "Iterations": 2}, data_type="FLOAT")
        geo = t.new("GeometryNodeStoreNamedGrid", {"Volume": gg.outputs["Volume"], "Name": "density", "Grid": blur.outputs[0]}, data_type="FLOAT").outputs[0]
    geo = t.new("GeometryNodeSetMaterial", {"Geometry": geo, "Material": material}).outputs[0]
    t.set(go.inputs[0], geo)
    return ng


def cloud_obj(name, material, volume=None):
    me = bpy.data.meshes.new(name)
    ob = link(bpy.data.objects.new(name, me))
    me.attributes.new("radius", "FLOAT", "POINT")
    me.attributes.new("velocity", "FLOAT_VECTOR", "POINT")
    ob.modifiers.new("points", "NODES").node_group = points_gn(name, volume, material)
    return ob


def set_cloud(ob, P, radius, vel=None):
    me = ob.data
    me.clear_geometry()
    n = len(P)
    if n:
        me.vertices.add(n)
        me.vertices.foreach_set("co", np.asarray(P, np.float32).ravel())
    for nm in ("radius", "velocity"):
        if nm not in me.attributes:
            me.attributes.new(nm, "FLOAT" if nm == "radius" else "FLOAT_VECTOR", "POINT")
    if n:
        me.attributes["radius"].data.foreach_set("value", np.asarray(radius, np.float32).ravel())
        v = np.zeros((n, 3), np.float32) if vel is None else np.asarray(vel, np.float32)
        me.attributes["velocity"].data.foreach_set("vector", v.ravel())
    me.update()


def volume_mat(name, colour, aniso=0.3, mult=1.0, billow=0.6, scale=0.8, emission=None):
    m, t, out = new_material(name)
    vi = t.new("ShaderNodeVolumeInfo")
    co = t.new("ShaderNodeTexCoord").outputs["Object"]
    nz1 = t.noise(co, scale, 5.0, 0.62, w=t.value(0.0, "time"))
    shape = t.lerp(1.0, t.mul(t.ss(0.3, 0.72, nz1), 2.2), billow)
    dens = t.mul(t.mul(vi.outputs["Density"], shape), mult)
    pv = t.new("ShaderNodeVolumePrincipled", {"Color": colour, "Density": dens, "Anisotropy": aniso, "Density Attribute": ""})
    if emission:
        bb = t.new("ShaderNodeBlackbody", {"Temperature": t.value(1600.0, "temp")})
        t.set(pv.inputs["Emission Color"], bb.outputs[0])
        t.set(pv.inputs["Emission Strength"], t.mul(dens, t.value(emission, "glow")))
    t.set(out.inputs["Volume"], pv.outputs[0])
    return m


drop_m, dt_, dout = new_material("spray droplets")
dp = dt_.new("ShaderNodeBsdfPrincipled", {"Base Color": (0.85, 0.9, 0.92, 1), "Roughness": 0.15, "Transmission Weight": 0.6, "IOR": 1.33})
dt_.set(dout.inputs["Surface"], dp.outputs[0])
DROPS = cloud_obj("spray droplets", drop_m)
DROPS.visible_shadow = False
NB = 4
VOL = {}
VOL_SPEC = {
    "mist": dict(col=(0.9, 0.93, 0.95, 1), voxel=0.08, smax=2.2, aniso=0.6, billow=0.5, scale=1.4),
    "white": dict(col=(0.86, 0.86, 0.85, 1), voxel=0.14, smax=3.0, aniso=0.35, billow=0.7, scale=0.7),
    "dark": dict(col=(0.06, 0.055, 0.05, 1), voxel=0.3, smax=1.2, aniso=0.1, billow=0.75, scale=0.25),
    "fire": dict(col=(0.04, 0.035, 0.03, 1), voxel=0.2, smax=1.5, aniso=0.0, billow=0.9, scale=0.55, emission=6.0),
}
for kind, sp in VOL_SPEC.items():
    m = volume_mat(f"{kind} volume", sp["col"], sp["aniso"], 1.0, sp["billow"], sp["scale"], sp.get("emission"))
    VOL[kind] = []
    for b in range(NB):
        dens = sp["smax"] * (0.12 ** ((NB - 1 - b) / (NB - 1)))  # log-spaced densities per metre
        VOL[kind].append((cloud_obj(f"{kind} {b}", m, (dens, sp["voxel"])), dens))


def put_volume(kind, P3, sigma, radius):
    """Points (three.js frame) into the bucket whose density is nearest each point's sigma (per metre)."""
    objs = VOL[kind]
    if len(P3) == 0:
        for ob, _ in objs:
            set_cloud(ob, np.zeros((0, 3)), [])
        return
    dens = np.array([d for _, d in objs])
    k = np.abs(np.log(np.maximum(sigma, 1e-4))[:, None] - np.log(dens)[None, :]).argmin(1)
    keep = sigma > dens[0] * 0.35
    vox = VOL_SPEC[kind]["voxel"]
    for b, (ob, _) in enumerate(objs):
        sel = (k == b) & keep
        set_cloud(ob, b3(P3[sel]), np.maximum(radius[sel], vox * 1.6))


# emitters (the film's, in numpy, denser)
def seeds(n, k):
    return RNG.random((n, k))


SPR = {"bow": dict(n=2600, life=0.9 + 0.7 * RNG.random(2600), ph=RNG.random(2600), s=seeds(2600, 5)),
       "tail": dict(n=1500, life=1.2 + 0.8 * RNG.random(1500), ph=RNG.random(1500), s=seeds(1500, 5))}
DROPS_PER = 7
JIT = RNG.normal(0, 1, (4100, DROPS_PER, 3))
JITV = RNG.normal(0, 1, (4100, DROPS_PER, 3))
DRAD = 0.004 + 0.012 * RNG.random((4100, DROPS_PER)) ** 2


def emit_spray(w):
    Pm, Sm, Am, Vd, Pd, Rd = [], [], [], [], [], []
    off = 0
    for kind, sp in SPR.items():
        life, phs, s = sp["life"], sp["ph"], sp["s"]
        birth = np.floor((w - phs * life) / life) * life + phs * life
        age = w - birth
        st = boat_at(np.maximum(birth, 0))
        v, slam = st["v"], clamp(-st["bowV"] / 2.5, 0, 1.4)
        n = sp["n"]
        if kind == "bow":
            amt = sstep(9, 20, v) * 0.8 + slam * mixf(0.25, 0.8, sstep(6, 16, v))
            side = np.where(s[:, 0] < 0.5, -1.0, 1.0)
            lx = mixf(0.8, 3.8, s[:, 1])
            local = np.stack([lx, mixf(-0.05, 0.25, s[:, 2]), side * 1.78 * np.sqrt(np.maximum(0, 1 - (lx / 6.3) ** 2))], -1)
            p0 = to_world(st, local)
            out = mixf(1.2, 3.5, s[:, 2]) + 0.16 * v
            up = mixf(0.6, 2.2, s[:, 3]) + 0.09 * v + slam * 1.6
            d = st["Rh"] * (side * out)[:, None] + st["Fh"] * (v * 0.55 + (s[:, 1] - 0.5) * 2)[:, None]
            d[:, 1] = up
            L_ = life
        else:
            amt = sstep(11, 21, v)
            lz = np.array([-0.74, 0.0, 0.74])[np.minimum((s[:, 0] * 3).astype(int), 2)]
            p0 = to_world(st, np.stack([np.full(n, -6.35), np.full(n, -0.05), lz], -1))
            d = st["Fh"] * (v * mixf(0.35, 0.75, s[:, 1]))[:, None] + st["Rh"] * ((s[:, 2] - 0.5) * 3)[:, None]
            d[:, 1] = mixf(3.0, 7.5, s[:, 3]) * (0.3 + 0.7 * sstep(11, 21, v))
            L_ = life * 1.2
        ok = (birth >= 0) & (amt >= 0.02) & (s[:, 4] <= amt)
        drag = 1.1
        tr = (1 - np.exp(-drag * age)) / drag
        P = p0 + d * tr[:, None]
        P[:, 1] -= 0.5 * G * age * age * 0.8
        vel = d * np.exp(-drag * age)[:, None]
        vel[:, 1] -= G * 0.8 * age
        sea = sea_h(P[:, 0], P[:, 2], w)
        ok &= P[:, 1] >= sea - 0.1
        u = age / L_
        a = (0.26 if kind == "bow" else 0.2) * np.minimum(1, amt) * np.maximum(0, 1 - u) ** 1.4 * sstep(0, 0.05, age)
        size = (0.06 if kind == "bow" else 0.08) + age * ((0.22 + 0.025 * v) if kind == "bow" else 0.55)
        idx = np.nonzero(ok)[0]
        Pm.append(P[idx]); Sm.append(size[idx]); Am.append(a[idx])
        # droplets: a few per puff, spread through it, fewer as it thins
        gi_ = idx + off
        jit = JIT[gi_] * (size[idx] * 0.3)[:, None, None]
        dp_ = P[idx][:, None, :] + jit
        dv = vel[idx][:, None, :] + JITV[gi_] * 0.6
        live = RNG.random(dp_.shape[:2]) < np.clip(a[idx] * 4.5, 0, 1)[:, None]
        Pd.append(dp_[live]); Vd.append(dv[live]); Rd.append(DRAD[gi_][live] * (1.4 if kind == "tail" else 1.0))
        off += n
    cat = lambda L, k=0: np.concatenate(L) if L else np.zeros((0, 3) if k else (0,))
    return cat(Pm, 1), cat(Sm), cat(Am), cat(Pd, 1), cat(Vd, 1), cat(Rd)


MSL = {k: np.array(v) for k, v in S["msl"].items() if k != "T"}
MSL_T = S["msl"]["T"]
I_PT, DIR_IN, WIND = np.array(S["iPt"]), np.array(S["dirIn"]), np.array(S["wind"])
VD_ = T["VD"]


def missile_at(tau):
    x = clamp(np.asarray(tau, float) / MSL_T, 0, 1)
    u = 0.05 * x + 0.95 * x ** 1.45
    vv = 1 - u
    return (np.multiply.outer(vv ** 3, MSL["p0"]) + np.multiply.outer(3 * vv * vv * u, MSL["p1"]) + np.multiply.outer(3 * vv * u * u, MSL["p2"])
            + np.multiply.outer(u ** 3, I_PT))


def sphere_dir(s):
    zz = 2 * s[:, 0] - 1
    a = s[:, 1] * 6.283
    q = np.sqrt(1 - zz * zz)
    return np.stack([q * np.cos(a), zz, q * np.sin(a)], -1)


BLAST, BALL, BOOM = seeds(360, 4), seeds(420, 4), seeds(320, 4)
DEB = S["debris"]


def sigma_of(alpha, size):
    return -np.log(np.maximum(1e-4, 1 - np.minimum(alpha, 0.95))) / np.maximum(0.9 * size, 0.05)


def emit_fx(w):
    out = {k: [] for k in ("white", "dark", "fire")}  # (P, sigma, radius)
    splash = []
    tau = w - T["T_L"]
    if tau > 0:
        s = BLAST
        a = tau - s[:, 3] * 0.25
        front = s[:, 0] < 0.4
        base = np.where(front[:, None], MSL["p0"], MSL["back"])
        dr = sphere_dir(s) * 0.6 + np.where(front[:, None], 1.0, -1.3) * MSL["d0"]
        dr /= np.linalg.norm(dr, axis=1, keepdims=True)
        reach = np.where(front, 2.2, 3.2) * (0.5 + s[:, 2]) * (1 - np.exp(-np.maximum(a, 0) * 3))
        P = base + dr * reach[:, None] + np.outer(np.maximum(a, 0), WIND) + np.outer(np.maximum(a, 0) * 0.5, [0, 1, 0])
        al = 0.32 * (1 - sstep(1.0, 4.5, a)) * sstep(0, 0.04, a)
        sz = 0.3 + 1.2 * np.sqrt(np.maximum(a, 0)) * (0.6 + s[:, 1])
        ok = a > 0
        out["white"].append((P[ok], sigma_of(al[ok], sz[ok]) * 1.6, sz[ok] * 0.5))
        te = np.arange(0, min(tau, MSL_T), 0.0012)
        if len(te):
            k = np.arange(len(te))
            age = tau - te
            P = missile_at(te)
            jr = (np.sin(k * 12.9898) * 43758.5453) % 1.0
            P = P + np.outer(age * 0.7, WIND) + np.stack([np.sin(k * 1.7), np.cos(k * 2.3), np.sin(k * 0.9)], -1) * (0.35 * np.sqrt(age))[:, None]
            al = 0.42 * (1 - sstep(2.5, 9, age)) * sstep(0, 0.05, age)
            sz = 0.7 + 1.5 * np.sqrt(age) * (0.7 + 0.6 * jr)
            out["white"].append((P, sigma_of(al, sz) * 1.4, sz * 0.5))
    b = w - T["T_I"]
    if b > 0:
        s = BALL
        dr = sphere_dir(s)
        r = 8.5 * (0.5 + 0.5 * s[:, 2]) * (1 - np.exp(-b * 7))
        P = I_PT + dr * r[:, None] + DIR_IN * VD_ * 0.25 * (1 - np.exp(-b * 2))
        heat = np.exp(-b * (2.6 + 2 * s[:, 3]))
        sz = 3 + 5 * np.sqrt(b)
        ok = heat > 0.03
        rr = sz * (0.12 + 0.22 * s[:, 0])
        out["fire"].append((P[ok], heat[ok] * 1.2, rr[ok]))
        s = BOOM
        dr = sphere_dir(s)
        r = 13 * (0.4 + 0.6 * s[:, 2]) * (1 - np.exp(-b * 2.2))
        P = I_PT + dr * r[:, None] + DIR_IN * VD_ * 0.25 * (1 - np.exp(-b * 2)) + WIND * b + np.array([0, 1.2 * b, 0])
        al = 0.75 * sstep(0.08, 0.4, b) * (1 - sstep(4, 12, b))
        sz = 6 + 7 * np.sqrt(b) * (0.6 + s[:, 1])
        out["dark"].append((P, sigma_of(np.full(len(P), al), sz) * 1.5, sz * (0.18 + 0.2 * s[:, 3])))
        for d in DEB:
            end = min(b, d["splash"])
            aa = np.arange(0.05, end, 0.06)
            if len(aa):
                tr = (1 - np.exp(-d["drag"] * aa)) / d["drag"]
                P = I_PT + np.outer(tr, d["v"])
                P[:, 1] -= 0.5 * G * aa * aa * 0.92
                age = b - aa
                P = P + np.outer(age, WIND)
                al = 0.45 * (1 - sstep(1, 6, age)) * (1 if d["fire"] else 0.5)
                sz = 0.6 + 1.2 * np.sqrt(age)
                out["dark"].append((P, sigma_of(al, sz), sz * 0.45))
            if d["fire"] and b < d["splash"] and b < 2.5:
                tr = (1 - np.exp(-d["drag"] * b)) / d["drag"]
                P = I_PT + tr * np.array(d["v"])
                P[1] -= 0.5 * G * b * b * 0.92
                out["fire"].append((P[None, :], np.array([1.0 - b / 2.5]), np.array([0.7])))
            if b > d["splash"]:
                splash.append((np.array(d["splashP"]), b - d["splash"]))
    res = {}
    for k, L_ in out.items():
        if L_:
            res[k] = tuple(np.concatenate([x[i] for x in L_]) for i in range(3))
        else:
            res[k] = (np.zeros((0, 3)), np.zeros(0), np.zeros(0))
    return res, splash


SPL = RNG.random((60, 3))


def splash_drops(splash):
    P, V, R, M, MS, MA = [], [], [], [], [], []
    for p, a in splash:
        az = SPL[:, 0] * 6.283 + p[0]
        sp = 1.5 + 5 * SPL[:, 1]
        up = 4 + 6 * SPL[:, 2]
        y = up * a - 0.5 * G * a * a
        ok = (y > -0.2) & (a < 1.8)
        if not ok.any():
            continue
        q = np.stack([p[0] + np.cos(az) * sp * a, p[1] + y, p[2] + np.sin(az) * sp * a], -1)[ok]
        vv = np.stack([np.cos(az) * sp, up - G * a, np.sin(az) * sp], -1)[ok]
        P.append(q); V.append(vv); R.append(np.full(len(q), 0.02))
        M.append(q); MS.append(np.full(len(q), 0.3 + a * 1.2)); MA.append(np.full(len(q), 0.5 * (1 - sstep(0.5, 1.6, a))))
    if not P:
        return None
    return tuple(np.concatenate(x) for x in (P, V, R, M, MS, MA))


# ---------------------------------------------------------------- the wake and foam, rastered round the boat every frame
BEAM_X = (np.arange(128) + 0.5) / 128 * 12.4 - 6.2


def foam_rasters(f, t):
    rowf = FR[f]
    bm = obj_m(rowf[LAY["boat"]:LAY["boat"] + 16])
    bpos = np.array(bm.translation)
    fwd = np.array(bm.to_3x3() @ Vector((1, 0, 0)))
    fwd[2] = 0
    fwd /= np.linalg.norm(fwd)
    left = np.array([-fwd[1], fwd[0], 0.0])
    v = rowf[LAY["v"]]
    tr = rowf[LAY["trail"]:LAY["trail"] + 4 * S["trail"]["n"]].reshape(-1, 4)
    trail = []
    for x, z, age, spd in tr:
        if age < 0:
            break
        trail.append((x, -z, age, spd))
    trail = np.array(trail) if trail else np.zeros((0, 4))
    ships = []
    for i, sh in enumerate(S["ships"]):
        m = obj_m(rowf[LAY["ships"] + 16 * i:LAY["ships"] + 16 * i + 16])
        d = np.array(m.to_3x3() @ Vector((1, 0, 0)))[:2]
        ships.append((np.array(m.translation)[:2], d / np.linalg.norm(d), sh["L"], sh["B"]))
    out = {}
    for key, R in RAS.items():
        size = R["size"]
        cx, cy = bpos[0], bpos[1]
        n = RAS_N
        g = (np.arange(n) + 0.5) / n * size - size / 2
        X, Y = np.meshgrid(cx + g, cy + g)
        foam = np.zeros((n, n))
        agec = np.zeros((n, n))
        hgt = np.zeros((n, n))
        px_ = size / n
        for i in range(len(trail) - 1):
            a, b = trail[i], trail[i + 1]
            reach = 1.4 + b[2] * b[3] * 0.33 + 3 * (1.1 + 0.35 * b[2] + 0.02 * b[3] * b[2]) + 2
            x0, x1 = min(a[0], b[0]) - reach, max(a[0], b[0]) + reach
            y0, y1 = min(a[1], b[1]) - reach, max(a[1], b[1]) + reach
            i0, i1 = int(max(0, (x0 - cx + size / 2) / px_)), int(min(n, (x1 - cx + size / 2) / px_ + 1))
            j0, j1 = int(max(0, (y0 - cy + size / 2) / px_)), int(min(n, (y1 - cy + size / 2) / px_ + 1))
            if i1 <= i0 or j1 <= j0:
                continue
            xs, ys = X[j0:j1, i0:i1], Y[j0:j1, i0:i1]
            abx, aby = b[0] - a[0], b[1] - a[1]
            L2 = max(abx * abx + aby * aby, 1e-4)
            ur = ((xs - a[0]) * abx + (ys - a[1]) * aby) / L2
            uu = np.clip(ur, 0, 1)
            dist = np.hypot(xs - (a[0] + abx * uu), ys - (a[1] + aby * uu))
            inside = (ur >= -0.02) & (ur <= 1.02)
            age = a[2] + (b[2] - a[2]) * uu
            spd = a[3] + (b[3] - a[3]) * uu
            width = 1.5 + 0.5 * age + 0.03 * spd * age
            wk = np.exp(-(dist / width) ** 2) * np.exp(-age / (6.0 + 0.45 * spd)) * np.clip(spd / 14, 0.15, 1)
            arm = 1.4 + age * spd * 0.33
            armp = inside * np.exp(-((dist - arm) / (1.0 + 0.25 * age)) ** 2) * np.exp(-age / 5.0) * np.clip((spd - 4) / 10, 0, 1)
            sub_f = foam[j0:j1, i0:i1]
            newf = np.maximum(wk, armp * 0.35)
            better = newf > sub_f
            agec[j0:j1, i0:i1] = np.where(better, np.clip(age / 12, 0, 1), agec[j0:j1, i0:i1])
            foam[j0:j1, i0:i1] = np.maximum(sub_f, newf)
            hgt[j0:j1, i0:i1] = np.maximum(hgt[j0:j1, i0:i1], armp * 0.22 * np.clip(spd / 18, 0, 1))
        # foam along the hull, wider at speed, and the bow's sheet of white water
        rx, ry = X - bpos[0], Y - bpos[1]
        lx, ly = rx * fwd[0] + ry * fwd[1], np.abs(rx * left[0] + ry * left[1])
        bw = np.interp(lx, BEAM_X, BEAM)
        edge = ly - bw
        along = sstep(-6.2, -4.5, lx) * sstep(6.3, 4.8, lx)
        hullf = np.exp(-(np.maximum(edge, 0) / (0.28 + 0.025 * v)) ** 2) * (0.4 + 0.5 * min(1, v / 15)) * along
        bow = np.exp(-(np.maximum(edge, 0) / (0.35 + 0.05 * v)) ** 2) * np.clip((v - 6) / 12, 0, 1) * sstep(-1, 2, lx) * sstep(6.3, 4.5, lx)
        foam = np.maximum(foam, np.maximum(hullf, bow))
        for (sp, d, L, Bm) in ships:
            rel_x, rel_y = X - sp[0], Y - sp[1]
            al_ = rel_x * d[0] + rel_y * d[1]
            side = np.abs(d[0] * rel_y - d[1] * rel_x)
            behind = -(al_ + L * 0.5)
            inh = 1 - sstep(0, 2.5, side - Bm * 0.5 * np.sqrt(np.maximum(0, 1 - (np.maximum(al_, 0) / (L * 0.5)) ** 2)))
            sw = inh * sstep(L * 0.5 + 4, L * 0.3, np.abs(al_)) * 0.6
            bh = np.maximum(behind, 0)
            sw = np.maximum(sw, (behind > 0) * np.exp(-(side / (Bm * 0.55 + bh * 0.05)) ** 2) * np.exp(-bh / 260) * 0.9)
            sw = np.maximum(sw, (behind > 0) * np.exp(-((side - Bm * 0.5 - bh * 0.34) / (1.5 + bh * 0.03)) ** 2) * np.exp(-bh / 180) * 0.55)
            foam = np.maximum(foam, sw)
        b_ = t - T["T_I"]
        for d in DEB:
            a = b_ - d["splash"]
            if a > 0:
                p = b3(d["splashP"])
                ring = np.hypot(X - p[0], Y - p[1])
                foam = np.maximum(foam, np.exp(-(ring / (1.5 + a * 0.6)) ** 2) * np.exp(-a / 6))
        img = np.stack([foam, agec, hgt, np.ones_like(foam)], -1).astype(np.float32)
        R["img"].pixels.foreach_set(img.ravel())
        R["img"].update()
        R["img"].update_tag()
        out[key] = (cx, cy)
    return out


# ---------------------------------------------------------------- keyframes from the bake
frames = np.arange(NF, dtype=float)


def mats(key, n=16):
    return [obj_m(FR[f, LAY[key]:LAY[key] + n]) for f in range(NF)]


def key_object(ob, ms, cut_frames=()):
    loc = np.array([m.translation for m in ms])
    qs = [m.to_quaternion() for m in ms]
    for i in range(1, len(qs)):
        if qs[i].dot(qs[i - 1]) < 0:
            qs[i].negate()
    quat = np.array([tuple(q) for q in qs])
    fr_ = frames.copy()
    if cut_frames:
        # with the shutter opening on the frame, the last frame before a cut must not blur into the next shot
        extra_f, extra_l, extra_q = [], [], []
        for c in cut_frames:
            if c >= 2:
                extra_f.append(c - 0.5)
                extra_l.append(loc[c - 1] + 0.5 * (loc[c - 1] - loc[c - 2]))
                qq = quat[c - 1] + 0.5 * (quat[c - 1] - quat[c - 2])
                extra_q.append(qq / np.linalg.norm(qq))
        order = np.argsort(np.concatenate([fr_, extra_f]), kind="stable")
        fr_ = np.concatenate([fr_, extra_f])[order]
        loc = np.concatenate([loc, extra_l])[order]
        quat = np.concatenate([quat, extra_q])[order]
    ob.rotation_mode = "QUATERNION"
    bake_keys(ob, "location", loc, fr_)
    bake_keys(ob, "rotation_quaternion", quat, fr_)
    return fr_


shot = FR[:, LAY["shot"]].astype(int)
CUTS = [int(f) for f in range(1, NF) if shot[f] != shot[f - 1]]
key_object(X12, mats("boat"))
rig = FR[:, LAY["rig"]:LAY["rig"] + 7]
RIG_AXES = {"rig_nav": (0, 2, 1), "rig_gim": (1, 2, 1), "rig_gim_tilt": (2, 1, -1), "rig_port_train": (3, 2, 1), "rig_port_elev": (4, 1, -1),
            "rig_starboard_train": (5, 2, 1), "rig_starboard_elev": (6, 1, -1)}
for name, (col_, axis, sgn) in RIG_AXES.items():
    ob = RIG.get(name)
    if ob is None:
        print(f"missing rig node {name}")
        continue
    ob.rotation_mode = "XYZ"
    e = np.zeros((NF, 3))
    e[:, axis] = sgn * rig[:, col_]
    bake_keys(ob, "rotation_euler", e, frames)
key_object(DRONE, [obj_m(FR[f, LAY["drone"] + 1:LAY["drone"] + 17]) for f in range(NF)])
bake_keys(DRONE, "hide_render", 1 - FR[:, LAY["drone"]], frames, 0)
for ch in DRONE.children:
    bake_keys(ch, "hide_render", 1 - FR[:, LAY["drone"]], frames, 0)
key_object(MISSILE, [obj_m(FR[f, LAY["missile"] + 1:LAY["missile"] + 17]) for f in range(NF)])
for ob in [MISSILE, *MISSILE.children]:
    bake_keys(ob, "hide_render", 1 - FR[:, LAY["missile"]], frames, 0)
for i, ob in enumerate(DEBRIS):
    base = LAY["debris"] + 17 * i
    key_object(ob, [obj_m(FR[f, base + 1:base + 17]) for f in range(NF)])
    bake_keys(ob, "hide_render", 1 - FR[:, base], frames, 0)
for i, ob in enumerate(SHIPS):
    key_object(ob, [obj_m(FR[f, LAY["ships"] + 16 * i:LAY["ships"] + 16 * i + 16]) for f in range(NF)])

# camera: the film's lens as a vertical field of view on a 24 mm tall sensor, focus on what the shot is about
cam_data = bpy.data.cameras.new("Film camera")
CAM = link(bpy.data.objects.new("Film camera", cam_data))
scene.camera = CAM
cam_data.sensor_fit = "VERTICAL"
cam_data.sensor_height = 24.0
cam_data.sensor_width = 24.0 * WIDE / HIGH
cam_data.clip_start, cam_data.clip_end = 0.05, 40000
cam_data.dof.use_dof = True
cam_data.dof.aperture_blades = 7
cam_ms = [cam_m(FR[f, LAY["cam"]:LAY["cam"] + 16]) for f in range(NF)]
cam_fr = key_object(CAM, cam_ms, CUTS)
fov = FR[:, LAY["fov"]]
lens = 12.0 / np.tan(np.radians(fov) / 2)
focus, fstop = np.zeros(NF), np.zeros(NF)
chap = S["chapters"]
for f in range(NF):
    t = f / FPS
    cp = np.array(cam_ms[f].translation)
    bm = m3(FR[f, LAY["boat"]:LAY["boat"] + 16])
    s_ = shot[f]
    target = np.array((C4 @ bm @ Vector((0, 0.9, 0)).to_4d()).xyz)
    fs = 5.6
    if s_ == 2:  # the tour: the part on the card
        ch = next((c for c in chap if c["t"] <= t < c["end"]), None)
        if ch:
            target = np.array((C4 @ bm @ Vector(ch["anchor"]).to_4d()).xyz)
        fs = 4.0
    elif s_ in (5, 6, 8):
        target = b3(FR[f, LAY["drone"] + 13:LAY["drone"] + 16]) if FR[f, LAY["drone"]] > 0 else b3(I_PT)
        fs = 16.0 if s_ == 6 else 8.0
    elif s_ == 7:
        target = np.array((C4 @ bm @ Vector((-4.0, 1.4, -0.55)).to_4d()).xyz)
        fs = 4.0
    focus[f] = max(0.3, np.linalg.norm(target - cp))
    fstop[f] = fs


def with_cuts(v):
    """Values on the camera's key frames (the half frames before cuts held from the frame before)."""
    return np.interp(np.floor(cam_fr), frames, v)


bake_keys(cam_data, "lens", with_cuts(lens), cam_fr)
bake_keys(cam_data, "dof.focus_distance", with_cuts(focus), cam_fr)
bake_keys(cam_data, "dof.aperture_fstop", with_cuts(fstop), cam_fr)

# ---------------------------------------------------------------- render settings
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
want = os.environ.get("X12_DEVICE", "auto").upper()
DEVICE = "CPU"
for dt in (["OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"] if want == "AUTO" else ([] if want == "CPU" else [want])):
    try:
        prefs.compute_device_type = dt
    except TypeError:
        continue
    (prefs.refresh_devices if hasattr(prefs, "refresh_devices") else prefs.get_devices)()
    devs = [d for d in prefs.devices if d.type == dt]
    if devs:
        for d in prefs.devices:
            d.use = d.type == dt
        scene.cycles.device = "GPU"
        DEVICE = f"{dt}: {', '.join(d.name for d in devs)}"
        break
cy = scene.cycles
cy.samples = SAMPLES
cy.use_adaptive_sampling = True
cy.adaptive_threshold = 0.015
cy.use_denoising = True
cy.denoiser = "OPENIMAGEDENOISE"
try:
    cy.denoising_use_gpu = True
except AttributeError:
    pass
cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces, cy.transmission_bounces = 10, 3, 4, 8
cy.volume_bounces, cy.transparent_max_bounces = 1, 32
cy.sample_clamp_indirect = 10.0
cy.dicing_rate = DICING
cy.offscreen_dicing_scale = 8.0
cy.max_subdivisions = 12
cy.volume_step_rate = 1.0
cy.seed = 3
cy.use_animated_seed = True
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.5
scene.render.motion_blur_position = "START"
scene.render.use_persistent_data = True
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = WIDE, HIGH, 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "8"
scene.view_settings.view_transform = "AgX"
for look in ("AgX - Medium High Contrast", "AgX - Base Contrast"):
    try:
        scene.view_settings.look = look
        break
    except TypeError:
        continue
scene.view_settings.exposure = float(os.environ.get("X12_EXPOSURE", "0.5"))
# the haze's emission is a look, not a light: without this every terrain and sea triangle joins the light tree (5 M emitters)
for m in bpy.data.materials:
    if m.name != "motor flame":
        m.cycles.emission_sampling = "NONE"
if os.environ.get("X12_DEBUG_NOOCEAN"):
    OCEAN.modifiers["dice"].use_adaptive_subdivision = False
if os.environ.get("X12_DEBUG_NOMB"):
    scene.render.use_motion_blur = False
print(f"device {DEVICE}; {SAMPLES} spp at {WIDE}x{HIGH}; {NF} frames, cuts at {CUTS}")

if os.environ.get("X12_SAVE"):
    bpy.ops.wm.save_as_mainfile(filepath=os.environ["X12_SAVE"])


# ---------------------------------------------------------------- per frame
def set_value(mat, name, v):
    n = mat.node_tree.nodes.get(name)
    if n is not None:
        n.outputs[0].default_value = v


VOL_MATS = [bpy.data.materials[f"{k} volume"] for k in VOL_SPEC]


def update_frame(f):
    t = f / FPS
    cp = cam_ms[f].translation
    for k, v in (("time", t), ("camx", cp.x), ("camy", cp.y), ("camz", cp.z)):
        set_value(ocean_m, k, v)
    for m in VOL_MATS:
        set_value(m, "time", t * 0.15)
    cent = foam_rasters(f, t)
    for key, (cx, cy_) in cent.items():
        set_value(ocean_m, f"{key}_cx", cx)
        set_value(ocean_m, f"{key}_cy", cy_)
    # spray
    Pm, Sm, Am, Pd, Vd, Rd = emit_spray(t)
    fx, splash = emit_fx(t)
    sd = splash_drops(splash)
    if sd is not None:
        Pd = np.concatenate([Pd, sd[0]]); Vd = np.concatenate([Vd, sd[1]]); Rd = np.concatenate([Rd, sd[2]])
        Pm = np.concatenate([Pm, sd[3]]); Sm = np.concatenate([Sm, sd[4]]); Am = np.concatenate([Am, sd[5]])
    set_cloud(DROPS, b3(Pd) if len(Pd) else np.zeros((0, 3)), Rd, b3(Vd) if len(Vd) else None)
    put_volume("mist", Pm, sigma_of(Am, Sm) * 0.9, Sm * 0.5)
    for k in ("white", "dark", "fire"):
        put_volume(k, *fx[k])
    # lights: the launch flash, the motor, the intercept's flash and fireball
    tau, b = t - T["T_L"], t - T["T_I"]
    launch_l.energy = 4e5 * math.exp(-max(tau, 0) / 0.08) if tau > 0 else 0.0
    flame_l.energy = 2.5e4 if 0 < tau < MSL_T else 0.0
    flash_l.energy = (3e7 * math.exp(-b / 0.05) + 1.5e5 * math.exp(-b / 0.5)) if b > 0 else 0.0
    fire_m = bpy.data.materials["fire volume"]
    set_value(fire_m, "temp", 900 + 1100 * math.exp(-max(b, 0) / 0.7))
    set_value(fire_m, "glow", 6.0 * (0.25 + 0.75 * math.exp(-max(b, 0) / 0.8)))


def frame_list():
    spec = os.environ.get("X12_TIMES")
    if spec:
        return sorted({min(NF - 1, round(float(s) * FPS)) for s in spec.split(",")})
    spec = os.environ.get("X12_FRAMES", "all")
    if spec == "all":
        return list(range(NF))
    if spec.startswith("every:"):
        return list(range(0, NF, int(spec[6:])))
    if "-" in spec and "," not in spec:
        a_, b_ = spec.split("-")
        return list(range(int(a_), min(NF - 1, int(b_)) + 1))
    return [int(s) for s in spec.split(",")]


OUT.mkdir(parents=True, exist_ok=True)
todo = frame_list()
t_all = time.time()
for f in todo:
    png = OUT / f"{f:04d}.png"
    lock = OUT / f"{f:04d}.lock"
    if png.exists():
        continue
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.close(fd)
    except FileExistsError:
        continue
    try:
        t0 = time.time()
        scene.frame_set(f)
        update_frame(f)
        t1 = time.time()
        scene.render.filepath = str(png)
        bpy.ops.render.render(write_still=True)
        print(f"frame {f} ({f / FPS:.2f} s): setup {t1 - t0:.1f} s, render {time.time() - t1:.1f} s", flush=True)
    finally:
        lock.unlink(missing_ok=True)
print(f"done: {len(todo)} frames in {time.time() - t_all:.0f} s")
