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
| umbrella_issues | `per-member` (one umbrella issue per member's workstream) · `off` | `per-member` |
| doc_pairs | docs that must change together | none |

## 3. Install

From the target repo root:

```
node <kit-path>/install.mjs
```

The installer copies system-owned files, seeds repo-owned ones (never overwrites them),
sets `git config core.hooksPath .githooks`, and writes `agent-system.lock.json`
(version pin + manifest). It stages the hook files to preserve their executable bit.

## 4. Configure + verify

- Write the interview answers into `agent-system.yaml`.
- `node .githooks/checks/doctor.mjs` — every line must be OK.
- For `shared`/`external` profiles: remind the user to set GitHub branch protection to
  match `protected_branches` (the server setting is the source of truth; the pre-push
  hook is its backstop).

## 5. Commit (approval gate applies)

- Show the user the diff summary and wait for explicit approval.
- The install commit lands on the protected branch by design, so commit it with the
  deliberate escape hatch: `AGENT_KIT_SKIP=1 git commit -m "chore: install agent-workflow-kit v<version>"`.
  This is the one legitimate use of the hatch — normal work never needs it.
- Add two lines to the target repo README: clone command + "run `claude`, say 'run onboarding'".

## Update / Uninstall

- Update: rerun `install.mjs` (system-owned files only). Review diff, commit.
- Uninstall: `node <kit-path>/uninstall.mjs` — manifest replay; repo-owned files and
  work logs stay.
