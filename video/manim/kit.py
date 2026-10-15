"""Shared look and building blocks for the ManimGX inserts (srm.py, engine.py): the showcase's palette,
the title block, and equation rows (a plain-language caption, the equation, the lab's numbers put in)."""

import json
import os
import sys
from pathlib import Path

import numpy as np

import manimgx as m

# the showcase's palette (video/showcase.html), plus one colour per physical quantity
BG, TEXT, AMBER, SUB, MUTED = "#06080d", "#eef2f8", "#ffb454", "#aeb8cb", "#7f8aa0"
COOL, CORAL, GREEN, VIOLET, GOLD = "#6fb7ff", "#ff8a70", "#7ee0a1", "#c9a2ff", "#ffd27a"
# Bahnschrift matches the showcase's titles, but it is a Windows system font: the browser player (Pyodide) has only
# the fonts ManimGX bundles, so there the text is set in Noto Sans. KIT_FONT overrides either (to check a layout).
FONT = os.environ.get("KIT_FONT") or ("Noto Sans" if sys.platform == "emscripten" else "Bahnschrift")

# symbols coloured wherever they appear in an equation
SYM = {"P_c": CORAL, "A_b": COOL, r"\dot m": GREEN, "c^*": VIOLET, "C_F": GOLD, "v_e": GREEN, "I_{sp}": AMBER, "I_t": AMBER}

LEFT_X = -6.45  # the left edge text lines up on
VALUE_X = 0.9  # where the numbers column starts


def setup() -> None:
    m.config.background_color = BG
    m.config.pixel_width, m.config.pixel_height, m.config.frame_rate = 1920, 1080, 30


def load(name: str) -> dict:
    return json.loads(Path(__file__).with_name(name).read_text())


def text(s: str, size: float = 24, color: str = SUB, **kw) -> m.Text:
    return m.Text(s, font=FONT, font_size=size, color=color, **kw)


def eq(tex: str, size: float = 38, color: str = TEXT, iso: list[str] | None = None) -> m.MathTex:
    """An equation with its symbols coloured. `iso` names the symbols to colour when the default (every SYM
    symbol in it) can't be isolated: ManimGX tells parts apart by their glyphs, so a symbol fails when the same
    glyphs appear elsewhere in the equation (P_c twice, v_e beside p_e)."""
    keys = iso if iso is not None else [k for k in SYM if k in tex]
    return m.MathTex(tex, font_size=size, color=color, substrings_to_isolate=keys, tex_to_color_map={k: SYM[k] for k in keys})


def header(eyebrow: str, title: str) -> m.VGroup:
    g = m.VGroup(text(eyebrow, 24, AMBER), text(title, 50, TEXT, weight=m.BOLD))
    return g.arrange(m.DOWN, aligned_edge=m.LEFT, buff=0.18).to_corner(m.UL, buff=0.6)


def section(label: str, head: m.VGroup) -> m.Text:
    """The section name, top right, level with the title, or with the eyebrow when a wide title leaves no room
    (Noto Sans, the browser's font, sets titles wider than Bahnschrift)."""
    s = text(label.upper(), 26, MUTED).to_edge(m.RIGHT, buff=0.65).match_y(head[1])
    if s.get_left()[0] - head[1].get_right()[0] < 0.5:
        s.match_y(head[0])
    return s


class Row(m.VGroup):
    """caption above, equation below it on the left, the numbers on the same line in the right-hand column"""

    def __init__(self, caption: str, tex: str, value: str | None = None, size: float = 38, iso: list[str] | None = None):
        cap, e, val = text(caption, 22, MUTED), eq(tex, size, iso=iso), eq(value, 30, SUB) if value else m.VGroup()
        super().__init__(cap, e, val)
        self.cap, self.eq, self.val = cap, e, val
        e.next_to(cap, m.DOWN, buff=0.16, aligned_edge=m.LEFT)
        if value:
            if e.get_right()[0] - cap.get_left()[0] < VALUE_X - LEFT_X - 0.4:  # room on the line: the numbers column
                val.move_to([cap.get_left()[0] + VALUE_X - LEFT_X, e.get_y(), 0], aligned_edge=m.LEFT)
            else:  # a wide equation: the numbers go on the next line, indented
                val.next_to(e, m.DOWN, buff=0.2, aligned_edge=m.LEFT).shift(m.RIGHT * 0.6)


def ladder(rows: list[Row], top: float, gap: float = 0.42) -> m.VGroup:
    """Stacks rows down from y = top, all starting at the left margin."""
    y = top
    for r in rows:
        r.shift([LEFT_X - r.cap.get_left()[0], y - r.get_top()[1], 0])
        y = r.get_bottom()[1] - gap
    return m.VGroup(*rows)


def reveal(row: Row, write: float = 1.0) -> list[m.Animation]:
    """caption, then the equation written, then the numbers, as one play's animations"""
    anims = [m.FadeIn(row.cap, shift=m.UP * 0.1), m.Write(row.eq, run_time=write)]
    if len(row.val):
        anims.append(m.FadeIn(row.val, shift=m.LEFT * 0.2))
    return [m.LaggedStart(*anims, lag_ratio=0.45)]


def trace(axes: m.Axes, xs: np.ndarray, ys: np.ndarray, upto: float, **style) -> m.VMobject:
    """The data curve (xs, ys) on the axes up to x = upto: the samples' own polyline, mapped to the frame in one step.
    (Redrawn every frame, axes.plot would sample the whole curve again through Python each time.)"""
    o = axes.c2p(0, 0)
    ux, uy = axes.c2p(1, 0) - o, axes.c2p(0, 1) - o
    k = int(np.searchsorted(xs, upto, side="right"))
    x, y = np.append(xs[:k], upto), np.append(ys[:k], np.interp(upto, xs, ys))
    return m.VMobject(**style).set_points_as_corners(o + np.outer(x, ux) + np.outer(y, uy))


_NUMBERS: dict = {}


def number(value: float, decimals: int, unit: str, color: str, size: float) -> m.DecimalNumber:
    """A typeset number, made once per distinct text. Returned as it is, not copied: always_redraw copies it in."""
    key = (f"{value:.{decimals}f}", unit, color, size)
    if key not in _NUMBERS:
        _NUMBERS[key] = m.DecimalNumber(value, num_decimal_places=decimals, unit=unit or None, font_size=size, color=color,
                                        unit_buff_per_font_unit=0.003, group_with_commas=False)
    return _NUMBERS[key]


def live_panel(cells: list, rows: int, cols: int, size: float, corner: np.ndarray, buff: tuple[float, float]) -> m.VGroup:
    """A grid of live readouts 'name = value unit'. cells: (name, value(), decimals, unit, colour). The names are set
    once and stay still; only each number is redrawn per frame, from the cache (a panel redraws every frame, and
    typesetting or copying whole groups each time is what made the films slow to make in the browser)."""
    rows_now = [m.VGroup(eq(name + "=", size, SUB, iso=[]), number(get(), d, u, c, size)).arrange(m.RIGHT, buff=0.15)
                for name, get, d, u, c in cells]
    m.VGroup(*rows_now).arrange_in_grid(rows=rows, cols=cols, col_alignments="l" * cols, buff=buff).move_to(corner, aligned_edge=m.UL)
    names = m.VGroup(*[r[0] for r in rows_now])

    def follow(get, d, u, c, at):
        return m.always_redraw(lambda: number(get(), d, u, c, size).move_to(at, aligned_edge=m.LEFT))

    values = m.VGroup(*[follow(get, d, u, c, r[1].get_left()) for (_, get, d, u, c), r in zip(cells, rows_now)])
    return m.VGroup(names, values)


def sci(x: float, digits: int = 2) -> str:
    """3.0\\times10^{-5} for TeX"""
    e = int(f"{x:e}".split("e")[1])
    return rf"{x / 10**e:.{digits - 1}f}\times10^{{{e}}}"
