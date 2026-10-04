#!/usr/bin/env python3
"""Tests for trending_readmes.py — offline, on fixtures. Run: python trending_readmes_test.py"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import trending_readmes as tr  # noqa: E402

PAGE = """<html><article class="Box-row">
  <h2 class="h3 lh-condensed"><a href="/acme/rocket" data-view-component="true">acme / rocket</a></h2>
  <p class="col-9 color-fg-muted my-1 pr-4">Launch &amp; land <b>rockets</b></p>
  <span>1,234 stars this week</span>
</article><article class="Box-row">
  <h2 class="h3 lh-condensed"><a href="/beta/tool">beta / tool</a></h2>
  <span>5,678 stars this week</span>
</article></html>"""

README = """<div align="center">
<h1>Rocket</h1>
<p><a href="#a">Quick start</a> · <a href="#b">Docs</a> · <a href="#c">Discord</a></p>
<img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</div>

> [!NOTE]
> New in 2.0.

## Quick start

```sh
# not a heading
echo hi
```

| Without Rocket | With Rocket |
| --- | --- |
| slow | fast |

<details><summary>More</summary>text</details>

### Install [docs](docs/install.md)

![screenshot](docs/shot.png)

## License
"""


def test_parse_trending_sorts_by_stars():
    rows = tr.parse_trending(PAGE)
    assert [r["repo"] for r in rows] == ["beta/tool", "acme/rocket"], rows
    assert rows[1]["stars"] == 1234, rows[1]
    assert rows[1]["description"] == "Launch & land rockets", rows[1]
    assert rows[0]["description"] == "", rows[0]


def test_parse_trending_empty_page():
    assert tr.parse_trending("<html></html>") == []


def test_outline_mixes_html_and_markdown_and_skips_code():
    o = tr.outline(README)
    assert o == [(1, "Rocket"), (2, "Quick start"), (3, "Install docs"), (2, "License")], o


def test_devices():
    d = tr.devices(README)
    assert d["centred header"] and d["nav links"] and d["badges"] == 1, d
    assert d["alerts"] == 1 and d["without/with table"] and d["details"] == 1, d
    assert d["tables"] == 1 and d["images"] == 1 and d["license section"], d
    assert not d["agent install block"] and d["mermaid"] == 0 and d["video"] == 0, d
    assert not d["contents list"], d


def test_report_handles_a_missing_readme():
    rows = [
        {"repo": "acme/rocket", "stars": 10, "description": "x", "outline": tr.outline(README), "devices": tr.devices(README)},
        {"repo": "beta/tool", "stars": 5, "description": "", "outline": [], "devices": {}, "error": "HTTP Error 404"},
    ]
    text = tr.report(rows, "weekly")
    assert "| 1 | [acme/rocket]" in text and "README not fetched: HTTP Error 404" in text, text
    assert "| badges | 1 | — |" in text, text
    assert "| 2 | [beta/tool](https://github.com/beta/tool) | 5 |  |" in text, text
    assert "  - Quick start" in text and "    - Install docs" in text, text


def test_main_offline(tmp: Path):
    page = tmp / "trending.html"
    page.write_text(PAGE, encoding="utf-8")
    tr.fetch_readme = lambda repo: README if repo == "beta/tool" else (_ for _ in ()).throw(OSError("offline"))
    out = tmp / "refs.md"
    assert tr.main(["--trending-html", str(page), "--top", "2", "--out", str(out)]) == 0
    text = out.read_text(encoding="utf-8")
    assert "## beta/tool" in text and "README not fetched: OSError: offline" in text, text


def main() -> int:
    import tempfile

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
