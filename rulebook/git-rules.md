# Git Rules

<!-- agent-workflow-kit — system-owned; `update` overwrites this file -->

## Branches

- Branch name: `<issue>-<type>-<desc>` (e.g. `42-feature-login-form`). It must equal the
  management document filename (`<issues_root>/<type>/<branch>.md`).
- `<type>` comes from `agent-system.yaml: issue_types`.
- NEVER commit directly on a protected branch (`agent-system.yaml: protected_branches`).
- Standard sequence for new work:
  `gh issue create` → `git fetch` → `git worktree add <path> -b <branch> <base>` →
  `EnterWorktree` → management document → edits → commit. The `issue-start` skill
  (`skills.md`) runs the sequence up to the first edit and prints the rest.
- `<base>` is the remote ref: `agent-system.yaml: base_branch`, or `origin/HEAD` when it
  is empty (`external` repos usually set `upstream/<branch>`). NEVER branch from a local
  `main` — it may sit ahead of or behind the remote, and the PR base is the remote.
- Worktree location follows `agent-system.yaml: worktree_root`: `sibling` (default) →
  `../<repo>-<issue>`; `claude` → `.claude/worktrees/<issue>-<short>` (git-ignored).
  Either way, create the directory with `git worktree add`, then move the session with
  `EnterWorktree path: <path>`. NEVER let `EnterWorktree` create it: it nests the path
  and prefixes the branch with `worktree-`, which breaks branch = doc name. A shell `cd`
  moves the shell only — the session's workspace root, instruction files and file-tool
  paths stay anchored to the old directory.
- Instruction files inside a worktree (`AGENTS.md`, `CLAUDE.md`, the rulebook) are frozen
  at the branch point. At session start in a worktree: `git fetch`, then compare against
  `<base>:AGENTS.md`; when they differ, follow the newer copy's agent-behaviour rules
  immediately — the rule that changed usually changed because of a failure.
- A fresh worktree lacks everything git ignores — `node_modules/`, `.env`, `.venv/`,
  build caches. The `Repo Tools` slot in `AGENTS.md` lists what this repo needs and how
  to get it (`npm ci`, `uv sync`, copy `.env` from the main checkout); `issue-start`
  prints those commands. Documentation-only work needs none of it.
- NEVER `git checkout` / `git switch` inside a worktree — its directory name must keep
  matching its branch. The guard asks before either command whenever the checkout has
  more than one worktree. After the PR reaches a terminal state, run the post-PR cleanup
  gate (below).
- Before creating a branch for an existing issue, check both local (`git branch --list '<issue>-*'`)
  AND remote (`git branch -r --list '*/<issue>-*'` — the slash keeps issue 48 from matching `origin/248-…`) — a squash-merged remote branch may still
  hold commits the local list does not show.
- Structure changes first: a branch that renames, moves, archives or splits top-level
  directories or shared module boundaries gets its own PR (commit type `repo`) before
  feature work stacks on the new layout. Feature commits that already accumulated on it
  are reapplied onto the merged base, not extended.

### Choosing the issue

- Reuse an open issue only when it is materially the same work item — title, goal, done
  criteria, related documents and branch context all match. A similar title is not a
  match. When separate tracking would make the doc or the PR clearer, open a new issue.
- Ambiguous match → report the candidates and the reasoning, then wait. NEVER pick one by
  guesswork and NEVER invent an issue number.
- `gh` unavailable (no auth, no network): say so in one line, search `<issues_root>/` for
  a matching management document, and continue with `#<issue>` as the placeholder in
  branch, doc and drafts. Prepare the issue title and body so they can be posted at once;
  rename branch and doc the moment the real number exists.

### Repos without issues (`agent-system.yaml: issue_first: false`)

- No GitHub issues, no management documents. `branch_pattern` (e.g. `<member>/<desc>`)
  governs the branch name; the hooks read it and stop asking for an issue suffix or a doc.
- Commit subject: `<type>: <summary>`, no `(#n)`.
- The record of a work unit is one section in a working note (`documentation-rules.md`
  "Working notes"), written before the commit exactly as a work-log section would be.
- Everything else holds: branch from `<base>` in a worktree, never commit on a protected
  branch, the review gate before every commit.

## Commits

- Subject format: `<type>: <summary> (#<issue>)` — the commit-msg hook enforces it (no
  suffix when `issue_first: false`). Subject language: `team_language`. Body: English
  (why + what changed + how verified).
- Types: `issue_types` plus the conventional prefixes. `repo` marks repository structure
  changes (archiving, moving, removing directories or submodules) so a history reader can
  skip them when looking for behaviour changes.
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
  "too complex to verify" (Claude Code worktree isolation guard, v2.1.222+). The guard
  warns on the inline form.
- Encoding: `.sh` files stay LF (CRLF breaks `/bin/sh`); a `.ps1` that carries non-ASCII
  text needs a UTF-8 BOM (Windows PowerShell reads it as the ANSI code page otherwise).
  The pre-commit `encoding` check warns; fix the file, not the warning.

## Push & PR

- NEVER `git push` unless the user explicitly asks. The same holds for every publish
  action — `docker push`, `wrangler deploy`, `npm publish`, `gh release create` — the
  guard asks before each; a "yes" to push is not a yes to publish.
- Protected branches take changes via PR only. Server-side branch protection (GitHub
  settings) is the source of truth; the local pre-push hook is its backstop.
- Open the PR only as part of a user-requested publish. Body: `templates.md` "PR body";
  `Closes #<issue>` in it closes the issue on merge. Keep the body aligned with the
  management doc's work log as commits land.
- Prefer squash merge; the cleanup gate's landed check is written for it.
- Profile behavior (`agent-system.yaml: profile`):
  - `solo` — single remote; pushing a protected branch is allowed when the user asks
    (force push still blocked).
  - `shared` — single repo, branch + PR; direct push to protected branches blocked.
  - `external` — fork + upstream; `base_branch` names the upstream branch. Playbook:
    1. `git fetch upstream` → `git merge --ff-only upstream/<base>` on the local base
       branch. A failing `--ff-only` means the local base holds its own commits — that
       is a misplaced commit to move, not a merge to make.
    2. Sync the fork's base through the API, never by push:
       `gh api -X PATCH repos/<owner>/<fork>/git/refs/heads/<base> -f sha=$(git rev-parse upstream/<base>)`.
    3. Branch from `upstream/<base>`; push the branch to the fork (`origin`); open the PR
       from the fork to upstream.
    4. After the merge, repeat 1–2 before the next branch; `post-pr-cleanup --apply`
       does both.

## Post-PR cleanup gate

Run after every PR reaches a terminal state — merged or closed without merge.
NEVER clean up from memory: refresh state first with `git fetch --prune`,
`git worktree list`, `git branch --list`, and the GitHub issue/PR state.
`post-pr-cleanup` (`skills.md`) does the mechanical part — dry-run by default,
`--apply` acts — and ends with the audit output below.

- Recent Active Context: the pointer line is removed as the LAST commit on the branch,
  before the PR merges, in the same commit that sets the management doc's Status to done.
  A protected branch takes PRs only, so nothing can edit `AGENTS.md` after the merge — a
  PR whose whole content is one deleted line is the workaround this rule exists to avoid.
  The gate verifies the line is gone; only on `solo` (direct commits to the base are
  allowed there) does it remove a leftover itself.
- Verify the issue actually closed (`Closes #<issue>` in the PR body handles this
  on merge). If it is still open, close it or record the blocker.
- Remove the worktree only after `git status --porcelain=v1 -uall` prints nothing
  inside it: `git worktree remove <path>`. On Windows, unlink a `node_modules` junction
  first — a recursive delete can follow it into the directory it points at. The guard
  warns on a plain `git worktree remove`; the skill's checks are what make it safe.
- Delete the local branch only after
  `git log --right-only --cherry-pick --oneline <base>...<branch>` prints
  nothing — after a squash merge `git branch -d` protects nothing; this check does.
- Delete the remote branch (`git push origin --delete <branch>`). Better: enable
  GitHub "Automatically delete head branches" once per repo (Settings → General),
  so merges clean up after themselves.
- Orphan worktree directories (on disk, unknown to `git worktree list`) are reported,
  never deleted by the script.
- Finish by showing `git worktree list` and a branch/PR state table, so the cleanup is
  auditable.

## CI gate

- A repo with a protected branch should run a PR-validation workflow that executes
  the same commands the rulebook and repo docs tell the agent to run locally.
  CI is the machine copy of the documented gate, not a second rulebook.
- Keep the default PR gate balanced: typecheck, lint/format, tests, machine checks.
  NEVER deploy, publish artifacts, or require production/runtime secrets on the
  default PR path. Add heavier lanes only when the risk changes.
- Template: `templates.md` "PR validation workflow".
