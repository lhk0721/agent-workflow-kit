#!/usr/bin/env python3
"""agent-workflow-kit — pick a candidate on one fold, score it on the other. System-owned.

Choosing "the best of N candidates on the full validation set" and then reporting
that best score is selection bias with a friendly name. With enough candidates one
of them wins by luck, and the reported gain is the luck, not the candidate. The cure
is to select and evaluate on disjoint items: shuffle, split into folds, pick the best
candidate on one fold, score that pick on the other, and repeat over seeds so the
answer is a distribution rather than one lucky split.

The script prints both numbers side by side — the in-sample "best on the full set"
gain and the holdout gain — because seeing them next to each other is what makes the
first one stop being persuasive.

    python holdout_select.py --truth val.csv --baseline v3.csv --candidates "cands/*.csv" \\
        --metric composite --round half-up --clip 1,5 --seeds 8 --folds 2

Candidates: a directory (every *.csv in it) or a glob; each file is one candidate
named by its file stem. The baseline file is excluded if it matches.
"""
from __future__ import annotations

import argparse
import glob
import json
import random
import statistics
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # a skills directory is committed; it must not grow a __pycache__
sys.path.insert(0, str(Path(__file__).resolve().parent))
import gatelib as g  # noqa: E402


def find_candidates(spec, baseline_path):
    p = Path(spec)
    files = sorted(p.glob("*.csv")) if p.is_dir() else sorted(Path(f) for f in glob.glob(spec))
    base = Path(baseline_path).resolve()
    files = [f for f in files if f.resolve() != base]
    if not files:
        raise ValueError(f"no candidate CSV under {spec!r}")
    names = [f.stem for f in files]
    if len(set(names)) != len(names):
        raise ValueError("candidate file stems must be unique")
    return list(zip(names, files))


def make_splits(n, seeds, folds, base_seed):
    """Yield (seed, fold, select_index, evaluate_index). Interleaved slices keep folds equal-sized."""
    for s in range(seeds):
        order = list(range(n))
        random.Random(base_seed + s).shuffle(order)
        chunks = [order[i::folds] for i in range(folds)]
        for f in range(folds):
            select = sorted(chunks[f])
            evaluate = sorted(i for k, c in enumerate(chunks) if k != f for i in c)
            yield s, f, select, evaluate


def run(args):
    scorer = g.Scorer(args.metric, args.composite, args.round, g.parse_clip(args.clip), args.higher_is_better)
    truth_ids, truth_cols, truth = g.read_predictions(args.truth, args.id_col)
    _, base_cols, baseline = g.read_predictions(args.baseline, args.id_col)
    candidates = find_candidates(args.candidates, args.baseline)
    loaded = {name: g.read_predictions(path, args.id_col) for name, path in candidates}
    targets = g.common_targets([truth_cols, base_cols] + [loaded[n][1] for n, _ in candidates],
                               g.parse_targets(args.targets))
    ids, dropped = g.align(truth_ids, [baseline] + [loaded[n][2] for n, _ in candidates],
                           ["baseline"] + [n for n, _ in candidates], args.allow_missing)
    n = len(ids)
    ty = {t: [truth[i][t] for i in ids] for t in targets}
    prepared = {"baseline": {t: scorer.prepare([baseline[i][t] for i in ids]) for t in targets}}
    for name, _ in candidates:
        table = loaded[name][2]
        prepared[name] = {t: scorer.prepare([table[i][t] for i in ids]) for t in targets}
    names = [name for name, _ in candidates]
    select_best = max if scorer.higher_is_better else min
    if args.select != "auto":
        select_best = max if args.select == "max" else min

    # in-sample: the number that fools people
    full = {name: scorer.macro_on(prepared[name], ty)[0] for name in ["baseline"] + names}
    best_full = select_best(names, key=full.__getitem__)
    in_sample = {"best": best_full, "score": full[best_full], "baseline": full["baseline"],
                 "delta": full[best_full] - full["baseline"],
                 "table": sorted(((name, full[name], full[name] - full["baseline"]) for name in names),
                                 key=lambda r: r[1], reverse=scorer.higher_is_better)}

    # holdout
    picks, records = {}, []
    per_target_deltas = {t: [] for t in targets}
    for seed, fold, select, evaluate in make_splits(n, args.seeds, args.folds, args.seed):
        on_select = {name: scorer.macro_on(prepared[name], ty, select)[0] for name in names}
        pick = select_best(names, key=on_select.__getitem__)
        picks[pick] = picks.get(pick, 0) + 1
        pick_score, pick_base = scorer.macro_on(prepared[pick], ty, evaluate)
        base_score, base_base = scorer.macro_on(prepared["baseline"], ty, evaluate)
        for t in targets:
            per_target_deltas[t].append(scorer.score_from_base(pick_base[t]) - scorer.score_from_base(base_base[t]))
        records.append({"seed": args.seed + seed, "fold": fold, "pick": pick, "pick_on_select": on_select[pick],
                        "pick_on_holdout": pick_score, "baseline_on_holdout": base_score,
                        "delta": pick_score - base_score})
    deltas = [r["delta"] for r in records]
    holdout = {
        "splits": len(deltas), "mean": statistics.fmean(deltas),
        "sd": statistics.pstdev(deltas) if len(deltas) > 1 else 0.0,
        "min": min(deltas), "max": max(deltas),
        "improved": sum(1 for d in deltas if scorer.better(d)),
        "per_target": {t: {"mean": statistics.fmean(v), "sd": statistics.pstdev(v) if len(v) > 1 else 0.0}
                       for t, v in per_target_deltas.items()},
        "picks": sorted(picks.items(), key=lambda kv: -kv[1]),
        "records": records,
    }
    return {
        "truth": {"path": str(args.truth), "sha256": g.sha256_of(args.truth)},
        "baseline": {"path": str(args.baseline), "sha256": g.sha256_of(args.baseline)},
        "candidates": [{"name": name, "path": str(path), "sha256": g.sha256_of(path)} for name, path in candidates],
        "n": n, "dropped": dropped, "targets": targets, "metric": scorer.describe(),
        "seeds": args.seeds, "folds": args.folds, "seed": args.seed, "nan_as_zero": scorer.nan_count,
        "in_sample": in_sample, "holdout": holdout,
    }


def render(res):
    hi = "higher is better" in res["metric"]
    out = ["# holdout selection — candidates vs baseline", ""]
    out.append(f"- truth: `{res['truth']['path']}` (sha256 {res['truth']['sha256'][:12]}) · N = {res['n']}")
    out.append(f"- baseline: `{res['baseline']['path']}` (sha256 {res['baseline']['sha256'][:12]})")
    out.append(f"- candidates: {len(res['candidates'])} · metric: {res['metric']}")
    out.append(f"- {res['seeds']} seeds × {res['folds']} folds = {res['holdout']['splits']} splits · seed {res['seed']}")
    if any(res["dropped"].values()):
        out.append(f"- WARNING: scored on the intersection — dropped {res['dropped']}")
    if res["nan_as_zero"]:
        out.append(f"- NOTE: {res['nan_as_zero']} constant-vector correlation(s) scored as 0")
    ins = res["in_sample"]
    out += ["", "## In-sample — best on the full set (the number that fools people)", ""]
    out.append(f"baseline {g.fmt(ins['baseline'])} · best `{ins['best']}` {g.fmt(ins['score'])} · Δ {g.fmt_signed(ins['delta'])}")
    out += ["", "| candidate | full-set score | Δ vs baseline |", "| --- | --- | --- |"]
    for name, score, delta in ins["table"][:10]:
        out.append(f"| {name} | {g.fmt(score)} | {g.fmt_signed(delta)} |")
    if len(ins["table"]) > 10:
        out.append(f"| … {len(ins['table']) - 10} more | | |")
    h = res["holdout"]
    out += ["", "## Holdout — select on one fold, evaluate on the other", ""]
    out.append(f"Δ vs baseline over {h['splits']} splits: mean {g.fmt_signed(h['mean'])} · sd {g.fmt(h['sd'])} · "
               f"min {g.fmt_signed(h['min'])} · max {g.fmt_signed(h['max'])} · "
               f"improved in {h['improved']}/{h['splits']} splits ({'higher' if hi else 'lower'} is better)")
    out += ["", "| target | mean Δ | sd |", "| --- | --- | --- |"]
    for t, v in h["per_target"].items():
        out.append(f"| {t} | {g.fmt_signed(v['mean'])} | {g.fmt(v['sd'])} |")
    out += ["", "## Which candidate got picked", "", "| candidate | picked | full-set Δ |", "| --- | --- | --- |"]
    full = {name: delta for name, _, delta in ins["table"]}
    for name, count in h["picks"]:
        out.append(f"| {name} | {count}/{h['splits']} | {g.fmt_signed(full[name])} |")
    out += ["", f"In-sample Δ {g.fmt_signed(ins['delta'])} vs holdout mean Δ {g.fmt_signed(h['mean'])}: "
            "the difference is what selecting on the same items you score on buys you."]
    return "\n".join(out) + "\n"


def build_parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--truth", required=True)
    p.add_argument("--baseline", required=True, help="frozen baseline predictions CSV")
    p.add_argument("--candidates", required=True, help="directory of CSVs or a glob; one file per candidate")
    p.add_argument("--targets", default=None)
    p.add_argument("--id-col", default="id")
    p.add_argument("--metric", default="composite", choices=("composite",) + g.BASE_METRICS)
    p.add_argument("--composite", default=g.DEFAULT_COMPOSITE)
    p.add_argument("--round", default="none", choices=g.ROUNDINGS)
    p.add_argument("--clip", default=None, help="lo,hi")
    p.add_argument("--seeds", type=int, default=8)
    p.add_argument("--folds", type=int, default=2)
    p.add_argument("--seed", type=int, default=42, help="first seed; seeds are seed, seed+1, …")
    p.add_argument("--select", default="auto", choices=("auto", "max", "min"),
                   help="how a candidate wins the selection fold; auto follows the metric direction")
    d = p.add_mutually_exclusive_group()
    d.add_argument("--higher-is-better", dest="higher_is_better", action="store_true", default=None)
    d.add_argument("--lower-is-better", dest="higher_is_better", action="store_false")
    p.add_argument("--allow-missing", action="store_true")
    p.add_argument("--json", default=None)
    return p


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass
    args = build_parser().parse_args(argv)
    if args.folds < 2:
        print("error: --folds must be at least 2", file=sys.stderr)
        return 2
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
