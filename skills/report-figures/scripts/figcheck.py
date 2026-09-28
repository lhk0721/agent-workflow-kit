#!/usr/bin/env python3
"""Static check of a matplotlib figure script against the report-figures rules.

agent-workflow-kit — system-owned. Stdlib only.

    python figcheck.py make_figures.py [more.py ...]

FAIL (exit 1)
  - sentence-like text passed to a title, suptitle, text, annotate, axis label, tick
    label, legend title or a `label=` keyword: ends like a sentence (다/요/니다, or a
    period after three or more words), runs past eight words, or carries a
    parenthetical explanation (a parenthesis with a space inside, 15+ characters)
  - a non-gray colour literal in a colour keyword, outside a function whose source
    contains the marker `figcheck: diagram`. Module-level string constants and dict
    literals are resolved, so `color=BLUE` is checked against `BLUE = "#2a78d6"`.
WARN
  - horizontal bars (`barh`): keep them for ranked lists with long category names
  - a bar or histogram drawn in a function that starts its length axis above zero

The check reads the script; it does not run it. Layout problems (collisions, text
spilling out of boxes) still need the rendered image looked at.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

TEXT_CALLS = {
    "set_title", "suptitle", "title", "text", "figtext", "annotate",
    "set_xlabel", "set_ylabel", "xlabel", "ylabel", "supxlabel", "supylabel",
    "set_xticklabels", "set_yticklabels",
}
TEXT_KW = {"label", "title", "xlabel", "ylabel", "s", "text", "labels"}
COLOR_KW = {
    "color", "c", "colors", "facecolor", "edgecolor", "fc", "ec",
    "markerfacecolor", "markeredgecolor", "mfc", "mec",
}
# the axis that carries bar length: vertical bars and histograms on y, horizontal bars on x
BAR_CALLS = {"bar": "y", "hist": "y", "barh": "x"}
LIMIT_CALLS = {"set_ylim": "y", "ylim": "y", "set_xlim": "x", "xlim": "x"}
GRAY_NAMES = {
    "black", "white", "k", "w", "none", "gray", "grey", "lightgray", "lightgrey",
    "darkgray", "darkgrey", "dimgray", "dimgrey", "silver", "gainsboro", "whitesmoke",
    "C0", "C1", "C2", "C3",  # the grayscale style's cycle
}
MARKER = "figcheck: diagram"
MAX_WORDS = 8
MAX_CHANNEL_SPREAD = 16  # a warm or cool gray like #c3c2b7 still counts as gray


def text_of(node: ast.AST) -> str | None:
    """The literal text of a string node; f-string holes become {}."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return "".join(v.value if isinstance(v, ast.Constant) else "{}" for v in node.values)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = text_of(node.left), text_of(node.right)
        if left is not None and right is not None:
            return left + right
    return None


def sentence_problem(text: str) -> str | None:
    for line in text.split("\n"):
        s = line.strip()
        if not s:
            continue
        if re.search(r"(다|요|니다)[.!?]?$", s):
            return "ends like a sentence"
        words = s.split()
        if s.endswith(".") and len(words) >= 3:
            return "ends like a sentence"
        if ". " in s and len(words) >= 4:
            return "contains a sentence break"
        if len(words) > MAX_WORDS:
            return f"{len(words)} words (labels stay under {MAX_WORDS + 1})"
        m = re.search(r"\(([^)]*)\)", s)
        if m and " " in m.group(1) and len(m.group(0)) >= 15:
            return "parenthetical explanation"
    return None


def is_gray(color: str) -> bool:
    c = color.strip()
    if c.lower() in GRAY_NAMES or c in GRAY_NAMES:
        return True
    try:
        float(c)  # "0.5" is a matplotlib gray level
        return True
    except ValueError:
        pass
    m = re.fullmatch(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})", c)
    if not m:
        return False
    h = m.group(1)
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return max(r, g, b) - min(r, g, b) <= MAX_CHANNEL_SPREAD


def call_name(node: ast.Call) -> str:
    f = node.func
    if isinstance(f, ast.Attribute):
        return f.attr
    if isinstance(f, ast.Name):
        return f.id
    return ""


class Checker:
    def __init__(self, path: Path):
        self.path = path
        self.source = path.read_text(encoding="utf-8")
        self.tree = ast.parse(self.source, filename=str(path))
        self.fails: list[tuple[int, str]] = []
        self.warns: list[tuple[int, str]] = []
        self.constants: dict[str, list[str]] = {}
        for node in self.tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                values = self.strings_in(node.value, resolve=False)
                if values:
                    self.constants[node.targets[0].id] = values

    def strings_in(self, node: ast.AST, resolve: bool = True) -> list[str]:
        """Every string a colour argument can evaluate to, as far as a static read can tell."""
        t = text_of(node)
        if t is not None:
            return [t]
        if resolve and isinstance(node, ast.Name):
            return self.constants.get(node.id, [])
        if resolve and isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
            return self.constants.get(node.value.id, [])
        if isinstance(node, ast.Dict):
            return [s for v in node.values for s in self.strings_in(v, resolve)]
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            return [s for e in node.elts for s in self.strings_in(e, resolve)]
        if isinstance(node, ast.IfExp):
            return self.strings_in(node.body, resolve) + self.strings_in(node.orelse, resolve)
        if isinstance(node, (ast.ListComp, ast.GeneratorExp)):
            return self.strings_in(node.elt, resolve)
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Mult)):
            return self.strings_in(node.left, resolve) + self.strings_in(node.right, resolve)
        return []

    def check_text(self, node: ast.AST, where: str) -> None:
        nodes = node.elts if isinstance(node, (ast.List, ast.Tuple)) else [node]
        for n in nodes:
            t = text_of(n)
            if t is None:
                continue
            why = sentence_problem(t)
            if why:
                short = t.replace("\n", " ")
                short = short if len(short) <= 60 else short[:57] + "..."
                self.fails.append((n.lineno, f'text in {where} — {why}: "{short}"'))

    def scopes(self):
        """Top-level functions (with their marker flag) and the module body outside them."""
        funcs = [n for n in self.tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
        for f in funcs:
            seg = ast.get_source_segment(self.source, f) or ""
            yield f, MARKER in seg
        rest = ast.Module(body=[n for n in self.tree.body if n not in funcs], type_ignores=[])
        yield rest, False

    def run(self) -> None:
        for scope, diagram in self.scopes():
            bar_axes: set[str] = set()
            limits: list[ast.Call] = []
            for node in ast.walk(scope):
                if not isinstance(node, ast.Call):
                    continue
                name = call_name(node)
                if name in TEXT_CALLS:
                    for a in node.args:
                        self.check_text(a, name)
                for kw in node.keywords:
                    if kw.arg in TEXT_KW:
                        self.check_text(kw.value, f"{name}({kw.arg}=)")
                    if kw.arg in COLOR_KW and not diagram:
                        for c in self.strings_in(kw.value):
                            if not is_gray(c):
                                self.fails.append((node.lineno, f"non-gray colour {c!r} in {name}({kw.arg}=) — use gray, or mark a diagram function with '{MARKER}'"))
                if name == "barh":
                    self.warns.append((node.lineno, "horizontal bars — keep only for a ranked list with long category names; otherwise use vertical columns"))
                if name in BAR_CALLS:
                    bar_axes.add(BAR_CALLS[name])
                if name in LIMIT_CALLS:
                    limits.append(node)
            for node in limits:
                if LIMIT_CALLS[call_name(node)] in bar_axes:
                    lo = node.args[0] if node.args else None
                    if isinstance(lo, ast.Tuple) and lo.elts:
                        lo = lo.elts[0]
                    if isinstance(lo, ast.Constant) and isinstance(lo.value, (int, float)) and lo.value > 0:
                        self.warns.append((node.lineno, f"bars with an axis starting at {lo.value} — bar length misstates ratios; use points or start at zero"))


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    failed = False
    for arg in argv:
        c = Checker(Path(arg))
        c.run()
        for line, msg in sorted(set(c.fails)):
            print(f"FAIL {arg}:{line}: {msg}")
        for line, msg in sorted(set(c.warns)):
            print(f"WARN {arg}:{line}: {msg}")
        print(f"{arg}: {len(set(c.fails))} fail, {len(set(c.warns))} warn")
        failed = failed or bool(c.fails)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
