---
name: issue-start
description: Start tracked work the kit way — one script registers the GitHub issue, creates the branch and worktree from the REMOTE base ref, and seeds the management doc, Master Registry row and AGENTS.md pointer line. Use this whenever the user wants to begin work that is not yet tracked by an open issue, even when they only say "let's fix X" or "add Y" — and always when they say "이슈 만들어", "새 작업 시작", "새 이슈로", "worktree 파줘", "브랜치 파줘", "start issue", "new task", "open an issue for", "create a branch for", "set up a worktree for". In a kit repo (agent-system.yaml present) never hand-run gh issue create / git worktree add for new work; run this skill's script instead — it does the steps in the only order the rulebook allows.
---

# issue-start

Every issue in a kit repo begins with the same five steps: register the issue, name the
branch after it, create a worktree from the remote base, seed the management doc + registry
row + AGENTS.md pointer, make the first commit. Done by hand they drift (branch named before
the issue exists, worktree cut from a stale local `main`, pointer forgotten). The script does
them in order or does nothing at all. You do what only you can: agree the scope with the
user, fill the doc, get approval, commit.

## When to use, when not

Use it when the user wants to begin work and no open issue + branch already covers it.

Do not use it when:

- `agent-system.yaml` says `issue_first: false`. The script refuses on its own: that repo
  names branches without issue numbers, so follow the `branch_pattern` flow in
  `docs/agent-workflow/git-rules.md` (branch + doc by hand).
- An issue already exists AND a branch `<n>-*` exists locally or on the remote. The script
  aborts and prints them; continue in that branch's worktree instead of opening a second line.
- The request is pure Q&A with no file changes.

If an issue exists but no branch does, pass `--issue <n>` so the script skips creation and
reads the title from GitHub.

## Sequence

1. Check the work is not already tracked: `gh issue list --state open --search "<key words>"`.
2. Agree the pieces with the user: `type` (from `issue_types`), a short `title` in the
   repo's `team_language`, and a `slug` (lowercase English words; the script normalises it).
   With umbrella issues enabled, ask which umbrella this belongs to → `--parent <n>`.
3. Dry run first and show the plan:

   ```
   node .claude/skills/issue-start/scripts/issue-start.mjs --dry-run --type <t> --title "<title>" --slug <slug> [--parent <n>]
   ```

4. Run it for real (same command without `--dry-run`). It prints a summary block.
5. Move in with the `EnterWorktree` tool using the `path:` from the summary — the worktree
   already exists. Never let `EnterWorktree` create one: it would branch from a local ref,
   and the rulebook wants the remote base.
6. Install what the summary lists under "prerequisites". A fresh worktree is a clean
   checkout: `node_modules`, `.venv`, `.env` are gitignored and did not come along. Run
   installs inside the worktree. Never link `node_modules` from the main checkout — a
   junction there is followed by `git worktree remove` and by `npm ci`, and wipes the main
   checkout's dependencies (three incidents in one repo).
7. If the summary says `docs/agent-workflow/repo-templates.md` exists, the repo has its own
   richer doc shape that predates the kit. Reshape the seeded doc to it before the first
   commit — keep the filename, the `Document Relations` facts and the first work-log section.
8. Fill `Summary`, `Goal`, `Scope`, `Out Of Scope`, `Done Criteria` from the conversation.
   The template leaves them empty on purpose; a doc with placeholder text is worse than none.
9. Pre-Commit Review Gate: show the user the seeded files (doc, registry, `AGENTS.md`), wait
   for explicit approval, then make the first commit inside the worktree with the command
   the summary printed (`chore: <title> (#<n>)`). One commit, nothing batched. If the
   summary lists `dropped:` lines, say so — those were pointers for branches that no longer
   exist, and this first commit is the sanctioned place to remove them.
10. Remember the pointer's exit: before opening the PR, remove this branch's line from
    `AGENTS.md` as the branch's **last** commit (`git-rules.md`, post-PR gate). A PR-only
    base branch cannot take that edit after the merge; `post-pr-cleanup` will only report
    it as a leftover.

## What the script does — and does not

Does, in this order, and rolls back the worktree and branch if any later step fails:

- reads `agent-system.yaml` (`issue_types`, `issues_root`, `worktree_root`, `base_branch`,
  `profile`, `issue_first`) — kit defaults when the file is missing
- `git fetch --prune`, then resolves the base: `--base` > `base_branch` > `origin/HEAD`
  (`upstream/<name>` for the `external` profile). Always a remote ref.
- `gh issue create --title --body-file` with the kit issue-body template (`### Goal`,
  `### Done criteria`, `### Umbrella` when `--parent`) and reads the number from the URL
- checks `git branch --list '<n>-*'` AND `git branch -r --list '*/<n>-*'`; aborts on a hit
- `git worktree add --no-track <path> -b <n>-<type>-<slug> <base>`; sibling root →
  `../<repo>-<n>`, claude root → `.claude/worktrees/<n>-<first-two-slug-words>`
- writes `<issues_root>/<type>/<branch>.md` from `assets/management-doc-template.md`
  (`<issues_root>/feat/` is honoured as the `feature` directory; `sub-issues/<type>/` is
  used when it exists and `<type>/` does not)
- appends the Master Registry row to `<issues_root>/README.md` unless the repo generates
  `<issues_root>/INDEX.md`
- adds the pointer line under `## Recent Active Context` in `AGENTS.md` (replaces a
  `- (none)` placeholder, otherwise after the last pointer; creates the section if missing)
  and, in the same edit, drops pointers whose branch exists neither locally nor on a remote
  — the summary lists each dropped line

Does not: commit (the review gate is yours), push, link sub-issues on GitHub, install
dependencies, or edit anything in the main checkout — every file change lands in the new
worktree.

`--dry-run` prints the whole plan and creates nothing, not even the issue.

## What to tell the user

Absolute paths, always — the worktree sits outside the directory their editor has open.
Report: the issue number + URL, the branch and the base commit it was cut from, the
worktree path, the doc path, and which prerequisites you installed. Ask for approval of the
seeded files before the first commit; do not describe the commit as done until it is.

## Umbrella issues

`--parent <n>` writes `Sub-issue of #n` into the issue body and `- Umbrella: #n` into the
doc. The GitHub sub-issue link itself is a separate step the script does not take (it
needs the child's database id, not its number); the summary prints the `gh api` command.
Run it when the user wants the link, or leave it for the umbrella's owner.

## When it fails

The script exits non-zero with one plain line and leaves no half-made worktree. Two cases
need a decision from you: a branch for that issue already exists (continue there), or the
issue was created but a later step failed (the message says `--issue <n>` — reuse it, do not
open a duplicate).
