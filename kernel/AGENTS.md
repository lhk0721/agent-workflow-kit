# Agent Entry Point

<!-- kernel:begin — agent-workflow-kit system-owned block. Do not edit inside; `update` replaces it. -->
## Pre-Execution Gate

- Before any file edit, creation, move, or deletion, re-check whether the task belongs to a tracked issue.
- If it does, open the matching management document under `issues_root` (`agent-system.yaml`, default `docs/issues/`) BEFORE editing files.
- Reading this file once at session start does not satisfy the gate — re-apply it before each change.
- "Small fix" is not an exception. Only pure Q&A with no file changes is exempt.

## Issue-First Order

- Before starting work: find a matching open GitHub issue; create one if none (`gh issue create`). NEVER guess issue numbers.
- Branch name = `<issue>-<type>-<desc>` = management doc filename. This equality is the system's axis.
- Umbrella issues (`agent-system.yaml: umbrella_issues`): one umbrella per member's workstream; concrete tasks are sub-issues under it. See `docs/agent-workflow/documentation-rules.md`.
- Repos with `agent-system.yaml: issue_first: false` skip issue numbers: branches follow `branch_pattern`, the record is one note section per work unit (`git-rules.md`).

## Branch & Worktree Discipline

- NEVER edit issue-tracked files while HEAD is a protected branch (`agent-system.yaml: protected_branches`).
- One branch, one working directory. New issue: `git worktree add <path> -b <branch> <base>` (`base_branch`, else `origin/HEAD` — never a local `main`).
- Worktree location follows `agent-system.yaml: worktree_root`; create it with git, then EnterWorktree; instruction files inside it are frozen at the branch point (git-rules).
- NEVER `git checkout` inside a worktree. After merge, run the post-PR cleanup gate (`docs/agent-workflow/git-rules.md`).
- When reporting files to the user, print absolute paths (drive/root included) — a worktree sits outside the directory the user's editor has open, so relative paths are not clickable there.

## Pre-Commit Review Gate

- After each work unit: show the user a summary of changed files and wait for explicit approval.
- Only then write the work-log section and commit — immediately, one work unit per commit. Never batch.

## Push Rule

- NEVER `git push` unless the user explicitly asks. Same for publish actions — `docker push`, deploys, `npm publish`, releases. Server-side branch protection is the source of truth; the pre-push hook is its backstop.

## Canon Rule

- If this repo designates canon documents (slot below), change the canon first, dependent docs after.

## Output Language

- Agent-read text is English: this file, the rulebook, management docs, work logs, issue/PR bodies, commit bodies.
- Replies and reports to the user follow their personal `human_language` AND reply style (set during onboarding, lives in `~/.claude/CLAUDE.md`). If that file is missing, run onboarding §4 before long reports.
- Repo-visible titles (commit/issue/PR titles, README) follow `team_language` in `agent-system.yaml`.
- Korean output goes through the installed skills: `ko-writing` for prose (reports, docs, explanations), `ko-ui-text` for screen strings. See `docs/agent-workflow/skills.md`.
- NEVER translate English working notes into a Korean report. Pull the facts out and write the report in Korean from scratch — a translated note reads as machine output.

## Rulebook

- Git, branch, commit, push, PR rules: `docs/agent-workflow/git-rules.md`
- Management documents, working notes, logging: `docs/agent-workflow/documentation-rules.md`
- Verification, measurement, background runs: `docs/agent-workflow/verification-rules.md`
- Templates: `docs/agent-workflow/templates.md`
- New member setup: `docs/agent-workflow/onboarding.md`
- Skills (Korean writing, issue-start, post-pr-cleanup, ui-evidence, experiment-gate, session-handoff): `docs/agent-workflow/skills.md`
- AGENTS.md size/staleness budget, where a fact belongs, and the hook layers: `docs/agent-workflow/context-maintenance.md`
- Hooks are backstops at three points, not the rule source. `.githooks/` fires at commit; `.claude/hooks/` fires before a tool call — the only layer that can stop a destructive command — and at session start. Tripping one means the workflow was already violated — fix the order, not just the failure.
<!-- kernel:end -->

## Recent Active Context (pointer-only slot)

<!-- One line per active work item: name + management doc path + one-line summary.
     Details live in the doc's "Current State" block, never here.
     Remove the line as the last commit on the branch before merge — a protected
     branch cannot be edited afterwards (git-rules.md, post-PR cleanup gate). -->
- (none)

## Environment (repo slot)

<!-- Three lines, fixed shape. Addresses, "currently alive" and lists of what is
     missing go in the pointed-to note (context-maintenance.md).
     - Runs here: <edit, test, lint>
     - Cannot run here: <docker, GPU> → <note path>
     - Runs there: <the other machine, by role> → <note path> -->
- (none)

## Canon (repo slot)

- (none)

## Domain Rules (repo slot)

<!-- Repo-specific rules. Kit updates never touch this section. -->
- (none)

## Repo Tools (repo slot)

<!-- Gitignored prerequisites a fresh worktree needs (`npm ci`, `uv sync`, `.env` from
     the main checkout) and pointers to repo tools with WHEN to reach for them. A tool
     that depends on an artifact goes in `agent-system.yaml: tools` instead — the
     SessionStart hook injects its pointer only while the artifact exists.
     Kit updates never touch this section. -->
- (none)
