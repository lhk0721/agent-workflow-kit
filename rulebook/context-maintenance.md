# Context Maintenance

<!-- agent-workflow-kit — system-owned; `update` overwrites this file -->

`AGENTS.md` is not documentation. It is a prompt fragment that ships in full on every
single request of every session, before the agent has read one line of code. Its size
is a recurring cost and its accuracy is a correctness property: a stale line there is
worse than a missing one, because the agent acts on it without checking.

Management documents and working notes are the opposite — read on demand, unbounded,
and the right place for history. Session memory is a third store with its own failure
mode. The whole discipline is deciding which of the three a fact belongs in.

## Where a fact belongs

| Store | Loads | Belongs | Never |
| --- | --- | --- | --- |
| Session memory (`~/.claude/projects/<slug>/memory/`) | every session; outside git, so no hook refreshes it | user preferences, corrections received, session-coexistence etiquette (who holds the shared server, where the lock is), a link to the note that holds the detail | numbers, results, artifact paths, anything already in `AGENTS.md` or a note — a restated fact is a second copy that goes stale on its own |
| `AGENTS.md` | every request | rules, the Environment slot, at most 5 active pointers | live status ("host X is the one that answers today"), inventories of what exists, "not yet built" lists — each is a snapshot that reads as current forever |
| notes / docs | on demand | facts, measurements, decisions and why, history, handoffs | rules the agent must know before it reads anything else |

A memory entry that restates a note is the common case, and the one that hurts most:
paths move, numbers get re-measured, and the memory copy keeps the old value with no
hook to catch it. Memory links; notes hold.

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
  a note or a document and are reached by link. Struck-through text in `AGENTS.md` is a
  signal that this move is overdue.
- **One fact, one line.** If a bullet needs a second paragraph to stay honest, it is a
  document with a pointer left behind, not a bullet.
- **Slots have ceilings.** `Recent Active Context` is bounded by work in progress, never
  by history (see `documentation-rules.md`). `Domain Rules` and `Canon` are bounded by
  what the agent must know *before* it reads anything else. `Environment` is three lines.
- **Write the pointer for a reader who has no history.** "Trigger mode needs 60fps
  negotiation; exposure ≤230" is a fact. "Fixed the exposure cliff (see 08-27)" is a
  note to yourself.
- **Delete before merge.** Removing the Recent Active Context line is the last commit on
  the branch (`git-rules.md` post-PR gate), not a tidy-up for later — after the merge a
  protected branch cannot be edited.

## Environment (repo slot)

Half of a stale `AGENTS.md` is environment fact written as a snapshot: which host is
up, which tools exist on this machine, what is "not yet built". A fixed shape keeps that
class of fact to three lines and makes each one falsifiable:

```
## Environment (repo slot)

- Runs here: <what this machine does — edit, test, lint>
- Cannot run here: <what it cannot — docker, GPU inference> → <note that says where>
- Runs there: <the other machine or service, by role not by address> → <note with hosts, accounts, lock rules>
```

Addresses, "currently alive", and lists of what is missing go in the pointed-to note;
the slot names the split, not the state. A line in it that needs "as of <date>" to be
true is already a note.

## Budget

`context-budget.mjs` runs on every commit that touches `AGENTS.md` and warns past these
numbers. They are thresholds for a second look, not hard limits — it never blocks.

| Measure | Warn above | Why this number |
| --- | --- | --- |
| Whole file | 12,000 chars | Beyond this the file stops being an entry point |
| Single bullet | 1,200 chars | A bullet this long is a document |
| One `##` section | 30% of the file | An entry point with one dominant section is that section's document |
| Enumerator bullet | 4 glyphs (①②③…) | A bullet numbering its own sub-steps is a procedure, and a procedure is a doc |
| Recent Active Context | 5 lines | More parallel work than one person tracks |
| Struck-through runs | 1 | History that has not moved out yet |

When a warning fires, the fix is to move text out, not to raise the number.

### Untracked `AGENTS.md`

Some repos keep `AGENTS.md` out of git (`.git/info/exclude`) so each member holds their
own. No commit hook ever sees such a file, so `agents-freshness.mjs` runs at session
start instead: it reports Recent Active Context pointers whose branch is gone or landed,
an `AGENTS.md` whose last write predates the 100th commit before HEAD, and a file over
budget. The report lands in the session as context; the fix is the same — move text out,
delete the pointer.

## Hook layers

The kit ships backstops at three points, and they catch different things.

| Layer | Runs | Catches |
| --- | --- | --- |
| git hooks (`.githooks/`) | at commit and push | wrong branch, missing work log, missing registry row or notes index line, unpaired docs, context budget, encoding, protected push |
| Claude Code PreToolUse (`.claude/hooks/`) | before a tool call | destructive and publish commands (three tiers, below), a Korean edit before its skill is loaded |
| Claude Code SessionStart (`.claude/hooks/`) | at session start; after a compaction | stale session memory (`memory-freshness`), stale pointers and an old untracked `AGENTS.md` (`agents-freshness`), repo tool pointers (`repo-tools`), the skill listing (`skill-listing`) |

A git hook cannot stop `rm -rf` — by the time a commit runs, the deletion already
happened. That is the gap `.claude/hooks/guard-destructive.mjs` covers: it sees the
command before the agent runs it. Prose in `AGENTS.md` asking the agent to be careful is
not a substitute; it is advisory and probabilistic, while a hook is deterministic.

The SessionStart layer exists because two things the agent loads at session start live
outside git's reach: session memory, and an `AGENTS.md` the repo keeps untracked. Their
checks run when the session does and report through additionalContext into the session
that needs them. `repo-tools` is the inverse case: `agent-system.yaml: tools` pairs a
tool doc with the artifact it needs (`docs/agent-workflow/tools/graphify.md |
graphify-out/graph.json`), and the pointer is injected only while the artifact exists on
this machine — "query the graph first" on a machine with no graph is a stale line by
construction, so it never gets written into `AGENTS.md`.

### The guard's three tiers

| Tier | Effect | Defaults |
| --- | --- | --- |
| `deny` | refused, whatever the permission mode | deleting the filesystem or home root |
| `ask` | confirmation even under bypass | recursive delete, history rewrite, raw device, a write or redirect into a guarded path, publish actions (`docker push`, `wrangler deploy`, `npm publish`, `gh release create`), `git checkout`/`switch` when the checkout has more than one worktree |
| `warn` | runs; one line of context reaches the model | `pkill -f`, a heredoc writing `\\` into a code file (an unquoted heredoc halves the backslashes), PowerShell `ssh … 2>&1`, an inline `-m "$(…)"` body, plain `git worktree remove` |

Nuisance traps go to `warn`, never to `ask`. A prompt the user learns to click through
protects nothing — when fifteen prompts in a row are harmless, the sixteenth gets the
same reflex — and the party that made the mistake is the agent, which a warning reaches
and a prompt does not. `ask` is reserved for what the user would want to stop: hard to
undo, or visible outside the repo. Heredoc text that `cat`/`tee` writes to disk is data,
not a command, and is stripped before matching; a heredoc fed to `bash`/`python`/`ssh`
runs, so it stays visible. Repos add their own entries in `.claude/guard.json`
(repo-owned, seeded once). `.claude/hooks/guard-destructive.test.mjs` holds the cases;
run it from the repo root after touching either file.

Skills have the same advisory-versus-deterministic split. "Use `ko-writing` for Korean docs" is
prose, and it has a second failure mode: after a context compaction Claude Code re-sends
the tool and agent listings but not the skill listing, so a skill that was never invoked
before the compaction is unknown afterwards — the agent cannot use what it does not know
exists. Two hooks close that. `.claude/hooks/skill-listing.mjs` runs on SessionStart with
matcher `compact` and hands the user's and the repo's SKILL.md names back as context.
`.claude/hooks/require-skill.mjs` runs before Write/Edit and denies an edit whose new text
carries Hangul until the skill named by `.claude/require-skill.json` (repo-owned: which
paths want `ko-ui-text`, which want `ko-writing`, the Hangul threshold, a TTL) has been
invoked in this session — it sees the `Skill` call and keeps a marker. The deny goes to the
model, which invokes the skill and retries; the user sees nothing. Do not reach for
`paths:` in SKILL.md frontmatter as a cheaper lever: on Claude Code 2.1.278 a skill that
carries it drops out of the listing entirely and the `Skill` tool answers "Unknown skill",
so the hook above would deny every Korean edit with no way to satisfy it (verified 2026-09-22
with a two-skill control run).
