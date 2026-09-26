#!/usr/bin/env python3
"""agent-workflow-kit — the metric, defined once, for the experiment-gate scripts. System-owned.

paired_bootstrap.py and holdout_select.py must score a predictions file the same way:
same clipping, same rounding, same tie handling in Spearman, same composite
expression. If each had its own copy, the gate would one day compare two different
metrics and nobody would notice. So the whole definition of "the metric" lives here.

Rounding is spelled out because it has moved a real score: `round()` (banker's) and
floor(x + 0.5) (half-up) disagree on every x.5, and the evaluation environment that
mattered used half-up. Spearman uses average ranks for ties (scipy's
rankdata(method="average")), so an integer-valued prediction column ranks the way a
grader's tool ranks it.

stdlib only. numpy is optional: it makes the bootstrap fast and changes nothing in the
point estimates (which resamples get drawn differs between the two engines).
"""
from __future__ import annotations

import csv
import hashlib
import math
import re
from pathlib import Path

try:
    import numpy as np
except ImportError:  # numpy is optional; the pure engine covers everything
    np = None

BASE_METRICS = ("rmse", "mae", "spearman", "pearson", "accuracy")
LOWER_IS_BETTER = frozenset({"rmse", "mae"})
DEFAULT_COMPOSITE = "0.5*(1-rmse)+0.5*spearman"
ROUNDINGS = ("none", "half-up", "bankers")


# --- files ---------------------------------------------------------------------

def sha256_of(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_predictions(path, id_col="id"):
    """CSV -> (ids in file order, numeric column names, {id: {column: float}}).

    A column counts as numeric when every cell parses as a float. Text columns (a
    prompt, a rationale) are ignored rather than rejected, so one file can carry both.
    An empty cell in a numeric column is an error: a missing prediction must be loud,
    not a NaN that quietly poisons the mean. Duplicate ids are an error: a paired
    comparison needs exactly one row per item.
    """
    path = Path(path)
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        fields = reader.fieldnames
        if not fields or id_col not in fields:
            raise ValueError(f"{path}: no '{id_col}' column (columns: {fields})")
        rows = list(reader)
    if not rows:
        raise ValueError(f"{path}: no rows")
    numeric = []
    for col in fields:
        if col == id_col or not col:
            continue
        cells = [(row.get(col) or "").strip() for row in rows]
        if all(cells) and all(_is_float(c) for c in cells):
            numeric.append(col)
        elif any(_is_float(c) for c in cells if c) and any(c == "" for c in cells):
            empties = sum(1 for c in cells if c == "")
            raise ValueError(f"{path}: column '{col}' has {empties} empty cell(s)")
    ids, table = [], {}
    for row in rows:
        key = (row.get(id_col) or "").strip()
        if not key:
            raise ValueError(f"{path}: empty id")
        if key in table:
            raise ValueError(f"{path}: duplicate id {key!r}")
        ids.append(key)
        table[key] = {col: float(row[col]) for col in numeric}
    return ids, numeric, table


def _is_float(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def common_targets(column_lists, restrict=None):
    """Targets = numeric columns shared by every file, in the first file's order."""
    first = column_lists[0]
    common = [c for c in first if all(c in cols for cols in column_lists[1:])]
    if restrict:
        missing = [t for t in restrict if t not in common]
        if missing:
            raise ValueError(f"target(s) not present in every file: {missing} (shared: {common})")
        return list(restrict)
    if not common:
        raise ValueError(f"no numeric column is shared by all files (first file has {first})")
    return common


def align(truth_ids, tables, names, allow_missing=False):
    """Items = truth ids present in every predictions file, in truth order.

    Scoring two systems on different subsets is how "B beats A" becomes an artefact
    of which items B skipped. A missing id is therefore an error unless the caller
    says the intersection is intended. Returns (ids, {name: dropped_count}).
    """
    dropped = {}
    ids = list(truth_ids)
    for name, table in zip(names, tables):
        missing = [i for i in ids if i not in table]
        dropped[name] = len(missing)
        if missing and not allow_missing:
            raise ValueError(
                f"{name} lacks {len(missing)} of {len(truth_ids)} truth ids (first: {missing[:3]}); "
                "pass --allow-missing to score the intersection on purpose"
            )
        ids = [i for i in ids if i in table]
    return ids, dropped


# --- preparation ---------------------------------------------------------------

def round_half_up(x: float) -> float:
    return float(math.floor(x + 0.5))


def round_bankers(x: float) -> float:
    return float(round(x))


_ROUNDERS = {"none": None, "half-up": round_half_up, "bankers": round_bankers}


def prepare(values, rounding="none", clip=None):
    """Clip, round, clip again — rounding can push a clipped value back out of range."""
    if rounding not in _ROUNDERS:
        raise ValueError(f"rounding must be one of {ROUNDINGS}, got {rounding!r}")
    rounder = _ROUNDERS[rounding]
    out = []
    for v in values:
        if clip:
            v = min(max(v, clip[0]), clip[1])
        if rounder:
            v = rounder(v)
        if clip:
            v = min(max(v, clip[0]), clip[1])
        out.append(float(v))
    return out


def parse_clip(text):
    if not text:
        return None
    parts = text.split(",")
    if len(parts) != 2:
        raise ValueError(f"--clip wants lo,hi (got {text!r})")
    lo, hi = float(parts[0]), float(parts[1])
    if lo > hi:
        raise ValueError("--clip lo must be <= hi")
    return (lo, hi)


# --- base metrics (pure Python) -----------------------------------------------

def rankdata(values):
    """1-based ranks, ties share the mean of their positions."""
    n = len(values)
    order = sorted(range(n), key=values.__getitem__)
    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + j + 2) / 2.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def rmse(p, t):
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(p, t)) / len(t))


def mae(p, t):
    return sum(abs(a - b) for a, b in zip(p, t)) / len(t)


def pearson(p, t):
    """NaN when either side is constant — the caller decides what NaN means."""
    n = len(t)
    mp, mt = sum(p) / n, sum(t) / n
    num = sum((a - mp) * (b - mt) for a, b in zip(p, t))
    dp = sum((a - mp) ** 2 for a in p)
    dt = sum((b - mt) ** 2 for b in t)
    den = math.sqrt(dp * dt)
    return num / den if den > 0 else math.nan


def spearman(p, t):
    return pearson(rankdata(p), rankdata(t))


def accuracy(p, t):
    return sum(1 for a, b in zip(p, t) if abs(a - b) < 1e-9) / len(t)


_METRIC_FN = {"rmse": rmse, "mae": mae, "spearman": spearman, "pearson": pearson, "accuracy": accuracy}


# --- composite expression -----------------------------------------------------

_TOKEN = re.compile(r"\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/()]))")


class Expression:
    """Arithmetic over metric names: + - * / ( ) and numbers. Nothing else parses.

    A hand-written recursive-descent parser instead of eval(): the text comes from a
    CLI flag or a gate document, and eval would run whatever is written there. Names
    are checked against BASE_METRICS at parse time, so `__import__` or `os` fail
    before anything is evaluated. Evaluation works on floats and on numpy arrays.
    """

    def __init__(self, text: str):
        self.text = text.strip()
        if not self.text:
            raise ValueError("empty expression")
        self._tokens = self._tokenize(self.text)
        self._pos = 0
        self.ast = self._expr()
        if self._pos != len(self._tokens):
            raise ValueError(f"unexpected {self._tokens[self._pos][1]!r} in {self.text!r}")
        self.names = sorted({node[1] for node in self._walk(self.ast) if node[0] == "name"})

    @staticmethod
    def _tokenize(text):
        tokens, pos = [], 0
        while pos < len(text):
            m = _TOKEN.match(text, pos)
            if not m or m.end() == pos:
                if text[pos:].strip() == "":
                    break
                raise ValueError(f"bad character {text[pos]!r} at {pos} in {text!r}")
            num, name, op = m.groups()
            if num is not None:
                tokens.append(("num", float(num)))
            elif name is not None:
                if name not in BASE_METRICS:
                    raise ValueError(f"unknown metric name {name!r} (allowed: {', '.join(BASE_METRICS)})")
                tokens.append(("name", name))
            else:
                tokens.append(("op", op))
            pos = m.end()
        return tokens

    def _peek(self):
        return self._tokens[self._pos] if self._pos < len(self._tokens) else (None, None)

    def _take(self):
        tok = self._peek()
        self._pos += 1
        return tok

    def _expr(self):
        node = self._term()
        while self._peek() == ("op", "+") or self._peek() == ("op", "-"):
            op = self._take()[1]
            node = ("bin", op, node, self._term())
        return node

    def _term(self):
        node = self._unary()
        while self._peek() == ("op", "*") or self._peek() == ("op", "/"):
            op = self._take()[1]
            node = ("bin", op, node, self._unary())
        return node

    def _unary(self):
        if self._peek() == ("op", "-"):
            self._take()
            return ("neg", self._unary())
        if self._peek() == ("op", "+"):
            self._take()
            return self._unary()
        return self._primary()

    def _primary(self):
        kind, value = self._take()
        if kind == "num":
            return ("num", value)
        if kind == "name":
            return ("name", value)
        if kind == "op" and value == "(":
            node = self._expr()
            if self._take() != ("op", ")"):
                raise ValueError(f"missing ')' in {self.text!r}")
            return node
        raise ValueError(f"expected a number, a metric name or '(' in {self.text!r}")

    def _walk(self, node):
        yield node
        if node[0] == "neg":
            yield from self._walk(node[1])
        elif node[0] == "bin":
            yield from self._walk(node[2])
            yield from self._walk(node[3])

    def evaluate(self, env):
        return self._eval(self.ast, env)

    def _eval(self, node, env):
        kind = node[0]
        if kind == "num":
            return node[1]
        if kind == "name":
            return env[node[1]]
        if kind == "neg":
            return -self._eval(node[1], env)
        op, left, right = node[1], self._eval(node[2], env), self._eval(node[3], env)
        if op == "+":
            return left + right
        if op == "-":
            return left - right
        if op == "*":
            return left * right
        return left / right


# --- scorer --------------------------------------------------------------------

class Scorer:
    """One metric, fully specified: base metric or composite, rounding, clip, direction.

    `nan_count` counts Spearman/Pearson values that were NaN (a constant vector) and
    were scored as 0.0 — a fold whose predictions are all one value has no ranking
    signal, and 0 is what "no signal" means. Report it when it is non-zero.
    """

    def __init__(self, metric="composite", composite=DEFAULT_COMPOSITE, rounding="none", clip=None,
                 higher_is_better=None):
        if metric == "composite":
            self.expr = Expression(composite)
        elif metric in BASE_METRICS:
            self.expr = Expression(metric)
        else:
            raise ValueError(f"metric must be composite or one of {BASE_METRICS}, got {metric!r}")
        self.metric = metric
        self.needs = self.expr.names
        self.rounding = rounding
        self.clip = clip
        if higher_is_better is None:
            higher_is_better = metric not in LOWER_IS_BETTER
        self.higher_is_better = bool(higher_is_better)
        self.nan_count = 0
        prepare([0.0], rounding, clip)  # validate rounding early

    def describe(self) -> str:
        what = f"composite = {self.expr.text}" if self.metric == "composite" else self.metric
        clip = f"clip [{self.clip[0]:g}, {self.clip[1]:g}]" if self.clip else "no clip"
        direction = "higher is better" if self.higher_is_better else "lower is better"
        return f"{what} · round {self.rounding} · {clip} · {direction}"

    def prepare(self, values):
        return prepare(values, self.rounding, self.clip)

    def base(self, pred, truth):
        """Only the base metrics the expression needs, on already-prepared predictions."""
        out = {}
        for name in self.needs:
            value = _METRIC_FN[name](pred, truth)
            if math.isnan(value):
                self.nan_count += 1
                value = 0.0
            out[name] = value
        return out

    def score_from_base(self, base):
        return float(self.expr.evaluate(base))

    def score(self, pred, truth):
        return self.score_from_base(self.base(pred, truth))

    def macro(self, base_by_target):
        """Expression over the target-averaged base metrics.

        For a linear expression this equals the mean of per-target scores; for a
        non-linear one it is the definition we choose, and it is stated here so the
        gate document can quote it.
        """
        targets = list(base_by_target)
        averaged = {name: sum(base_by_target[t][name] for t in targets) / len(targets) for name in self.needs}
        return self.score_from_base(averaged)

    def better(self, delta) -> bool:
        """Is a difference (candidate − baseline) an improvement?"""
        return delta > 0 if self.higher_is_better else delta < 0

    def macro_on(self, preds_by_target, truth_by_target, index=None):
        """Macro score on all items or on the items at `index`."""
        base = {}
        for t in preds_by_target:
            p, y = preds_by_target[t], truth_by_target[t]
            if index is not None:
                p = [p[i] for i in index]
                y = [y[i] for i in index]
            base[t] = self.base(p, y)
        return self.macro(base), base


# --- numpy helpers (row-wise, for resample matrices) --------------------------

def rank_rows(x):
    """Average ranks along axis 1 of a 2-D array — rankdata() for every row at once."""
    order = np.argsort(x, axis=1, kind="stable")
    sx = np.take_along_axis(x, order, axis=1)
    n = x.shape[1]
    pos = np.arange(1, n + 1)
    change = np.ones(sx.shape, dtype=bool)
    change[:, 1:] = sx[:, 1:] != sx[:, :-1]
    first = np.maximum.accumulate(np.where(change, pos, 0), axis=1)
    last_flag = np.ones(sx.shape, dtype=bool)
    last_flag[:, :-1] = change[:, 1:]
    last = np.minimum.accumulate(np.where(last_flag, pos, n + 1)[:, ::-1], axis=1)[:, ::-1]
    avg = (first + last) / 2.0
    ranks = np.empty_like(avg)
    np.put_along_axis(ranks, order, avg, axis=1)
    return ranks


def _pearson_rows(p, t):
    pc = p - p.mean(axis=1, keepdims=True)
    tc = t - t.mean(axis=1, keepdims=True)
    num = (pc * tc).sum(axis=1)
    den = np.sqrt((pc ** 2).sum(axis=1) * (tc ** 2).sum(axis=1))
    out = np.zeros(num.shape)
    ok = den > 0
    out[ok] = num[ok] / den[ok]
    return out, int((~ok).sum())


def base_rows(names, p, t):
    """Base metrics for every row of (R, n) prediction/truth matrices. Returns (dict, nan_count)."""
    out, nans = {}, 0
    for name in names:
        if name == "rmse":
            out[name] = np.sqrt(((p - t) ** 2).mean(axis=1))
        elif name == "mae":
            out[name] = np.abs(p - t).mean(axis=1)
        elif name == "pearson":
            out[name], k = _pearson_rows(p, t)
            nans += k
        elif name == "spearman":
            out[name], k = _pearson_rows(rank_rows(p), rank_rows(t))
            nans += k
        elif name == "accuracy":
            out[name] = (np.abs(p - t) < 1e-9).mean(axis=1)
    return out, nans


# --- formatting ----------------------------------------------------------------

def fmt(x, digits=4):
    return f"{x:.{digits}f}"


def fmt_signed(x, digits=4):
    return f"{x:+.{digits}f}"


def percentile(sorted_values, q):
    """Linear-interpolated percentile of an already sorted list, q in [0, 100]."""
    if not sorted_values:
        return math.nan
    k = (len(sorted_values) - 1) * q / 100.0
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return sorted_values[int(k)]
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (k - lo)


def parse_targets(text):
    return [t.strip() for t in text.split(",") if t.strip()] if text else None
