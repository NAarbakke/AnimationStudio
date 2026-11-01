"""Razorbill farm drone: the SolidWorks GLB from cad/imports/ with its parts renamed and flattened for the drone film.

    npm run cad:drone    # -> site/public/models/razorbill.glb

The assembly has no motion data, so everything that moves must be its own node. All nodes end up in one frame: metres,
hub centre on the vertical axis, leg feet on the ground plane. Names (the film colours parts by the first word):
    hub, top_plate, battery, avionics_*, spacer_*    the fixed body
    arm_N, leg_N, motor_N, prop_N                    one per rotor, N = 0..3 going round the hub; prop_N spins about motor_N
    release_*                                        the fishhook; release_hook, release_lever and release_horn move
    rod_*                                            the sensor rod, which hangs from the hook by rod_ring until the drop
Materials are dropped: the film sets its own, and the export's are mostly the same grey.
"""
from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "cad" / "imports" / "2000_Razorbill_farm_drone.glb"
OUT = ROOT / "site" / "public" / "models" / "razorbill.glb"

ROD = {"1410": "rod_shaft", "1430": "rod_fins", "1440": "rod_cone", "1450": "rod_cap", "1460": "rod_ring", "1470": "rod_tape"}
RELEASE = {"1320": "release_lever", "1330": "release_hook", "1350": "release_servo", "1360": "release_bracket", "1370": "release_horn", "1380": "release_support"}
ARM = {"1110": "arm", "1140": "prop", "1150": "motor", "1160": "leg"}
BODY = {"1210": "hub", "1220": "top_plate", "1260": "battery"}


def code(obj):
    return obj.name[:4]


def world_box(objs):
    points = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    return Vector(min(p[i] for p in points) for i in range(3)), Vector(max(p[i] for p in points) for i in range(3))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    by_code = lambda *codes: [o for o in meshes if code(o) in codes]

    lo, hi = world_box(by_code("1210"))
    feet = world_box(by_code("1160"))[0].z
    shift = Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -feet))

    names, spacers, avionics = {}, 0, 0
    motors = sorted(by_code("1150"), key=lambda m: math.atan2(*(m.matrix_world.translation.xy - (lo.xy + hi.xy) / 2)))
    index = {m.parent: n for n, m in enumerate(motors)}
    for o in meshes:
        c = code(o)
        if c in ROD:
            names[o] = ROD[c]
        elif c in RELEASE:
            names[o] = RELEASE[c]
        elif c in ARM:
            names[o] = f"{ARM[c]}_{index[o.parent]}"
        elif c in BODY:
            names[o] = BODY[c]
        elif c == "1390":
            names[o] = f"spacer_{spacers}"
            spacers += 1
        else:
            names[o] = f"avionics_{avionics}"
            avionics += 1

    world = {o: shift @ o.matrix_world for o in meshes}
    for o in meshes:
        o.data = o.data.copy()
        o.data.materials.clear()
        o.parent = None
        o.matrix_world = world[o]
        o.name = names[o]
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    bpy.context.view_layer.update()

    # the numbers the film's choreography is written against, in the exported Y-up frame: (x, z up, -y)
    gltf = lambda v: tuple(round(a, 4) for a in (v.x, v.z, -v.y))
    meshes = list(bpy.context.scene.objects)
    named = {o.name: o for o in meshes}
    for part in ("hub", "top_plate", "rod_shaft", "rod_cone", "rod_cap", "rod_fins", "rod_ring", "release_hook", "release_lever", "release_horn", "release_servo", "release_bracket"):
        l, h = world_box([named[part]])
        print(f"{part:16} min {gltf(l)} max {gltf(h)}", flush=True)
    hook = named["release_hook"]
    points = [hook.matrix_world @ v.co for v in hook.data.vertices]
    bottom = min(points, key=lambda p: p.z)
    tip_side = max(points, key=lambda p: p.y)
    tip_other = min(points, key=lambda p: p.y)
    top = max(points, key=lambda p: p.z)
    print(f"hook bottom {gltf(bottom)} top {gltf(top)} extreme_a {gltf(tip_side)} extreme_b {gltf(tip_other)}", flush=True)

    bpy.ops.object.select_all(action="SELECT")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB", use_selection=True, export_yup=True, export_materials="NONE",
                              export_normals=True, export_texcoords=False, export_animations=False, export_vertex_color="NONE")
    print(f"{OUT.name} written: {len(meshes)} parts, {OUT.stat().st_size / 1e6:.1f} MB", flush=True)


main()
