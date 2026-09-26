# Onboarding — new member / new clone

<!-- agent-workflow-kit — system-owned; `update` overwrites this file -->

Agent runbook — run when a user says "run onboarding" in a fresh clone. The user may be
completely new to Claude Code: do every step FOR them, confirm before installing software.

## 1. Node (the hooks run on it)

- `node --version` — need >= 18.17 (>= 20 recommended).
- If missing, install it for the user (confirm first):
  - Windows: `winget install OpenJS.NodeJS.LTS`
  - macOS: `brew install node`
  - Linux (Debian/Ubuntu): `sudo apt-get install -y nodejs npm` (or the distro's package)
- If the new PATH is not picked up, tell the user to restart the terminal/session.

## 2. GitHub CLI (issue workflow runs on it)

- `gh auth status` — if `gh` is missing: `winget install GitHub.cli` / `brew install gh` /
  distro package. If unauthenticated, have the user run `! gh auth login` themselves
  (interactive login).
- A repo with `issue_first: false` in `agent-system.yaml` needs no `gh` for daily work.

## 3. Enable hooks (per clone — git does not inherit this)

- `git config core.hooksPath .githooks`
- Windows: set `PYTHONUTF8=1` in the user environment — a cp949 console kills any Python
  script that prints a non-ASCII character. Doctor checks it.

## 4. Personal reply language & style

- Ask which language the user wants replies and reports in (`human_language`), AND
  whether they want a specific style — e.g. plain easy wording, no translation-ese,
  technical terms kept in English.
- Record BOTH in their personal global instructions `~/.claude/CLAUDE.md` (create if missing):
  `Reply and report in <language>. <style, e.g.: Use plain, easy wording; no
  translation-ese; keep technical terms in English.> Repo-visible titles follow
  the repo's team_language.`
- Language alone does not carry style: the agent works in English (docs, work logs,
  commit bodies), and a final report translated from those notes reads as
  translation-ese. If the user wants plain wording, it must be written here —
  rewrite reports in the user's language from scratch, never translate working notes.
- This is personal and lives outside the repo. Repo-visible text keeps following
  `team_language` in `agent-system.yaml`.

## 5. Read the repo's settings (`agent-system.yaml`)

Nothing to ask here — the owner set these at install. Read them so the explanation in
§7 matches this repo.

| Key | What it changes for this clone |
| --- | --- |
| `profile` | `solo` / `shared` / `external` — how pushes and PRs work (`git-rules.md`) |
| `issue_first` | `false`: no GitHub issues; branches follow `branch_pattern`; the record is a note section per work unit |
| `worktree_root` | where new worktrees go: `sibling` = `../<repo>-<issue>`, `claude` = `.claude/worktrees/<issue>-<short>` |
| `base_branch` | the ref branches start from and PRs target; empty = `origin/HEAD` |
| `notes_dir` | where analysis, retros and handoff notes go; index at `<notes_dir>/README.md` |
| `tools` | repo tools whose pointer appears at session start only while their artifact exists on this machine |

## 6. Verify

- `node .githooks/checks/doctor.mjs` — every line must be OK. Beyond hooks and skills it
  checks `.claude/require-skill.json`, the SessionStart hook registrations,
  `.gitattributes` (`.githooks/**` LF), and `PYTHONUTF8` on Windows.
- A WARN on hook hash drift means a system-owned file was edited in place in this repo.
  Do not "fix" it locally: the change belongs in the kit repo, then `install.mjs` again.

## 7. Explain the system (in the user's language, briefly)

- Pre-Execution Gate: files change only under a tracked issue with its management
  document opened first (or, with `issue_first: false`, under a note section).
- Pre-Commit Review Gate: the agent shows a change summary and waits for the user's
  explicit approval before committing. The user's job is to review and say yes/no.
- Umbrella issues: each member gets one umbrella issue (their workstream); concrete
  tasks hang under it as sub-issues.
- Worktrees: each issue gets its own directory (`worktree_root`); the agent creates it
  with git and moves itself there. Nothing is ever checked out over another session's
  work.
- Hooks are backstops — if one blocks a commit, the workflow order was missed; the
  agent fixes the cause, the user does not need to bypass anything.
- Repo-owned rule files (`docs/agent-workflow/repo-*.md`, or rule files the installer
  reported it left in place) extend the kit rulebook with this repo's own lessons; the
  agent reads them after the kit files.
- Korean writing skills: if the user writes Korean, mention that `ko-writing` (reports,
  docs, explanations) and `ko-ui-text` (screen strings) load themselves — no command to
  remember. Workflow skills (`issue-start`, `post-pr-cleanup`, `ui-evidence`,
  `experiment-gate`, `session-handoff`) fire on plain requests such as "start issue" or
  "cleanup after merge", in either language. Details in `docs/agent-workflow/skills.md`.
