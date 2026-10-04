#!/usr/bin/env python3
"""Tests for readme_check.py — offline, in a temporary directory. Run: python readme_check_test.py"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import readme_check as rc  # noqa: E402


def test_slug_matches_github():
    cases = {
        "Quick start": "quick-start",
        "Update / Uninstall": "update--uninstall",
        "Is it for you?": "is-it-for-you",
        "`VERSION` file": "version-file",
        "C++ & Rust": "c--rust",
        "[Docs](x.md) and **more**": "docs-and-more",
        "한국어 제목": "한국어-제목",
        "snake_case stays": "snake_case-stays",
    }
    for text, want in cases.items():
        assert rc.slug(text) == want, (text, rc.slug(text), want)


def test_anchors_number_duplicates_and_read_html_ids():
    ids = rc.anchors("# Install\n\n## Install\n\n<h2>Third &amp; last</h2>\n<a id=\"user-content-top\"></a>\n")
    assert {"install", "install-1", "third--last", "top", "user-content-top"} <= ids, ids


def run(tmp: Path, text: str, *, online=False, words=None):
    f = tmp / "README.md"
    f.write_text(text, encoding="utf-8")
    return rc.check_file(f, tmp, online=online, words=rc.WORDS if words is None else words, cache={})


def test_links_anchors_and_images(tmp: Path):
    (tmp / "docs").mkdir()
    (tmp / "docs" / "guide.md").write_text("# Guide\n\n## Setup steps\n", encoding="utf-8")
    (tmp / "docs" / "shot.png").write_bytes(b"\x89PNG")
    text = (
        "# Title\n\n## Quick start\n\n"
        "[ok](#quick-start) [bad](#quick-starts) [file](docs/guide.md#setup-steps) "
        "[badfrag](docs/guide.md#nope) [missing](docs/none.md) [root](/docs/guide.md)\n\n"
        "![](docs/shot.png) ![gone](docs/gone.png)\n\n"
        '<p align="center"><a href="docs/guide.md">guide</a> <img src="docs/shot.png"></p>\n\n'
        "```sh\n[not a link](nowhere.md)\n```\n\n"
        "and `[code](nowhere.md)` inline, plus <https://example.com/x>.\n"
    )
    fails, warns = run(tmp, text, words=[])
    msgs = [m for _, m in fails]
    assert any("#quick-starts" in m for m in msgs), msgs
    assert any("#nope" in m and "guide.md" in m for m in msgs), msgs
    assert any("docs/none.md" in m for m in msgs), msgs
    assert any("docs/gone.png" in m for m in msgs), msgs
    assert len(fails) == 4, fails
    wmsgs = [m for _, m in warns]
    assert sum("no alt text" in m for m in wmsgs) == 2, wmsgs


def test_references(tmp: Path):
    text = (
        "# Notes\n\nSee [the PR][#1] and [#2] and [#3][] and [ ] a task [x] done.\n\n"
        "> [!NOTE]\n> alert\n\n"
        "[#1]: https://example.com/1\n[#3]: https://example.com/3\n[unused]: https://example.com/u\n"
    )
    fails, warns = run(tmp, text, words=[])
    assert len(fails) == 0, fails
    wm = [m for _, m in warns]
    assert any("[#2] has no definition" in m for m in wm), wm
    assert any("[unused] is never used" in m for m in wm), wm
    assert not any("!NOTE" in m or "[x]" in m or "[ ]" in m for m in wm), wm
    text2 = "See [docs][missing-ref].\n"
    fails, _ = run(tmp, text2, words=[])
    assert len(fails) == 1 and "missing-ref" in fails[0][1], fails


def test_marketing_words_skip_code_and_urls(tmp: Path):
    text = (
        "# X\n\nA powerful, seamless tool. `powerful` in code is fine.\n"
        "https://example.com/powerful-things too.\nBlazingly fast.\n"
    )
    _, warns = run(tmp, text)
    hits = sorted(m.split('"')[1] for _, m in warns if "say what it does" in m)
    assert hits == ["Blazingly", "powerful", "seamless"], hits


def test_main_exit_code(tmp: Path):
    f = tmp / "README.md"
    f.write_text("# A\n\n[x](#b)\n", encoding="utf-8")
    assert rc.main([str(f), "--no-words"]) == 1
    f.write_text("# A\n\n[x](#a)\n", encoding="utf-8")
    assert rc.main([str(f), "--no-words"]) == 0
    assert rc.main([str(tmp / "nope.md")]) == 1


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in tests:
        try:
            if fn.__code__.co_argcount:
                with tempfile.TemporaryDirectory() as d:
                    fn(Path(d))
            else:
                fn()
            print(f"PASS {fn.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL {fn.__name__}: {e!r}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
