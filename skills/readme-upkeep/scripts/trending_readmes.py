#!/usr/bin/env python3
"""Outline the READMEs of the repositories trending on GitHub.

agent-workflow-kit — readme-upkeep. Stdlib only.

    python trending_readmes.py                        # top 5 of this week, report on stdout
    python trending_readmes.py --since monthly --top 8 --out refs/trending.md --save-dir refs

For each repository: stars gained in the period, its one-line description, the heading
outline (Markdown # headings and HTML <h1>–<h6>), and which README devices it uses — a
centred header, badges, a navigation line of links, GitHub alerts, a without/with table,
folded <details>, tables, a mermaid block, video, images, an install block addressed to a
coding agent, a contents list, a license section. The report is reference material for
layout only: the facts in your README come from your repository, not from theirs.
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

TRENDING = "https://github.com/trending?since={since}"
README_API = "https://api.github.com/repos/{repo}/readme"
RAW_README = "https://raw.githubusercontent.com/{repo}/HEAD/README.md"
UA = {"User-Agent": "agent-workflow-kit readme-upkeep (stdlib urllib)"}


def fetch(url: str, *, accept: str | None = None, timeout: float = 30) -> str:
    headers = dict(UA)
    if accept:
        headers["Accept"] = accept
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


# ---------------------------------------------------------------- the trending page
ARTICLE_START = '<article class="Box-row">'
REPO = re.compile(r'<h2[^>]*>\s*<a[^>]*href="/([^/"]+/[^/"]+)"', re.S)
STARS = re.compile(r"([\d,]+)\s+stars?\s+(?:today|this week|this month)")
DESC = re.compile(r'<p class="col-9[^"]*"[^>]*>\s*(.*?)\s*</p>', re.S)
TAGS = re.compile(r"<[^>]+>")


def parse_trending(page: str) -> list[dict]:
    """Repositories on a trending page, most stars first: {repo, stars, description}."""
    rows = []
    for chunk in page.split(ARTICLE_START)[1:]:
        art = chunk.split("</article>", 1)[0]
        m = REPO.search(art)
        if not m:
            continue
        s = STARS.search(art)
        d = DESC.search(art)
        rows.append({
            "repo": m.group(1),
            "stars": int(s.group(1).replace(",", "")) if s else 0,
            "description": html.unescape(TAGS.sub("", d.group(1))).strip() if d else "",
        })
    rows.sort(key=lambda r: r["stars"], reverse=True)
    return rows


def fetch_readme(repo: str) -> str:
    """The README through the API (any filename); on a rate limit or a miss, the raw README.md."""
    try:
        return fetch(README_API.format(repo=repo), accept="application/vnd.github.raw")
    except urllib.error.HTTPError as e:
        if e.code not in (403, 404, 429):
            raise
    return fetch(RAW_README.format(repo=repo))


# ---------------------------------------------------------------- reading a README
FENCE = re.compile(r"^\s*(```|~~~)")
HEADING = re.compile(r"(?m)^(#{1,6})[ \t]+([^\n]*?)[ \t]*#*[ \t]*$|<h([1-6])[^>]*>(.*?)</h\3>", re.S | re.I)
LINK = re.compile(r"\[[^\]]*\]\([^)]+\)|<a\s[^>]*href=", re.I)
SEPARATOR = re.compile(r"·|&middot;|•|&bull;|\s\|\s|&#124;")
TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*\|")
WITHOUT_WITH = re.compile(r"^\|[^\n]*\bwithout\b[^\n]*\|[^\n]*\bwith\b", re.I | re.M)
AGENT_INSTALL = re.compile(r"(paste|tell|ask|share)[^\n]{0,80}(agent|Claude Code|Codex|Cursor)", re.I)
ALERT = re.compile(r"^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]", re.M)
CONTENTS = re.compile(r"^\W*(\*\*)?(Contents|Table of Contents)(\*\*)?\W*$", re.I | re.M)
LICENSE = re.compile(r"^#{1,6}\s+[^\n]*licen[cs]e|<h[1-6][^>]*>[^<]*licen[cs]e", re.I | re.M)
# one badge = one image whose source is a badge host; the host name and the /badge/ path
# both appear in a shields URL, so the count is per image, not per match
BADGE = re.compile(r'(?:!\[[^\]]*\]\(|<img\b[^>]*?src=")[^)"\s]*(?:shields\.io|/badge/|badge\.svg)', re.I)


def strip_fences(md: str) -> list[str]:
    """Lines with fenced code blanked, so `# comment` inside a shell block is not a heading."""
    out, fence = [], None
    for line in md.splitlines():
        m = FENCE.match(line)
        if m:
            fence = m.group(1) if fence is None else (None if m.group(1) == fence else fence)
            out.append("")
            continue
        out.append("" if fence else line)
    return out


def clean_heading(text: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = TAGS.sub("", text)
    return html.unescape(text).replace("`", "").replace("**", "").strip()


def outline(md: str) -> list[tuple[int, str]]:
    """(level, text) per heading, in document order, Markdown and HTML headings together."""
    text = "\n".join(strip_fences(md))
    heads = []
    for m in HEADING.finditer(text):
        if m.group(1):
            level, raw = len(m.group(1)), m.group(2)
        else:
            level, raw = int(m.group(3)), m.group(4)
        name = clean_heading(raw)
        if name:
            heads.append((level, name))
    return heads


def devices(md: str) -> dict:
    """Which README devices the page uses. Counts where a count means something, else yes/no."""
    lines = strip_fences(md)
    body = "\n".join(lines)
    head = md.splitlines()[:60]
    return {
        "centred header": bool(re.search(r'<(div|p|h1)\s+align="center"', "\n".join(head), re.I)),
        "badges": len(BADGE.findall(md)),
        "nav links": any(len(LINK.findall(l)) >= 3 and SEPARATOR.search(l) for l in head),
        "alerts": len(ALERT.findall(body)),
        "without/with table": bool(WITHOUT_WITH.search(body)),
        "details": len(re.findall(r"<details\b", md, re.I)),
        "tables": sum(1 for l in lines if TABLE_RULE.match(l)),
        "mermaid": len(re.findall(r"```mermaid", md)),
        "video": len(re.findall(r"<video\b", md, re.I)),
        "images": sum(len(re.findall(r"!\[|<img\s", l)) for l in lines
                      if "shields.io" not in l and "/badge" not in l),
        "agent install block": bool(AGENT_INSTALL.search(md)),
        "contents list": bool(CONTENTS.search(body)),
        "license section": bool(LICENSE.search(body)),
        "words": len(re.findall(r"\S+", body)),
        "lines": len(md.splitlines()),
    }


# ---------------------------------------------------------------- the report
def report(rows: list[dict], since: str) -> str:
    out = [f"# README references — GitHub trending ({since})", ""]
    out += ["| # | Repository | Stars | Description |", "| --- | --- | ---: | --- |"]
    for i, r in enumerate(rows, 1):
        out.append(f"| {i} | [{r['repo']}](https://github.com/{r['repo']}) | {r['stars']:,} | {r['description']} |")
    out.append("")

    with_devices = [r for r in rows if r.get("devices")]
    if with_devices:
        keys = [k for k in with_devices[0]["devices"] if k not in ("words", "lines")]
        out.append("| Device | " + " | ".join(r["repo"].split("/")[1] for r in rows) + " |")
        out.append("| --- |" + " ---: |" * len(rows))
        for k in keys:
            cells = []
            for r in rows:
                v = r["devices"].get(k) if r.get("devices") else None
                cells.append("—" if v is None else "yes" if v is True else "no" if v is False else str(v))
            out.append(f"| {k} | " + " | ".join(cells) + " |")
        out.append("")

    for r in rows:
        out += [f"## {r['repo']}", ""]
        if not r.get("devices"):
            out += [f"README not fetched: {r.get('error', 'unknown error')}", ""]
            continue
        d = r["devices"]
        out += [f"{d['lines']} lines, {d['words']} words outside code blocks.", ""]
        out += [f"{'  ' * (level - 1)}- {name}" for level, name in r["outline"]]
        out.append("")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--since", choices=("daily", "weekly", "monthly"), default="weekly")
    ap.add_argument("--top", type=int, default=5, help="how many repositories (default 5)")
    ap.add_argument("--out", type=Path, help="write the report here instead of stdout")
    ap.add_argument("--save-dir", type=Path, help="also save each README as <owner>_<repo>.md here")
    ap.add_argument("--trending-html", type=Path, help="parse this saved trending page instead of fetching")
    a = ap.parse_args(argv)

    page = a.trending_html.read_text(encoding="utf-8") if a.trending_html else fetch(TRENDING.format(since=a.since))
    rows = parse_trending(page)[: a.top]
    if not rows:
        print("no repositories parsed — GitHub may have changed the trending page markup", file=sys.stderr)
        return 1
    for r in rows:
        try:
            md = fetch_readme(r["repo"])
        except Exception as e:  # noqa: BLE001 — one unreachable README must not lose the others
            r.update(outline=[], devices={}, error=f"{type(e).__name__}: {e}")
            continue
        r.update(outline=outline(md), devices=devices(md))
        if a.save_dir:
            a.save_dir.mkdir(parents=True, exist_ok=True)
            (a.save_dir / (r["repo"].replace("/", "_") + ".md")).write_text(md, encoding="utf-8")

    text = report(rows, a.since)
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(text, encoding="utf-8")
        print(f"wrote {a.out} ({len(rows)} repositories)")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
