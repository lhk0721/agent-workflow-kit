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

## 3. Enable hooks (per clone — git does not inherit this)

- `git config core.hooksPath .githooks`

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

## 5. Verify

- `node .githooks/checks/doctor.mjs` — every line must be OK.

## 6. Explain the system (in the user's language, briefly)

- Pre-Execution Gate: files change only under a tracked issue with its management
  document opened first.
- Pre-Commit Review Gate: the agent shows a change summary and waits for the user's
  explicit approval before committing. The user's job is to review and say yes/no.
- Umbrella issues: each member gets one umbrella issue (their workstream); concrete
  tasks hang under it as sub-issues.
- Hooks are backstops — if one blocks a commit, the workflow order was missed; the
  agent fixes the cause, the user does not need to bypass anything.
