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
re-plans the document in eight steps — fix the audience, write the glossary and fact ledgers as files first,
extract claims, fix the paragraph shape (claim → evidence → decision), pair every number
with a baseline or ceiling, give failures their own section in the same shape as the
adopted work, read the headings and figure-caption names alone as a table of contents,
then run the mechanical check. Headings come from the list of topics, not the list of
claims. Section "재료를 줄글로 옮길 때" in
`SKILL.md` states the procedure. `references/rules.md` opens with the ten principles the
rest derives from — the cold reader (knows the field, not the project) as the default
audience, standard terms over metaphors, one definition at first use, numbers with a
baseline, no internal identifiers as evidence, quantities before the noun, headings that
name the topic. A claim squeezed into a relative clause ("약한 영역이 아닌 X", "원인이 된
설정값") passes a sentence-heading check but reads as rhetoric; an evaluator flagged exactly
that in a report draft, so the rules now forbid it and name the four shapes it takes. Each principle is tied to a criterion of the National Institute of Korean
Language's argumentative-writing rubric (rules.md §0-1 holds the mapping), so the rules
have an official public source, not only house style; a report that goes to Korean
evaluators uses that table as its checklist.

Two files support that path:

| File | Purpose |
| --- | --- |
| `scripts/check.py` | Mechanical check, stdlib Python. Counts banned patterns (em dash, mid-sentence middle dot, "~를 통해", "~것 같다", …), sentence-ending mix (해라체 / 하십시오체 / 해요체), paragraphs over the sentence limit, headings over the length limit or shaped as sentences, bold overuse, quantities placed after the noun, and — as warnings for a human to judge — headings and figure captions that hide a claim (relative clause, ending in 것/법, "~아닌" contrast, rhetorical words, a large number at the end) or carry a sentence after the name. `--from`/`--to` scope the check to a body range; `--heading 25` is the limit for external reports. Run it after writing, before handing the text over. |
| `references/style-conversion.md` | Rule table for switching a finished draft between 해라체 (`~한다`) and 하십시오체 (`~합니다`), with the exceptions that need a hand and the rule that a heading names its topic in either tone (a sentence heading's claim moves to the first sentence of the body). |

Run the check from the repo root: `python .claude/skills/ko-writing/scripts/check.py <file.md>`.

Neither carries `paths:` in its frontmatter. It looked like a cheap auto-load lever, but on
Claude Code 2.1.278 a skill with `paths:` vanishes from the skill listing and the `Skill` tool
reports "Unknown skill" (verified 2026-09-22). The file scoping lives in
`.claude/require-skill.json` instead, and the deterministic lever is
`.claude/hooks/require-skill.mjs`, which denies any Write/Edit whose new text carries Hangul
until the matching skill has been invoked in the session (see `context-maintenance.md`).

### ko-writing: ledgers, section drafts and the cold-reader pass

A 13,000-character model report written with the skill passed `check.py` almost clean,
and a teammate still said it did not read. A review that saw only the manuscript found
defects no sentence-level rule can see: numbers that disagreed between sections (inherited
from the notes), one spelling with two meanings ("노트북" for a laptop GPU and for notebook
computation), terms used sections before their definition, one component under five
names, "이 채점자들" with no raters in sight, and figure-legend sentences wedged between a
claim and its conclusion. The draft had been written in one pass, and the v0.1.14
conversion procedure had been written from the model's own description of how it wrote
("I kept a glossary in my head"), which the draft itself did not satisfy. The rules
existed; nothing independent checked them. So the skill now separates writing from
checking:

- **Ledgers before prose.** Two files next to the manuscript, as fixed-column Markdown
  tables (`references/ledgers.md`, templates in `assets/`): a glossary ledger
  (`표기 | 뜻 | 쓰지 않을 말 | 정의 위치` — one spelling, one meaning; forbidden aliases;
  the section that defines it) and a fact ledger (`대상 | 지표 | 값 | 표본 | 조건 | 재료 위치`
  — every staged or ordinal entity and every number with its sample, condition and source
  line). Filling the fact ledger surfaces contradictions in the notes; they are resolved or
  asked about before writing, never smoothed over in prose.
- **One section at a time.** A manuscript with more than three sections is drafted section
  by section; the section is the batch of the existing batch rule.
- **Cold-reader pass.** After each section and once over the whole document, a fresh
  subagent that has seen neither the notes nor the ledgers gets only the manuscript path
  and the prompt in `assets/cold-reader-prompt.md`. It returns a fixed list with line
  numbers and quotes: where it got stuck, terms used before definition, names that drift
  or collide, numbers or claims that contradict elsewhere, demonstratives with no
  antecedent, sentences it had to re-read, and a three-sentence summary to compare with
  the intended claims. The writer never runs this pass itself, and a re-run uses a new
  subagent. Items are fixed (ledger first, then prose) or accepted with a reason.
- **Re-check after rule-driven rewrites.** A tone switch, a caption or heading rule, or a
  bulk term replacement sends the whole document back through `check.py` and the
  cold-reader pass. In the report above, moving figure explanations out of captions into
  the body without re-reading produced the wedged legend sentences.
- **Document-level checks in `check.py`** (warnings, stdlib only, existing flags and
  sections 1–8 unchanged): §9 "이/해당 + noun" whose noun is absent from the previous
  three paragraphs (`--dem-window`), skipping quoted text, self-references and summary
  nouns ("이 결과"); §10 figure-reading sentences ("그림에서", "파랑은", "점선은") in the
  middle of a paragraph; §11 with `--glossary FILE`: a term first used before its
  definition section, a term absent from that section, forbidden aliases (terms broken
  across lines are matched); §12 with `--facts FILE`: a ledger entity followed within 25
  characters by a same-precision number that is not its ledger value, one number attached
  to two entities, one value given to two entities in the ledger, ledger values with
  different samples in one paragraph (60 vs 400 essays), and decimals missing from the
  ledger. Known false positives are listed in `references/ledgers.md` (difference values
  after an entity name, integers of a different kind, aliases inside a definition
  sentence). Tests: `scripts/check_test.py`.

Skill changes, in this skill and in every kit skill, cite defects observed in real
output. A procedure written from an agent's description of how it works is not evidence;
the v0.1.14 procedure above is the example.

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
  `base_branch` → worktree per `worktree_root`, or in `--path <dir>` (missing or empty;
  for a session stuck in an empty leftover directory) → management document from the full
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
  A worktree whose directory stays on disk (a running program holds it) still counts as
  removed once git drops its entry; the directory is reported. Orphan worktree
  directories are reported. Ends with `git worktree list` and a branch/PR table.
- Does not: remove anything dirty or unlanded; remove the worktree it runs in; delete
  orphan or left-behind directories; close issues.
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

### report-figures

- Purpose: figures for documents read on paper or as a PDF — one claim per figure, no
  explanatory sentences inside it, gray data charts with one colour-blind-safe accent,
  values on the vertical axis,
  structure as flat 2D box-and-arrow diagrams. Comes from a model write-up whose
  teammates found 3D architecture renders confusing, in-figure sentences noisy,
  saturated palettes machine-looking, horizontal dot plots hard to read and a long
  latency tail invisible — and then found an all-gray draft hid its own emphasis.
- Triggers: "그림 만들어", "도식 그려", "구조도", "그래프 단순하게", "그림 안 글씨 빼",
  "grayscale로", "AI 티 나", "make the figures", "architecture diagram",
  "simplify the chart".
- Procedure: claim line first (a figure that needs two conclusions is split) →
  form picked from the job (columns, difference columns, overflow-binned histogram,
  slope chart, box-and-arrow diagram) → drawn in the repo's one plotting script with
  `assets/grayscale.mplstyle` → `scripts/figcheck.py` → every PNG rendered and opened →
  whatever left the figure (axis start, line and colour meaning) written into the block's in-text line and the body; the caption stays a name.
- `scripts/figcheck.py` (stdlib Python, static): fails on sentence-like strings in
  titles, text, annotations, axis and tick labels, legend labels, and on colours that are
  neither gray, an Okabe-Ito accent nor a light tint, outside functions marked
  `figcheck: diagram` (module constants and dict literals are resolved); warns on more
  than two accents in one chart, on horizontal bars and on bars whose length axis starts
  above zero. Tests: `scripts/figcheck_test.py`.
- Tables that go into the document are drawn as images by the same script, read from the
  manuscript's Markdown tables (no vertical rules, text measured with the real font,
  wrapped cells broken at clause boundaries with a warning for mid-clause breaks and
  orphan words).
- `scripts/figure_sheet.py` (stdlib Python): one self-contained HTML page per document
  with every figure and table in manuscript order and buttons that copy the image, its
  absolute path and its caption (number dropped by default). HTML because a PDF viewer
  cannot put an image on the clipboard. Tests: `scripts/figure_sheet_test.py`.
- `scripts/manuscript_sheet.py` (stdlib Python): the whole manuscript as one HTML page
  with a bracket line per section, nested by depth, and a floating switch. Copy mode:
  clicking a heading, paragraph, table, bracket (whole section, text only) or figure
  (PNG) copies it as plain text, or HTML plus tab-separated text for tables. Select
  mode: clicking copies a selector (file:line and section path; for a figure with an SVG
  next to its PNG, the matplotlib element's id path, text and position; moving outward
  selects larger groups). With `--serve`, an edit mode writes one block's Markdown back
  (refused if that block changed on disk since load) and the page reloads on file
  changes. Tests: `scripts/manuscript_sheet_test.py`.
- Captions are names only; each figure block carries a claim line and an in-text line
  for whoever writes the body. `scripts/figure_refs.py` checks that the body mentions
  every figure and repeats its numbers; the cold-read test gives a fresh agent only the
  images and compares its reading with the claims. Tests: `scripts/figure_refs_test.py`.
- Does not: judge whether the plotted comparison is fair (`experiment-gate`); write the
  caption prose (`ko-writing` §3); check layout — the rendered image is looked at.
- Reads: no kit config; the script path is the argument.

### readme-upkeep

- Purpose: a README and release notes that state what the repo does today. The kit's
  own README said "seven kit skills" while the installer wrote eight, kept the config
  keys in a runbook and had no release notes until 2026-10-04; every missing fact lived
  in the repo and had never been copied back.
- Triggers: "README 개선", "리드미 갱신", "릴리스 노트", "changelog", "배지",
  "update the README", "write a README", "release notes", "the README is out of date".
- Procedure: inventory every count, name, path, default and version from its source
  (version file, directory listing, config defaults, `--help`) → compare the layout with
  the READMEs of this week's most-starred repositories (`scripts/trending_readmes.py`:
  heading outlines and a device matrix — centred header, badges, alert note,
  without/with table, folded details, agent install block) → the outline in SKILL.md →
  figures through `report-figures` from one script, never a Mermaid block →
  `CHANGELOG.md` in Keep a Changelog form, one entry per version with its PR and an
  Upgrading note where an install needs a manual step → `scripts/readme_check.py` →
  render through the GitHub markdown API and look at it at 1280 px and 390 px.
- `scripts/readme_check.py` (stdlib Python): fails on a relative link or image whose
  target is missing, an anchor that matches no heading (GitHub slugs, across files), a
  reference link without its definition, and with `--online` a URL that does not
  answer; warns on unused definitions, images without alt text and marketing words.
  Tests: `scripts/readme_check_test.py`.
- `scripts/trending_readmes.py` (stdlib Python): GitHub Trending for a period, each
  README fetched and outlined, a device matrix across the repos. Tests on fixtures:
  `scripts/trending_readmes_test.py`.
- Does not: push, open the PR or publish a release; choose the license; write Korean
  prose (`ko-writing`); draw figures (`report-figures`); verify the claims
  (`verification-rules.md`).
- Reads: `team_language` (which language the README is in).

## Repo-specific skills

A repo's own skills live beside these under `.claude/skills/` and the kit never touches
them. They hold what only this repo knows: a runner for a remote fleet of experiment
nodes, a field-test log with the site's fixed fields, a submission gate that checks the
container contract before an image is pushed. Give each the same shape — a SKILL.md
with the triggers and the judgment calls, a script for the steps that must not vary.

## Ownership

- `.claude/skills/ko-writing/**`, `ko-ui-text/**`, `issue-start/**`, `post-pr-cleanup/**`,
  `ui-evidence/**`, `experiment-gate/**`, `session-handoff/**`, `report-figures/**` and
  `readme-upkeep/**` are system-owned:
  `update` overwrites them. Don't edit in place — send the fix to the kit repo.
- Any other directory under `.claude/skills/` is yours. The installer never touches it.
- The config and glossary files above are repo-owned. `update` never touches them.
- Commit `.claude/skills/` so teammates get the skills. If `.claude/` is git-ignored in
  this repo, the installer and `doctor.mjs` both say so — un-ignore `.claude/skills/`.
