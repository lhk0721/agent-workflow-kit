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
