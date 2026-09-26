#!/usr/bin/env python3
"""agent-workflow-kit — paired bootstrap: is B better than A on the same items? System-owned.

Two systems scored on the same items are compared item by item, not as two separate
numbers. Resampling the items with replacement and re-scoring both systems on every
resample gives the distribution of the difference directly, and that distribution is
far narrower than the gap between two separately estimated intervals. P(B better) is
the share of resamples in which B scores better; ties count half, so identical
predictions give exactly 0.5.

The verdict belongs to the reader, so the exit code is always 0. `--threshold`
prints a PASS/FAIL line against the number that was written in the gate document
before anything was measured; that is the only number it should be compared to.

    python paired_bootstrap.py --truth val.csv --a baseline.csv --b candidate.csv \\
        --metric composite --round half-up --clip 1,5 --resamples 10000 --threshold 0.90

CSV: an `id` column plus one numeric column per target. Targets are the numeric
columns common to all three files (or --targets). Per-target rows and a macro row are
always printed; a macro alone hides a target that got worse.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True  # a skills directory is committed; it must not grow a __pycache__
sys.path.insert(0, str(Path(__file__).resolve().parent))
import gatelib as g  # noqa: E402


def load(args):
    truth_ids, truth_cols, truth = g.read_predictions(args.truth, args.id_col)
    _, a_cols, a = g.read_predictions(args.a, args.id_col)
    _, b_cols, b = g.read_predictions(args.b, args.id_col)
    targets = g.common_targets([truth_cols, a_cols, b_cols], g.parse_targets(args.targets))
    ids, dropped = g.align(truth_ids, [a, b], ["A", "B"], args.allow_missing)
    return ids, targets, truth, a, b, dropped


def point_estimates(scorer, ids, targets, truth, a, b):
    """Prepared prediction lists plus full-set metrics for A and B."""
    pa, pb, ty, base_a, base_b = {}, {}, {}, {}, {}
    for t in targets:
        ty[t] = [truth[i][t] for i in ids]
        pa[t] = scorer.prepare([a[i][t] for i in ids])
        pb[t] = scorer.prepare([b[i][t] for i in ids])
        base_a[t] = scorer.base(pa[t], ty[t])
        base_b[t] = scorer.base(pb[t], ty[t])
    return pa, pb, ty, base_a, base_b


def bootstrap_numpy(scorer, pa, pb, ty, targets, resamples, seed, chunk=1000):
    np = g.np
    rng = np.random.default_rng(seed)
    n = len(ty[targets[0]])
    A = {t: np.asarray(pa[t], dtype=float) for t in targets}
    B = {t: np.asarray(pb[t], dtype=float) for t in targets}
    T = {t: np.asarray(ty[t], dtype=float) for t in targets}
    per_target = {t: [] for t in targets}
    macro = []
    nans = 0
    done = 0
    while done < resamples:
        r = min(chunk, resamples - done)
        idx = rng.integers(0, n, size=(r, n))
        sum_a = {name: np.zeros(r) for name in scorer.needs}
        sum_b = {name: np.zeros(r) for name in scorer.needs}
        for t in targets:
            tt = T[t][idx]
            ba, k1 = g.base_rows(scorer.needs, A[t][idx], tt)
            bb, k2 = g.base_rows(scorer.needs, B[t][idx], tt)
            nans += k1 + k2
            per_target[t].append(scorer.expr.evaluate(bb) - scorer.expr.evaluate(ba))
            for name in scorer.needs:
                sum_a[name] += ba[name]
                sum_b[name] += bb[name]
        k = len(targets)
        macro.append(scorer.expr.evaluate({m: v / k for m, v in sum_b.items()})
                     - scorer.expr.evaluate({m: v / k for m, v in sum_a.items()}))
        done += r
    scorer.nan_count += nans
    return {t: np.concatenate(v).tolist() for t, v in per_target.items()}, np.concatenate(macro).tolist()


def bootstrap_pure(scorer, pa, pb, ty, targets, resamples, seed):
    rng = random.Random(seed)
    n = len(ty[targets[0]])
    population = range(n)
    per_target = {t: [] for t in targets}
    macro = []
    for _ in range(resamples):
        idx = rng.choices(population, k=n)
        base_a, base_b = {}, {}
        for t in targets:
            tt = [ty[t][i] for i in idx]
            base_a[t] = scorer.base([pa[t][i] for i in idx], tt)
            base_b[t] = scorer.base([pb[t][i] for i in idx], tt)
            per_target[t].append(scorer.score_from_base(base_b[t]) - scorer.score_from_base(base_a[t]))
        macro.append(scorer.macro(base_b) - scorer.macro(base_a))
    return per_target, macro


def summarize(deltas, scorer):
    s = sorted(deltas)
    n = len(s)
    wins = sum(1 for d in deltas if scorer.better(d))
    ties = sum(1 for d in deltas if d == 0)
    return {
        "boot_mean": sum(deltas) / n,
        "ci_low": g.percentile(s, 2.5),
        "ci_high": g.percentile(s, 97.5),
        "p_better": (wins + 0.5 * ties) / n,
        "ties": ties,
    }


def run(args):
    """Everything except printing; tests call this directly."""
    scorer = g.Scorer(args.metric, args.composite, args.round, g.parse_clip(args.clip), args.higher_is_better)
    ids, targets, truth, a, b, dropped = load(args)
    pa, pb, ty, base_a, base_b = point_estimates(scorer, ids, targets, truth, a, b)
    engine = args.engine
    if engine == "auto":
        engine = "numpy" if g.np is not None else "pure"
    if engine == "numpy" and g.np is None:
        raise SystemExit("numpy is not importable; use --engine pure")
    started = time.time()
    if engine == "numpy":
        per_target, macro = bootstrap_numpy(scorer, pa, pb, ty, targets, args.resamples, args.seed)
    else:
        per_target, macro = bootstrap_pure(scorer, pa, pb, ty, targets, args.resamples, args.seed)
    elapsed = time.time() - started

    rows = []
    for t in targets:
        sa, sb = scorer.score_from_base(base_a[t]), scorer.score_from_base(base_b[t])
        rows.append({"target": t, "a": sa, "b": sb, "delta": sb - sa, "base_a": base_a[t], "base_b": base_b[t],
                     **summarize(per_target[t], scorer)})
    ma, mb = scorer.macro(base_a), scorer.macro(base_b)
    macro_row = {"target": "macro", "a": ma, "b": mb, "delta": mb - ma, **summarize(macro, scorer)}
    verdict = None
    if args.threshold is not None:
        verdict = "PASS" if macro_row["p_better"] >= args.threshold else "FAIL"
    return {
        "truth": {"path": str(args.truth), "sha256": g.sha256_of(args.truth)},
        "a": {"path": str(args.a), "sha256": g.sha256_of(args.a)},
        "b": {"path": str(args.b), "sha256": g.sha256_of(args.b)},
        "n": len(ids), "dropped": dropped, "targets": targets,
        "metric": scorer.describe(), "metric_args": {"metric": args.metric, "composite": args.composite,
                                                      "round": args.round, "clip": args.clip},
        "resamples": args.resamples, "seed": args.seed, "engine": engine, "seconds": round(elapsed, 2),
        "nan_as_zero": scorer.nan_count, "threshold": args.threshold, "verdict": verdict,
        "rows": rows, "macro": macro_row,
    }


def render(res):
    out = []
    out.append("# paired bootstrap — B vs A")
    out.append("")
    out.append(f"- truth: `{res['truth']['path']}` (sha256 {res['truth']['sha256'][:12]}) · N = {res['n']}")
    out.append(f"- A (baseline): `{res['a']['path']}` (sha256 {res['a']['sha256'][:12]})")
    out.append(f"- B (candidate): `{res['b']['path']}` (sha256 {res['b']['sha256'][:12]})")
    if any(res["dropped"].values()):
        out.append(f"- WARNING: scored on the intersection — dropped {res['dropped']}")
    out.append(f"- metric: {res['metric']}")
    out.append(f"- resamples {res['resamples']} · seed {res['seed']} · engine {res['engine']} · {res['seconds']} s")
    out.append(f"- targets: {', '.join(res['targets'])}")
    if res["nan_as_zero"]:
        out.append(f"- NOTE: {res['nan_as_zero']} constant-vector correlation(s) scored as 0")
    out.append("")
    out.append("| target | A | B | Δ (B−A) | boot mean Δ | 95% CI | P(B better) |")
    out.append("| --- | --- | --- | --- | --- | --- | --- |")
    for r in res["rows"] + [res["macro"]]:
        name = f"**{r['target']}**" if r["target"] == "macro" else r["target"]
        out.append(f"| {name} | {g.fmt(r['a'])} | {g.fmt(r['b'])} | {g.fmt_signed(r['delta'])} | "
                   f"{g.fmt_signed(r['boot_mean'])} | [{g.fmt_signed(r['ci_low'])}, {g.fmt_signed(r['ci_high'])}] | "
                   f"{r['p_better']:.3f} |")
    base_names = [n for n in ("rmse", "mae", "spearman", "pearson", "accuracy")
                  if res["rows"] and n in res["rows"][0]["base_a"]]
    if len(base_names) > 1 or (base_names and res["metric_args"]["metric"] == "composite"):
        out.append("")
        out.append("| target | " + " | ".join(f"{n} A | {n} B" for n in base_names) + " |")
        out.append("| --- |" + " --- | --- |" * len(base_names))
        for r in res["rows"]:
            cells = " | ".join(f"{g.fmt(r['base_a'][n])} | {g.fmt(r['base_b'][n])}" for n in base_names)
            out.append(f"| {r['target']} | {cells} |")
    if res["verdict"]:
        out.append("")
        out.append(f"Threshold P(B better) ≥ {res['threshold']:.2f} on macro: **{res['verdict']}** "
                   f"({res['macro']['p_better']:.3f})")
    return "\n".join(out) + "\n"


def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--truth", required=True, help="CSV with id + truth columns")
    p.add_argument("--a", required=True, help="baseline predictions CSV (frozen; record its sha256 in the gate doc)")
    p.add_argument("--b", required=True, help="candidate predictions CSV")
    p.add_argument("--targets", default=None, help="comma-separated subset of the shared numeric columns")
    p.add_argument("--id-col", default="id")
    p.add_argument("--metric", default="composite", choices=("composite",) + g.BASE_METRICS)
    p.add_argument("--composite", default=g.DEFAULT_COMPOSITE,
                   help=f"expression over metric names for --metric composite (default {g.DEFAULT_COMPOSITE!r})")
    p.add_argument("--round", default="none", choices=g.ROUNDINGS,
                   help="applied to predictions before scoring; half-up = floor(x+0.5)")
    p.add_argument("--clip", default=None, help="lo,hi applied to predictions before and after rounding")
    p.add_argument("--resamples", type=int, default=10000)
    p.add_argument("--seed", type=int, default=42)
    d = p.add_mutually_exclusive_group()
    d.add_argument("--higher-is-better", dest="higher_is_better", action="store_true", default=None)
    d.add_argument("--lower-is-better", dest="higher_is_better", action="store_false")
    p.add_argument("--threshold", type=float, default=None, help="print PASS/FAIL against P(B better) on macro")
    p.add_argument("--engine", default="auto", choices=("auto", "numpy", "pure"))
    p.add_argument("--allow-missing", action="store_true", help="score the intersection when B lacks some ids")
    p.add_argument("--json", default=None, help="write the full result here")
    return p


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass
    args = build_parser().parse_args(argv)
    try:
        res = run(args)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(render(res), end="")
    if args.json:
        Path(args.json).write_text(json.dumps(res, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
