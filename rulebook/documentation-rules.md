# Documentation Rules

<!-- agent-workflow-kit — system-owned; `update` overwrites this file -->

## Management documents

- One issue = one document: `docs/issues/<type>/<branch>.md`. Filename = branch name.
- One commit = one `## <commit title>` work-log section, written BEFORE the commit and
  staged with it (the pre-commit hook enforces presence, not order — order is the rule).
- A new management document adds one row to the Master Registry
  (`docs/issues/README.md`) in the same commit.
- Keep a `## Current State` block per document — the entry point for the next session.
  `AGENTS.md` Recent Active Context holds pointers only (name + path + one line);
  details never live in `AGENTS.md`.
- Recent Active Context lifecycle: add the pointer line when issue work starts;
  remove it in the post-PR cleanup gate (`git-rules.md`) when the PR merges or the
  issue closes. The slot lists ACTIVE work only — its size is bounded by work in
  progress, never by history. Finished work stays discoverable through
  `docs/issues/` and the Master Registry, not here.
- Paths in documents are repo-relative. Never absolute paths.

## Umbrella issues (`agent-system.yaml: umbrella_issues: per-member`)

- Each member keeps ONE umbrella issue as their personal workstream unit:
  `docs/issues/umbrella/<issue>-umbrella-<member>.md`.
- Concrete tasks are normal issues registered as GitHub sub-issues of the umbrella.
  Their documents live under `docs/issues/<type>/` as usual and link back to the umbrella.
- The umbrella document holds the member's task list and status only — never work logs.

## Backstop checks

- Hooks (`.githooks/`) are backstops, not the rule source. The document precedes the
  file change; a tripped hook means that order was already violated. Fix the cause
  (write the doc, get on the right branch), then commit again.
- Repo-specific pre-commit checks live in `.githooks/checks/repo-*.mjs` — that name
  prefix is the repo's namespace: the kit never ships `repo-*` files, so `update`
  never touches them. Each is a plain Node script; nonzero exit blocks the commit.
  A check that should only warn prints its reminder and exits 0.
