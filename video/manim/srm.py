"""Solid-motor insert: the equations from burn rate to thrust, written out with the lab's numbers, then the burn itself.

The data is the lab's own simulation (srm.json, from `node video/manim/export.js`). Render: npm run insert
"""

import numpy as np

import manimgx as m
from kit import AMBER, COOL, CORAL, GOLD, LEFT_X, MUTED, SUB, TEXT, Row, eq, header, ladder, live_panel, load, reveal, sci, section, setup, text, trace

setup()
D = load("srm.json")
P = D["prop"]
T, F, PC, KN, AB = (np.array(D[k]) for k in ("t", "F", "pc", "kn", "Ab"))
F = F / 1000  # kN
AT, T_END = D["At"], float(D["tEnd"])
i0 = int(np.argmax(T > 0.5))  # early steady burning: the numbers the equations are worked with
pc0, kn0, ab0, f0 = PC[i0], KN[i0], AB[i0], F[i0]
cf0 = f0 * 1000 / (pc0 * AT)
r0 = P["a"] * pc0 ** P["n"]
AB_SCALE = 25  # kN drawn per m² of burning area


def at(ch: np.ndarray, t: float) -> float:
    return float(np.interp(t, T, ch))


# ---- the motor as the lab draws it, in a cut-away: axial position y (forward +) runs right to left on screen
W = np.array(D["w"])
GR, GEO = D["slices"], D["geom"]
PORT, MIN_D, MAX_D = (np.array(GR[k]) for k in ("portR", "minD", "maxD"))
SLICE_LO = GR["oy"] + np.arange(len(PORT)) * GR["h"]
PROPELLANT = "#b8ab93"  # APCP's colour in the lab


class Cutaway:
    """Screen placement of the motor: k frame units per metre, the head end at x0, the axis at yc."""

    def __init__(self, k: float, x0: float, yc: float):
        self.k, self.x0, self.yc = k, x0, yc

    def p(self, y: float, r: float) -> np.ndarray:
        return np.array([self.x0 + (GEO["caseY1"] - y) * self.k, self.yc + r * self.k, 0])

    def hardware(self) -> m.VGroup:
        """case, forward closure and nozzle walls, and the axis"""
        cy0, cy1, cr = GEO["caseY0"], GEO["caseY1"], GEO["caseR"]
        ny, nr = GEO["nozzle"]["y"], GEO["nozzle"]["r"]
        g = m.VGroup()
        for sgn in (1, -1):
            wall = [self.p(cy0, sgn * cr), self.p(cy1, sgn * cr)]
            nozzle = [self.p(cy0, sgn * cr), *[self.p(y, sgn * r) for y, r in zip(ny, nr)]]
            g.add(m.VMobject(color=TEXT, stroke_width=4).set_points_as_corners(wall),
                  m.VMobject(color=TEXT, stroke_width=4).set_points_smoothly(nozzle))
        g.add(m.Line(self.p(cy1, cr), self.p(cy1, -cr), color=TEXT, stroke_width=6))
        g.add(m.DashedLine(self.p(cy1, 0), self.p(GEO["ye"], 0), color=MUTED, stroke_width=1.5, dash_length=0.08))
        return g

    def gas(self, glow: float) -> m.Polygon:
        """hot gas filling the case and the nozzle, brighter with chamber pressure"""
        ny, nr = GEO["nozzle"]["y"], GEO["nozzle"]["r"]
        cr = GEO["caseR"] - 0.004
        top = [self.p(GEO["caseY1"], cr), self.p(GEO["caseY0"], cr), *[self.p(y, r) for y, r in zip(ny, nr)]]
        bottom = [np.array([q[0], 2 * self.yc - q[1], 0]) for q in reversed(top)]
        return m.Polygon(*top, *bottom, stroke_width=0, fill_color=CORAL, fill_opacity=0.08 + 0.5 * glow)

    def grain(self, w: float) -> m.VGroup:
        """the propellant left after web w burned, and its burning surface (outlined in A_b's colour)"""
        R = GR["R"]
        alive = (MIN_D >= 0) & (w < MAX_D)
        inner = np.minimum(PORT + np.maximum(0.0, w - MIN_D), R)
        solid, surface = m.VGroup(), m.VGroup()
        j, n = 0, len(PORT)
        while j < n:
            if not alive[j]:
                j += 1
                continue
            e = j
            while e + 1 < n and alive[e + 1]:
                e += 1
            steps = []  # the inner edge, forward to aft: a corner only where the radius changes (most of a segment's bore is flat)
            for i in range(j, e + 1):
                if i == j or inner[i] != inner[i - 1]:
                    if i > j:
                        steps.append((SLICE_LO[i], inner[i - 1]))
                    steps.append((SLICE_LO[i], inner[i]))
            steps.append((SLICE_LO[e] + GR["h"], inner[e]))
            for sgn in (1, -1):
                edge = [self.p(y, sgn * r) for y, r in steps]
                outer = [self.p(SLICE_LO[e] + GR["h"], sgn * R), self.p(SLICE_LO[j], sgn * R)]
                solid.add(m.Polygon(*edge, *outer, stroke_width=0, fill_color=PROPELLANT, fill_opacity=0.95))
                surface.add(m.VMobject(color=COOL, stroke_width=3).set_points_as_corners([outer[1], *edge, outer[0]]))
            j = e + 1
        return m.VGroup(solid, surface)

    def plume(self, thrust: float) -> m.VGroup:
        """exhaust past the exit, its length following the thrust"""
        ye, re = GEO["ye"], GEO["re"]
        x, yc, k = self.p(ye, 0)[0], self.yc, self.k
        L = 1.15 * thrust
        outer = m.Polygon([x, yc + re * k, 0], [x + L, yc + re * k * 1.9, 0], [x + L * 1.08, yc, 0], [x + L, yc - re * k * 1.9, 0], [x, yc - re * k, 0],
                          stroke_width=0, fill_color=AMBER, fill_opacity=0.35)
        core = m.Polygon([x, yc + re * k * 0.8, 0], [x + 0.6 * L, yc, 0], [x, yc - re * k * 0.8, 0], stroke_width=0, fill_color=GOLD, fill_opacity=0.7)
        return m.VGroup(outer, core)


class SolidMotor(m.Scene):
    def construct(self) -> None:
        head = header(f"SOLID MOTOR · {P['name']} · {D['grain'].upper()} GRAIN", "From burning area to thrust")
        sec = section("1 · Chamber pressure", head)
        self.play(m.FadeIn(head[0], shift=m.UP * 0.2), m.Write(head[1]), m.FadeIn(sec), run_time=1.2)

        # ---- 1. chamber pressure: burn rate + mass balance → Pc
        burn = Row("Burn rate: the propellant surface recedes faster at higher pressure",
                   r"r = a\,P_c^{\,n}",
                   rf"a = {sci(P['a'])},\quad n = {P['n']:.2f}")
        balance = Row("Mass balance: gas made by the burning surface = gas choked through the throat",
                      r"\rho\,A_b\,r = \frac{P_c\,A_t}{c^*}",
                      rf"\rho = {P['rho']:.0f}\ \mathrm{{kg/m^3}},\quad c^* = {P['cstar']:.0f}\ \mathrm{{m/s}}")
        solved = Row("Put r into the balance and solve for the chamber pressure",
                     r"P_c = \left(a\,\rho\,c^*\,K_n\right)^{\frac{1}{1-n}},\qquad K_n = \frac{A_b}{A_t}",
                     rf"K_n = \frac{{{ab0:.2f}\ \mathrm{{m^2}}}}{{{AT * 1e4:.1f}\ \mathrm{{cm^2}}}} = {kn0:.0f}"
                     rf"\ \Rightarrow\ P_c = {pc0 / 1e5:.1f}\ \mathrm{{bar}}")
        page1 = ladder([burn, balance, solved], top=1.85)
        self.play(*reveal(burn), run_time=1.6)
        self.play(*reveal(balance), run_time=1.6)
        self.play(m.FadeIn(solved.cap, shift=m.UP * 0.1),
                  m.TransformMatchingTex(balance.eq.copy(), solved.eq), run_time=1.4)
        self.play(m.FadeIn(solved.val, shift=m.LEFT * 0.2), run_time=0.7)
        self.play(m.Indicate(solved.val, color=CORAL, scale_factor=1.06), run_time=0.9)
        self.wait(0.5)

        # ---- 2. thrust: F = CF Pc At, CF from the nozzle, time from the web
        thrust = Row("Thrust: the chamber pressure on the throat, multiplied by the nozzle",
                     r"F = C_F\,P_c\,A_t",
                     rf"= {cf0:.2f} \times {pc0 / 1e5:.1f}\ \mathrm{{bar}} \times {AT * 1e4:.1f}\ \mathrm{{cm^2}} = {f0:.1f}\ \mathrm{{kN}}")
        coef = Row(f"Thrust coefficient: ideal expansion through ε = {D['eps']:.0f}, at sea level",
                   r"C_F = \sqrt{\frac{2\gamma^2}{\gamma-1}\left(\frac{2}{\gamma+1}\right)^{\frac{\gamma+1}{\gamma-1}}"
                   r"\left[1-\left(\frac{p_e}{P_c}\right)^{\frac{\gamma-1}{\gamma}}\right]} + \frac{p_e-p_a}{P_c}\,\varepsilon",
                   rf"\gamma = {P['g']:.2f}\ \Rightarrow\ C_F = {cf0:.2f}", size=32, iso=["C_F"])
        web = Row("Burn-back: each layer Δw of the grain takes Δt = Δw / r to burn",
                  r"\Delta t = \frac{\Delta w}{r}",
                  rf"r = {r0 * 1000:.1f}\ \mathrm{{mm/s}}\ \Rightarrow\ t_b = {D['tb']:.1f}\ \mathrm{{s}}")
        page2 = ladder([thrust, coef, web], top=1.85)
        sec2 = section("2 · Thrust", head)
        self.play(m.FadeOut(page1, shift=m.UP * 0.4), m.FadeTransform(sec, sec2), run_time=0.8)
        for row in page2:
            self.play(*reveal(row), run_time=1.6)
        self.wait(0.6)

        # ---- 3. the burn: the chain, live, beside the thrust curve
        sec3 = section("3 · The burn", head)
        chain = m.VGroup(
            eq(r"r = a\,P_c^{\,n}", 30),
            eq(r"P_c = \left(a\,\rho\,c^*\,K_n\right)^{\frac{1}{1-n}}", 30),
            eq(r"K_n = \frac{A_b}{A_t}", 30),
            eq(r"F = C_F\,P_c\,A_t", 30),
        ).arrange(m.DOWN, aligned_edge=m.LEFT, buff=0.26)
        chain.move_to([LEFT_X, 1.8, 0], aligned_edge=m.UL)

        axes = m.Axes(x_range=[0, 18, 3], y_range=[0, 25, 5], x_length=5.2, y_length=2.6,
                      axis_config={"color": MUTED, "include_tip": False})
        axes.move_to([0.5, -2.75, 0], aligned_edge=m.DL)
        axes.add_coordinates(font_size=26, color=SUB)
        x_name = text("time (s)", 22).next_to(axes.x_axis, m.DOWN, buff=0.5)
        y_name = text("thrust (kN)", 22, AMBER).next_to(axes.y_axis, m.UP, buff=0.2)
        right = axes.c2p(18, 0)[0] + 0.22
        ab_ticks = m.VGroup(*[
            m.MathTex(f"{v:g}", font_size=26, color=COOL).move_to([right, axes.c2p(0, v * AB_SCALE)[1], 0], aligned_edge=m.LEFT)
            for v in (0.5, 1)
        ])
        ab_name = text("burning area (m²)", 22, COOL).rotate(-m.PI / 2)
        ab_name.next_to(ab_ticks, m.RIGHT, buff=0.25).set_y(axes.c2p(0, 0.5 * AB_SCALE)[1])

        # the motor, cut in half along its axis, above the chart
        cut = Cutaway(k=2.75, x0=0.55, yc=1.2)
        hardware = cut.hardware()
        tags = m.VGroup(
            text("propellant grain", 20, PROPELLANT).next_to(cut.p(0.9, GEO["caseR"]), m.UP, buff=0.12),
            text("nozzle", 20, SUB).next_to(cut.p(0.05, GEO["caseR"]), m.UP, buff=0.12),
            text("burning surface", 20, COOL).next_to(cut.p(0.9, -GEO["caseR"]), m.DOWN, buff=0.12),
        )

        self.play(m.FadeOut(m.VGroup(*[m.VGroup(r.cap, r.val) for r in page2]), web.eq, coef.eq),
                  m.ReplacementTransform(thrust.eq, chain[3]), m.FadeIn(chain[:3], shift=m.RIGHT * 0.2),
                  m.FadeTransform(sec2, sec3), run_time=1.2)
        still = m.VGroup(cut.gas(0), cut.grain(0))  # the unburned motor, until the burn takes over below
        self.play(m.Create(hardware), m.FadeIn(still, tags), run_time=1.2)
        self.play(m.Create(axes), m.FadeIn(x_name, y_name, ab_ticks, ab_name), run_time=1.0)

        t = m.ValueTracker(0.0)
        step = 0.02
        ab_curve = m.always_redraw(lambda: trace(axes, T, AB * AB_SCALE, t.get_value(), color=COOL, stroke_width=3, stroke_opacity=0.8))
        f_curve = m.always_redraw(lambda: trace(axes, T, F, t.get_value(), color=AMBER, stroke_width=5))
        dot = m.always_redraw(lambda: m.Dot(axes.c2p(t.get_value(), at(F, t.get_value())), radius=0.08, color=AMBER))

        now = t.get_value
        panel = live_panel([
            (r"t", now, 1, r"\mathrm{s}", TEXT), (r"A_b", lambda: at(AB, now()), 2, r"\mathrm{m^2}", COOL),
            (r"K_n", lambda: at(KN, now()), 0, "", TEXT), (r"P_c", lambda: at(PC, now()) / 1e5, 1, r"\mathrm{bar}", CORAL),
            (r"F", lambda: at(F, now()), 1, r"\mathrm{kN}", AMBER),
        ], rows=3, cols=2, size=30, corner=np.array([LEFT_X, -1.45, 0]), buff=(0.6, 0.28))
        fmax = float(F.max())
        motor = m.always_redraw(lambda: m.VGroup(
            cut.gas(at(PC, t.get_value()) / D["pcMax"]), cut.plume(at(F, t.get_value()) / fmax), cut.grain(at(W, t.get_value()))))
        self.remove(still)
        self.add(motor, hardware, ab_curve, f_curve, dot)
        self.play(m.FadeIn(panel), run_time=0.4)
        self.play(t.animate.set_value(T_END), run_time=7, rate_func=m.linear)

        # the area under the curve is the total impulse; per kilogram of propellant, the specific impulse
        f_final = axes.plot(lambda x: at(F, x), x_range=[0, T_END, step], color=AMBER, stroke_width=5)
        area = axes.get_area(f_final, x_range=[0, T_END], color=AMBER, opacity=0.22)
        impulse = m.VGroup(
            eq(rf"I_t = \int F\,dt = {D['It'] / 1000:.0f}\ \mathrm{{kN\cdot s}}", 34),
            eq(rf"I_{{sp}} = \frac{{I_t}}{{m_p\,g_0}} = \frac{{{D['It'] / 1000:.0f}\ \mathrm{{kN\cdot s}}}}{{{D['mprop']:.0f}\ \mathrm{{kg}} \times 9.81}}"
               rf" = {D['isp']:.0f}\ \mathrm{{s}}", 34),
        ).arrange(m.DOWN, aligned_edge=m.LEFT, buff=0.35).move_to([LEFT_X, -1.45, 0], aligned_edge=m.UL)
        self.play(m.FadeOut(dot), m.FadeOut(panel), m.FadeIn(area), m.Write(impulse[0]), run_time=1.2)
        self.play(m.Write(impulse[1]), run_time=1.2)
        self.play(m.Circumscribe(impulse, color=AMBER, buff=0.15), run_time=1.0)
        self.wait(1.2)
