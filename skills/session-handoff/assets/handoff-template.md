# Resume — <date> <slot>

Read only this document to take over. As of <yyyy-mm-dd hh:mm> (<timezone>).

<!-- Fill in this order: Fallback, Running now, Confirmed, Next steps, Traps, Tools,
     Open decisions, then the line above. A session can drop mid-write; the parts that
     are hardest to reconstruct go first. -->

## Fallback that is certain

<The artefact that ships if everything below fails: identity + measured number + one
command to restore or submit it.>

```
<e.g. docker pull user/image:2026-08-24-rubric   # 400 items, 0.5103, failed 0
      digest sha256:…>
```

<If nothing is pending: "nothing is pending; the tree at <sha> is the fallback".>

## Running now

| job | where (host / task / container) | started | ETA | log path | how to check |
| --- | --- | --- | --- | --- | --- |
| <what it computes> | <host, scheduled task or container name> | <hh:mm> | <hh:mm> | `<path on that host>` | `<one command>` |

<What survives a dropped session and what does not: scheduled tasks keep running; a
foreground ssh runner dies with the session; say which each row is.>

## Confirmed so far

<Facts with numbers and where they were written. One line each.>

- <fact> — <number(s)> — written in `<path>`
- <what was ruled out, with the number that ruled it out> — `<path>`

## Next steps in order

1. <step> — `<command or file>` — when it finishes: if <pass>, go to step 2; if <fail>, <what instead>
2. <step> — `<command or file>`
3. <step> — `<command or file>`

## Today's traps

<Each: symptom → cause → what to do instead. These cost an hour today and would cost the
next session the same hour.>

- <symptom> → <cause> → <do this instead>
- <symptom> → <cause> → <do this instead>

## Tools

<Every script the next steps need. Anything still in the scratchpad is copied into the
repo before the turn ends; this table lists the new path.>

| script | repo path | what it does | copied from scratchpad on |
| --- | --- | --- | --- |
| `<name>.py` | `scripts/<name>.py` | <one line> | <date or "was already in the repo"> |

## Open decisions for the user

<Questions only the user can answer. The next session asks these first.>

- <question> — <what depends on the answer>
