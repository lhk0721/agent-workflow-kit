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

## Management document — `docs/issues/<type>/<branch>.md`

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

## Umbrella document — `docs/issues/umbrella/<issue>-umbrella-<member>.md`

```
# Umbrella — <member>

| Sub-issue | Doc | Status |
| --- | --- | --- |
| #<n> <title> | docs/issues/<type>/<branch>.md | in progress |
```

## Master Registry row — `docs/issues/README.md`

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
