---
name: session-handoff
description: Writes the resume note a fresh session needs to take over — what is running where with ETA and log path, what is confirmed with numbers, the exact next steps in order, the fallback state that is certain, today's traps, and the scratchpad tools copied into the repo before they vanish. Use it whenever a session may end with work in flight — a long background job is running when the turn ends, the context is getting long, the user says they are stepping away, or a deadline week has jobs on remote nodes. Triggers include "이어받을 수 있게", "인계 문서", "세션 끊기기 전에", "resume 문서", "지금 상태 정리해둬", "다음 세션이 볼 수 있게", "handoff", "resume doc", "before the session ends", "context is getting long", "write down the state", "in case this drops", and whenever a long background job is running when the turn ends, even if nobody asked.
---

# Session handoff

A dropped session loses two things: the scratchpad (every helper script written in it)
and the agent's short-term plan (which of the three running jobs matters, what to do
when each finishes, what was already ruled out). The next session reads one document.
If that document does not exist, the next session re-derives the plan from logs and
rewrites the scripts, and both take longer than the job it was waiting on.

One project survived its deadline week across several dropped sessions with three such
notes. Each began with "read only this document to take over", listed what was running
on which node with ETA and log path, stated what was confirmed with numbers, gave the
next steps in order, named the fallback that was certain (an image tag on the Hub with
its measured score), listed the day's traps, and — the part nobody plans for — listed
the tools that lived in the scratchpad and would die with the session. The kit's
`## Current State` block in management docs is the same idea; it is barely used
(3 of 123 docs in one repo, 0 of 212 in another) because nothing asks for it at the
moment it matters. This skill asks.

## When

Write or refresh the note when any of these is true at the end of a turn:

- A background job (training, a 400-item evaluation, a build, a push) is running and its
  result decides the next step.
- The context window is long enough that a compaction or a drop is plausible.
- The user says they are leaving, sleeping, or switching machines.
- The work spans machines (remote nodes, scheduled tasks) that keep running without you.

Do it before answering the user's last question, not after — a session drops at the
moment nobody chose.

## Where the note goes

- When `agent-system.yaml` sets `notes_dir`: `<notes_dir>/<track>/resume-<yyyy-mm-dd>-<slot>.md`,
  where `<track>` is the track the running work belongs to and `<slot>` is `morning`,
  `evening`, `dawn`, or a short label that distinguishes two notes on the same day.
- Otherwise: the management document's `## Current State` block for the active issue,
  replaced wholesale with the template's content. The block already exists; it is the
  entry point `AGENTS.md` points to.

The note is agent-read: English, unless the repo's notes are written in the team
language (follow what the surrounding notes do).

## Fill order

Write the sections in this order, because a session can drop mid-write and the parts
that are hardest to reconstruct must land first:

1. **Fallback that is certain** — the last known-good artefact (commit, image tag with
   digest, adapter path) and the command that restores or submits it. This line alone
   lets someone ship if everything else fails.
2. **Running now** — one row per job: what, where (host, task name, container name), when
   it started, ETA, log path, and the command that checks it. "It's running on the
   second node" is not a row; `ssh ins22 "Get-Content ~/bajak/artifacts/train.log -Tail 3"` is.
3. **Confirmed so far** — facts with numbers and where they were written. "The candidate
   is better" is not a fact; "P(win) 0.026 vs threshold 0.90, written in
   `notes/score/round3-gate.md`" is.
4. **Next steps in order** — numbered; each with the command or file. Include the branch
   for the result: "if it passes, do X; if it fails, do Y", so the next session does not
   have to decide under time pressure.
5. **Today's traps** — each as symptom → cause → what to do instead. These are the
   things that cost an hour today and would cost the next session the same hour.
6. **Tools** — every script the next steps need, with its repo path. See the scratchpad
   rule below.
7. **Open decisions for the user** — questions only the user can answer (deadline time,
   which of two passing candidates to ship), so the next session asks them first.
8. **The first line**: "Read only this document to take over. As of <timestamp>." Put it
   at the top last, once the content exists — a note with that line and nothing under
   it is worse than no note.

## The scratchpad rule

Anything in the scratchpad dies with the session. Before the turn ends, every script
the next steps depend on is copied into the repo — `scripts/` if the repo has one, else
next to the note — and the note's Tools table lists the new path and the date. A
checker, a launcher, a log parser written in the scratchpad at 02:00 is exactly the
tool the 08:00 session will need and will not have.

If a script is too repo-specific or too rough to commit, copy it anyway and say so in
the table ("rough; not for reuse beyond this week"). Rough and present beats clean and
gone.

## The certain-fallback rule

State the fallback as an artefact that exists right now, with its identity (tag +
digest, commit sha, file + sha256) and the measured number attached to it. Then state
how to get back to it in one command. "Roll back to the previous version" is not a
fallback; `docker pull user/image:2026-08-24-rubric` (measured 0.5103 on 400 items,
failed items 0) is. If the fallback is the current state, say "nothing is pending; the
tree at <sha> is the fallback".

## The refresh rule

Exactly one resume note is current. When you write a new one:

- Overwrite the pointer in `AGENTS.md` Recent Active Context (or `notes/README.md` when
  the repo indexes notes there) so it names the new file. One pointer, not a list.
- Put a one-line "superseded by `<new note>`" at the top of the previous note. Do not
  delete it — its traps section is still true.
- When the running jobs finish and the note's next steps are done, remove the pointer in
  the post-PR cleanup gate; the note stays as history.

## Before ending the turn

- [ ] The fallback line names an artefact that exists and a command that restores it
- [ ] Every running job has a log path and a check command
- [ ] Every next step has a command or a file, and a branch for pass/fail
- [ ] Every script the next steps need has a repo path in the Tools table
- [ ] The pointer in `AGENTS.md` / `notes/README.md` names this note and no other
- [ ] The first line says "read only this" and carries the timestamp

## Files

- `assets/handoff-template.md` — the note's sections in fill order, with the shape of
  each table
