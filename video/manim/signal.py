"""Operation SKYFALL field tests: the sensor rod's signal plot, over the Blender render of the drop film.

Laid out on the 1920x1080 frame exactly where the film draws its own plot (site/drone.html #plot), on the film's clock:
it fades in as the first larva reaches the strip and draws as they climb. Each spike is a larva crossing the spiral sensor
strip; the readout counts them. The data is the film's own (scene.json from video/skyfall/field/bake.js).
ManimGX renders opaque video, so video/skyfall/field/finish.js renders this twice, on black and on white
(PLOT_BG), and takes the transparency from the difference.
"""

import json
import os
from pathlib import Path

import numpy as np

import manimgx as m
from kit import AMBER, FONT, MUTED, SUB, TEXT, setup

setup()
m.config.background_color = os.environ.get("PLOT_BG", "#000000")
ROOT = Path(__file__).resolve().parents[2]
D = json.loads((ROOT / "video/out/skyfall-work/blender/scene.json").read_text())["plot"]
SIG = np.array(D["signal"])
T0, T1 = D["t"]
BOX = D["box"]  # x0, x1, y0 (zero signal), y1 (1.25), in the film's 860x520 plot units
END = 39.0

PANEL = (1004, 280)  # the plot's top left on the 1920x1080 frame: right 56 px, centred
K = 8 / 1080  # frame units per pixel


def at(x, y):
    """the film's plot coordinates -> ManimGX frame coordinates"""
    return np.array([(PANEL[0] + x - 960) * K, (540 - PANEL[1] - y) * K, 0.0])


def X(i):
    return BOX["x0"] + (BOX["x1"] - BOX["x0"]) * i / (len(SIG) - 1)


def Y(v):
    return BOX["y0"] + (BOX["y1"] - BOX["y0"]) * v / 1.25


THRESHOLD = 0.5  # a detection: the signal rising through this, re-armed once it falls below 0.35


def detections():
    hits, armed = [], True
    for i in range(1, len(SIG)):
        if armed and SIG[i - 1] < THRESHOLD <= SIG[i]:
            hits.append(i - 1 + (THRESHOLD - SIG[i - 1]) / (SIG[i] - SIG[i - 1]))
            armed = False
        elif SIG[i] < 0.35:
            armed = True
    return hits


HITS = detections()


def label(s, size, color, **kw):
    return m.Text(s, font=FONT, font_size=size, color=color, **kw)


class Signal(m.Scene):
    def construct(self) -> None:
        panel = m.RoundedRectangle(width=860 * K, height=520 * K, corner_radius=4 * K, stroke_width=0, fill_color="#05080e", fill_opacity=0.78)
        panel.move_to(at(430, 260))
        grid = m.VGroup(*[m.Line(at(96, y), at(824, y), stroke_width=1, color=TEXT, stroke_opacity=0.13) for y in (60, 180, 300)])
        axis = m.VMobject(stroke_width=1.5, color=SUB).set_points_as_corners([at(96, 36), at(96, 420), at(824, 420)])
        y_name = label("SIGNAL", 26, TEXT, weight=m.BOLD).rotate(np.pi / 2).move_to(at(58, 228))
        x_name = label("TIME", 26, TEXT, weight=m.BOLD).move_to(at(460, 470))
        line = m.DashedLine(at(96, Y(THRESHOLD)), at(824, Y(THRESHOLD)), color=AMBER, stroke_width=1.5, stroke_opacity=0.6, dash_length=8 * K)
        # the legend for the dashed line, in the header row where no trace goes
        swatch = m.DashedLine(at(106, 30), at(146, 30), color=AMBER, stroke_width=1.5, stroke_opacity=0.8, dash_length=8 * K)
        line_name = m.VGroup(swatch, label("DETECTION LEVEL", 18, MUTED).next_to(swatch, m.RIGHT, buff=0.12))
        count_name = label("DETECTIONS", 20, MUTED).move_to(at(820, 30), aligned_edge=m.RIGHT)
        frame = m.VGroup(panel, grid, axis, line, line_name, y_name, x_name, count_name)

        u = m.ValueTracker(0.0)  # how far along the signal, 0..1
        span = T1 - T0
        pos = lambda: min(u.get_value(), 1.0) * (len(SIG) - 1)  # in samples
        val = lambda i: float(np.interp(i, np.arange(len(SIG)), SIG))

        def drawn():
            last = pos()
            k = int(last)
            pts = [at(X(i), Y(SIG[i])) for i in range(k + 1)] + [at(X(last), Y(val(last)))]
            return m.VMobject(stroke_width=3, color=AMBER).set_points_as_corners(pts)

        def head():
            return m.Dot(at(X(pos()), Y(val(pos()))), radius=6 * K, color=AMBER, stroke_color="#05080e", stroke_width=2)

        counts = {n: label(str(n), 28, AMBER, weight=m.BOLD) for n in range(len(HITS) + 1)}

        def count():
            n = sum(h <= pos() for h in HITS)
            return counts[n].copy().next_to(count_name, m.LEFT, buff=0.16)

        def marks():
            """per detection: a tick that stays on the time axis, and a ring that flashes out from the crossing"""
            g = m.VGroup()
            for h in HITS:
                age = (pos() - h) / (len(SIG) - 1) * span  # seconds since the trace crossed
                if age < 0:
                    continue
                g.add(m.Line(at(X(h), 420), at(X(h), 408), color=AMBER, stroke_width=3))
                if age < 0.6:
                    k = age / 0.6
                    g.add(m.Circle(radius=(6 + 22 * k) * K, color=AMBER, stroke_width=3 * (1 - k) + 0.5).set_stroke(opacity=1 - k).move_to(at(X(h), Y(THRESHOLD))))
            return g

        self.wait(T0 - 0.6)
        self.play(m.FadeIn(frame, count()), run_time=0.6)
        self.clear()
        self.add(frame, m.always_redraw(marks), m.always_redraw(drawn), m.always_redraw(head), m.always_redraw(count))
        self.play(u.animate.set_value(1.0), run_time=span, rate_func=m.linear)
        self.wait(END - T1)
