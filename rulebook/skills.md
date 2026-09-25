# Skills — Korean writing

<!-- agent-workflow-kit — system-owned; `update` overwrites this file -->

The kit ships Claude Code skills that fix the two things LLM Korean gets wrong every
time: screen text that reads like a design memo, and prose that reads like a
translation. They install to `.claude/skills/` and load automatically when the task
matches — nobody has to remember a command.

## What is installed

| Skill | Covers | Fires on |
| --- | --- | --- |
| `ko-writing` | Korean prose: reports, summaries, explanations, md docs, README, guides, design docs, meeting notes, release notes, chat replies | "정리해줘", "설명해줘", "보고서 써줘", "다듬어줘", "번역투 같다", writing or reworking a Korean `.md` |
| `ko-ui-text` | Korean UI strings: headings, buttons, labels, states, errors, empty states, onboarding, i18n files | "문구 검수해줘", "버튼 이름", "에러 메시지", editing Korean strings in JSX/HTML/JSON/YAML |

Each has three modes — audit (diagnose), rewrite (diagnose + edit the files), write
(compose new). They diagnose repeated patterns first and only then rewrite, so the same
defect does not come back on the next screen or the next document.

## ko-writing: from working notes to a reader-facing report

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

## Boundary between the two

Screen text and documents pull in opposite directions: a doc's default ending is the
plain `~한다`, and that same form on a screen reads like a developer's note. So route by
where the text is displayed, not by file type. UI strings inside a `.md` design mock are
still `ko-ui-text`.

## Interaction with Output Language (AGENTS.md)

These skills apply to text that goes out in Korean. Artifacts this system keeps in
English — management docs, work logs, issue/PR bodies, commit bodies — stay English and
never route through `ko-writing`. Repo-visible titles follow `team_language`; replies and
reports follow the user's personal `human_language`.

The one rule that matters most for report quality: **an English working note is never
translated into a Korean report — it is rewritten in Korean from the facts.** Translating
sentence by sentence carries the English word order across, and that is exactly what
reads as machine output. `ko-writing` states the procedure.

## Optional project config (repo-owned)

Put these at the repo root or under `docs/`. The skills read them before working; without
them they ask instead of guessing.

| File | Purpose | Template |
| --- | --- | --- |
| `ko-writing.config.md` | Audience per document type, default endings, which terms stay in English | `.claude/skills/ko-writing/assets/config-template.md` |
| `ui-text.config.md` | Product, surface, audience, reading situation, tone | `.claude/skills/ko-ui-text/assets/config-template.md` |
| `ui-text.glossary.md` | Settled term spellings — **shared by both skills** | `.claude/skills/ko-ui-text/assets/glossary-template.md` |

The glossary is deliberately one file for both. A screen and a doc calling the same thing
by different names is the defect these skills exist to remove, and a per-skill glossary
would reintroduce it.

## Ownership

- `.claude/skills/ko-writing/**` and `.claude/skills/ko-ui-text/**` are system-owned:
  `update` overwrites them. Don't edit in place — send the fix to the kit repo.
- Any other directory under `.claude/skills/` is yours. The installer never touches it.
- The config and glossary files above are repo-owned. `update` never touches them.
- Commit `.claude/skills/` so teammates get the skills. If `.claude/` is git-ignored in
  this repo, the installer and `doctor.mjs` both say so — un-ignore `.claude/skills/`.
