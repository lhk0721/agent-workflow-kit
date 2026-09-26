# Templates

<!-- agent-workflow-kit — system-owned; `update` overwrites this file -->

## GitHub issue body

```
### Goal
<one paragraph>

### Done criteria
- [ ] ...

### Umbrella
Sub-issue of #<umbrella-issue>.
```

## Management document — full — `<issues_root>/<type>/<branch>.md`

Default for issue work: anything that will take more than one commit. The work log
grows one `###` per commit. `## Current State` sits right after Done Criteria and is
the resume block the next session reads first; `AGENTS.md` points at it. The `####`
helpers under a work-log entry are optional — keep the ones that carry content.

```
# <issue> <title>

## Document Relations
- Issue: #<issue> — sub-issue of #<umbrella>
- Branch: `<branch>`
- Related: <docs this one depends on or changes together with>

## Summary
<two or three lines: what and why>

## Goal
- <what this issue must achieve>

## Scope
- <planned changes>

## Out Of Scope
- <explicit non-goals>

## Done Criteria
- [ ] <condition>
- [x] <condition> — <YYYY-MM-DD, written when ticked>

## Current State
<where the work stands, the next step, what blocks — keep current>

## Work Log

### <commit title>
> <one line: what changed and why>

#### Scope
#### Changes
#### Verification
#### Notes

## Management Notes

### Follow-up Candidates
- <deferred items, each a candidate issue>

### References
- <issues, docs, links>
```

## Management document — minimal

For a single-commit chore or docs fix. Same `## Current State`; the work-log section
is a `##` because there is only one.

```
# <issue> <title>

## Summary
- Issue: #<issue>
- Branch: `<branch>`
- Umbrella: #<umbrella-issue>
- Status: in progress | done | merged

## Current State
<entry point for the next session — keep this current; AGENTS.md points here>

## <commit title>
- What / why / how verified.
```

## PR body

Title: the commit-subject format, `<type>: <summary> (#<issue>)`, in `team_language`.
Body in English; `Closes #<issue>` closes the issue on merge.

```
## Related Issue
Closes #<issue>

## Summary
- <what and why — aligned with the management doc>

## Changes
- <structure, module or behaviour changes>

## Test Method
1. <how to run>
2. <what was checked — the full set, not a sample>

## Screenshots / Results
<optional; a UI change attaches the ui-evidence table>
```

## Handoff note — `<notes_dir>/<track>/<topic>-handoff.md`

The file ships with the `session-handoff` skill
(`.claude/skills/session-handoff/assets/handoff-template.md`); the skill fills it.
Sections, in order:

1. Running now — what, where (host, worktree), ETA, log path, how to tell it is alive
2. Confirmed — what is known true, with the command or number that says so
3. Next steps — in order, each executable as written
4. Fallback — the state that is certain if everything running fails
5. Today's traps — what cost time today and how to avoid it tomorrow
6. Tools — where the scripts are (copied into the repo, never only in the scratchpad)

## Gate document — `<notes_dir>/<track>/<experiment>-gate.md`

The file ships with the `experiment-gate` skill
(`.claude/skills/experiment-gate/assets/gate-template.md`); it is written before any
measurement (`verification-rules.md`). Sections:

1. Baseline — file, commit, conditions
2. Metric — how it is computed, per target
3. Threshold — the number that means "switch", chosen now
4. Sample — size, source, what a paired comparison pairs on
5. Exclusions — pre-declared, each with its reason
6. Gates — offline (holdout) and deployed (the served path)
7. Per-target reporting — one row per target, never the macro alone
8. Verdict — appended by the script, never edited by hand

## Notes index line — `<notes_dir>/README.md`

Newest first within its track. The bold headline is the conclusion.

```
- [cache-warmup-is-not-the-bottleneck.md](perf/cache-warmup-is-not-the-bottleneck.md) — **Cold cache costs 3% of p95, not 40%.** Five runs on the deployed topology; spread in the table
```

## Environment slot — `AGENTS.md`

```
## Environment (repo slot)

- Runs here: edit, tests, lint (`uv run pytest`, `uv run ruff check .`)
- Cannot run here: docker build, GPU inference → notes/infra/where-things-run.md
- Runs there: model serving and training on the GPU fleet → notes/infra/fleet.md (hosts, accounts, lock rules)
```

## Umbrella document — `<issues_root>/umbrella/<issue>-umbrella-<member>.md`

```
# Umbrella — <member>

| Sub-issue | Doc | Status |
| --- | --- | --- |
| #<n> <title> | docs/issues/<type>/<branch>.md | in progress |
```

## Recent Active Context pointer — `AGENTS.md`

```
- `<branch>` — `<issues_root>/<type>/<branch>.md` — <one-line summary>
```

The branch name stays in backticks: the context-budget check and the SessionStart
freshness hook find pointer lines by that token; without it a stale pointer is invisible
to both. `issue-start` writes this line; the branch's last commit removes it.

## Master Registry row — `<issues_root>/README.md`

```
| #<issue> | docs/issues/<type>/<branch>.md | in progress | <one-line summary> |
```

## Commit message

```
<type>: <summary> (#<issue>)

<body: why + what changed + how verified — English>
```

## PR validation workflow — `.github/workflows/pr-validation.yml`

Replace the gate steps with the repo's own documented local gate commands
(see `git-rules.md` "CI gate"). Keep the frame: cancel superseded runs,
read-only permissions, a timeout, and no secrets.

```yaml
name: PR Validation

on:
  pull_request:
    branches:
      - main
  workflow_dispatch:

concurrency:
  group: pr-validation-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  gate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      # <toolchain setup: actions/setup-node / astral-sh/setup-uv / ...>
      # <locked install: npm ci / uv sync --locked ...>
      # <the repo's documented gate commands: typecheck, lint, tests, machine checks>
```
