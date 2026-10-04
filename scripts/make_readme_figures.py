#!/usr/bin/env python3
"""README figures for agent-workflow-kit — one script draws every figure.

    python scripts/make_readme_figures.py
    python skills/report-figures/scripts/figcheck.py scripts/make_readme_figures.py

Writes docs/figures/f01_work_unit.png, f02_context_store.png and f03_hook_points.png.
The README states each figure's claim in the paragraph that cites it; the caption under
the image is the figure's name only (report-figures rules 1–4 and 10).

One meaning per colour across the three diagrams: a white box is a document or a step
the repository owns, a blue box is a kit hook, a dark edge is the user's gate.
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyBboxPatch  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "figures"
STYLE = ROOT / "skills" / "report-figures" / "assets" / "grayscale.mplstyle"
# GitHub shows a README image at about 830 px wide. At 8.2 in and 200 dpi a 10.5 pt label
# lands near 14 px on screen; a wider figure would shrink every label below that.
WIDTH = 8.2

plt.style.use(str(STYLE))
# One family name, not a fallback list: with a list matplotlib 3.11 resolves weights per
# entry and picks Pretendard Thin (weight 100) for "normal" text.
plt.rcParams.update({"font.family": "Pretendard", "svg.hashsalt": "agent-workflow-kit"})

SURFACE = "#ffffff"
INK = "#111111"
INK2 = "#555555"
MUTED = "#8c8c8c"
AXIS = "#bdbdbd"
ACCENT = "#0072B2"  # Okabe-Ito blue: the edge of a hook box
HOOK_FILL = "#e5f0f8"  # light tint of the accent: the fill of a hook box


def save(fig, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.png"
    fig.savefig(path)
    plt.close(fig)
    print(f"saved {path.relative_to(ROOT).as_posix()}")


# ---------------------------------------------------------------- diagram helpers
def _canvas(xlim, ylim, width=WIDTH):
    """Axis-free canvas with a 1:1 aspect, so rounded corners stay round."""
    height = width * (ylim[1] - ylim[0]) / (xlim[1] - xlim[0])
    fig, ax = plt.subplots(figsize=(width, height))
    ax.set_xlim(*xlim)
    ax.set_ylim(*ylim)
    ax.set_aspect("equal")
    ax.axis("off")
    return fig, ax


def _rect(ax, x, y, w, h, *, fill=SURFACE, edge=AXIS, ls="-", lw=1.2):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.1",
                                facecolor=fill, edgecolor=edge, linewidth=lw, linestyle=ls))


def _box(ax, x, y, w, h, title, sub=None, *, fill=SURFACE, edge=AXIS, size=10.5, ty=0.63, sy=0.3):
    """A step or a document: a title and, below it, one line of detail."""
    _rect(ax, x, y, w, h, fill=fill, edge=edge)
    if sub is None:
        ty = 0.5
    ax.text(x + w / 2, y + h * ty, title, ha="center", va="center", fontsize=size, fontweight="semibold", color=INK)
    if sub is not None:
        ax.text(x + w / 2, y + h * sy, sub, ha="center", va="center", fontsize=size - 2, color=INK2)


def _card(ax, x, y, w, h, title, lines, *, size=10.5, gap=0.38, pad=0.22):
    """A store: a title row, a rule, and left-aligned lines of what it holds."""
    _rect(ax, x, y, w, h)
    ax.text(x + w / 2, y + h - 0.4, title, ha="center", va="center", fontsize=size, fontweight="semibold", color=INK)
    ax.plot([x + pad, x + w - pad], [y + h - 0.72] * 2, color=AXIS, lw=0.8)
    for i, line in enumerate(lines):
        ax.text(x + pad, y + h - 1.05 - i * gap, line, ha="left", va="center", fontsize=size - 2, color=INK2)


def _hook(ax, x, y, w, h, lines, *, size=9.5, gap=0.36):
    """A kit hook: blue box, centred names."""
    _rect(ax, x, y, w, h, fill=HOOK_FILL, edge=ACCENT)
    top = y + h / 2 + gap * (len(lines) - 1) / 2
    for i, line in enumerate(lines):
        ax.text(x + w / 2, top - i * gap, line, ha="center", va="center", fontsize=size, color=INK)


def _arrow(ax, src, dst, *, color=INK2, rad=0.0, lw=1.1, shrink_a=2):
    ax.annotate("", dst, src, arrowprops={
        "arrowstyle": "-|>", "color": color, "linewidth": lw,
        "shrinkA": shrink_a, "shrinkB": 2, "connectionstyle": f"arc3,rad={rad}",
    })


def _label(ax, x, y, text, *, size=8.5, color=INK2, **kw):
    kw.setdefault("ha", "center")
    kw.setdefault("va", "bottom")
    ax.text(x, y, text, fontsize=size, color=color, **kw)


def _elbow(ax, src, dst, *, color=INK2, lw=1.1):
    """Down from src, across, then down into dst: the turn between two rows of boxes."""
    (x0, y0), (x1, y1) = src, dst
    ym = (y0 + y1) / 2
    ax.plot([x0, x0, x1], [y0, ym, ym], color=color, lw=lw, solid_capstyle="round", solid_joinstyle="round")
    _arrow(ax, (x1, ym), (x1, y1), color=color, lw=lw, shrink_a=0)
    return ym


# ================================================================ F01 one work unit
def fig01():
    """figcheck: diagram. Issue → branch, worktree, doc, pointer → edits, review, commit (repeated) → PR, cleanup."""
    # an arrow label must fit the gap between two boxes, so the gap is wide and the
    # labels are one or two words; the body text says what each hand-over contains
    w, h, gap = 2.2, 0.95, 1.0
    xs = [0.2 + i * (w + gap) for i in range(4)]
    y_top, y_bot = 3.55, 1.25
    fig, ax = _canvas((0, 12.2), (0.35, 4.9))

    top = [("Issue", "gh issue create"), ("Branch + worktree", "42-feature-login"),
           ("Management doc", "the same name, .md"), ("Pointer", "AGENTS.md, one line")]
    for x, (title, sub) in zip(xs, top):
        _box(ax, x, y_top, w, h, title, sub, size=9.5)
    for i, handed in enumerate(["#42", "name", "path"]):
        _arrow(ax, (xs[i] + w, y_top + h / 2), (xs[i + 1], y_top + h / 2))
        _label(ax, (xs[i] + w + xs[i + 1]) / 2, y_top + h / 2 + 0.09, handed)

    bottom = [("Edits", "in the worktree only"), ("Review gate", "the user approves"),
              ("Commit", "one per work unit"), ("PR and cleanup", "pointer removed first")]
    for i, (x, (title, sub)) in enumerate(zip(xs, bottom)):
        _box(ax, x, y_bot, w, h, title, sub, size=9.5, edge=INK2 if i == 1 else AXIS)
    for i, handed in enumerate(["diff", "approval", "on request"]):
        _arrow(ax, (xs[i] + w, y_bot + h / 2), (xs[i + 1], y_bot + h / 2))
        _label(ax, (xs[i] + w + xs[i + 1]) / 2, y_bot + h / 2 + 0.09, handed)

    # from set-up to work: the document is open before the first edit (Pre-Execution Gate)
    ym = _elbow(ax, (xs[3] + w / 2, y_top), (xs[0] + w / 2, y_bot + h))
    _label(ax, (xs[0] + xs[3] + w) / 2, ym + 0.08, "doc open before the first edit")

    # the next work unit starts from the same open document; negative rad bends the arc
    # below the row (it bends to the right of the direction of travel)
    _arrow(ax, (xs[2] + w / 2, y_bot), (xs[0] + w / 2, y_bot), rad=-0.22)
    _label(ax, (xs[0] + xs[2] + w) / 2, y_bot - 0.4, "next work unit", va="center")

    # which skill runs which part
    _label(ax, xs[0], y_top + h + 0.1, "issue-start", color=MUTED, ha="left")
    _label(ax, xs[3] + w, y_bot - 0.1, "post-pr-cleanup", color=MUTED, ha="right", va="top")
    save(fig, "f01_work_unit")


# ================================================================ F02 the three stores
def fig02():
    """figcheck: diagram. AGENTS.md on every request, documents on demand, memory outside git; a hook under each."""
    w, h, gap = 3.8, 3.8, 0.7
    xs = [0.2 + i * (w + gap) for i in range(3)]
    y = 1.7
    fig, ax = _canvas((0, 13.2), (0.1, 6.0))

    heads = ["every request · bounded", "on demand · unbounded", "every session · outside git"]
    cards = [
        ("AGENTS.md", [
            "kernel rules, about 50 lines",
            "repo slots: this repo's rules",
            "Environment: 3 lines",
            "Recent Active Context:",
            "≤ 5 pointers, path + one line",
        ]),
        ("Management docs, notes", [
            "docs/issues/<type>/<branch>.md",
            "one issue, one record",
            "key: filename = branch = issue",
            "index: docs/issues/README.md",
            "notes/<track>/<topic>.md",
            "findings, handoffs, retros",
            "index: notes/README.md",
        ]),
        ("Session memory", [
            "~/.claude/…/memory/",
            "preferences, corrections",
            "links to notes, not the facts",
        ]),
    ]
    hooks = [["context-budget", "agents-freshness"],
             ["management-doc", "registry-row · notes-index"],
             ["memory-freshness"]]
    for x, head, (title, lines), names in zip(xs, heads, cards, hooks):
        _label(ax, x + w / 2, y + h + 0.12, head, size=9, color=MUTED)
        _card(ax, x, y, w, h, title, lines, size=10.2, pad=0.16)  # 8.2 pt lines: the longest path fits
        _hook(ax, x, 0.35, w, 1.0, names)

    # a pointer leaves AGENTS.md for the record it names; memory links to the note that holds the fact
    yp = y + h - 1.05 - 4 * 0.38  # the "≤ 5 pointers" line
    _arrow(ax, (xs[0] + w, yp), (xs[1], yp))
    _label(ax, xs[0] + w + gap / 2, yp + 0.08, "pointer")
    yl = y + h - 1.05 - 2 * 0.38  # the "links to notes" line
    _arrow(ax, (xs[2], yl), (xs[1] + w, yl))
    _label(ax, xs[2] - gap / 2, yl + 0.08, "link")
    save(fig, "f02_context_store")


# ================================================================ F03 where hooks fire
def fig03():
    """figcheck: diagram. Four fixed points: session start and tool call (Claude Code), commit and push (git)."""
    w, h, gap = 2.6, 0.8, 0.5
    xs = [0.2 + i * (w + gap) for i in range(4)]
    y_stage = 4.3
    fig, ax = _canvas((0, 12.3), (0.4, 5.3))

    stages = ["Session start", "Tool call", "git commit", "git push"]
    hooks = [
        ["memory-freshness", "agents-freshness", "repo-tools", "skill-listing (compact)"],
        ["guard-destructive", "require-skill"],
        ["pre-commit: 6 checks", "repo-*.mjs", "commit-msg"],
        ["pre-push"],
    ]
    for x, stage in zip(xs, stages):
        _box(ax, x, y_stage, w, h, stage)
    for i in range(3):
        _arrow(ax, (xs[i] + w, y_stage + h / 2), (xs[i + 1], y_stage + h / 2))
    hh, step = 0.56, 0.68
    for x, names in zip(xs, hooks):
        for j, name in enumerate(names):
            _hook(ax, x, y_stage - 0.3 - hh - j * step, w, hh, [name])

    # the two layers: Claude Code hooks see the command before it runs; git hooks run when git does
    y_br = 1.0
    for (a, b), text in (((0, 1), ".claude/hooks/ — before the agent acts"),
                         ((2, 3), ".githooks/ — when git acts")):
        ax.plot([xs[a], xs[b] + w], [y_br, y_br], color=AXIS, lw=1.0)
        _label(ax, (xs[a] + xs[b] + w) / 2, y_br - 0.1, text, size=9, va="top")
    save(fig, "f03_hook_points")


if __name__ == "__main__":
    for draw in (fig01, fig02, fig03):
        draw()
