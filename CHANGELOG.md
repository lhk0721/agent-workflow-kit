# Release notes

Every version of the kit, newest first. The version lives in [`VERSION`](VERSION); a
target repo records the one it runs in `agent-system.lock.json`. To move a repo to a
newer version, pull the kit and rerun `node ../agent-workflow-kit/install.mjs` from the
repo root (see [Update / Uninstall](README.md#update--uninstall)).

The format loosely follows [Keep a Changelog](https://keepachangelog.com/). Each entry
names the part of the kit that changed (skill, hook, check, installer, rulebook) and the
pull request that shipped it. **Upgrading** lists anything an existing install has to do
by hand; a version without it needs only the rerun.

## [Unreleased]

### Changed

- README: "How it works" starts at the request gate (a question is answered in place; a
  file change is tracked work), and two sections are new — git as the operating system
  that runs several sessions at once (one live branch per issue, the user as scheduler,
  the merge as join, commits as the channel between sessions), and context engineering:
  what assembling the prompt from the stores buys over wording one message. ([#30])

## [0.2.13] — 2026-10-04

### Added

- New skill `readme-upkeep`: writes or updates a repository's README and release notes.
  Facts come from their source of truth (version file, directory listing, config
  defaults, `--help`); the layout is compared with the READMEs of this week's
  most-starred repositories (`scripts/trending_readmes.py` — heading outlines and a
  device matrix); figures go through `report-figures`; `scripts/readme_check.py` fails on
  a dead relative link, an anchor that matches no heading or an undefined reference, and
  warns on unused definitions, images without alt text and marketing words. The kit's own
  README was the first case: it said "seven kit skills" while eight were installed.
  ([#29])
- `LICENSE`: the kit is released under the MIT License. ([#28])

### Changed

- README reorganised after the five most-starred repositories of the week: what the kit
  catches, an agent-first quick start, hook, skill and configuration tables, a
  documentation map ([#28]); then a section on Markdown as the document store (records,
  key, indexes, the hot set in `AGENTS.md`) and three figures drawn by
  `scripts/make_readme_figures.py` in the `report-figures` style — one work unit, the
  three stores, where each hook fires — in place of the mermaid block ([#29]). Release
  notes (this file) cover every version since 0.1.0.
- `doctor` requires the ninth skill. ([#29])

## [0.2.12] — 2026-09-29

### Changed

- `ko-writing`: a figure caption is the figure's name and nothing else. The body
  paragraph that cites the figure states its point and its reading notes. Manuscript
  figure blocks keep two working lines, a claim line and an in-text line, which are
  never pasted into the document. `check.py` warns when a caption carries a sentence
  after the name; `report-figures` and the rulebook follow the same rule. ([#27])

## [0.2.11] — 2026-09-28

There is no 0.2.10; the number was skipped.

### Added

- `ko-writing`: the drafting procedure writes a glossary ledger and a fact ledger to
  files before any prose, drafts section by section, and hands each section to a fresh
  subagent that sees only the manuscript (`assets/cold-reader-prompt.md`). ([#26])
- `ko-writing/scripts/check.py`: document-level warnings for demonstratives with no
  antecedent and legend sentences in the middle of a paragraph. With `--glossary` and
  `--facts` it also flags a term used before its definition, forbidden aliases, numbers
  that disagree with the ledger, and comparisons across different samples. ([#26])

### Changed

- A rewrite driven by a rule sends the whole document back through both checks, and a
  change to the skill must cite a defect seen in real output. ([#26])

## [0.2.9] — 2026-09-28

### Fixed

- `report-figures`: the manuscript page no longer snaps the scroll position to figures.
  Clicking a "그림 n" reference still scrolls that figure to the middle of the
  viewport. ([#25])

## [0.2.8] — 2026-09-28

### Added

- `report-figures/scripts/manuscript_sheet.py` renders a whole Markdown manuscript as
  one page for pasting into a word processor. Copy mode copies a heading, paragraph,
  list or table (tables also as HTML); a section bracket copies its section; clicking a
  figure copies the PNG. Select mode copies a selector instead: `file:line` and the
  section path for text, and for a figure that has an SVG beside its PNG, the
  matplotlib element's id path, text and position. ([#24])
- `manuscript_sheet.py --serve` adds an edit mode on `127.0.0.1`. The page reloads
  when the Markdown or a figure changes, and Ctrl+Enter writes back only the edited
  block. The write is refused when the block has moved or changed underneath, so a
  concurrent edit by another agent is never overwritten; requests from other origins
  are rejected. ([#24])

## [0.2.7] — 2026-09-28

### Added

- `report-figures` draws tables as images, like figures: booktabs rules, text measured
  with the real font, wrapped cells broken at a clause boundary first. ([#23])
- `figure_sheet.py` builds one self-contained HTML page per document, in document
  order, with buttons that copy each image, its absolute path and its caption. ([#23])
- `figure_refs.py` checks that the text and the figures answer each other. It fails on a
  caption that is more than a name, a figure block without a claim line, and a figure
  the body never mentions; it warns when the first mention comes after the figure and
  when a number from the claim line is missing from the body. ([#23])

### Changed

- `report-figures`: captions are names only. Each figure block carries two working
  lines, `Claim:` / `요점:` and `In text:` / `본문에 쓸 것:`, that brief whoever writes
  the body and are never pasted. ([#23])

## [0.2.6] — 2026-09-28

### Added

- New skill `report-figures` for figures that go into reports, papers and PDFs: one
  claim per figure, no sentences inside the figure, gray charts with one
  colour-blind-safe accent on the series that carries the claim, values on the vertical
  axis, flat 2D box-and-arrow diagrams instead of 3D renders, and every figure rendered
  and looked at before it ships. Ships `assets/grayscale.mplstyle` and
  `scripts/figcheck.py`, a static check of a matplotlib script. ([#22])

## [0.2.5] — 2026-09-28

### Changed

- `ko-writing`: a heading names its topic in the field's usual vocabulary, and the
  claim moves to the first sentence. A new diagnostic catches a claim squeezed into a
  heading (a relative clause, a `것`/`법` ending, a `~아닌` contrast, rhetorical words);
  `check.py` check 8 flags it in headings and caption names. `ko-ui-text` gains the
  matching section-heading rule. ([#21])

## [0.2.4] — 2026-09-28

### Fixed

- `post-pr-cleanup` judges a worktree removal by `git worktree list`, not by the exit
  code. On Windows, `git worktree remove` cannot delete a directory that a running
  program (usually a Claude Code session started there) uses as its working directory;
  git drops the entry anyway and exits 1. The branch is now deleted as usual and the
  directory is reported under "left on disk". The worktree the run starts in is
  skipped. ([#20])

### Added

- `issue-start --path <dir>` creates the worktree in a missing or empty directory, so a
  session stuck in an empty leftover directory gets a working checkout without moving.
  The default path also accepts an empty directory now. ([#20])

## [0.2.3] — 2026-09-26

### Added

- `guard-destructive` ask-tier switch: `askTier` in `.claude/guard.json`, or the
  personal `AGENT_KIT_GUARD_ASK` environment variable, which wins. `warn` turns every
  would-be prompt into a note the model reads; `off` drops it. The deny tier stays on
  either way, and doctor prints the active tier. ([#18])
- `ko-writing` opens with ten principles, each tied to a criterion of the National
  Institute of Korean Language (NIKL) writing rubric. Two new diagnostics (a metaphor
  used in place of a term, a quantity placed after the noun); `check.py` runs seven
  checks. ([#19])

### Changed

- Skills no longer use one project's repo names, hosts and sample sizes as examples.
  `session-handoff` writes `<topic>-handoff.md` and refreshes it in place. ([#19])

## [0.2.2] — 2026-09-26

### Fixed

- The `session-handoff` description broke YAML (an unquoted `: `), so Claude Code listed
  the skill by its H1 title and the trigger text never reached the model. ([#17])

### Added

- `skills/frontmatter.test.mjs` lints every `SKILL.md` frontmatter: `: ` and ` #` in
  unquoted values, a name that does not match the directory, `paths:`, a description too
  short to trigger on. ([#17])

## [0.2.1] — 2026-09-26

### Fixed

- Install seeds `docs/issues/` only when `issue_first` is on. A repo without issues no
  longer gets an empty registry tree its own rules may forbid. ([#16])

## [0.2.0] — 2026-09-26

Shipped in [#15].

**Highlights**

- Five workflow skills with scripts behind them: `issue-start`, `post-pr-cleanup`,
  `ui-evidence`, `experiment-gate`, `session-handoff`.
- Repos without GitHub issues: `issue_first: false` with a `branch_pattern`.
- Adopt-mode install: an existing `docs/agent-workflow/<file>.md` without the kit
  marker is left untouched and reported.

### Added

- Config keys `issue_first`, `branch_pattern`, `issues_root`, `worktree_root`,
  `base_branch`, `notes_dir` and `tools`.
- Pre-commit checks `registry-row`, `notes-index` and `encoding`; `doc-pairs` gains a
  warn tier for pairs that only share a section.
- SessionStart hooks `agents-freshness` (stale AGENTS.md pointers, checked even when no
  commit stages AGENTS.md) and `repo-tools` (announces a repo tool only while its
  artifact exists in this clone).
- `guard-destructive`: a warn tier, and publish commands (`docker push`, `npm publish`,
  `gh release create`, `wrangler deploy`, `twine upload`) now ask.
- Installer: a hash per system-owned file in the lock file, so doctor can spot in-place
  edits; kernel slots added after a repo's install are appended to its `AGENTS.md`;
  `team_language: ko` seeds the Korean writing config files.
- Rulebook: `verification-rules.md`, and the rule that a Recent Active Context pointer
  is removed as the last commit on its branch, before merge.

### Upgrading

- An existing `agent-system.yaml` keeps working: a key it lacks falls back to its
  default (issue workflow on, sibling worktrees, `origin/HEAD` as the base). Add keys
  only to change that.

## [0.1.14] — 2026-09-25

### Added

- `ko-writing`: a seven-step procedure for turning notes, tables and bullets into a
  report for outside readers; a 해라체 ↔ 하십시오체 conversion table
  (`references/style-conversion.md`); and `scripts/check.py`, a standard-library check
  for banned patterns, mixed sentence endings, paragraph and heading length, and bold
  count. ([#14])
- New rules: a number comes with its baseline or ceiling, and failures are written in
  the same shape as the work that was adopted. ([#14])

## [0.1.13] — 2026-09-22

### Fixed

- Removed `paths:` from the `ko-writing` and `ko-ui-text` frontmatter. On Claude Code
  2.1.278 a `SKILL.md` with `paths:` disappears from the skill listing and the Skill
  tool answers "Unknown skill". File scoping stays in `.claude/require-skill.json`.
  ([#13])

## [0.1.12] — 2026-09-21

### Changed

- `guard-destructive` judges guarded paths per simple command: the command is split on
  `;`, `&&`, `||`, `|` and newlines outside quotes, and a write verb must sit in the same
  simple command as the guarded path. `rm -f a.md` next to a heredoc that merely
  mentions a guarded path no longer asks. ([#12])

## [0.1.11] — 2026-09-21

### Added

- `skill-listing` (SessionStart after a compaction) hands the skill listing back;
  Claude Code re-sends tools and agents after a compaction, but not skills. ([#11])
- `require-skill` (PreToolUse) denies a Write or Edit whose new text carries Hangul until
  the skill named in `.claude/require-skill.json` has been invoked in the session. The
  deny goes to the model, not the user. ([#11])

## [0.1.10] — 2026-09-21

### Fixed

- `guard-destructive` asks only for what is hard to undo: `rm` asks on a recursive flag
  only, heredoc bodies written by `cat`/`tee` are ignored, `2>/dev/null` and `2>&1` no
  longer count as writes, and `--force-with-lease` is no longer treated as a force
  push. `Remove-Item -Recurse` is now guarded. ([#10])

## [0.1.9] — 2026-09-18

### Added

- `memory-freshness` (SessionStart) checks every "branch is unpushed / uncommitted"
  claim in Claude Code session memory against git and quotes the stale line. ([#9])

### Changed

- `context-budget` reports a pointer whose branch holds no commits beyond the base as
  "landed, or never started" instead of claiming the work merged. ([#9])

## [0.1.8] — 2026-09-18

### Added

- Claude Code hook layer. `guard-destructive` (PreToolUse) runs before the tool call —
  the only layer that can stop a destructive command, since a git hook fires long after
  `rm -rf` ran. Its `ask` forces a confirmation even under `bypassPermissions`. Defaults
  cover recursive deletes, force push, hard reset, `git clean`, `branch -D`, worktree
  removal, `DROP`/`TRUNCATE`, raw device writes and remote `ssh … rm -rf`; a repo
  extends it through `.claude/guard.json`. ([#8])
- `context-budget` (pre-commit, warn only): AGENTS.md size limits and stale Recent
  Active Context pointers. ([#8])
- `rulebook/context-maintenance.md`: how AGENTS.md rots and what each hook layer
  catches. ([#8])

## [0.1.7] — 2026-09-08

### Added

- Korean writing skills: `ko-writing` for prose and `ko-ui-text` for screen strings,
  sharing one glossary. Install puts them under `.claude/skills/` and warns when
  `.claude/` is git-ignored, since ignored skills never reach teammates. The kernel's
  Output Language section routes Korean output through them and forbids translating
  English working notes into a report. ([#7])

## [0.1.6] — 2026-08-18

### Fixed

- Update overwrote any target `CLAUDE.md` that merely mentioned the kit by name. A
  `CLAUDE.md` is now treated as kit-owned only when it starts with the kernel marker
  comment. ([#6])
- Onboarding records the user's reply style along with the reply language. ([#6])

## [0.1.5] — 2026-08-17

### Added

- Repo-owned checks: pre-commit runs `.githooks/checks/repo-*.mjs` after the kit's
  checks. The kit never ships a file named `repo-*`, so updates never touch them. The
  pull request is titled v0.1.4; it shipped as 0.1.5 because #4 took 0.1.4. ([#5])

## [0.1.4] — 2026-08-17

### Changed

- Kernel: report files to the user as absolute paths. A worktree sits outside the
  directory the user's editor has open, so relative paths are not clickable. ([#4])

## [0.1.3] — 2026-08-17

### Added

- Post-PR cleanup gate in `git-rules.md`: branch deletion that is safe after a squash
  merge, a clean-status check before removing a worktree, remote branch deletion, and
  pointer removal. ([#3])
- CI gate rule and a PR validation workflow template. ([#3])
- Recent Active Context lifecycle, and a `Repo Tools` slot in the kernel. ([#3])

### Upgrading

- Installs of this version wrote slots only into a fresh `AGENTS.md`; add the
  `Repo Tools` slot by hand, or update to 0.2.0 or later, which appends missing slots.

## [0.1.2] — 2026-08-17

### Fixed

- The foreign-doc pre-commit check no longer blocks umbrella documents
  (`docs/issues/umbrella/…`) when a sub-issue branch adds its row. ([#2])

## [0.1.1] — 2026-08-16

### Changed

- `git-rules.md`: write multi-line commit and PR bodies to a file and pass it with
  `git commit -F` / `gh pr create --body-file`. Heredoc forms are refused in
  worktree-isolated Claude Code sessions. ([#1])

## [0.1.0] — 2026-08-12

First release.

- An AGENTS.md kernel of about 50 lines with repo-owned slots, and an English rulebook.
- Five backstop checks in Node, with no PowerShell dependency.
- An installer that writes a version pin and a manifest; uninstall replays the manifest.
- Agent-run runbooks: `SETUP.md` for repo owners, `onboarding.md` for new members.

[Unreleased]: https://github.com/lhk0721/agent-workflow-kit/commits/main
[0.2.13]: https://github.com/lhk0721/agent-workflow-kit/commit/44e264b
[0.2.12]: https://github.com/lhk0721/agent-workflow-kit/commit/1515056
[0.2.11]: https://github.com/lhk0721/agent-workflow-kit/commit/f007b7b
[0.2.9]: https://github.com/lhk0721/agent-workflow-kit/commit/c44d421
[0.2.8]: https://github.com/lhk0721/agent-workflow-kit/commit/f9aa814
[0.2.7]: https://github.com/lhk0721/agent-workflow-kit/commit/f1d1774
[0.2.6]: https://github.com/lhk0721/agent-workflow-kit/commit/a7ddc32
[0.2.5]: https://github.com/lhk0721/agent-workflow-kit/commit/5e59f9f
[0.2.4]: https://github.com/lhk0721/agent-workflow-kit/commit/6a99d3a
[0.2.3]: https://github.com/lhk0721/agent-workflow-kit/commit/fe08aa2
[0.2.2]: https://github.com/lhk0721/agent-workflow-kit/commit/d5889a8
[0.2.1]: https://github.com/lhk0721/agent-workflow-kit/commit/cc0bf49
[0.2.0]: https://github.com/lhk0721/agent-workflow-kit/commit/e2136d9
[0.1.14]: https://github.com/lhk0721/agent-workflow-kit/commit/73d6910
[0.1.13]: https://github.com/lhk0721/agent-workflow-kit/commit/4e8d634
[0.1.12]: https://github.com/lhk0721/agent-workflow-kit/commit/ec3d74d
[0.1.11]: https://github.com/lhk0721/agent-workflow-kit/commit/27d259d
[0.1.10]: https://github.com/lhk0721/agent-workflow-kit/commit/c155dda
[0.1.9]: https://github.com/lhk0721/agent-workflow-kit/commit/13c4781
[0.1.8]: https://github.com/lhk0721/agent-workflow-kit/commit/1de7996
[0.1.7]: https://github.com/lhk0721/agent-workflow-kit/commit/f201752
[0.1.6]: https://github.com/lhk0721/agent-workflow-kit/commit/5311444
[0.1.5]: https://github.com/lhk0721/agent-workflow-kit/commit/c821eb7
[0.1.4]: https://github.com/lhk0721/agent-workflow-kit/commit/3730e6f
[0.1.3]: https://github.com/lhk0721/agent-workflow-kit/commit/50befc5
[0.1.2]: https://github.com/lhk0721/agent-workflow-kit/commit/b17eb54
[0.1.1]: https://github.com/lhk0721/agent-workflow-kit/commit/fd5af25
[0.1.0]: https://github.com/lhk0721/agent-workflow-kit/commit/07827f6
[#1]: https://github.com/lhk0721/agent-workflow-kit/pull/1
[#2]: https://github.com/lhk0721/agent-workflow-kit/pull/2
[#3]: https://github.com/lhk0721/agent-workflow-kit/pull/3
[#4]: https://github.com/lhk0721/agent-workflow-kit/pull/4
[#5]: https://github.com/lhk0721/agent-workflow-kit/pull/5
[#6]: https://github.com/lhk0721/agent-workflow-kit/pull/6
[#7]: https://github.com/lhk0721/agent-workflow-kit/pull/7
[#8]: https://github.com/lhk0721/agent-workflow-kit/pull/8
[#9]: https://github.com/lhk0721/agent-workflow-kit/pull/9
[#10]: https://github.com/lhk0721/agent-workflow-kit/pull/10
[#11]: https://github.com/lhk0721/agent-workflow-kit/pull/11
[#12]: https://github.com/lhk0721/agent-workflow-kit/pull/12
[#13]: https://github.com/lhk0721/agent-workflow-kit/pull/13
[#14]: https://github.com/lhk0721/agent-workflow-kit/pull/14
[#15]: https://github.com/lhk0721/agent-workflow-kit/pull/15
[#16]: https://github.com/lhk0721/agent-workflow-kit/pull/16
[#17]: https://github.com/lhk0721/agent-workflow-kit/pull/17
[#18]: https://github.com/lhk0721/agent-workflow-kit/pull/18
[#19]: https://github.com/lhk0721/agent-workflow-kit/pull/19
[#20]: https://github.com/lhk0721/agent-workflow-kit/pull/20
[#21]: https://github.com/lhk0721/agent-workflow-kit/pull/21
[#22]: https://github.com/lhk0721/agent-workflow-kit/pull/22
[#23]: https://github.com/lhk0721/agent-workflow-kit/pull/23
[#24]: https://github.com/lhk0721/agent-workflow-kit/pull/24
[#25]: https://github.com/lhk0721/agent-workflow-kit/pull/25
[#26]: https://github.com/lhk0721/agent-workflow-kit/pull/26
[#27]: https://github.com/lhk0721/agent-workflow-kit/pull/27
[#28]: https://github.com/lhk0721/agent-workflow-kit/pull/28
[#29]: https://github.com/lhk0721/agent-workflow-kit/pull/29
[#30]: https://github.com/lhk0721/agent-workflow-kit/pull/30
