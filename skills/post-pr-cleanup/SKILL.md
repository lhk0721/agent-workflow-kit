---
name: post-pr-cleanup
description: Run the post-PR cleanup gate with a script instead of from memory — refresh git and GitHub state, classify every worktree and branch (remove / keep-open / dirty / unpushed / landed-no-pr / prunable), then, only after the user confirms, remove the worktrees, local and remote branches that provably landed, and report leftover AGENTS.md pointer lines. Use it whenever a PR was merged or closed, and whenever the user says "머지됐어", "PR 머지된 뒤", "PR 정리", "worktree 정리", "잠자는 브랜치", "브랜치 청소", "sweep", "cleanup after merge", "post-PR", "the PR was merged", "the PR was closed", "clean up the worktrees" — and before starting new work when worktrees have piled up. In a kit repo never delete a worktree or branch by hand from memory; run this dry-run first.
---

# post-pr-cleanup

The cleanup gate in `docs/agent-workflow/git-rules.md` is six checks in a fixed order, and
each skipped check has a cost with a name: rack-tracker holds 13 worktree branches that were
never pushed and 8 orphan directories git no longer lists; pipeplot spent 5 commits on
pointer-line bookkeeping. The script refreshes state first and decides from what git and
GitHub say now — never from what you remember about the branch.

## Sequence

1. Dry run, always first, from any worktree of the repo:

   ```
   node .claude/skills/post-pr-cleanup/scripts/post-pr-cleanup.mjs
   ```

   Show the user the table and the per-branch reasons. Nothing is changed by a dry run
   (it does run `git fetch --all --prune`, which is the point).
2. Ask for explicit confirmation of exactly which `remove`/`prunable` rows will go. This is
   the destructive half, and the Claude Code guard cannot see inside a script: it asks
   about `git worktree remove --force` and `git branch -D` when *you* type them, not when
   the script runs them. The confirmation is on you.
3. Apply:

   ```
   node .claude/skills/post-pr-cleanup/scripts/post-pr-cleanup.mjs --apply
   ```

4. Relay the closing report: `git worktree list`, the remaining branches with their tags,
   the issue/PR table, leftover pointer lines, and anything marked "still manual".

Options: `--base <ref>` overrides the base (default: `--base` > `base_branch` in
`agent-system.yaml` > `origin/HEAD`; `upstream/<name>` on the `external` profile).
`--json` prints the state instead of tables. `--assume-landed` is for a machine without
`gh`: it lets a clean worktree whose commits are all on the base count as `remove` when the
PR state cannot be read. Never use it as a shortcut when `gh` works.

## What each class means

| class | meaning | `--apply` does |
| --- | --- | --- |
| `remove` | PR MERGED (or CLOSED), worktree clean, every commit on the base | worktree, local branch, remote branch removed |
| `prunable` | the worktree directory is gone from disk | `git worktree prune`; branch deleted only if its commits are on the base |
| `keep-open` | PR OPEN or DRAFT | nothing |
| `dirty` | uncommitted changes in the worktree | nothing — never touched, whatever GitHub says |
| `unpushed` | no PR and commits not on the base | nothing — listed so it is not forgotten |
| `landed-no-pr` | no PR, but nothing beyond the base | nothing — "landed, or never started"; git cannot tell, you decide |
| `merged-ahead` | PR merged, but the local branch has commits beyond the merged head | nothing — decide |
| `closed-unmerged` | PR closed without merge and commits not on the base | nothing — decide |
| `unknown` | `gh` unavailable or failed | nothing unless `--assume-landed` and the commits are on the base |

"Landed" is proven two ways: `git log --right-only --cherry-pick --oneline <base>...<branch>`
prints nothing, or the PR is MERGED and its head commit is exactly the local tip. The second
exists because a multi-commit squash merge defeats `--cherry-pick` (no single commit's patch
matches the squash commit). Branch deletion tries `git branch -d` first; when `-d` refuses
after a squash merge, `-D` runs — justified only by that proof, and the report says so.

## What `--apply` does, in order

- fast-forwards the main checkout's base branch (`git merge --ff-only <base>`) when it is
  on that branch and has no tracked changes — `git branch -d` judges "merged" against HEAD,
  so a stale main refuses to delete branches that did land
- per `remove`/`prunable` row: unlinks a `node_modules` **junction or symlink** inside the
  worktree first (the link only, target untouched), then `git worktree remove` / `prune`,
  `git branch -d` (or `-D` with proof), `git push <remote> --delete <branch>` when the
  remote branch still exists (remote = the branch's upstream, else `origin`)
- `external` profile only: fast-forwards the fork's base branch through the API
  (`gh api -X PATCH repos/<owner>/<repo>/git/refs/heads/<base> -f sha=<sha>`), because the
  pre-push hook forbids pushing the base directly; skipped with a message when `origin` is
  not a GitHub URL
- exits 1 if any step failed, naming the step; 0 otherwise (dry run always 0)

Why the junction step exists: on Windows a `node_modules` junction inside a worktree that
points at the main checkout's `node_modules` is followed by `git worktree remove` and by
`npm ci`, which wipes the main checkout's dependencies (pipeplot, three incidents). Never
run `npm ci` in a worktree whose `node_modules` is a link.

## AGENTS.md pointer lines

The rule is that a work item's line under `## Recent Active Context` is removed **as the
branch's last commit before the PR merges** — a PR-only base branch cannot take the edit
afterwards, and the management-doc hook blocks direct commits on protected branches on every
profile. So the script treats a pointer still present for a finished branch as a *leftover*
and reports it, always: "leftover pointer for `<branch>` — it should have been removed on
the branch; remove it in your next branch's first commit". `issue-start` does exactly that
drop when the next branch begins.

Only on `profile: solo` does `--apply` drop the leftover lines in the main checkout's
`AGENTS.md` itself; it prints that the change is uncommitted and leaves the commit to you.
On `shared` and `external` the file is never edited.

## What stays manual

- Closing an issue that did not auto-close (`Closes #n` in the PR body handles it on merge).
  The report names open issues whose PR finished: `gh issue close <n>` or record the blocker.
- Every `landed-no-pr`, `merged-ahead`, `closed-unmerged`, `unpushed` and `dirty` row —
  the script lists them with a reason and touches nothing.
- Orphan directories: `../<repo>-*` (sibling root) or `.claude/worktrees/*` (claude root)
  that `git worktree list` does not know. They are reported, never deleted — a directory
  git does not know might be anything. Inspect, then remove by hand with the user's OK.
- Committing the `AGENTS.md` edit on the solo profile.
- The base fast-forward on `shared` — `git pull --ff-only` on the main checkout if it was
  not on the base branch or had tracked changes when the script ran.
