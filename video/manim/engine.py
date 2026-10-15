"""Liquid-engine insert: the equations from chamber gas to thrust, written out with the lab's numbers, and the flow
through the lab's own nozzle.

The data is the lab's own solver (engine.json, from `node video/manim/export.js`). Render: npm run insert
"""

import numpy as np

import manimgx as m
from kit import AMBER, COOL, CORAL, GREEN, LEFT_X, MUTED, SUB, TEXT, Row, eq, header, ladder, live_panel, load, reveal, section, setup, text, trace

setup()
D = load("engine.json")
E, P, TP = D["Es"], D["prop"], D["tp"]
Y, R, MACH, TR, PR, V = (np.array(D["prof"][k]) for k in ("y", "r", "M", "T", "p", "v"))
S = Y[0] - Y  # distance from the injector face, m
S_END = float(S[-1])
S_THROAT = float(Y[0])  # the throat is at y = 0
g = P["g"]


def at(ch: np.ndarray, s: float) -> float:
    return float(np.interp(s, S, ch))


class LiquidEngine(m.Scene):
    def construct(self) -> None:
        head = header(f"LIQUID ENGINE · LOX / {P['name']} · GAS-GENERATOR CYCLE", "From chamber to exhaust")
        sec = section("1 · Chamber", head)
        self.play(m.FadeIn(head[0], shift=m.UP * 0.2), m.Write(head[1]), m.FadeIn(sec), run_time=1.2)

        # ---- 1. chamber: hot light gas → c* → choked mass flow
        gas = Row(f"Combustion gas at a mixture ratio O/F = {D['of']:.2f}: hot, with a low molar mass",
                  r"R = \frac{R_u}{\mathcal{M}}",
                  rf"= \frac{{8314}}{{{E['M']:.1f}}} = {E['R']:.0f}\ \mathrm{{J\,kg^{{-1}}K^{{-1}}}},\quad T_c = {E['Tc']:.0f}\ \mathrm{{K}}")
        cstar = Row("Characteristic velocity: how much pressure the chamber makes per kg/s",
                    r"c^* = \frac{\sqrt{R\,T_c}}{\gamma\sqrt{\left(\frac{2}{\gamma+1}\right)^{\frac{\gamma+1}{\gamma-1}}}}",
                    rf"\gamma = {g:.2f}\ \Rightarrow\ c^* = {E['cstar']:.0f}\ \mathrm{{m/s}}", size=36)
        mdot = Row("The throat is choked, so it fixes the mass flow",
                   r"\dot m = \frac{P_c\,A_t}{c^*}",
                   rf"= \frac{{{E['Pc'] / 1e5:.0f}\ \mathrm{{bar}} \times {D['AT']:.3f}\ \mathrm{{m^2}}}}{{{E['cstar']:.0f}\ \mathrm{{m/s}}}}"
                   rf" = {E['mdot']:.0f}\ \mathrm{{kg/s}}")
        page1 = ladder([gas, cstar, mdot], top=1.85)
        for row in page1:
            self.play(*reveal(row), run_time=1.7)
        self.play(m.Indicate(mdot.val, color=GREEN, scale_factor=1.06), run_time=0.9)
        self.wait(0.4)

        # ---- 2. nozzle: area → Mach → pressure and temperature, along the lab's own contour
        sec2 = section("2 · Nozzle", head)
        mach = Row("Area sets the Mach number: M = 1 exactly at the throat",
                   r"\frac{A}{A_t} = \frac{1}{M}\left[\frac{2}{\gamma+1}\left(1+\frac{\gamma-1}{2}M^2\right)\right]^{\frac{\gamma+1}{2(\gamma-1)}}",
                   size=30)
        iso = Row("Pressure and temperature fall as the gas speeds up",
                  r"\frac{p}{P_c} = X^{-\frac{\gamma}{\gamma-1}},\quad \frac{T}{T_c} = X^{-1},\quad X = 1+\frac{\gamma-1}{2}M^2",
                  size=30)
        page2 = ladder([mach, iso], top=1.85)

        k = 2.4  # frame units per metre, both ways, so the nozzle keeps its shape
        axes = m.Axes(x_range=[0, 1.8, 0.3], y_range=[0, 4, 1], x_length=1.8 * k, y_length=2.0,
                      axis_config={"color": MUTED, "include_tip": False})
        axes.move_to([1.55, -2.95, 0], aligned_edge=m.DL)
        axes.add_coordinates(font_size=24, color=SUB)
        x0, yc = axes.c2p(0, 0)[0], 0.55

        def wall(s: float, r: float) -> np.ndarray:
            return np.array([x0 + s * k, yc + r * k, 0])

        # gas inside, coloured by temperature; then the walls, the axis and the throat
        lo, hi = m.ManimColor(COOL), m.ManimColor(AMBER)
        strips = m.VGroup(*[
            m.Polygon(wall(S[i], R[i]), wall(S[j], R[j]), wall(S[j], -R[j]), wall(S[i], -R[i]),
                      stroke_width=0, fill_opacity=0.45, fill_color=m.interpolate_color(lo, hi, (TR[i] - TR[-1]) / (TR[0] - TR[-1])))
            for i, j in zip(range(0, len(S) - 1, 3), [*range(3, len(S) - 1, 3), len(S) - 1])
        ])
        walls = m.VGroup(*[m.VMobject(color=TEXT, stroke_width=4).set_points_smoothly([wall(s, sgn * r) for s, r in zip(S[::3], R[::3])])
                           for sgn in (1, -1)])
        centre = m.DashedLine(wall(0, 0), wall(S_END, 0), color=MUTED, stroke_width=2, dash_length=0.08)
        throat_tag = text("throat", 22, SUB).move_to([wall(S_THROAT, 0)[0], wall(S_THROAT, R.min())[1] + 0.42, 0])
        throat = m.DashedLine([throat_tag.get_x(), throat_tag.get_bottom()[1] - 0.06, 0], axes.c2p(S_THROAT, 0), color=SUB, stroke_width=2, dash_length=0.08)
        flow = m.Arrow(wall(0.05, 0.42), wall(0.42, 0.42), color=MUTED, buff=0, stroke_width=3, max_tip_length_to_length_ratio=0.25)
        nozzle = m.VGroup(strips, walls, centre, flow)

        curves = m.VGroup(
            axes.plot(lambda s: at(MACH, s), x_range=[0, S_END, 0.01], color=COOL, stroke_width=4),
            axes.plot(lambda s: 4 * at(PR, s), x_range=[0, S_END, 0.01], color=CORAL, stroke_width=4),
            axes.plot(lambda s: 4 * at(TR, s), x_range=[0, S_END, 0.01], color=AMBER, stroke_width=4),
        )
        names = m.VGroup(
            eq("M", 26, COOL, iso=[]).next_to(axes.c2p(S_END, at(MACH, S_END)), m.RIGHT, buff=0.12),
            eq(r"T/T_c", 26, AMBER, iso=[]).next_to(axes.c2p(S_END, 4 * at(TR, S_END)), m.RIGHT, buff=0.12),
            eq(r"p/P_c", 26, CORAL, iso=[]).next_to(axes.c2p(S_END, 4 * at(PR, S_END)), m.RIGHT, buff=0.12).shift(m.UP * 0.12),
        )
        x_name = text("distance from the injector (m)", 20).next_to(axes.x_axis, m.DOWN, buff=0.45)
        y_note = text("Mach · ratios × 4", 20, SUB).next_to(axes.y_axis, m.UP, buff=0.15)

        self.play(m.FadeOut(page1, shift=m.UP * 0.4), m.FadeTransform(sec, sec2), run_time=0.8)
        self.play(*reveal(page2[0]), m.FadeIn(nozzle), run_time=1.6)
        self.play(*reveal(page2[1]), m.Create(axes), m.FadeIn(x_name, y_note, throat, throat_tag), run_time=1.6)

        s = m.ValueTracker(0.0)
        cut = m.always_redraw(lambda: m.Line(wall(s.get_value(), at(R, s.get_value())), wall(s.get_value(), -at(R, s.get_value())),
                                             color=TEXT, stroke_width=3))
        traced = m.always_redraw(lambda: m.VGroup(*[
            trace(axes, S, ys, s.get_value(), color=c, stroke_width=4) for ys, c in ((MACH, COOL), (4 * PR, CORAL), (4 * TR, AMBER))
        ]))
        dots = m.always_redraw(lambda: m.VGroup(*[
            m.Dot(axes.c2p(s.get_value(), v), radius=0.07, color=c)
            for v, c in ((at(MACH, s.get_value()), COOL), (4 * at(PR, s.get_value()), CORAL), (4 * at(TR, s.get_value()), AMBER))
        ]))

        now = s.get_value
        panel = live_panel([
            ("M", lambda: at(MACH, now()), 2, "", COOL), ("p", lambda: at(PR, now()) * E["Pc"] / 1e5, 1, r"\mathrm{bar}", CORAL),
            ("T", lambda: at(TR, now()) * E["Tc"], 0, r"\mathrm{K}", AMBER), ("v", lambda: at(V, now()), 0, r"\mathrm{m/s}", GREEN),
        ], rows=2, cols=2, size=32, corner=np.array([LEFT_X, -1.75, 0]), buff=(0.7, 0.3))
        self.add(traced, dots, cut)
        self.play(m.FadeIn(panel), run_time=0.4)
        self.play(s.animate.set_value(S_END), run_time=5, rate_func=m.linear)
        self.play(m.FadeIn(names), run_time=0.6)
        self.wait(0.6)

        # ---- 3. thrust: exit velocity → thrust → Isp, and what drives the pumps
        sec3 = section("3 · Thrust", head)
        isp_vac = D["isp"][-1]
        dp = 1.3 * E["Pc"]  # pump discharge pressure rise, as in the lab
        sign = "-" if E["Fpres"] < 0 else "+"
        exit_v = Row("Exhaust velocity: the heat left over after expanding to the exit pressure",
                     r"v_e = \sqrt{\frac{2\gamma}{\gamma-1}\,R\,T_c\left[1-\left(\frac{p_e}{P_c}\right)^{\frac{\gamma-1}{\gamma}}\right]}",
                     rf"= {E['ve']:.0f}\ \mathrm{{m/s}}\quad (M_e = {E['Me']:.2f},\ p_e = {E['pe'] / 1e5:.2f}\ \mathrm{{bar}})", size=32, iso=[])
        exit_v.eq[0][:2].set_color(GREEN)  # v_e: its subscript e is the same glyph as p_e's, so it can't be isolated by name
        force = Row("Thrust: momentum of the jet, plus the pressure difference across the exit",
                    r"F = \dot m\,v_e + (p_e - p_a)\,A_e",
                    rf"= {E['Fmom'] / 1000:.0f}\ \mathrm{{kN}} {sign} {abs(E['Fpres']) / 1000:.0f}\ \mathrm{{kN}} = {E['F'] / 1000:.0f}\ \mathrm{{kN}}",
                    size=32)
        isp = Row("Specific impulse: thrust per unit weight of propellant flow",
                  r"I_{sp} = \frac{F}{\dot m\,g_0}",
                  rf"= {E['Isp']:.0f}\ \mathrm{{s}}\ \text{{at sea level}},\ \ {isp_vac:.0f}\ \mathrm{{s}}\ \text{{in vacuum}}", size=32)
        pump = Row(f"Turbopump: the gas generator drives one shaft at {TP['rpm']:,.0f} rpm",
                   r"P = \frac{\Delta p}{\eta}\left(\frac{\dot m_o}{\rho_o} + \frac{\dot m_f}{\rho_f}\right)",
                   rf"\Delta p = {dp / 1e5:.0f}\ \mathrm{{bar}},\ \eta = 0.65\ \Rightarrow\ P = {TP['MW']:.1f}\ \mathrm{{MW}}", size=32)
        page3 = ladder([exit_v, force, isp, pump], top=1.9, gap=0.24)

        self.play(m.FadeOut(m.VGroup(page2, nozzle, axes, x_name, y_note, throat, throat_tag, traced, dots, cut, panel, names), shift=m.UP * 0.4),
                  m.FadeTransform(sec2, sec3), run_time=0.8)
        for row in page3:
            self.play(*reveal(row), run_time=1.7)
        self.play(m.Circumscribe(m.VGroup(force.eq, force.val), color=AMBER, buff=0.12), run_time=1.0)
        self.wait(1.3)
