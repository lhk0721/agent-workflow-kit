# Agent Workflow Kit

Rules + hooks + document system for repositories where AI agents (Claude Code) do the work.
This repo is the single source; each target repo gets git-tracked copies via `install.mjs`,
so fixes flow from here to every repo instead of drifting per-copy.

## What a target repo gets

- `CLAUDE.md` + `AGENTS.md` kernel (gates first, ~50 lines) with repo-owned slots
- `docs/agent-workflow/` rulebook: git rules, documentation rules, templates, onboarding
- `.githooks/` backstops in Node — 5 checks: management doc (branch = doc), sibling branch,
  doc pairs, commit message format, protected push
- `agent-system.yaml` (repo settings) + `agent-system.lock.json` (version pin + install manifest)

## Install into your repo (owner, once per repo)

```
git clone <this-kit-url>
cd <your-repo>
claude
```

Then tell the agent: **"Install the agent workflow kit from ../agent-workflow-kit"**.
The agent follows `SETUP.md`: checks/installs Node for you, asks your options
(profile, protected branches, team language, umbrella issues, doc pairs), runs the
installer, verifies with doctor, and commits after your approval.

Manual fallback: `node ../agent-workflow-kit/install.mjs` from your repo root.

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
| System-owned | `CLAUDE.md`, AGENTS.md kernel block, `docs/agent-workflow/*`, `.githooks/*` | Yes — overwritten |
| Repo-owned | `agent-system.yaml`, AGENTS.md slots, `docs/issues/**` | Never |
| Personal | reply language etc. in `~/.claude/CLAUDE.md` | Outside the system |
