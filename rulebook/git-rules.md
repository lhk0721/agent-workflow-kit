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
  After the PR reaches a terminal state, run the post-PR cleanup gate (below).
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
- Multi-line commit or PR bodies: write the body to a file first, then
  `git commit -F <file>` / `gh pr create --body-file <file>`. NEVER inline it via
  heredoc or command substitution (`git commit -m "$(cat <<'EOF' ...)"`) —
  worktree-isolated agent sessions statically verify that each Bash command stays
  inside the worktree, and heredoc/substitution forms are refused as
  "too complex to verify" (Claude Code worktree isolation guard, v2.1.222+).

## Push & PR

- NEVER `git push` unless the user explicitly asks.
- Protected branches take changes via PR only. Server-side branch protection (GitHub
  settings) is the source of truth; the local pre-push hook is its backstop.
- Profile behavior (`agent-system.yaml: profile`):
  - `solo` — single remote; pushing a protected branch is allowed when the user asks
    (force push still blocked).
  - `shared` — single repo, branch + PR; direct push to protected branches blocked.
  - `external` — fork + upstream; contribute via PR from the fork, keep the fork synced.

## Post-PR cleanup gate

Run after every PR reaches a terminal state — merged or closed without merge.
NEVER clean up from memory: refresh state first with `git fetch --prune`,
`git worktree list`, `git branch --list`, and the GitHub issue/PR state.

- Verify the issue actually closed (`Closes #<issue>` in the PR body handles this
  on merge). If it is still open, close it or record the blocker.
- Remove the worktree only after `git status --porcelain=v1 -uall` prints nothing
  inside it: `git worktree remove ../<repo>-<issue>`.
- Delete the local branch only after
  `git log --right-only --cherry-pick --oneline origin/main...<branch>` prints
  nothing — after a squash merge `git branch -d` protects nothing; this check does.
- Delete the remote branch (`git push origin --delete <branch>`). Better: enable
  GitHub "Automatically delete head branches" once per repo (Settings → General),
  so merges clean up after themselves.
- Remove the work item's pointer line from `AGENTS.md` Recent Active Context
  (see `documentation-rules.md`).
- Finish by showing `git worktree list`, the remaining branches, and the issue/PR
  state, so the cleanup is auditable.

## CI gate

- A repo with a protected branch should run a PR-validation workflow that executes
  the same commands the rulebook and repo docs tell the agent to run locally.
  CI is the machine copy of the documented gate, not a second rulebook.
- Keep the default PR gate balanced: typecheck, lint/format, tests, machine checks.
  NEVER deploy, publish artifacts, or require production/runtime secrets on the
  default PR path. Add heavier lanes only when the risk changes.
- Template: `templates.md` "PR validation workflow".
