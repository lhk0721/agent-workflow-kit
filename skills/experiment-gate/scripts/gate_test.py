#!/usr/bin/env python3
"""agent-workflow-kit — tests for the experiment-gate scripts on synthetic data. System-owned.

Each case is a property the gate relies on. If one breaks, a verdict somewhere was
wrong: identical systems must come out at exactly 0.5, a strictly better system at
~1.0, half-up and banker's rounding must differ on x.5, the composite parser must
reject code, and a candidate that only wins in-sample must show ~0 on holdout.

    PYTHONUTF8=1 python skills/experiment-gate/scripts/gate_test.py
"""
from __future__ import annotations

import csv
import math
import random
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True  # a skills directory is committed; it must not grow a __pycache__
sys.path.insert(0, str(HERE))
import gatelib as g  # noqa: E402
import holdout_select  # noqa: E402
import paired_bootstrap  # noqa: E402

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def write_csv(path, ids, columns, rows_by_id, extra_text=None):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        header = ["id"] + columns + (["note"] if extra_text else [])
        w.writerow(header)
        for i in ids:
            row = [i] + [f"{rows_by_id[i][c]:.6f}" for c in columns]
            if extra_text:
                row.append(extra_text)
            w.writerow(row)


def synth(n=400, seed=1, targets=("content", "organization", "expression"), noise_a=0.6, noise_b=0.6, shrink_b=None):
    """Truth in [1, 5]; A = truth + noise; B = truth + noise (independent) or truth + shrink*A's noise."""
    rng = random.Random(seed)
    ids = [f"item{i:04d}" for i in range(n)]
    truth, a, b = {}, {}, {}
    for i in ids:
        truth[i], a[i], b[i] = {}, {}, {}
        for t in targets:
            y = rng.uniform(1, 5)
            ea = rng.gauss(0, noise_a)
            truth[i][t] = y
            a[i][t] = y + ea
            b[i][t] = y + (shrink_b * ea if shrink_b is not None else rng.gauss(0, noise_b))
    return ids, list(targets), truth, a, b


def bootstrap_args(tmp, ids, targets, truth, a, b, **over):
    write_csv(tmp / "truth.csv", ids, targets, truth, extra_text="prompt text, ignored")
    write_csv(tmp / "a.csv", ids, targets, a)
    write_csv(tmp / "b.csv", ids, targets, b)
    argv = ["--truth", str(tmp / "truth.csv"), "--a", str(tmp / "a.csv"), "--b", str(tmp / "b.csv"),
            "--resamples", "2000", "--seed", "7"]
    for k, v in over.items():
        argv += [f"--{k.replace('_', '-')}", str(v)]
    return paired_bootstrap.build_parser().parse_args(argv)


# --- 4. composite expression ----------------------------------------------------

@test
def composite_parses_and_evaluates():
    e = g.Expression("0.5*(1-rmse)+0.5*spearman")
    assert e.names == ["rmse", "spearman"], e.names
    assert abs(e.evaluate({"rmse": 0.6, "spearman": 0.58}) - (0.5 * 0.4 + 0.5 * 0.58)) < 1e-12
    assert abs(g.Expression("-rmse").evaluate({"rmse": 0.3}) + 0.3) < 1e-12
    assert abs(g.Expression("(1 - mae) / 2").evaluate({"mae": 0.5}) - 0.25) < 1e-12
    assert abs(g.Expression(" 2 ").evaluate({}) - 2.0) < 1e-12


@test
def composite_rejects_code():
    for bad in ("__import__('os').system('x')", "rmse.__class__", "2 ** 3", "rmse; 1", "foo + 1",
                "rmse[0]", "rmse(1)", "", "1 +", "(rmse", "rmse spearman", "0.5*(1-rmse)+0.5*spearman)"):
        try:
            g.Expression(bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad!r}")


# --- 3. rounding ----------------------------------------------------------------

@test
def half_up_and_bankers_differ_on_point_five():
    xs = [0.5, 1.5, 2.5, 3.5, 4.5, -0.5, 2.4999, 2.5001]
    assert g.prepare(xs, "half-up") == [1.0, 2.0, 3.0, 4.0, 5.0, 0.0, 2.0, 3.0], g.prepare(xs, "half-up")
    assert g.prepare(xs, "bankers") == [0.0, 2.0, 2.0, 4.0, 4.0, -0.0, 2.0, 3.0], g.prepare(xs, "bankers")
    assert g.prepare(xs, "none") == xs
    assert g.prepare([0.2, 5.4, 4.5], "half-up", (1, 5)) == [1.0, 5.0, 5.0], "clip before and after"
    truth = [1.0, 2.0, 3.0, 4.0, 5.0]
    preds = [1.5, 2.5, 3.5, 4.5, 4.5]
    hu = g.Scorer("rmse", rounding="half-up").score(g.prepare(preds, "half-up"), truth)
    bk = g.Scorer("rmse", rounding="bankers").score(g.prepare(preds, "bankers"), truth)
    assert hu != bk, (hu, bk)
    try:
        g.prepare([1.0], "nearest")
    except ValueError:
        pass
    else:
        raise AssertionError("unknown rounding accepted")


# --- ranks and base metrics ----------------------------------------------------

@test
def ranks_and_correlations():
    assert g.rankdata([1, 2, 2, 3]) == [1.0, 2.5, 2.5, 4.0]
    assert g.rankdata([3, 3, 3]) == [2.0, 2.0, 2.0]
    assert abs(g.spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1.0) < 1e-12
    assert abs(g.spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1.0) < 1e-12
    assert math.isnan(g.spearman([2, 2, 2], [1, 2, 3]))
    s = g.Scorer("spearman")
    assert s.score([2.0, 2.0, 2.0], [1.0, 2.0, 3.0]) == 0.0 and s.nan_count == 1
    assert abs(g.rmse([1, 2], [2, 4]) - math.sqrt(2.5)) < 1e-12
    assert abs(g.mae([1, 2], [2, 4]) - 1.5) < 1e-12
    assert g.accuracy([1, 2, 3], [1, 2, 4]) == 2 / 3
    if g.np is not None:
        rows = g.np.array([[1, 2, 2, 3], [3, 3, 3, 3], [0.5, 0.1, 0.9, 0.1]])
        got = g.rank_rows(rows)
        for r, row in enumerate(rows):
            assert got[r].tolist() == g.rankdata(row.tolist()), (r, got[r].tolist())


# --- 1. identical systems -> exactly 0.5 --------------------------------------

@test
def identical_predictions_give_half():
    ids, targets, truth, a, _ = synth(n=200, seed=3)
    with tempfile.TemporaryDirectory() as d:
        for engine in engines():
            res = paired_bootstrap.run(bootstrap_args(Path(d), ids, targets, truth, a, a, engine=engine,
                                                      round="half-up", clip="1,5", resamples=500))
            assert res["macro"]["p_better"] == 0.5, (engine, res["macro"])
            assert res["macro"]["ties"] == 500
            for row in res["rows"]:
                assert row["p_better"] == 0.5 and row["delta"] == 0.0, row


# --- 2. B strictly better on every item -> ~1.0 -------------------------------

@test
def strictly_better_gives_about_one():
    ids, targets, truth, a, b = synth(n=300, seed=5, shrink_b=0.3)
    with tempfile.TemporaryDirectory() as d:
        for engine in engines():
            res = paired_bootstrap.run(bootstrap_args(Path(d), ids, targets, truth, a, b, engine=engine))
            assert res["macro"]["p_better"] >= 0.99, (engine, res["macro"])
            assert res["macro"]["ci_low"] > 0, res["macro"]
            for row in res["rows"]:
                assert row["p_better"] >= 0.99, row
            assert res["verdict"] is None
            res = paired_bootstrap.run(bootstrap_args(Path(d), ids, targets, truth, a, b, engine=engine, threshold=0.9))
            assert res["verdict"] == "PASS"
            res = paired_bootstrap.run(bootstrap_args(Path(d), ids, targets, truth, b, a, engine=engine, threshold=0.9))
            assert res["verdict"] == "FAIL" and res["macro"]["p_better"] <= 0.01


@test
def same_quality_is_a_coin_flip():
    ids, targets, truth, a, b = synth(n=300, seed=11)
    with tempfile.TemporaryDirectory() as d:
        res = paired_bootstrap.run(bootstrap_args(Path(d), ids, targets, truth, a, b, engine=engines()[0]))
        assert 0.1 < res["macro"]["p_better"] < 0.9, res["macro"]
        assert res["macro"]["ci_low"] < 0 < res["macro"]["ci_high"], res["macro"]


@test
def lower_is_better_flips_direction():
    ids, targets, truth, a, b = synth(n=200, seed=13, shrink_b=0.3)
    with tempfile.TemporaryDirectory() as d:
        res = paired_bootstrap.run(bootstrap_args(Path(d), ids, targets, truth, a, b, metric="rmse", engine=engines()[0]))
        assert res["macro"]["delta"] < 0 and res["macro"]["p_better"] >= 0.99, res["macro"]
        assert "lower is better" in res["metric"]


@test
def engines_agree_on_point_estimates():
    if g.np is None:
        print("  (numpy absent — only the pure engine was checked)")
        return
    ids, targets, truth, a, b = synth(n=150, seed=17)
    with tempfile.TemporaryDirectory() as d:
        base = dict(round="half-up", clip="1,5", resamples=300)
        r1 = paired_bootstrap.run(bootstrap_args(Path(d), ids, targets, truth, a, b, engine="numpy", **base))
        r2 = paired_bootstrap.run(bootstrap_args(Path(d), ids, targets, truth, a, b, engine="pure", **base))
        for x, y in zip(r1["rows"] + [r1["macro"]], r2["rows"] + [r2["macro"]]):
            for k in ("a", "b", "delta"):
                assert abs(x[k] - y[k]) < 1e-12, (x["target"], k, x[k], y[k])
            assert abs(x["p_better"] - y["p_better"]) < 0.15, (x["target"], x["p_better"], y["p_better"])
        # a numpy run on many resamples must stay quick: 1,000 items × 10,000 resamples
        ids, targets, truth, a, b = synth(n=1000, seed=19)
        import time
        t0 = time.time()
        paired_bootstrap.run(bootstrap_args(Path(d), ids, targets, truth, a, b, engine="numpy", resamples=10000))
        secs = time.time() - t0
        print(f"  (numpy: 1000 items x 10000 resamples x 3 targets in {secs:.1f} s)")
        assert secs < 120, secs


# --- CSV loading and alignment ------------------------------------------------

@test
def csv_loading_rules():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "x.csv"
        p.write_text("id,content,note,organization\nA,1.5,hello,2\nB,2.5,world,3\n", encoding="utf-8")
        ids, cols, table = g.read_predictions(p)
        assert ids == ["A", "B"] and cols == ["content", "organization"], (ids, cols)
        assert table["A"] == {"content": 1.5, "organization": 2.0}
        p.write_text("id,content\nA,1\nA,2\n", encoding="utf-8")
        assert_raises(ValueError, "duplicate", g.read_predictions, p)
        p.write_text("id,content\nA,1\nB,\n", encoding="utf-8")
        assert_raises(ValueError, "empty cell", g.read_predictions, p)
        p.write_text("essay,content\nA,1\n", encoding="utf-8")
        assert_raises(ValueError, "no 'id' column", g.read_predictions, p)
        assert g.read_predictions(p, id_col="essay")[0] == ["A"]
    assert g.common_targets([["a", "b", "c"], ["c", "a"], ["a", "c", "z"]]) == ["a", "c"]
    assert g.common_targets([["a", "b"], ["a", "b"]], ["b"]) == ["b"]
    assert_raises(ValueError, "not present", g.common_targets, [["a"], ["a"]], ["b"])
    truth_ids = ["1", "2", "3"]
    full = {"1": {}, "2": {}, "3": {}}
    part = {"1": {}, "3": {}}
    assert g.align(truth_ids, [full], ["A"]) == (["1", "2", "3"], {"A": 0})
    assert_raises(ValueError, "lacks 1 of 3", g.align, truth_ids, [full, part], ["A", "B"])
    assert g.align(truth_ids, [full, part], ["A", "B"], allow_missing=True) == (["1", "3"], {"A": 0, "B": 1})


# --- 5. holdout: in-sample winner vs holdout ----------------------------------

@test
def holdout_exposes_in_sample_selection():
    """20 candidates of the same quality as the baseline (independent noise, same sigma).
    Picking the best on the full set shows a gain; picking on one half and scoring on
    the other shows ~0. The stable quantity is the gap between the two — the winner's
    curse — while the holdout value itself wanders about ±0.01 with the baseline draw
    (probed over 5 seeds × {20, 40} candidates × {none, half-up}: gap +0.011..+0.021).
    Seed 37 measured: in-sample +0.0173, holdout +0.0016."""
    rng = random.Random(37)
    n, targets = 400, ["content", "organization", "expression"]
    ids = [f"e{i:04d}" for i in range(n)]
    truth = {i: {t: rng.uniform(1, 5) for t in targets} for i in ids}
    base = {i: {t: truth[i][t] + rng.gauss(0, 0.6) for t in targets} for i in ids}
    cands = {f"cand{k:02d}": {i: {t: truth[i][t] + rng.gauss(0, 0.6) for t in targets} for i in ids}
             for k in range(20)}
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        write_csv(d / "truth.csv", ids, targets, truth)
        write_csv(d / "baseline.csv", ids, targets, base)
        (d / "cands").mkdir()
        for name, table in cands.items():
            write_csv(d / "cands" / f"{name}.csv", ids, targets, table)
        args = holdout_select.build_parser().parse_args([
            "--truth", str(d / "truth.csv"), "--baseline", str(d / "baseline.csv"),
            "--candidates", str(d / "cands"), "--round", "none", "--clip", "1,5", "--seeds", "8", "--folds", "2"])
        res = holdout_select.run(args)
        ins, hold = res["in_sample"]["delta"], res["holdout"]["mean"]
        print(f"  (in-sample best-of-20 delta {ins:+.4f}, holdout mean delta {hold:+.4f}, sd {res['holdout']['sd']:.4f})")
        assert ins > 0.008, ins
        assert abs(hold) < 0.01, hold
        assert ins - hold > 0.008, (ins, hold)
        assert res["holdout"]["splits"] == 16
        assert sum(c for _, c in res["holdout"]["picks"]) == 16
        assert len(res["candidates"]) == 20 and res["n"] == n
        md = holdout_select.render(res)
        assert "the number that fools people" in md and "## Holdout" in md
        # the same candidate selected by the baseline dir glob form
        args.candidates = str(d / "cands" / "*.csv")
        assert holdout_select.run(args)["in_sample"]["best"] == res["in_sample"]["best"]
        # a genuinely better candidate wins on holdout too
        better = {i: {t: truth[i][t] + rng.gauss(0, 0.3) for t in targets} for i in ids}
        write_csv(d / "cands" / "cand_real.csv", ids, targets, better)
        args.candidates = str(d / "cands")
        res2 = holdout_select.run(args)
        assert res2["in_sample"]["best"] == "cand_real"
        assert res2["holdout"]["mean"] > 0.02 and res2["holdout"]["improved"] == 16, res2["holdout"]


# --- CLI ------------------------------------------------------------------------

@test
def cli_help_and_end_to_end():
    for script in ("paired_bootstrap.py", "holdout_select.py"):
        r = subprocess.run([sys.executable, str(HERE / script), "--help"], capture_output=True, text=True)
        assert r.returncode == 0 and "usage:" in r.stdout, (script, r.returncode, r.stderr[:200])
    ids, targets, truth, a, b = synth(n=120, seed=29, shrink_b=0.5)
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        write_csv(d / "truth.csv", ids, targets, truth)
        write_csv(d / "a.csv", ids, targets, a)
        write_csv(d / "b.csv", ids, targets, b)
        r = subprocess.run([sys.executable, str(HERE / "paired_bootstrap.py"), "--truth", str(d / "truth.csv"),
                            "--a", str(d / "a.csv"), "--b", str(d / "b.csv"), "--resamples", "300",
                            "--round", "half-up", "--clip", "1,5", "--threshold", "0.9", "--json", str(d / "out.json")],
                           capture_output=True, text=True, encoding="utf-8")
        assert r.returncode == 0, r.stderr
        assert "| **macro** |" in r.stdout and "PASS" in r.stdout, r.stdout
        assert (d / "out.json").exists()
        # bad composite exits 2 with a message, not a traceback
        r = subprocess.run([sys.executable, str(HERE / "paired_bootstrap.py"), "--truth", str(d / "truth.csv"),
                            "--a", str(d / "a.csv"), "--b", str(d / "b.csv"), "--composite", "__import__('os')"],
                           capture_output=True, text=True, encoding="utf-8")
        assert r.returncode == 2 and "unknown metric name" in r.stderr, (r.returncode, r.stderr)


# --- helpers / runner -----------------------------------------------------------

def engines():
    return ["numpy", "pure"] if g.np is not None else ["pure"]


def assert_raises(exc, fragment, fn, *args, **kw):
    try:
        fn(*args, **kw)
    except exc as e:
        assert fragment in str(e), f"expected {fragment!r} in {e}"
        return
    raise AssertionError(f"{fn.__name__} did not raise {exc.__name__}")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass
    failed = 0
    for fn in TESTS:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}\n{traceback.format_exc()}")
    print(f"\n{failed} of {len(TESTS)} failed" if failed else f"\nall {len(TESTS)} passed (engine: {', '.join(engines())})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
