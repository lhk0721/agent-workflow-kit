# Documentation Rules

<!-- agent-workflow-kit — system-owned; `update` overwrites this file -->

## Management documents

- One issue = one document: `<issues_root>/<type>/<branch>.md` (`agent-system.yaml:
  issues_root`, default `docs/issues`). Filename = branch name. A scoped child task
  under a broader tracked issue may live at `<issues_root>/sub-issues/<type>/<branch>.md`;
  the hooks accept both.
- Shape: the full template (`templates.md`) for work that will take more than one
  commit; the minimal one for single-commit chores. Both keep a `## Current State`
  block — the entry point for the next session. `AGENTS.md` Recent Active Context holds
  pointers only (name + path + one line); details never live in `AGENTS.md`.
- One commit = one work-log section (`### <commit title>` under `## Work Log` in the
  full shape, `## <commit title>` in the minimal one), written BEFORE the commit and
  staged with it (the pre-commit hook enforces presence, not order — order is the rule).
- A new management document adds one row to the Master Registry
  (`<issues_root>/README.md`) in the same commit — or the repo generates
  `<issues_root>/INDEX.md`, and then no row is needed: the `registry-row` check skips
  when that file exists.
- A placeholder-named document (`<issue>-...` before the number exists) is renamed the
  moment the number exists; the check warns on a number-less filename because such a
  doc matches no branch.
- A document's assets — design notes, figures, data extracts — live in a child folder
  named after it (`<issues_root>/<type>/<branch>/`); the `.md` keeps the work log and
  links in. When a path may still be useful, archive it rather than delete it, and record
  keep/move/archive decisions in the doc.
- Recent Active Context lifecycle: add the pointer line when issue work starts; remove
  it as the last commit on the branch before the PR merges (`git-rules.md` post-PR gate).
  The slot lists ACTIVE work only — its size is bounded by work in progress, never by
  history. Finished work stays discoverable through `<issues_root>/` and the registry,
  not here.
- Paths in documents are repo-relative. Never absolute paths.

## Umbrella issues (`agent-system.yaml: umbrella_issues: per-member`)

- Each member keeps ONE umbrella issue as their personal workstream unit:
  `<issues_root>/umbrella/<issue>-umbrella-<member>.md`.
- Concrete tasks are normal issues registered as GitHub sub-issues of the umbrella.
  Their documents live under `<issues_root>/<type>/` as usual and link back to the umbrella.
- The umbrella document holds the member's task list and status only — never work logs.

## Working notes (`agent-system.yaml: notes_dir`)

- `notes_dir` (e.g. `notes`) is the default sink for prose that is not a management
  document: analysis write-ups, retrospectives, surveys, todo lists, handoff notes. Write
  there without asking. Public directories — `docs/`, `README.md`, the source tree —
  take a document only on the user's explicit request; "write up what we found" means a
  note.
- Track subdirectories (`<notes_dir>/<track>/`) group notes by workstream; the index
  header names the tracks once.
- Index: `<notes_dir>/README.md`, one line per note, newest first within its track:
  `[file](path) — **headline.** detail`. The headline is the conclusion, not the topic,
  so the index reads as a list of findings. The `notes-index` check blocks a commit that
  adds a note without its index line.
- Filenames: lowercase, hyphen-separated, English, named for the conclusion or the
  question (`retry-budget-does-not-help.md`), never dated — a date says nothing about
  what is inside.
- Handoff note: before a session that may drop — a long run, a deadline week — write one
  through `session-handoff` (`skills.md`): what runs where + ETA + log path, what is
  confirmed, next steps in order, the fallback state that is certain, today's traps,
  tool locations. Its shape is in `templates.md`.
- Lesson promotion: a trap recorded in a note is not yet learned. In the same work unit,
  move it to where the next session will meet it — a rule line (`AGENTS.md` Domain Rules
  or the repo rules file), a test, or a memory entry that links to the note. A lesson that
  lives only in a note is re-learned at the same price.
- With `issue_first: false` the note section is the work record: one section per work
  unit, written before its commit (`git-rules.md`).

## Doc pairs (`agent-system.yaml: doc_pairs`)

- `"a <-> b"` — both must be staged together; the pre-commit check blocks otherwise.
- `"a <-> b | warn | <why it matters>"` — the check prints the reason and lets the commit
  through. Use warn for couplings where one side legitimately changes alone (a section
  in a plan and its parent matrix).
- Code pairs use the same syntax: `"src/server.py <-> tests/fixtures/server_mock.py |
  warn | the mock mirrors the server's response shape"`. A server file staged without its
  mock or fixture is how a test keeps passing against behaviour that no longer exists.

## Backstop checks

- Hooks (`.githooks/`) are backstops, not the rule source. The document precedes the
  file change; a tripped hook means that order was already violated. Fix the cause
  (write the doc, get on the right branch), then commit again.
- Repo-specific pre-commit checks live in `.githooks/checks/repo-*.mjs` — that name
  prefix is the repo's namespace: the kit never ships `repo-*` files, so `update`
  never touches them. Each is a plain Node script; nonzero exit blocks the commit.
  A check that should only warn prints its reminder and exits 0.
