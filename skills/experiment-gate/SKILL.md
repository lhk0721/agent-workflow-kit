---
name: experiment-gate
description: Pre-registers and runs the comparison between a candidate (model, prompt, parameter, adapter, head) and a baseline — gate document first, then paired bootstrap on the same items, holdout selection for any tuned knob, per-target report, a fixed P(win) threshold. Use it every time a variant is about to be compared against a baseline or someone asks whether to switch, adopt, or keep something, even if they only ask "which one is better"; the gate must exist before the candidate's numbers are looked at. Triggers include "판정해", "이길 확률", "bootstrap 돌려", "문턱 넘었어?", "갈아탈지 정해", "홀드아웃", "채택할지", "기준선이랑 비교", "is B better than A", "should we switch", "paired bootstrap", "pre-register", "before looking at the results", "did it beat the baseline", "pick the best layer/cut point/weight", and any time a model/prompt/parameter variant is about to be compared against a baseline.
---

# Experiment gate

A comparison whose rules are written after the numbers are in is not a comparison; it
is a story about the numbers. This skill puts the rules on paper first, then runs two
scripts that produce the only two figures that matter — the probability the candidate
is better on the same items, and how much of a tuned candidate's gain survives when it
is selected on items it is not scored on.

## Why the discipline is this strict

Three things happened in real projects and each cost days:

- One validation set was consulted eight times in a day. With eight candidates of equal
  quality, the chance that at least one crosses a 0.92 threshold by luck is roughly
  40%. The gate fixes the threshold and the item set before the first look, so the
  eighth look is worth the same as the first.
- A candidate scored 0.916 once, against a baseline that had scored 0.905 once, and the
  switch was nearly made on that pair. Two single measurements are not a comparison;
  a paired bootstrap on the same items is. Rebasing a branch moves commits, not
  measurements — a "newer" baseline number is still one number.
- Cut points tuned on the full 400-item validation set showed +0.028. Selected on one
  half and scored on the other, over 8 seeds × 2 folds, they lost to plain rounding
  every time (−0.002 to −0.010). The in-sample number was selection bias with a
  friendly name.

## The rules

Write these into the gate document **before** the candidate is measured. Each one closes
a specific hole.

1. **The baseline predictions file is frozen.** Path + sha256 in the doc. Regenerating
   the baseline is a new gate, because a regenerated baseline can drift by the same
   amount the candidate is supposed to win by.
2. **The metric is one function**, with rounding, clipping, batch/inference settings and
   aggregation spelled out. `round()` (banker's) and floor(x+0.5) (half-up) disagree on
   every x.5; bf16 scores change with padding, so batch size is part of the metric.
   Report per target and macro — a macro can go up while one target goes down.
3. **The threshold is P(candidate better) ≥ 0.90** by paired bootstrap on the same
   items, unless the doc says otherwise before measuring. 0.85 means "not adopted",
   not "close".
4. **Sensitivity exclusions are declared up front**: conditions under which a passing
   P(win) still does not count (a target that regresses, a different N, a continuous
   scale when the deployed scale is integer). One project wrote: "if this condition had
   not been registered, we would have switched on 0.916 alone."
5. **Any selection over candidates goes through holdout**, never "best on the full
   set". Layer band, cut points, ensemble weights, prompt variant: select on fold A,
   evaluate on fold B, over k seeds. Report the in-sample number only as contrast.
6. **Two gates when a deployed artefact exists**: offline (predictions files) and
   deployed (the same items through the container or endpoint that ships). The offline
   pass is not the deployed pass; int8, batching and a stale adapter path have each
   moved the deployed number.

## Sequence

1. **Write the gate doc from `assets/gate-template.md`.** Fill every section above
   `## Verdict`. Ask the user for anything the repo does not already state (threshold,
   metric formula, mandatory items); do not invent a threshold.
2. **Freeze the baseline.** `sha256sum <baseline.csv>` into the doc. If the baseline
   predictions are not in a CSV with an `id` column yet, export them once and freeze
   that file.
3. **Measure the candidate** on exactly the item ids in the doc. A run that skips items
   is a failed run, not a smaller N — `paired_bootstrap.py` refuses a missing id unless
   `--allow-missing` says the intersection is intended.
4. **If there is a knob, run holdout selection first:**

   ```
   python <skill>/scripts/holdout_select.py --truth val.csv --baseline base.csv \
       --candidates "cands/*.csv" --metric composite --round half-up --clip 1,5 --seeds 8 --folds 2
   ```

   The candidate to gate is the one picked most often; its number is the holdout Δ.
5. **Run the paired bootstrap:**

   ```
   python <skill>/scripts/paired_bootstrap.py --truth val.csv --a base.csv --b cand.csv \
       --metric composite --composite "0.5*(1-rmse)+0.5*spearman" --round half-up --clip 1,5 \
       --resamples 10000 --seed 42 --threshold 0.90 --json gate.json
   ```

   It prints per-target and macro rows (A, B, Δ, bootstrap mean Δ, 95% CI, P(B better))
   and a PASS/FAIL line against `--threshold`. Exit code is 0 either way — the verdict is
   the reader's, and it is written down, not inferred from a shell status.
6. **Append the verdict** to the gate doc: paste the tables unedited under `## Verdict`,
   fill P(win), CI, per-target, holdout result, which exclusions fired, the date and the
   decision (adopt / reject / undecided) with its consequence for the pipeline.
7. **Run the deployed gate** when there is a shipped artefact, and record it in the same
   section. Until it passes the decision is "undecided" and the baseline ships.

`<skill>` is this skill's directory: `.claude/skills/experiment-gate/` when installed in
the repo, `~/.claude/skills/experiment-gate/` for a personal install.

## Where the gate document lives

- When `agent-system.yaml` sets `notes_dir`: `<notes_dir>/<track>/<name>-gate.md`, where
  `<track>` is the repo's track directory for that kind of work (e.g. `score/`,
  `rationale/`) and `<name>` names the candidate (`layer-band-24-48-gate.md`).
- Otherwise: next to the issue's management document, `docs/issues/<type>/<branch>-gate.md`,
  linked from the management doc's `## Current State`.

One gate per comparison. A second candidate against the same baseline is a second doc,
or a second row in `## Candidate(s)` written before that candidate is measured.

## Reading the output

- `P(B better)` counts ties as half, so identical predictions give exactly 0.500 and a
  candidate that changes nothing cannot pass by rounding luck.
- The 95% CI straddling 0 with P(win) = 0.93 is normal: P(win) answers "is B better",
  the CI answers "by how much". The gate is on P(win); the CI goes in the doc so the
  reader knows the size.
- A per-target row with P(better) far below the macro is what the exclusions are for.
  Say which target regressed in the verdict even when the macro passes.
- `holdout_select.py` prints "in-sample Δ vs holdout mean Δ". When they differ by more
  than the holdout sd, the in-sample gain was selection, not improvement.
- `NOTE: n constant-vector correlation(s) scored as 0` means some fold had a prediction
  column with a single value; Spearman is undefined there and counted as no signal.

## Anti-patterns this prevents

| Habit | What actually happens | The rule that stops it |
| --- | --- | --- |
| Look at the validation set after each tweak | With 8 looks, ~40% chance one crosses 0.92 by luck | Threshold and item ids fixed in the doc before the first look |
| Switch on a single 0.916 vs 0.905 | Two numbers, one comparison, no distribution | Paired bootstrap on the same items; P(win) ≥ 0.90 |
| Tune cut points / bands / weights on the full set | +0.028 in-sample, −0.002 to −0.010 on holdout | `holdout_select.py`; in-sample reported as contrast only |
| Compare on "whatever items both runs finished" | The candidate wins on the subset it did not skip | Missing id = failed run; `--allow-missing` is explicit |
| Report the macro only | One target regresses under a rising macro | Per-target table in every verdict; exclusions per target |
| Offline pass, ship | int8 / batch / adapter path change the deployed number | Deployed gate on the same items before "adopt" |
| Regenerate the baseline "to be fair" | The baseline drifts by the margin under test | Baseline file frozen by sha256; regeneration = new gate |

## Files

- `assets/gate-template.md` — the document; every section above Verdict is filled before measuring
- `scripts/paired_bootstrap.py` — P(B better), Δ with CI, per-target and macro; `--help` lists every option
- `scripts/holdout_select.py` — select-on-A / evaluate-on-B over seeds × folds, with the in-sample number for contrast
- `scripts/gatelib.py` — the metric definition both scripts share (rounding, clip, ranks, composite parser)
- `scripts/gate_test.py` — synthetic-data checks; run with `PYTHONUTF8=1 python scripts/gate_test.py`

Python 3.9+ stdlib; numpy is optional and only makes 10,000 resamples fast.
