"""Razorbill farm drone: imports the SolidWorks STEP from cad/imports/ and exports a named-part GLB for the drone film.

    cad/.venv/Scripts/python cad/razorbill.py    # -> site/public/models/razorbill.glb

The STEP is one unnamed assembly of 31 solids (Y up, mm). Parts are named here by their index in the file, the model
is moved so the hub centre sits on the Y axis with the feet on y = 0, and each solid becomes its own GLB node:
    hub, top_plate, battery, release_*   body and the payload release under the belly
    arm_N, leg_N, motor_N, prop_N        one per rotor, N = 0..3; the film spins prop_N about motor_N's axis
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent
STEP = ROOT / "imports" / "2000_Razorbill_farm_drone.STEP"
OUT = ROOT.parent / "site" / "public" / "models"

NAMES = {0: "hub", 1: "top_plate", 2: "battery", 3: "release_bracket", 4: "release_latch", 5: "release_servo", 10: "release_horn"}
NAMES.update({i: f"release_pin_{k}" for k, i in enumerate([6, 7, 8, 9, 11, 12, 13, 14])})
for n, base in enumerate([15, 19, 23, 27]):
    for j, kind in enumerate(["arm", "leg", "prop", "motor"]):
        NAMES[base + j] = f"{kind}_{n}"
COLORS = {"hub": (0.09, 0.09, 0.1), "top_plate": (0.12, 0.12, 0.13), "battery": (0.85, 0.42, 0.1), "arm": (0.1, 0.1, 0.11),
          "leg": (0.82, 0.83, 0.85), "prop": (0.06, 0.06, 0.07), "motor": (0.55, 0.57, 0.6), "release": (0.75, 0.76, 0.78)}


def build():
    from build123d import Color, Compound, Location, Unit, export_gltf, import_step

    solids = import_step(str(STEP)).solids()
    assert len(solids) == 31, f"expected 31 solids, got {len(solids)}"
    bb = Compound(children=solids).bounding_box()
    shift = Location((-(bb.min.X + bb.max.X) / 2, -bb.min.Y, -(bb.min.Z + bb.max.Z) / 2))
    children = []
    for i, s in enumerate(solids):
        s = s.moved(shift)
        s.label = NAMES.get(i, f"part_{i}")
        s.color = Color(*COLORS.get(s.label.split("_")[0], (0.5, 0.5, 0.5)))
        children.append(s)
    OUT.mkdir(parents=True, exist_ok=True)
    export_gltf(Compound(label="razorbill", children=children), str(OUT / "razorbill.glb"), unit=Unit.MM, binary=True,
                linear_deflection=0.08, angular_deflection=0.1)
    print(f"razorbill.glb written: {len(children)} parts, {bb.size.X:.0f} x {bb.size.Y:.0f} x {bb.size.Z:.0f} mm")


if __name__ == "__main__":
    build()
