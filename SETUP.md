# SETUP — agent runbook: install the kit into a target repo

Run this when a user asks to install the kit. Target repo = the repo you are working in.

## 1. Preflight

- Target must be a git repository with a reviewable working tree.
- `node --version` must be >= 20. If Node is missing, install it FOR the user
  (confirm first): see `rulebook/onboarding.md` §1 for per-OS commands.

## 2. Interview the user (before writing anything)

Ask these, then record the answers in `agent-system.yaml` after install:

| Question | Options | Default |
| --- | --- | --- |
| profile | `solo` (single remote) · `shared` (team, branch + PR) · `external` (forks) | `shared` |
| protected_branches | branch names that never take direct commits/pushes | `[main]` |
| team_language | language of repo-visible titles / README | user's language |
| issue_first | `true` (GitHub issues + management docs) · `false` (no issues; `branch_pattern` such as `<member>/<desc>`; a note section per work unit is the record) | `true` |
| umbrella_issues | `per-member` (one umbrella issue per member's workstream) · `off` | `per-member` |
| worktree_root | `sibling` (`../<repo>-<issue>`) · `claude` (`.claude/worktrees/<issue>-<short>`, git-ignored) | `sibling` |
| base_branch | the remote ref branches start from and PRs target; `external` usually `upstream/<branch>` | empty = `origin/HEAD` |
| notes_dir | working-notes directory (analysis, retros, handoffs); index at `<notes_dir>/README.md` | none |
| doc_pairs | docs that must change together: `a <-> b` (fail) or `a <-> b \| warn \| why it matters` | none |
| tools | repo tools as `<tool doc> \| <artifact>`; the pointer is injected at session start only while the artifact exists | none |

## 3. Install

From the target repo root:

```
node <kit-path>/install.mjs
```

The installer copies system-owned files, seeds repo-owned ones (never overwrites them),
sets `git config core.hooksPath .githooks`, adds `.githooks/** text eol=lf` to
`.gitattributes`, and writes `agent-system.lock.json` (version pin + manifest + a hash
per system-owned file). It stages the hook files to preserve their executable bit.

- Adopt mode: an existing `docs/agent-workflow/<file>.md` without the kit marker is left
  untouched and reported. A repo that already has richer rule files keeps them — tell
  the user which files the installer skipped and where the kit's copy is for comparison.
- `team_language: ko` seeds `ko-writing.config.md`, `ui-text.config.md` and
  `ui-text.glossary.md` from the skill templates (repo-owned, never overwritten).
- The skills install to `.claude/skills/`. If the installer warns that `.claude/` is
  git-ignored, ask the user whether to un-ignore `.claude/skills/` — otherwise the skills
  stay in this clone and teammates never get them.

## 4. Configure + verify

- Write the interview answers into `agent-system.yaml`.
- `node .githooks/checks/doctor.mjs` — every line must be OK. It checks hooks, skills,
  `.claude/require-skill.json`, the PreToolUse and SessionStart registrations in
  `.claude/settings.json`, `.gitattributes`, and `PYTHONUTF8` on Windows. A WARN on hook
  hash drift right after install means the kit copy itself is dirty — fix the kit, not
  the target.
- For `shared`/`external` profiles: remind the user to set GitHub branch protection to
  match `protected_branches` (the server setting is the source of truth; the pre-push
  hook is its backstop).

## 5. Commit (approval gate applies)

- Show the user the diff summary and wait for explicit approval.
- The install commit lands on the protected branch by design, so commit it with the
  deliberate escape hatch: `AGENT_KIT_SKIP=1 git commit -m "chore: install agent-workflow-kit v<version>"`.
  This is the one legitimate use of the hatch — normal work never needs it.
- Add two lines to the target repo README: clone command + "run `claude`, say 'run onboarding'".
- If `team_language` is not `ko` but the repo writes Korean, offer to seed
  `ko-writing.config.md` / `ui-text.config.md` / `ui-text.glossary.md` from the templates
  under `.claude/skills/*/assets/` (repo-owned; see `docs/agent-workflow/skills.md`).

## Update / Uninstall

- Update: rerun `install.mjs` (system-owned files only). Review diff, commit.
- Uninstall: `node <kit-path>/uninstall.mjs` — manifest replay; repo-owned files and
  work logs stay.
