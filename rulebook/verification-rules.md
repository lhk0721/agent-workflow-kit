# Verification Rules

<!-- agent-workflow-kit — system-owned; `update` overwrites this file -->

What it takes to say "done", "works", or "B beats A". The failures these rules answer
share one shape: a claim was made from less evidence than the claim needed, and the
gap surfaced days later as re-work. The cost of the rule is minutes; the cost of the
gap was never less than an afternoon.

## Background execution

- NEVER start a process expected to run more than ten minutes without a watch attached
  in the same turn. Completion notifications fire on exit only; a process that is alive
  but stalled — a rate limit, a hung connection, a queue that emptied — never exits and
  never notifies.
- Designate the progress record before starting: a log or ledger that gains a timestamp
  per unit of work. If the script writes none, make it write one; at minimum watch the
  output file's size and mtime. A run with no observable signal is not a run, it is a wait.
- Watch conditions: stall — report when the record's newest timestamp is older than 4–5×
  the expected interval between units; progress — one line every 15 minutes and one at
  each phase transition, whatever the interval.
- Do not add a second completion watch; the background task reports its own exit. The
  watch owns stalls and progress only.
- Notify on death: an early exit, a quota stop, a partial output is reported the moment
  the watch sees it, not when the user asks. Write the log path into the handoff note
  (`session-handoff`, `skills.md`) so the next session can read what happened.

## Verification before claiming

- The success criterion is written before the work starts and checked before "done".
  A criterion written after seeing the result describes the result; it tests nothing.
- A sample of 3 proves nothing. Run the full set — every test, every item, every page —
  before claiming; a smoke run earns the right to start the full run, not a result.
- After changing behaviour, re-run what passed before, not only what you were fixing. A
  change that rescues the failing cases and breaks the passing ones is a regression that
  a fix-only check cannot see, and it is the common outcome of a targeted fix.
- State failures plainly, with the count and the first failing case. "Mostly works" is a
  failure report with the numbers removed.
- A UI change is verified by a screenshot at the widths users have (`ui-evidence`,
  `skills.md`), not by the DOM or the test suite; the evidence table goes into the work
  log and the PR body.
- "Verified" in a work log names the command and the count (`pytest: 148 passed`,
  `1,200/1,200 parsed`). A bare "verified" is a claim, not a record.

## Measurement hygiene

- Lock shared resources before timing — a GPU, a model server, a device — and record
  contention with every number (`nvidia-smi`, who else held the lock, what else ran).
  A latency measured under someone else's load is that person's latency.
- Same topology or no comparison: a number taken over the network says nothing about
  loopback in the container, and a number from one machine's memory layout says nothing
  about another's. Measure where the result will run, or label the number as a bound.
- Report per-target metrics, never the macro alone — targets that average to the same
  number can move in opposite directions, and the decision usually hangs on one of them.
- Compare distributions, not two single measurements: repeat runs, report the spread
  (or a paired bootstrap), decide on the interval. Two points have no spread.
- A rebase moves commits, not measurements. A number is attached to the tree it was
  taken on; after a rebase, re-measure before quoting it for the new one.
- Do not decide from 2–3 points of a curve. A learning curve that is not flat, a scan
  with three settings, a trend across two releases — each is a direction, not a verdict.
- Every number in a note carries its conditions: sample, seed, precision, batch size,
  host, date. A number without conditions cannot be reproduced and will be re-measured.

## Pre-registered judgment

- Write the gate before looking at any result: baseline file, metric, threshold, sample,
  pre-declared exclusions, the offline gate and the deployed gate, per-target reporting.
  A threshold chosen after the numbers are in is the number that was seen.
- A hyper-parameter chosen on the evaluation set is a leak. Choose on one fold, evaluate
  on the other, over k seeds; report the selection-vs-evaluation gap. In-sample gain is
  selection bias until a holdout confirms it.
- `experiment-gate` (`skills.md`) writes the gate document, runs the paired bootstrap
  and the holdout, and appends the verdict; the gate template's section list is in
  `templates.md`.
- "Tried and failed" goes into a note with the numbers and the conditions, so the next
  session does not retry it — and so a later change of conditions can reopen it on
  evidence rather than memory.
