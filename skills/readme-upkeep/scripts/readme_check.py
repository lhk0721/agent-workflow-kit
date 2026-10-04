#!/usr/bin/env python3
"""Check Markdown pages for the defects a render hides: dead relative links, anchors that
match no heading, undefined references, missing images, marketing words.

agent-workflow-kit — readme-upkeep. Stdlib only.

    python readme_check.py README.md [CHANGELOG.md ...] [--root DIR] [--online] [--no-words] [--words FILE]

FAIL (exit 1)
  - a relative link, image or href whose target is not on disk
  - an in-page anchor (#section) that matches no heading or id in the target file
  - a reference link ([text][ref]) whose [ref]: definition is missing
  - with --online, an http(s) URL that does not answer 2xx or 3xx (after redirects)
WARN
  - a shortcut reference ([ref] alone) with no definition — GitHub renders it as plain text
  - a reference definition nothing uses
  - an image with no alt text
  - a word from the marketing list (powerful, seamless, …) — the README states facts

Fenced code blocks and inline code are skipped. Headings are slugged the way GitHub does
it: lower case, punctuation dropped, spaces to hyphens, -1/-2 suffixes for duplicates.
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

WORDS = [
    "powerful", "seamless", "seamlessly", "blazing", "blazingly", "robust", "effortless",
    "effortlessly", "cutting-edge", "state-of-the-art", "revolutionary", "game-changing",
    "supercharge", "supercharged", "next-generation", "world-class", "best-in-class",
    "lightning-fast", "enterprise-grade", "just works",
]
UA = {"User-Agent": "agent-workflow-kit readme-upkeep (stdlib urllib)"}

FENCE = re.compile(r"^\s*(```|~~~)")
INLINE_CODE = re.compile(r"`+[^`\n]*`+")
MD_HEADING = re.compile(r"^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$")
HTML_HEADING = re.compile(r"<h([1-6])[^>]*>(.*?)</h\1>", re.I | re.S)
HTML_ID = re.compile(r'<[a-z][^>]*\s(?:id|name)="([^"]+)"', re.I)
TAGS = re.compile(r"<[^>]+>")
IMG_MD = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
LINK_MD = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HTML_SRC = re.compile(r'<(a|img|source|video)\b[^>]*?\s(?:href|src|srcset)="([^"]+)"[^>]*>', re.I | re.S)
HTML_IMG = re.compile(r"<img\b[^>]*>", re.I | re.S)
REF_FULL = re.compile(r"(?<!!)\[([^\]]+)\]\[([^\]]*)\]")
REF_SHORT = re.compile(r"(?<![\]!\w])\[([^\]\[\n]+)\](?![\(\[:])")
REF_DEF = re.compile(r"^ {0,3}\[([^\]]+)\]:\s*(\S+)", re.M)
AUTOLINK = re.compile(r"<(https?://[^>\s]+)>")
BARE_URL = re.compile(r"(?<![(<\"'])https?://[^\s)>\]\"']+")


def slug(text: str) -> str:
    """GitHub's heading id, before the duplicate suffix."""
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = html.unescape(TAGS.sub("", t)).replace("`", "").replace("*", "")
    t = re.sub(r"[^\w\- ]", "", t.strip().lower())
    return t.replace(" ", "-")


def blank_fences(text: str) -> str:
    out, fence = [], None
    for line in text.splitlines():
        m = FENCE.match(line)
        if m:
            fence = m.group(1) if fence is None else (None if m.group(1) == fence else fence)
            out.append("")
            continue
        out.append("" if fence else line)
    return "\n".join(out)


def blank_inline(text: str) -> str:
    return INLINE_CODE.sub(lambda m: " " * len(m.group(0)), text)


def anchors(text: str) -> set[str]:
    """Every id a #fragment can point at in this page: heading slugs and explicit ids."""
    page = blank_fences(text)
    ids: set[str] = set()
    seen: dict[str, int] = {}
    heads = [m.group(2) for m in (MD_HEADING.match(l) for l in page.splitlines()) if m]
    heads += [m.group(2) for m in HTML_HEADING.finditer(page)]
    for h in heads:
        s = slug(h)
        n = seen.get(s, 0)
        seen[s] = n + 1
        ids.add(s if n == 0 else f"{s}-{n}")
    for m in HTML_ID.finditer(page):
        ids.add(m.group(1))
        ids.add(m.group(1).removeprefix("user-content-"))
    return ids


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def probe(url: str, cache: dict) -> tuple[bool, str]:
    if url in cache:
        return cache[url]
    verdict = (False, "no response")
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, method=method, headers=UA)
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                verdict = (True, str(r.status))
                break
        except urllib.error.HTTPError as e:
            if method == "HEAD" and e.code in (400, 403, 405, 501):
                continue  # some hosts refuse HEAD; ask again with GET
            verdict = (False, f"HTTP {e.code}")
            break
        except Exception as e:  # noqa: BLE001 — the kind of failure is the message
            verdict = (False, type(e).__name__)
            break
    cache[url] = verdict
    return verdict


def check_file(path: Path, root: Path, *, online: bool, words: list[str], cache: dict) -> tuple[list, list]:
    """(fails, warns) for one page, each a (line, message)."""
    fails: list[tuple[int, str]] = []
    warns: list[tuple[int, str]] = []
    raw = path.read_text(encoding="utf-8")
    page = blank_fences(raw)
    clean = blank_inline(page)
    own = anchors(raw)
    anchor_cache: dict[Path, set[str]] = {path.resolve(): own}

    def target_ok(url: str, line: int, what: str) -> None:
        if url.startswith(("mailto:", "tel:", "data:")):
            return
        if re.match(r"https?://", url):
            if online:
                ok, status = probe(url, cache)
                if not ok:
                    fails.append((line, f"{what} {url} — {status}"))
            return
        if url.startswith("#"):
            if url[1:] not in own and urllib.parse.unquote(url[1:]).lower() not in own:
                fails.append((line, f"anchor {url} matches no heading in {path.name}"))
            return
        part, _, frag = url.partition("#")
        part = urllib.parse.unquote(part.split("?", 1)[0])
        target = (root / part.lstrip("/")) if part.startswith("/") else (path.parent / part)
        if not target.exists():
            fails.append((line, f"{what} {url} — not found ({target.resolve()})"))
            return
        if frag and target.is_file() and target.suffix.lower() in (".md", ".markdown"):
            resolved = target.resolve()
            if resolved not in anchor_cache:
                anchor_cache[resolved] = anchors(target.read_text(encoding="utf-8"))
            if frag not in anchor_cache[resolved]:
                fails.append((line, f"anchor #{frag} matches no heading in {target.as_posix()}"))

    for m in IMG_MD.finditer(clean):
        target_ok(m.group(2), line_of(clean, m.start()), "image")
        if not m.group(1).strip():
            warns.append((line_of(clean, m.start()), f"image {m.group(2)} has no alt text"))
    for m in LINK_MD.finditer(clean):
        target_ok(m.group(2), line_of(clean, m.start()), "link")
    for m in HTML_SRC.finditer(clean):
        target_ok(m.group(2).split()[0], line_of(clean, m.start()), m.group(1).lower())
    for m in HTML_IMG.finditer(clean):
        alt = re.search(r'\salt="([^"]*)"', m.group(0))
        if not alt or not alt.group(1).strip():
            warns.append((line_of(clean, m.start()), "<img> has no alt text"))
    for m in AUTOLINK.finditer(clean):
        target_ok(m.group(1), line_of(clean, m.start()), "link")
    if online:
        for m in BARE_URL.finditer(clean):
            target_ok(m.group(0).rstrip(".,;:"), line_of(clean, m.start()), "url")

    defs: dict[str, tuple[int, str]] = {}
    for m in REF_DEF.finditer(clean):
        defs[m.group(1).strip().lower()] = (line_of(clean, m.start()), m.group(2))
    used: set[str] = set()
    for m in REF_FULL.finditer(clean):
        ref = (m.group(2) or m.group(1)).strip().lower()
        if ref in defs:
            used.add(ref)
        else:
            fails.append((line_of(clean, m.start()), f"reference [{ref}] has no [{ref}]: definition"))
    for m in REF_SHORT.finditer(clean):
        ref = m.group(1).strip()
        if ref in ("x", "X", "") or ref.startswith(("!", "^")):
            continue
        if ref.lower() in defs:
            used.add(ref.lower())
        else:
            warns.append((line_of(clean, m.start()), f"[{ref}] has no definition — renders as plain text"))
    for ref, (line, url) in defs.items():
        if ref not in used:
            warns.append((line, f"definition [{ref}] is never used"))
        target_ok(url, line, "reference")

    if words:
        prose = re.sub(r"https?://\S+", lambda m: " " * len(m.group(0)), clean)
        for w in words:
            for m in re.finditer(rf"(?<![\w-]){re.escape(w)}(?![\w-])", prose, re.I):
                warns.append((line_of(prose, m.start()), f'"{m.group(0)}" — say what it does instead'))

    fails.sort()
    warns.sort()
    return fails, warns


def find_root(start: Path) -> Path:
    for p in [start.resolve()] + list(start.resolve().parents):
        if (p / ".git").exists():
            return p
    return start.resolve()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--root", type=Path, help="repository root for /absolute links (default: nearest .git)")
    ap.add_argument("--online", action="store_true", help="also probe http(s) URLs")
    ap.add_argument("--no-words", action="store_true", help="skip the marketing-word warnings")
    ap.add_argument("--words", type=Path, help="one word per line; replaces the built-in list")
    a = ap.parse_args(argv)

    words = [] if a.no_words else (
        [l.strip() for l in a.words.read_text(encoding="utf-8").splitlines() if l.strip()] if a.words else WORDS)
    root = a.root.resolve() if a.root else find_root(a.files[0].parent)
    cache: dict = {}
    total_fail = total_warn = 0
    for f in a.files:
        if not f.exists():
            print(f"FAIL {f} — no such file")
            total_fail += 1
            continue
        fails, warns = check_file(f, root, online=a.online, words=words, cache=cache)
        for line, msg in fails:
            print(f"FAIL {f.as_posix()}:{line} — {msg}")
        for line, msg in warns:
            print(f"WARN {f.as_posix()}:{line} — {msg}")
        total_fail += len(fails)
        total_warn += len(warns)
    print(f"{len(a.files)} file(s): {total_fail} fail, {total_warn} warn"
          + ("" if a.online else " (URLs not probed; add --online)"))
    return 1 if total_fail else 0


if __name__ == "__main__":
    sys.exit(main())
