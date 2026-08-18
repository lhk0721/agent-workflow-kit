# Agent Entry Point

<!-- kernel:begin — agent-workflow-kit system-owned block. Do not edit inside; `update` replaces it. -->
## Pre-Execution Gate

- Before any file edit, creation, move, or deletion, re-check whether the task belongs to a tracked issue.
- If it does, open the matching management document under `docs/issues/` BEFORE editing files.
- Reading this file once at session start does not satisfy the gate — re-apply it before each change.
- "Small fix" is not an exception. Only pure Q&A with no file changes is exempt.

## Issue-First Order

- Before starting work: find a matching open GitHub issue; create one if none (`gh issue create`). NEVER guess issue numbers.
- Branch name = `<issue>-<type>-<desc>` = management doc filename. This equality is the system's axis.
- Umbrella issues (`agent-system.yaml: umbrella_issues`): one umbrella per member's workstream; concrete tasks are sub-issues under it. See `docs/agent-workflow/documentation-rules.md`.

## Branch & Worktree Discipline

- NEVER edit issue-tracked files while HEAD is a protected branch (`agent-system.yaml: protected_branches`).
- One branch, one working directory. New issue: `git worktree add ../<repo>-<issue> -b <branch> main`.
- NEVER `git checkout` inside a worktree. After merge, run the post-PR cleanup gate (`docs/agent-workflow/git-rules.md`).
- When reporting files to the user, print absolute paths (drive/root included) — a worktree sits outside the directory the user's editor has open, so relative paths are not clickable there.

## Pre-Commit Review Gate

- After each work unit: show the user a summary of changed files and wait for explicit approval.
- Only then write the work-log section and commit — immediately, one work unit per commit. Never batch.

## Push Rule

- NEVER `git push` unless the user explicitly asks. Server-side branch protection is the source of truth; the pre-push hook is its backstop.

## Canon Rule

- If this repo designates canon documents (slot below), change the canon first, dependent docs after.

## Output Language

- Agent-read text is English: this file, the rulebook, management docs, work logs, issue/PR bodies, commit bodies.
- Replies and reports to the user follow their personal `human_language` AND reply style (set during onboarding, lives in `~/.claude/CLAUDE.md`). If that file is missing, run onboarding §4 before long reports.
- Repo-visible titles (commit/issue/PR titles, README) follow `team_language` in `agent-system.yaml`.

## Rulebook

- Git, branch, commit, push, PR rules: `docs/agent-workflow/git-rules.md`
- Management documents and logging: `docs/agent-workflow/documentation-rules.md`
- Templates: `docs/agent-workflow/templates.md`
- New member setup: `docs/agent-workflow/onboarding.md`
- Hooks (`.githooks/`) are backstops, not the rule source. Tripping one means the workflow was already violated — fix the order, not just the failure.
<!-- kernel:end -->

## Recent Active Context (pointer-only slot)

<!-- One line per active work item: name + management doc path + one-line summary.
     Details live in the doc's "Current State" block, never here.
     Remove the line in post-PR cleanup when the PR merges or the issue closes. -->
- (none)

## Canon (repo slot)

- (none)

## Domain Rules (repo slot)

<!-- Repo-specific rules. Kit updates never touch this section. -->
- (none)

## Repo Tools (repo slot)

<!-- Pointers to repo-installed agent tools and WHEN to reach for them, e.g.
     "graphify-out/ exists — treat codebase/architecture questions as graphify
     queries first". Kit updates never touch this section. -->
- (none)
