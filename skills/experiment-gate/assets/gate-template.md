# Gate — <candidate name> vs <baseline name>

<!-- Fill every section above "Verdict" BEFORE the candidate is measured. A number
     written after the result is known is not a threshold, it is a rationalisation. -->

## Question

<One sentence. "Does <candidate> beat <baseline> on <metric> over <data>?">

## Baseline

- Predictions file: `<path>` — sha256 `<hash>` (frozen; regenerate = a new gate)
- Produced by: `<commit / image tag / adapter name>`
- Metric value on the data below: `<value>` (macro), per target: `<t1> <v1>`, `<t2> <v2>`, …

## Candidate(s)

| name | what changes vs baseline | predictions file (filled when measured) |
| --- | --- | --- |
| `<candidate>` | <one line> | `<path>` |

## Metric

- Formula: `<e.g. 0.5*(1-rmse) + 0.5*spearman>` (composite over `rmse`, `spearman`)
- Rounding: `<none | half-up (floor(x+0.5)) | bankers>` applied to predictions before scoring
- Clip: `<lo, hi>`
- Inference settings that change the numbers: `<batch size, dtype, seed, temperature>`
- Aggregation: per target, then macro = expression over target-averaged base metrics
- Targets, in report order: `<t1>`, `<t2>`, `<t3>`
- Tool: `paired_bootstrap.py --metric composite --composite "<formula>" --round <r> --clip <lo,hi>`

## Data

- Item ids: `<file>` — sha256 `<hash>` — N = `<n>`
- Items that must be present (known hard cases, regression ids): `<ids or "none">`
- Both systems are scored on exactly these ids; a missing id is a failed run, not a smaller N

## Threshold

- Adopt when P(candidate better) ≥ `0.90` by paired bootstrap, `<resamples>` resamples, seed `<seed>`, on the macro
- Below the threshold the answer is "not adopted", including at 0.85 — the threshold is not a suggestion

## Selection rule

<When the candidate has a knob (layer band, cut points, weights, prompt variant):>

- Candidates: `<list or directory>`
- Chosen by `holdout_select.py --seeds <k> --folds 2` — select on one fold, evaluate on the other
- The pick is the candidate selected most often across splits; its gate is the holdout Δ, never the full-set Δ
- "Best on the full set" is reported for contrast only

<When there is no knob: "none — a single candidate">

## Pre-declared exclusions / sensitivity checks

<Conditions under which a passing P(win) is still not adopted. Write them now; after
the result they will look like excuses either way.>

- <e.g. "any target's Δ below −0.01 → not adopted even if the macro passes">
- <e.g. "P(win) computed on the continuous scale does not count; only the rounded scale">
- <e.g. "if the candidate changes N or item order, the run is void">

## Gates

1. Offline: `paired_bootstrap.py` on the predictions files above → P(win), CI, per-target table
2. Deployed (when a shipped artefact exists): the same items through the deployed container / endpoint,
   `<how: command, host, image tag>`; the deployed metric must be within `<tolerance>` of the offline one, and
   failed items = 0

## Decision rule

- **adopt** — both gates pass and no exclusion fires: `<what changes in the pipeline, which artefact ships>`
- **reject** — offline gate fails or an exclusion fires: `<baseline stays; what is written down; the candidate is not re-run with a tweak>`
- **undecided** — offline passes, deployed gate not yet run or failed on infrastructure: `<what unblocks it; the baseline ships meanwhile>`

## Verdict

<!-- Filled after measuring. Paste the script's Markdown tables here unedited. -->

- Date: `<yyyy-mm-dd>`
- P(candidate better): `<p>` (threshold `0.90`) — `<PASS | FAIL>`
- Mean Δ: `<+0.0000>`, 95% CI `[<lo>, <hi>]`
- Per target:

| target | baseline | candidate | Δ | P(better) |
| --- | --- | --- | --- | --- |

- Holdout (if a selection rule applies): mean Δ `<…>`, sd `<…>`, improved in `<k>/<splits>` splits; in-sample Δ was `<…>`
- Exclusions fired: `<none | which>`
- Deployed gate: `<not run | value, failed items>`
- Decision: **`<adopt | reject | undecided>`** — `<one line on what happens to the pipeline>`
