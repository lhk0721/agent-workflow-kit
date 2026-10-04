---
name: readme-upkeep
description: Writes or updates a repository's README and release notes so they state what the repo does today — facts pulled from their source of truth (the version file, directory listings, config defaults, --help output), layout compared with the READMEs of this week's most-starred GitHub repositories, figures made through report-figures, a Keep a Changelog CHANGELOG with one entry per version, and a script that fails on a dead link, a wrong anchor or an undefined reference before the page is rendered and looked at. Use it whenever someone says the README is stale, thin or unconvincing, when a version ships, when a skill, hook, command, flag or config key is added or renamed, or when a repo has no README or release notes yet. Triggers include "README 개선", "README 고쳐", "리드미 갱신", "릴리스 노트 추가", "changelog 써줘", "배지 달아줘", "update the README", "write a README", "release notes", "the README is out of date", "add badges", "what should the README say".
---

# README upkeep

A README is read by someone deciding whether to use the repository and by someone who
already uses it and needs one fact — a flag, a path, what changed since last month. It
drifts because nothing re-reads it. This kit's own README said "seven kit skills" while
the installer wrote eight, kept the configuration keys only in a runbook, and had no
release notes and no license until a rewrite on 2026-10-04. Every one of those facts
lived somewhere in the repository and had never been copied back. This skill turns the
copying into a procedure: facts from their source, layout from what readers see most
this week, figures from one script, links and anchors checked by a script, and the
rendered page looked at before it ships.

## When

- The repo has no README, or no release notes.
- A version ships — `VERSION`, `package.json` or `pyproject.toml` changes.
- A skill, hook, command, flag or configuration key is added, renamed or removed; a
  table in the README names it.
- Someone says the README is stale, thin, confusing, or "does not explain why".
- A figure in the README is a Mermaid block or a screenshot of a diagram tool: redraw it
  through `report-figures` so it matches the document's other figures.

## Procedure

### 1. Inventory from the source of truth

Before writing a sentence, list every fact the README states or will state as a count,
a name, a path, a default or a version, and where the repository holds it. Write the
list down — a facts ledger, the same device `ko-writing` uses — so the check at the end
has something to check against.

| Fact | Where it lives | How to read it |
| --- | --- | --- |
| version | `VERSION`, `package.json`, `pyproject.toml` | `cat`; never from memory |
| skills, hooks, checks, commands | the directories and call lists that hold them | `ls`, the hook script's lines |
| configuration keys and defaults | the config reader's defaults block, the sample config | `grep -n` the defaults |
| flags | `--help` output | run it |
| what an installer writes | its copy list, the lock file manifest | read the installer |

A number written as a word ("eight skills") is the fact most likely to rot. Prefer a
table whose rows are the things counted, or a badge that reads the file
(`img.shields.io/badge/dynamic/regex?url=<raw VERSION url>&search=<regex>`).

### 2. Layout from this week's most-read READMEs

```sh
python .claude/skills/readme-upkeep/scripts/trending_readmes.py --top 5 --out notes/readme-refs.md
```

The script reads GitHub Trending (weekly by default), fetches each README and prints a
report: stars gained, the heading outline, and which devices each page uses. Read the
outlines for order and for what readers are shown first; read the device matrix for what
is common this week. Take the shapes, never the tone — a README states facts, and the
adjectives trending pages use for themselves do not transfer.

| Device | Use it when | Skip it when |
| --- | --- | --- |
| centred header: name, one-line what, nav links, badges | the repo has more than one page a reader may want next | a single-file tool |
| `> [!NOTE]` "new in" | a version changed what a returning reader does | nothing changed for them |
| figure of the mechanism | the repo has parts that hand things to each other | one command does one thing |
| "is it for you" list | readers must decide before installing | everyone in the audience already uses it |
| without/with table | the repo removes a concrete pain | the gain is hard to name in one cell |
| "paste this to your agent" block | an agent can run the install | the install is one command |
| `<details>` | a path most readers never take, kept for the few | the content is the main path |
| tables of parts (hooks, skills, keys) | the README names things a reader will look up | the list has two items |
| "what it is not" | readers arrive with a wrong model of the repo | nobody has asked |
| documentation map | more than three documents exist | the README is the documentation |

### 3. The outline

Sections in this order; drop the ones with nothing true to say.

1. header — name, one sentence of what it does, nav links, badges (version from the file,
   license from `LICENSE`)
2. "new in" note pointing at the release notes
3. what it is and how it works, with the mechanism figure
4. is it for you
5. what it catches or removes (without/with)
6. quick start — the agent prompt first, the manual path folded
7. what you get — tables of the parts, one row per thing
8. configuration — one row per key with its default
9. update / uninstall
10. what it is not
11. documentation map
12. working on it — how to run the tests and regenerate the figures
13. license, maintainer

### 4. Figures through report-figures

Every figure in the README comes from one plotting script checked into the repository
and follows `report-figures`: a flat box-and-arrow diagram for structure, one claim per
figure, no sentences inside, one meaning per colour across the document, captions that
are names. The paragraph that cites the figure states its claim and explains every
encoding the figure uses (what the blue boxes are, what a dark edge means). A Mermaid
block is not a figure in this sense: it renders differently per host, its text cannot
be sized, and its layout cannot be looked at before it ships.

### 5. Release notes

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/): newest first,
`## [Unreleased]` on top, one `## [x.y.z] — YYYY-MM-DD` per version with `### Added`,
`### Changed`, `### Fixed`, and `### Upgrading` whenever an existing install must do
something by hand. Each entry names the part that changed and links the pull request.
A change that reaches users bumps the version and adds its entry in the same pull
request; the README's "new in" note points at the file. Link each version to its
squash-merge commit, or to its pull request when the commit does not exist yet.

### 6. Check, render, look

```sh
python .claude/skills/readme-upkeep/scripts/readme_check.py README.md CHANGELOG.md --online
```

The check fails on a relative link or image whose target is not on disk, an anchor that
matches no heading (GitHub's slug rules), a reference link without its definition and,
with `--online`, a URL that does not answer. It warns on an unused reference definition,
an image without alt text, and marketing words. Then render the page the way GitHub
does and look at it at desktop and phone width (`ui-evidence`):

```sh
gh api -X POST markdown -F text=@README.md -f mode=markdown > /tmp/readme.html
```

Wrap the body in a page with `github-markdown-css` and shoot it at 1280 px and 390 px.
Look for a table whose first column wraps every row, a badge row that wraps, a figure
whose labels fall below about 12 px, and a folded block that hides the main path.
Finally check every count in the README against the inventory from step 1.

### 7. Language

The README follows `team_language` in `agent-system.yaml`. A Korean README goes through
`ko-writing`; an English README stays plain — short sentences, no adjective the repo
cannot measure. Commit titles follow the repo's commit rules; the change ships like any
other work unit, through the review gate.

## What this skill does not do

- Push, open the pull request or publish a release — the user asks for each.
- Choose the license; it adds the badge and the section once `LICENSE` exists.
- Write Korean prose — `ko-writing` does; or draw the figures — `report-figures` does.
- Verify that the repository works as the README claims; that is `verification-rules.md`.

## Files

| File | Purpose |
| --- | --- |
| `scripts/trending_readmes.py` | Reads GitHub Trending (daily, weekly, monthly), fetches the top READMEs and prints a Markdown report — stars, heading outline, device matrix. `--save-dir` keeps the READMEs; `--trending-html` parses a saved page offline. Stdlib only. |
| `scripts/trending_readmes_test.py` | Tests on fixtures: `python scripts/trending_readmes_test.py`. |
| `scripts/readme_check.py` | Checks Markdown pages: relative links and images on disk, anchors against GitHub slugs (across files too), reference definitions, alt text, marketing words; `--online` probes URLs. Exit 1 on a failure. Stdlib only. |
| `scripts/readme_check_test.py` | Tests in a temporary directory: `python scripts/readme_check_test.py`. |
