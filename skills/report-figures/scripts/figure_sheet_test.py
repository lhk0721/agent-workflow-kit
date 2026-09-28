#!/usr/bin/env python3
"""Tests for figure_sheet.py. Run: python skills/report-figures/scripts/figure_sheet_test.py"""

from __future__ import annotations

import base64
import json
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from figure_sheet import from_manifest, from_markdown, main, split_caption  # noqa: E402

# 1x1 white PNG
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
)


class SheetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        (self.dir / "figures").mkdir()
        for name in ["f01.png", "t01.png", "f02.png"]:
            (self.dir / "figures" / name).write_bytes(PNG)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name: str, text: str) -> Path:
        p = self.dir / name
        p.write_text(textwrap.dedent(text), encoding="utf-8")
        return p

    def test_caption_split(self):
        self.assertEqual(split_caption("그림 3. 정답 분포."), ("그림 3", "정답 분포."))
        self.assertEqual(split_caption("**표 1.** 영역별 기준"), ("표 1", "영역별 기준"))
        self.assertEqual(split_caption("Figure 2: Loss curve"), ("Figure 2", "Loss curve"))
        self.assertIsNone(split_caption("그림은 아래에 있다"))

    def test_markdown_blocks_in_order(self):
        md = self.write("report.md", """
            본문

            > **[그림 1 자리]** 파일 `figures/f01.png`
            > 그림 1. 첫 그림의 결론.

            > **[표 1 자리]** 파일 `figures/t01.png`
            > 표 1. 표의 결론.

            > 인용문일 뿐인 블록

            ![둘째 그림의 결론](figures/f02.png)
        """)
        figs = from_markdown(md)
        self.assertEqual([Path(f["file"]).name for f in figs], ["f01.png", "t01.png", "f02.png"])
        self.assertEqual([f["label"] for f in figs], ["그림 1", "표 1", None])
        self.assertEqual(figs[1]["caption"], "표의 결론.")
        self.assertTrue(Path(figs[0]["file"]).is_absolute())

    def test_manifest(self):
        m = self.write("figs.json", json.dumps([{"file": "figures/f01.png", "caption": "결론", "label": "그림 1"}]))
        figs = from_manifest(m)
        self.assertEqual(figs[0]["label"], "그림 1")
        self.assertTrue(Path(figs[0]["file"]).is_file())

    def test_page_embeds_images_and_buttons(self):
        md = self.write("report.md", """
            > 파일 `figures/f01.png`
            > 그림 1. 첫 그림의 결론.
        """)
        out = self.dir / "sheet.html"
        self.assertEqual(main(["--markdown", str(md), "--out", str(out)]), 0)
        page = out.read_text(encoding="utf-8")
        self.assertIn("data:image/png;base64,", page)
        self.assertIn('data-kind="image"', page)
        self.assertIn(str((self.dir / "figures" / "f01.png").resolve()), page)
        self.assertIn('data-text="첫 그림의 결론."', page)  # number dropped by default
        main(["--markdown", str(md), "--out", str(out), "--keep-number"])
        self.assertIn('data-text="그림 1. 첫 그림의 결론."', out.read_text(encoding="utf-8"))

    def test_missing_file_fails(self):
        md = self.write("report.md", """
            > 파일 `figures/nope.png`
            > 그림 1. 없는 그림.
        """)
        self.assertEqual(main(["--markdown", str(md), "--out", str(self.dir / "x.html")]), 1)

    def test_no_figures_fails(self):
        md = self.write("report.md", "본문만 있다.\n")
        self.assertEqual(main(["--markdown", str(md), "--out", str(self.dir / "x.html")]), 1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
