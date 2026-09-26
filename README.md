# Agent Workflow Kit

Rules + hooks + document system for repositories where AI agents (Claude Code) do the work.
This repo is the single source; each target repo gets git-tracked copies via `install.mjs`,
so fixes flow from here to every repo instead of drifting per-copy.

## What a target repo gets

- `CLAUDE.md` + `AGENTS.md` kernel (gates first, ~50 lines) with repo-owned slots,
  including a three-line `Environment` slot for "runs here / cannot run here / runs there"
- `docs/agent-workflow/` rulebook: git, documentation, verification, context maintenance,
  templates, onboarding, skills
- `.githooks/` backstops in Node — 8 checks over three hooks: management doc (branch = doc,
  sibling branch), registry row, notes index, doc pairs (fail or warn), context budget,
  encoding, commit message format, protected push
- `.claude/hooks/` — PreToolUse: a destructive-command guard with `deny` / `ask` / `warn`
  tiers and a require-skill gate for Korean edits; SessionStart: memory-freshness,
  agents-freshness, repo-tools, and the skill listing after a compaction
- `agent-system.yaml` (repo settings) + `agent-system.lock.json` (version pin, install
  manifest, a hash per system-owned file so doctor can spot in-place edits)
- `.claude/skills/` — seven skills: `ko-writing` and `ko-ui-text` (Korean writing),
  `issue-start`, `post-pr-cleanup`, `ui-evidence`, `experiment-gate`, `session-handoff`
  (workflow); they load themselves when the task matches
  (see `docs/agent-workflow/skills.md`)

## Install into your repo (owner, once per repo)

```
git clone <this-kit-url>
cd <your-repo>
claude
```

Then tell the agent: **"Install the agent workflow kit from ../agent-workflow-kit"**.
The agent follows `SETUP.md`: checks/installs Node for you, asks your options
(profile, protected branches, team language, issue-first or not, worktree location,
base branch, notes directory, doc pairs, repo tools), runs the installer, verifies with
doctor, and commits after your approval.

Manual fallback: `node ../agent-workflow-kit/install.mjs` from your repo root.

A repo that already has richer rule files keeps them: an existing
`docs/agent-workflow/<file>.md` without the kit marker is left untouched and reported,
so you can compare it with the kit's copy at your own pace.

## Join a repo that already has the kit (teammate)

```
git clone <team-repo-url>
cd <team-repo>
claude
```

Then tell the agent: **"run onboarding"**.
The agent follows `docs/agent-workflow/onboarding.md`: checks/installs Node and gh,
enables hooks for your clone (`core.hooksPath` is per-clone), asks which language you
want replies in, runs the doctor check, and walks you through the two gates.

First time with Claude Code? Install it first — https://docs.anthropic.com/en/docs/claude-code
(`npm install -g @anthropic-ai/claude-code`, or the native installer on that page if you
don't have Node yet; the agent installs Node for the hooks during onboarding either way).

## Repos without issues

Not every repo runs on GitHub issues — a solo research repo, a course project, a repo
whose tracker lives elsewhere. Set `issue_first: false` in `agent-system.yaml` and give
`branch_pattern` (e.g. `<member>/<desc>`): the hooks stop asking for an issue suffix and
a management document, branches follow the pattern, and the record of each work unit is
one section in a working note under `notes_dir`. Everything else — worktrees, the review
gate before every commit, protected branches, the push rule — stays on.

## Update / Uninstall

- **Update**: from your repo root, rerun `node ../agent-workflow-kit/install.mjs`.
  Overwrites system-owned files only; your config, slots, and logs are never touched.
  Review the diff, commit.
- **Uninstall**: `node ../agent-workflow-kit/uninstall.mjs` — replays the install manifest:
  removes system files and the AGENTS.md kernel block, unsets `core.hooksPath`, keeps all
  repo-owned files. `core.hooksPath` is per-clone — unset it in other clones too.

## Ownership (what update touches)

| Scope | Files | Update touches? |
| --- | --- | --- |
| System-owned | `CLAUDE.md` (only when it starts with the kit marker comment), AGENTS.md kernel block, `docs/agent-workflow/*.md` that carry the kit marker, `.githooks/*` except `checks/repo-*.mjs`, `.claude/hooks/*`, the seven kit skills under `.claude/skills/` | Yes — overwritten |
| Repo-owned | `agent-system.yaml`, AGENTS.md slots, `docs/issues/**` (or `issues_root`), `<notes_dir>/**`, `docs/agent-workflow/repo-*.md`, `docs/agent-workflow/tools/*`, any `docs/agent-workflow/*.md` without the kit marker (adopt mode), `.githooks/checks/repo-*.mjs`, `.claude/guard.json`, `.claude/require-skill.json`, other `.claude/skills/*`, `ko-writing.config.md`, `ui-text.config.md`, `ui-text.glossary.md` | Never |
| Personal | reply language & style in `~/.claude/CLAUDE.md`, session memory | Outside the system |

---

Maintained by [@lhk0721](https://github.com/lhk0721).
