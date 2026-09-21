# Context Maintenance

<!-- agent-workflow-kit — system-owned; `update` overwrites this file -->

`AGENTS.md` is not documentation. It is a prompt fragment that ships in full on every
single request of every session, before the agent has read one line of code. Its size
is a recurring cost and its accuracy is a correctness property: a stale line there is
worse than a missing one, because the agent acts on it without checking.

Management documents are the opposite — read on demand, unbounded, and the right place
for history. The whole discipline is deciding which of the two a fact belongs in.

## The three ways it rots

Every observed failure is one of these.

| Failure | What it looks like | Why it happens |
| --- | --- | --- |
| Stale pointer | Recent Active Context names work that finished long ago | Nothing forces the pointer to move when the PR merges |
| Append-only facts | A domain bullet grows to thousands of characters, carrying struck-through hypotheses and `→` chains | Each measurement is appended; nothing is ever removed |
| Unbounded slot | A repo slot becomes a second management document | No slot has a stated ceiling |

The second one is the expensive one and the hardest to see, because each individual
append is correct. The bullet is true, well-sourced and hard-won. It just does not
belong in a file that reloads on every request.

## Rules

- **State the current fact, link the history.** A domain bullet holds what is true now.
  Superseded hypotheses, the measurement that overturned them, and the reasoning move to
  a document under `docs/` and are reached by link. Struck-through text in `AGENTS.md`
  is a signal that this move is overdue.
- **One fact, one line.** If a bullet needs a second paragraph to stay honest, it is a
  document with a pointer left behind, not a bullet.
- **Slots have ceilings.** `Recent Active Context` is bounded by work in progress, never
  by history (see `documentation-rules.md`). `Domain Rules` and `Canon` are bounded by
  what the agent must know *before* it reads anything else.
- **Write the pointer for a reader who has no history.** "Trigger mode needs 60fps
  negotiation; exposure ≤230" is a fact. "Fixed the exposure cliff (see 08-27)" is a
  note to yourself.
- **Delete on merge.** Removing the Recent Active Context line is part of the post-PR
  cleanup gate (`git-rules.md`), not a tidy-up for later.

## Budget

`context-budget.mjs` runs on every commit that touches `AGENTS.md` and warns past these
numbers. They are thresholds for a second look, not hard limits — it never blocks.

| Measure | Warn above | Why this number |
| --- | --- | --- |
| Whole file | 12,000 chars | Beyond this the file stops being an entry point |
| Single bullet | 1,200 chars | A bullet this long is a document |
| Recent Active Context | 5 lines | More parallel work than one person tracks |
| Struck-through runs | 1 | History that has not moved out yet |

When a warning fires, the fix is to move text out, not to raise the number.

## Two hook layers

The kit ships backstops at two levels, and they catch different things.

| Layer | Runs | Catches |
| --- | --- | --- |
| git hooks (`.githooks/`) | at commit | wrong branch, missing work log, unpaired docs, context budget |
| Claude Code hooks (`.claude/hooks/`) | before a tool call | destructive commands, edits to protected paths |

A git hook cannot stop `rm -rf` — by the time a commit runs, the deletion already
happened. That is the gap `.claude/hooks/guard-destructive.mjs` covers: it sees the
command before the agent runs it. Prose in `AGENTS.md` asking the agent to be careful is
not a substitute; it is advisory and probabilistic, while a hook is deterministic.

Repos add their own guarded paths in `.claude/guard.json` (repo-owned, seeded once).

A guard that asks too often is worse than none. When 15 prompts in a row are `rm -f
one-file`, `2>/dev/null`, or a grep that mentions a guarded directory, the user learns to
click through — and the one prompt that matters gets the same reflex. So the guard asks
only for what is actually hard to undo: a *recursive* delete, a history rewrite, a raw
device, a write or redirect *into* a guarded path. Heredoc text that `cat`/`tee` writes to
disk is data, not a command, and is stripped before matching; a heredoc fed to
`bash`/`python`/`ssh` runs, so it stays visible. `.claude/hooks/guard-destructive.test.mjs`
holds the cases; run it from the repo root after touching either file.
