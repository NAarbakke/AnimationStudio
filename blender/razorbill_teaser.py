"""Razorbill launch teaser: the real airframe shot in the dark, revealed a slit of light at a time. Frames only; video/teaser/finish.js cuts them.

    npm run blender -- razorbill_teaser.py

Environment:
    TEASER_FRAMES   "even" (default: every second frame, which finish.js interpolates shot by shot), "all", or a list ("40,150,230")
    TEASER_OUT      output folder (default video/out/teaser-frames)
    TEASER_SIZE     WxH (default 1280x720; finish.js scales to 1080p)
    TEASER_SAMPLES  Cycles samples per pixel (default 16, denoised)
Frames already on disk are skipped, so a stopped render resumes. Delete the folder after changing the look.
"""
from __future__ import annotations

import math
import os
import random
import time
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "site" / "public" / "models" / "razorbill.glb"
OUT = Path(os.environ.get("TEASER_OUT", ROOT / "video" / "out" / "teaser-frames"))
WIDE, HIGH = (int(v) for v in os.environ.get("TEASER_SIZE", "1280x720").split("x"))
SAMPLES = int(os.environ.get("TEASER_SAMPLES", "16"))
FPS = 24

# colours and finishes follow the drone film's MAT table (site/src/drone/main.js), darkened where the film's are for daylight
LOOK = {
    "hub": (0x16171a, 0.34, 0.5), "top": (0x1a1b1e, 0.3, 0.5), "avionics": (0x101114, 0.4, 0.3), "spacer": (0x8a8d92, 0.25, 1),
    "battery": (0x2a2b2d, 0.42, 0.1), "arm": (0x101113, 0.28, 0.55), "leg": (0x8f9296, 0.34, 0.2), "motor": (0x34373c, 0.22, 0.95),
    "prop": (0x0c0d0f, 0.22, 0.15), "release": (0xb8bcc1, 0.2, 1), "rod_shaft": (0x34363a, 0.42, 0.6), "rod_tape": (0xf0f1f2, 0.16, 1),
    "rod_cone": (0x16171a, 0.35, 0.3), "rod_cap": (0x16171a, 0.35, 0.3), "rod_fins": (0x5a1b03, 0.45, 0), "rod_ring": (0xc8ccd0, 0.18, 1),
}


def linear(hex_colour):
    out = []
    for shift in (16, 8, 0):
        c = ((hex_colour >> shift) & 255) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1)


def ease(u):
    u = min(1.0, max(0.0, u))
    return u * u * u * (u * (6 * u - 15) + 10)


def arch(u):
    return math.sin(math.pi * min(1.0, max(0.0, u)))


def mix(a, b, u):
    return a + (b - a) * u


def vmix(a, b, u):
    return Vector(a).lerp(Vector(b), u)


def aimed(location, target, roll=0.0):
    q = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y")
    return (q.to_matrix().to_4x4() @ Matrix.Rotation(roll, 4, "Z")).to_euler("XYZ")


# ---- shots: each is frames [start, end) and a function of u in 0..1 returning the pose of camera, slit light and atmosphere ----
# camera (from, to, lens, f-stop); slit (location, target, roll, watts); rim (location, watts); glow (card strength); spin (prop turns so far)
def shot_blade(u):
    e = ease(u)
    return dict(
        cam=vmix((0.56, 0.60, 0.325), (0.50, 0.52, 0.285), e), look=vmix((0.30, 0.31, 0.175), (0.285, 0.29, 0.175), e), lens=52, fstop=7.0,
        slit=vmix((-0.35, 1.05, 1.0), (1.05, -0.35, 1.0), u), slit_to=vmix((0.0, 0.62, 0.18), (0.62, 0.0, 0.18), u), roll=math.radians(45), watts=70 * arch(u * 1.04) ** 0.7,
        rim=(-0.3, -0.3, 0.7), rim_w=2.5 * ease(u * 2), ember=0, glow=0.0, spin=0.012 * u, motion=False,
    )


def shot_arm(u):
    e = ease(u)
    return dict(
        cam=vmix((0.44, 0.35, 0.315), (0.255, 0.185, 0.265), e), look=vmix((0.08, 0.05, 0.155), (0.0, -0.01, 0.15), e), lens=32, fstop=7.0,
        slit=vmix((1.05, 1.05, 0.85), (-0.55, -0.55, 0.85), u), slit_to=vmix((0.55, 0.55, 0.15), (-0.2, -0.2, 0.15), u), roll=math.radians(135), watts=60 * arch(u) ** 0.5,
        rim=(-1.2, 1.2, 0.7), rim_w=3 * ease(u), ember=0, glow=0.0, spin=0.02 + 0.01 * u, motion=False,
    )


def shot_rod(u):
    e = ease(u)
    return dict(
        cam=vmix((0.09, -0.66, 0.0), (0.09, -0.56, -0.92), e), look=vmix((0.0, 0.0, -0.03), (0.0, 0.0, -0.98), e), lens=62, fstop=8.0,
        slit=vmix((0.75, -1.1, 0.4), (0.75, -1.1, -1.3), u), slit_to=vmix((0, 0, 0.08), (0, 0, -1.2), u), roll=math.radians(90), watts=20 * arch(u * 1.02) ** 0.5,
        rim=(-0.8, 0.9, -0.5), rim_w=2.5, ember=0.9 * ease(u * 1.5), ember_at=vmix((0.2, -0.16, -0.3), (0.2, -0.16, -0.55), u), glow=0.0, spin=0.03, motion=False,
    )


def shot_whole(u):
    e = ease(u)
    rise = ease(u / 0.82)
    u = max(0.0, u)
    return dict(
        cam=vmix((1.15, -2.9, -0.95), (0.8, -2.25, -0.8), e), look=vmix((0, 0, -0.16), (0, 0, -0.1), e), lens=44, fstop=8.0,
        slit=(0, -1.8, 1.4), slit_to=(0, 0, 0.1), roll=0.0, watts=0.0,
        rim=(-0.1, 2.0, 0.7), rim_w=mix(3, 70, rise), ember=2.0 * rise, ember_at=Vector((0.25, 0.3, -0.4)), glow=mix(0.004, 0.95, rise ** 1.7),
        spin=0.03 + 42 * u ** 3.2,  # props wake up, slowly at first; the last frames are a motion-blurred blur
        motion=True,
    )


SHOTS = [("blade", 0, 90, shot_blade), ("arm", 90, 180, shot_arm), ("rod", 180, 276, shot_rod), ("whole", 276, 396, shot_whole)]


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(MODEL))
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    parts = {o.name: o for o in scene.objects if o.type == "MESH"}

    materials = {}
    for name, (hex_colour, rough, metal) in LOOK.items():
        m = bpy.data.materials.new(name)
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = linear(hex_colour)
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
        materials[name] = m
    for name, o in parts.items():
        key = name if name in LOOK else name.split("_")[0]
        o.data.materials.clear()
        o.data.materials.append(materials.get(key, materials["hub"]))

    # props spin on their own pivots: empties at the motor centres
    pivots = []
    for n in range(4):
        motor = parts[f"motor_{n}"]
        corners = [motor.matrix_world @ Vector(c) for c in motor.bound_box]
        centre = sum(corners, Vector()) / 8
        pivot = bpy.data.objects.new(f"pivot_{n}", None)
        pivot.location = (centre.x, centre.y, 0)
        scene.collection.objects.link(pivot)
        bpy.context.view_layer.update()
        prop = parts[f"prop_{n}"]
        world = prop.matrix_world.copy()
        prop.parent = pivot
        prop.matrix_parent_inverse = pivot.matrix_world.inverted()
        prop.matrix_world = world
        pivots.append((pivot, 1 if n % 2 else -1, 0.0))

    world = bpy.data.worlds.new("void")
    scene.world = world
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.0

    camera_data = bpy.data.cameras.new("camera")
    camera = bpy.data.objects.new("camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.clip_start = 0.01
    camera_data.dof.use_dof = True
    camera_data.dof.aperture_blades = 7
    camera_data.sensor_width = 36

    # the slit: a long thin area light whose narrow spread cuts a band across the airframe, and whose shape shows as a line in glossy parts
    slit_data = bpy.data.lights.new("slit", "AREA")
    slit_data.shape = "RECTANGLE"
    slit_data.size, slit_data.size_y = 0.025, 3.5
    slit_data.spread = math.radians(13)
    slit_data.color = (0.86, 0.92, 1.0)
    slit = bpy.data.objects.new("slit", slit_data)
    scene.collection.objects.link(slit)

    rim_data = bpy.data.lights.new("rim", "AREA")
    rim_data.shape = "DISK"
    rim_data.size = 1.6
    rim_data.color = (0.72, 0.84, 1.0)
    rim = bpy.data.objects.new("rim", rim_data)
    scene.collection.objects.link(rim)

    ember_data = bpy.data.lights.new("ember", "POINT")
    ember_data.color = (1.0, 0.36, 0.08)
    ember_data.shadow_soft_size = 0.05
    ember = bpy.data.objects.new("ember", ember_data)
    scene.collection.objects.link(ember)

    # haze: a card far behind the subject, on the camera, with drifting noise. Much cheaper here than a true volume, and silhouettes read the same.
    verts = [(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)]
    card_mesh = bpy.data.meshes.new("haze")
    card_mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    card = bpy.data.objects.new("haze", card_mesh)
    scene.collection.objects.link(card)
    card.parent = camera
    card.location = (0, 0, -9)
    card.scale = (9, 9, 1)
    for ray in ("visible_diffuse", "visible_glossy", "visible_shadow", "visible_transmission", "visible_volume_scatter"):
        setattr(card, ray, False)
    haze = bpy.data.materials.new("haze")
    nt = haze.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (0.55, 0.68, 0.95, 1)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 2.6
    noise.inputs["Detail"].default_value = 3
    noise.inputs["Roughness"].default_value = 0.55
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.2
    ramp.color_ramp.elements[1].position = 0.78
    # radial falloff round the card's centre
    length = nt.nodes.new("ShaderNodeVectorMath")
    length.operation = "LENGTH"
    fall = nt.nodes.new("ShaderNodeMapRange")
    fall.inputs["From Min"].default_value = 0.02
    fall.inputs["From Max"].default_value = 0.5
    fall.inputs["To Min"].default_value = 1
    fall.inputs["To Max"].default_value = 0
    fall.interpolation_type = "SMOOTHSTEP"
    product = nt.nodes.new("ShaderNodeMath")
    product.operation = "MULTIPLY"
    level = nt.nodes.new("ShaderNodeMath")
    level.operation = "MULTIPLY"
    nt.links.new(coord.outputs["Object"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(coord.outputs["Object"], length.inputs[0])
    nt.links.new(length.outputs["Value"], fall.inputs["Value"])
    nt.links.new(ramp.outputs["Color"], product.inputs[0])
    nt.links.new(fall.outputs["Result"], product.inputs[1])
    nt.links.new(product.outputs[0], level.inputs[0])
    nt.links.new(level.outputs[0], emit.inputs["Strength"])
    nt.links.new(emit.outputs[0], out.inputs["Surface"])
    card_mesh.materials.append(haze)

    # motes: pollen in the air, drifting with the shot; visible only to the camera so they never light or shadow the drone
    rng = random.Random(23)
    mesh = bpy.data.meshes.new("motes")
    mv, mf = [], []
    for _ in range(160):
        c = Vector((rng.gauss(0, 0.5), rng.gauss(0, 0.5), rng.gauss(0, 0.5)))
        r = rng.uniform(0.0004, 0.0011)
        base = len(mv)
        mv += [c + Vector(d) * r for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]
        mf += [tuple(base + i for i in f) for f in ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5))]
    mesh.from_pydata(mv, [], mf)
    motes = bpy.data.objects.new("motes", mesh)
    scene.collection.objects.link(motes)
    for ray in ("visible_diffuse", "visible_glossy", "visible_shadow", "visible_transmission", "visible_volume_scatter"):
        setattr(motes, ray, False)
    mote_mat = bpy.data.materials.new("mote")
    mt = mote_mat.node_tree
    mt.nodes.clear()
    mo = mt.nodes.new("ShaderNodeOutputMaterial")
    me = mt.nodes.new("ShaderNodeEmission")
    me.inputs["Color"].default_value = (0.8, 0.86, 1, 1)
    mt.links.new(me.outputs[0], mo.inputs["Surface"])
    mesh.materials.append(mote_mat)

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.04
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.seed = 7
    scene.cycles.use_animated_seed = False
    scene.cycles.max_bounces = 5
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 0
    scene.cycles.volume_bounces = 0
    scene.cycles.sample_clamp_indirect = 8
    scene.render.use_persistent_data = True
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5
    scene.render.resolution_x, scene.render.resolution_y = WIDE, HIGH
    scene.render.fps = FPS
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "16"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - High Contrast"
    scene.view_settings.exposure = 0.0

    rig = dict(camera=camera, slit=slit, rim=rim, ember=ember, motes=motes, pivots=pivots, level=level.inputs[1], w=noise.inputs["W"], mote_glow=me.inputs["Strength"])
    return scene, rig


def keyed(rig, frame, pose, seconds):
    camera, slit, rim, ember, motes = rig["camera"], rig["slit"], rig["rim"], rig["ember"], rig["motes"]
    camera.location = pose["cam"]
    camera.rotation_euler = aimed(pose["cam"], pose["look"])
    camera.data.lens = pose["lens"]
    camera.data.dof.aperture_fstop = pose["fstop"]
    camera.data.dof.focus_distance = (Vector(pose["look"]) - Vector(pose["cam"])).length
    slit.location = pose["slit"]
    slit.rotation_euler = aimed(pose["slit"], pose["slit_to"], pose["roll"])
    slit.data.energy = max(0.0, pose["watts"])
    rim.location = pose["rim"]
    rim.rotation_euler = aimed(pose["rim"], (0, 0, -0.1))
    rim.data.energy = pose["rim_w"]
    ember.location = pose.get("ember_at", (0.3, 0.3, -0.4))
    ember.data.energy = pose["ember"]
    motes.location = Vector(pose["look"]) + Vector((math.sin(seconds * 0.11) * 0.03, seconds * 0.006, seconds * 0.012))
    motes.rotation_euler = (seconds * 0.021, seconds * 0.013, seconds * 0.017)
    rig["level"].default_value = pose["glow"]
    rig["w"].default_value = seconds * 0.09
    rig["mote_glow"].default_value = 0.22 + pose["glow"] * 0.5

    for ob in (camera, slit, rim, ember, motes):
        ob.keyframe_insert("location", frame=frame)
        ob.keyframe_insert("rotation_euler", frame=frame)
    camera.data.keyframe_insert("lens", frame=frame)
    camera.data.dof.keyframe_insert("focus_distance", frame=frame)
    camera.data.dof.keyframe_insert("aperture_fstop", frame=frame)
    slit.data.keyframe_insert("energy", frame=frame)
    rim.data.keyframe_insert("energy", frame=frame)
    ember.data.keyframe_insert("energy", frame=frame)
    rig["level"].keyframe_insert("default_value", frame=frame)
    rig["w"].keyframe_insert("default_value", frame=frame)
    rig["mote_glow"].keyframe_insert("default_value", frame=frame)
    for pivot, direction, phase in rig["pivots"]:
        pivot.rotation_euler = (0, 0, phase + direction * 2 * math.pi * pose["spin"])
        pivot.keyframe_insert("rotation_euler", frame=frame)


def clear_keys(scene, rig):
    for ob in (rig["camera"], rig["slit"], rig["rim"], rig["ember"], rig["motes"], *[p[0] for p in rig["pivots"]]):
        ob.animation_data_clear()
    for block in (rig["camera"].data, rig["slit"].data, rig["rim"].data, rig["ember"].data):
        block.animation_data_clear()
    for material in bpy.data.materials:
        if material.node_tree and material.node_tree.animation_data:
            material.node_tree.animation_data_clear()


def main():
    wanted = os.environ.get("TEASER_FRAMES", "even")
    only = None if wanted == "all" else set(range(0, SHOTS[-1][2], 2)) if wanted == "even" else {int(v) for v in wanted.split(",")}
    OUT.mkdir(parents=True, exist_ok=True)
    scene, rig = build()
    started = time.time()
    done = 0
    for name, start, end, pose_at in SHOTS:
        todo = [f for f in range(start, end) if (only is None or f in only) and not (OUT / f"{f:04d}.png").exists()]
        if not todo:
            continue
        clear_keys(scene, rig)
        scene.render.use_motion_blur = pose_at(0.5)["motion"]  # only the last shot moves fast enough to need it, and it costs a BVH rebuild per frame
        # keys one frame past either end, from this shot's own curves, so motion blur never smears across a cut
        for f in range(start - 1, end + 1):
            keyed(rig, f, pose_at((f - start) / (end - start - 1)), f / FPS)
        for f in todo:
            scene.frame_set(f)
            scene.render.filepath = str(OUT / f"{f:04d}.png")
            t0 = time.time()
            bpy.ops.render.render(write_still=True)
            done += 1
            print(f"TEASER {name} frame {f}: {time.time() - t0:.1f} s, {done} done, {(time.time() - started) / 60:.1f} min", flush=True)


main()
