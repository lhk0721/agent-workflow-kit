# Skills

<!-- agent-workflow-kit — system-owned; `update` overwrites this file -->

The kit ships two kinds of Claude Code skills. Korean writing skills fix the two things
LLM Korean gets wrong every time: screen text that reads like a design memo, and prose
that reads like a translation. Workflow skills carry the mechanical parts of the
rulebook — the steps a script gets right every time and prose gets right most of the
time. All install to `.claude/skills/` and load when the task matches; nobody has to
remember a command.

## Korean writing

### What is installed

| Skill | Covers | Fires on |
| --- | --- | --- |
| `ko-writing` | Korean prose: reports, summaries, explanations, md docs, README, guides, design docs, meeting notes, release notes, chat replies | "정리해줘", "설명해줘", "보고서 써줘", "다듬어줘", "번역투 같다", writing or reworking a Korean `.md` |
| `ko-ui-text` | Korean UI strings: headings, buttons, labels, states, errors, empty states, onboarding, i18n files | "문구 검수해줘", "버튼 이름", "에러 메시지", editing Korean strings in JSX/HTML/JSON/YAML |

Each has three modes — audit (diagnose), rewrite (diagnose + edit the files), write
(compose new). They diagnose repeated patterns first and only then rewrite, so the same
defect does not come back on the next screen or the next document.

### ko-writing: from working notes to a reader-facing report

`ko-writing` carries a fourth path for the case that produces the worst prose: turning a
pile of notes, tables and bullets into a document an outsider (an evaluator, another
team, management) will read. The notes are not translated line by line; the skill
re-plans the document in seven steps — fix the audience, build the term table first,
extract claims, fix the paragraph shape (claim → evidence → decision), pair every number
with a baseline or ceiling, give failures their own section in the same shape as the
adopted work, then run the mechanical check. Section "재료를 줄글로 옮길 때" in
`SKILL.md` states the procedure; `references/rules.md` §10 maps it onto the National
Institute of Korean Language's argumentative-writing rubric, so each rule has an official
source behind it.

Two files support that path:

| File | Purpose |
| --- | --- |
| `scripts/check.py` | Mechanical check, stdlib Python. Counts banned patterns (em dash, mid-sentence middle dot, "~를 통해", "~것 같다", …), sentence-ending mix (해라체 / 하십시오체 / 해요체), paragraphs over the sentence limit, headings over the length limit, bold overuse. `--from`/`--to` scope the check to a body range; `--heading 25` is the limit for external reports. Run it after writing, before handing the text over. |
| `references/style-conversion.md` | Rule table for switching a finished draft between 해라체 (`~한다`) and 하십시오체 (`~합니다`), with the exceptions that need a hand and the rule that headings stay noun phrases in either tone. |

Run the check from the repo root: `python .claude/skills/ko-writing/scripts/check.py <file.md>`.

Neither carries `paths:` in its frontmatter. It looked like a cheap auto-load lever, but on
Claude Code 2.1.278 a skill with `paths:` vanishes from the skill listing and the `Skill` tool
reports "Unknown skill" (verified 2026-09-22). The file scoping lives in
`.claude/require-skill.json` instead, and the deterministic lever is
`.claude/hooks/require-skill.mjs`, which denies any Write/Edit whose new text carries Hangul
until the matching skill has been invoked in the session (see `context-maintenance.md`).

### Boundary between the two

Screen text and documents pull in opposite directions: a doc's default ending is the
plain `~한다`, and that same form on a screen reads like a developer's note. So route by
where the text is displayed, not by file type. UI strings inside a `.md` design mock are
still `ko-ui-text`.

### Interaction with Output Language (AGENTS.md)

These skills apply to text that goes out in Korean. Artifacts this system keeps in
English — management docs, work logs, issue/PR bodies, commit bodies — stay English and
never route through `ko-writing`. Repo-visible titles follow `team_language`; replies and
reports follow the user's personal `human_language`.

The one rule that matters most for report quality: **an English working note is never
translated into a Korean report — it is rewritten in Korean from the facts.** Translating
sentence by sentence carries the English word order across, and that is exactly what
reads as machine output. `ko-writing` states the procedure.

### Project config (repo-owned)

The skills read these before working; without them they ask instead of guessing. When
`agent-system.yaml: team_language` is `ko`, the installer seeds all three from the
templates at the repo root; otherwise create them from the templates when the repo
starts writing Korean. They are repo-owned — `update` never overwrites them.

| File | Purpose | Template |
| --- | --- | --- |
| `ko-writing.config.md` | Audience per document type, default endings, which terms stay in English | `.claude/skills/ko-writing/assets/config-template.md` |
| `ui-text.config.md` | Product, surface, audience, reading situation, tone | `.claude/skills/ko-ui-text/assets/config-template.md` |
| `ui-text.glossary.md` | Settled term spellings — **shared by both skills** | `.claude/skills/ko-ui-text/assets/glossary-template.md` |

The glossary is deliberately one file for both. A screen and a doc calling the same thing
by different names is the defect these skills exist to remove, and a per-skill glossary
would reintroduce it.

## Workflow skills

Each pairs a short SKILL.md with a script. The script does the steps that must come out
identical every time; the skill text holds the judgment calls the script refuses to
make. None of them commits — the pre-commit review gate stays with the user.

### issue-start

- Purpose: the "standard sequence for new work" in `git-rules.md`, up to the first edit,
  so that branch, worktree, management doc and pointer line agree by construction.
- Triggers: "이슈 만들어", "새 작업 시작", "worktree 파줘", "start issue", "new task".
- `scripts/issue-start.mjs` (`--dry-run` prints every step and runs none):
  `gh issue create` from the issue template → branch `<n>-<type>-<slug>` from
  `base_branch` → worktree per `worktree_root` → management document from the full
  template inside the worktree → Master Registry row (skipped when `INDEX.md` is
  generated) → Recent Active Context pointer line → prints the `EnterWorktree` path,
  the dependency setup (`npm ci` / `uv sync`) and the first-commit command.
- Does not: commit; call `EnterWorktree` (only the session can move itself); choose
  between candidate issues — that judgment is `git-rules.md` "Choosing the issue".
- Reads: `issue_first`, `branch_pattern`, `issues_root`, `worktree_root`, `base_branch`,
  `issue_types`, `umbrella_issues`.

### post-pr-cleanup

- Purpose: the mechanical part of the post-PR cleanup gate (`git-rules.md`).
- Triggers: "머지됐어", "PR 정리", "worktree 정리", "잠자는 브랜치", "sweep",
  "cleanup after merge".
- `scripts/post-pr-cleanup.mjs` (dry-run by default; `--apply` acts): `git fetch --prune`
  → PR/issue state per worktree branch → dirty check → landed check
  (`git log --right-only --cherry-pick base...branch`) → classification. With `--apply`:
  unlinks a `node_modules` junction before `git worktree remove`; deletes the local and
  remote branch only when landed; verifies the Recent Active Context line is gone and
  removes a leftover on `solo` only; on `external`, `merge --ff-only upstream/<base>` and
  the fork's base fast-forwarded through `gh api -X PATCH .../git/refs/heads/<base>`.
  Orphan worktree directories are reported. Ends with `git worktree list` and a
  branch/PR table.
- Does not: remove anything dirty or unlanded; delete orphan directories; close issues.
- Reads: `profile`, `base_branch`, `worktree_root`, `protected_branches`, `issues_root`.

### ui-evidence

- Purpose: screenshot evidence for a UI change, at the widths users have, for the work
  log and the PR body (`verification-rules.md`).
- Triggers: "스크린샷", "before/after", "휴대폰 폭", "390px", "verify visually",
  "screenshot evidence".
- `scripts/shot.mjs`: headless Chrome over CDP at 1600×900 and 390×844 (mobile
  emulation), reduced motion, a readiness expression, an overflow probe
  (`scrollWidth` > `clientWidth`, elements past the viewport edge), computed-style
  probes, console errors, a served-page identity check (the page shot is the page
  built). Writes the PNGs and an `evidence.md` table; per-shot timeout with relaunch.
- Does not: judge the design; stand in for the full-set rule — one page shot is one
  sample.
- Reads: no kit config; URL, output directory and readiness expression are arguments.

### experiment-gate

- Purpose: the pre-registered judgment in `verification-rules.md` — the gate is
  written before the numbers exist.
- Triggers: "판정", "이길 확률", "bootstrap", "문턱", "갈아탈지", "홀드아웃",
  "is B better than A".
- Writes the gate document from `assets/gate-template.md` (baseline file, metric,
  threshold, sample, pre-declared exclusions, offline and deployed gates, per-target
  reporting) BEFORE any measurement → `scripts/paired_bootstrap.py` gives P(B > A) with
  a confidence interval → `scripts/holdout_select.py` runs k-seed × 2-fold
  selection-vs-evaluation for any chosen hyper-parameter → per-target table → verdict
  appended to the gate document.
- Does not: run the experiment; accept a threshold written after the result.
- Reads: `notes_dir` (the gate document lives there, index line included).

### session-handoff

- Purpose: a note that survives a dropped session.
- Triggers: "이어받", "인계", "세션 끊기기 전에", "resume doc", "handoff".
- Writes the handoff note from `assets/handoff-template.md` — what runs where + ETA +
  log path, what is confirmed, next steps in order, the fallback state that is certain,
  today's traps, tool locations — and copies scratchpad tools into the repo before the
  session ends, because a script that lives only in the scratchpad dies with it.
- Does not: commit; replace the management doc's `Current State` — the handoff note is
  cross-issue and longer-lived.
- Reads: `notes_dir` (the note goes there, index line included).

## Repo-specific skills

A repo's own skills live beside these under `.claude/skills/` and the kit never touches
them. They hold what only this repo knows: a runner for a remote fleet of experiment
nodes, a field-test log with the site's fixed fields, a submission gate that checks the
container contract before an image is pushed. Give each the same shape — a SKILL.md
with the triggers and the judgment calls, a script for the steps that must not vary.

## Ownership

- `.claude/skills/ko-writing/**`, `ko-ui-text/**`, `issue-start/**`, `post-pr-cleanup/**`,
  `ui-evidence/**`, `experiment-gate/**` and `session-handoff/**` are system-owned:
  `update` overwrites them. Don't edit in place — send the fix to the kit repo.
- Any other directory under `.claude/skills/` is yours. The installer never touches it.
- The config and glossary files above are repo-owned. `update` never touches them.
- Commit `.claude/skills/` so teammates get the skills. If `.claude/` is git-ignored in
  this repo, the installer and `doctor.mjs` both say so — un-ignore `.claude/skills/`.
