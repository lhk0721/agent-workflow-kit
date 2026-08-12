# Git Rules

<!-- agent-workflow-kit — system-owned; `update` overwrites this file -->

## Branches

- Branch name: `<issue>-<type>-<desc>` (e.g. `42-feature-login-form`). It must equal the
  management document filename (`docs/issues/<type>/<branch>.md`).
- `<type>` comes from `agent-system.yaml: issue_types`.
- NEVER commit directly on a protected branch (`agent-system.yaml: protected_branches`).
- Standard sequence for new work:
  `gh issue create` → `git worktree add ../<repo>-<issue> -b <branch> main` → management
  document → edits → commit.
- NEVER `git checkout` inside a worktree — its directory name must keep matching its branch.
  After the PR merges: `git worktree remove ../<repo>-<issue>` and delete the branch.
- Before creating a branch for an existing issue, check both local (`git branch --list '<issue>-*'`)
  AND remote (`git branch -r --list '*<issue>-*'`) — a squash-merged remote branch may still
  hold commits the local list does not show.

## Commits

- Subject format: `<type>: <summary> (#<issue>)` — the commit-msg hook enforces it.
  Subject language: `team_language`. Body: English (why + what changed + how verified).
- One approved work unit = one commit, immediately. Never batch work units.
- NEVER amend or rebase published history. NEVER skip hooks (`--no-verify`) — a failing
  hook means the workflow was missed earlier; fix the cause, not the check.
  (`AGENT_KIT_SKIP=1` exists for deliberate, user-approved exceptions only, e.g. the
  kit install commit.)

## Push & PR

- NEVER `git push` unless the user explicitly asks.
- Protected branches take changes via PR only. Server-side branch protection (GitHub
  settings) is the source of truth; the local pre-push hook is its backstop.
- Profile behavior (`agent-system.yaml: profile`):
  - `solo` — single remote; pushing a protected branch is allowed when the user asks
    (force push still blocked).
  - `shared` — single repo, branch + PR; direct push to protected branches blocked.
  - `external` — fork + upstream; contribute via PR from the fork, keep the fork synced.
