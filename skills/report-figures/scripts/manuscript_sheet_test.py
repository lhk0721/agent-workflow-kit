#!/usr/bin/env python3
"""Tests for manuscript_sheet.py. Run: python skills/report-figures/scripts/manuscript_sheet_test.py"""

from __future__ import annotations

import base64
import http.client
import json
import re
import sys
import tempfile
import textwrap
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from manuscript_sheet import apply_edit, build, inline_html, inline_plain, main, make_server, parse, plain  # noqa: E402

# 1x1 white PNG
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
)

DOC = """
    # 원고

    ## 1. 개요

    첫 문단은 **굵게**와 `코드`와 [링크 `a.md`](a.md)를
    두 줄에 걸쳐 쓴다. 그림 1을 본다.

    > **[그림 1 자리]** 파일 `figures/f01.png`
    > 그림 1. 첫 그림.
    > 요점: 복사하지 않는 줄.
    > 본문에 쓸 것: 이것도 복사하지 않는다.

    | 항목 | 값 |
    | --- | --- |
    | 가 | **1** |

    - 하나
      이어지는 줄
    - 둘

    ### 1-1. 세부

    세부 문단.

    ---

    ## 2. 다음

    다음 문단.
"""


class ManuscriptSheetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        (self.dir / "figures").mkdir()
        (self.dir / "figures" / "f01.png").write_bytes(PNG)
        self.md = self.dir / "report.md"
        self.md.write_text(textwrap.dedent(DOC), encoding="utf-8")
        self.blocks = parse(self.md.read_text(encoding="utf-8"), [self.dir])

    def tearDown(self):
        self.tmp.cleanup()

    def test_block_kinds_in_order(self):
        kinds = [b["kind"] for b in self.blocks]
        self.assertEqual(kinds, ["heading", "heading", "para", "figure", "table", "list",
                                 "heading", "para", "hr", "heading", "para"])

    def test_plain_text_joins_lines_and_drops_marks(self):
        para = self.blocks[2]
        self.assertEqual(plain(para), "첫 문단은 굵게와 코드와 링크 a.md를 두 줄에 걸쳐 쓴다. 그림 1을 본다.")
        self.assertEqual(plain(self.blocks[4]), "항목\t값\n가\t1")
        self.assertEqual(plain(self.blocks[5]), "- 하나 이어지는 줄\n- 둘")

    def test_figure_block_keeps_work_lines_out_of_caption(self):
        fig = self.blocks[3]
        self.assertEqual((fig["label"], fig["caption"]), ("그림 1", "첫 그림."))
        self.assertEqual(fig["claim"], "복사하지 않는 줄.")
        self.assertTrue(Path(fig["file"]).is_file())

    def test_inline(self):
        self.assertEqual(inline_plain("**a** `b` [c](d)"), "a b c")
        h = inline_html("그림 1과 [`x`](y.md) <b>", {"그림1": "fig-그림1"})
        self.assertIn('<a class="ref" href="#fig-그림1">그림 1</a>', h)
        self.assertIn('<a href="y.md"><code>x</code></a>', h)
        self.assertIn("&lt;b&gt;", h)

    def page(self):
        page, missing = build(self.blocks, "T", "report.md", "ko", keep_number=False, last_line=30)
        data = json.loads(re.search(r'<script id="data" type="application/json">(.*?)</script>', page, re.S).group(1))
        return page, missing, data

    def test_page_data_and_selectors(self):
        page, missing, data = self.page()
        self.assertEqual(missing, [])
        self.assertEqual(len(data), len(self.blocks))
        fig = data[3]
        self.assertEqual(fig["caption"], "첫 그림.")
        self.assertNotIn("복사하지 않는", fig["caption"] + fig["plain"])
        self.assertIn("png", fig)
        self.assertIn("<table>", data[4]["html"])
        self.assertIn('id="fig-그림1"', page)
        self.assertIn("요소 복사", page)
        self.assertIn("요소 선택", page)
        self.assertEqual(data[2]["sel"], 'report.md:6 · 1. 개요 › 문단 1 · "첫 문단은 굵게와 코드와 링크 a.md를 두 줄에 걸쳐 쓴다. 그림 1을…"')
        self.assertEqual(data[1]["sel_sec"], 'report.md:4-27 · 절 "1. 개요"')  # up to the line before "## 2. 다음"

    def test_sections_nest_by_heading_level(self):
        page, _, _ = self.page()
        self.assertEqual(page.count('<section class="sec'), 4)
        self.assertEqual(page.count("</section>"), 4)
        h11 = page.index('class="sec lv3"')
        self.assertLess(page.index('class="sec lv2"'), h11)
        self.assertEqual(page.count('class="brk"'), 4)

    def test_svg_next_to_png_is_inlined_with_prefixed_ids(self):
        (self.dir / "figures" / "f01.svg").write_text(
            '<?xml version="1.0"?>\n<svg width="10pt" height="5pt" viewBox="0 0 10 5" xmlns="http://www.w3.org/2000/svg">'
            '<metadata>x</metadata><defs><path id="m1" d="M0 0"/></defs>'
            '<g id="figure_1"><g id="text_1"><!-- 라벨 --><use xlink:href="#m1"/></g>'
            '<g clip-path="url(#p9)"></g></g></svg>', encoding="utf-8")
        page, _, data = self.page()
        self.assertIn('id="s3-figure_1" data-id="figure_1"', page)
        self.assertIn('xlink:href="#s3-m1"', page)
        self.assertIn("url(#s3-p9)", page)
        self.assertNotIn("<metadata>", page)
        self.assertNotIn('width="10pt"', page)
        self.assertIn("<!-- 라벨 -->", page)   # text of each label stays for selectors
        self.assertIn("f01.svg", data[3]["sel"])

    def test_missing_figure_still_writes_page(self):
        (self.dir / "figures" / "f01.png").unlink()
        out = self.dir / "out.html"
        self.assertEqual(main([str(self.md), "--out", str(out)]), 1)
        self.assertIn("파일 없음", out.read_text(encoding="utf-8"))

    def test_block_line_ranges(self):
        spans = [(b["kind"], b["line"], b["end"]) for b in self.blocks]
        self.assertEqual(spans[2], ("para", 6, 7))      # two source lines, one paragraph
        self.assertEqual(spans[3], ("figure", 9, 12))
        self.assertEqual(spans[4], ("table", 14, 16))
        self.assertEqual(spans[5], ("list", 18, 20))

    def test_page_without_serve_has_no_edit_mode(self):
        page, _, data = self.page()
        self.assertIn("const EDITABLE = false;", page)
        self.assertNotIn('<button type="button" data-mode="edit">', page)
        self.assertNotIn("src", data[2])

    def test_apply_edit_replaces_only_that_block(self):
        para = "첫 문단은 **굵게**와 `코드`와 [링크 `a.md`](a.md)를\n두 줄에 걸쳐 쓴다. 그림 1을 본다."
        ok, at = apply_edit(self.md, 6, para, "고친 문단.")
        self.assertEqual((ok, at), (True, 6))
        text = self.md.read_text(encoding="utf-8")
        self.assertIn("\n고친 문단.\n\n> **[그림 1 자리]**", text)
        self.assertTrue(text.endswith("다음 문단.\n"))

    def test_apply_edit_follows_a_moved_block_and_refuses_a_changed_one(self):
        self.md.write_text("머리 한 줄 더.\n\n" + self.md.read_text(encoding="utf-8"), encoding="utf-8")
        ok, at = apply_edit(self.md, 25, "세부 문단.", "새 세부 문단.")   # stale line number
        self.assertEqual((ok, at), (True, 26))
        ok, _ = apply_edit(self.md, 26, "세부 문단.", "또 고침.")       # already changed
        self.assertFalse(ok)
        self.assertIn("새 세부 문단.", self.md.read_text(encoding="utf-8"))

    def test_apply_edit_keeps_crlf(self):
        self.md.write_bytes(self.md.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
        self.assertTrue(apply_edit(self.md, 25, "세부 문단.", "가\n나")[0])
        raw = self.md.read_bytes()
        self.assertIn("가\r\n나\r\n".encode(), raw)
        self.assertNotIn(b"\r\r", raw)
        self.assertEqual(raw.count(b"\n"), raw.count(b"\r\n"))

    def test_server_page_and_edit(self):
        httpd = make_server(self.md, 0, None, "ko", False)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        port = httpd.server_address[1]
        try:
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            c.request("GET", "/")
            page = c.getresponse().read().decode()
            self.assertIn("const EDITABLE = true;", page)
            self.assertIn('<button type="button" data-mode="edit">', page)
            body = json.dumps({"line": 25, "old": "세부 문단.", "new": "서버로 고침."})
            c.request("POST", "/edit", body, {"Content-Type": "text/plain"})
            self.assertEqual(c.getresponse().status, 415)       # a plain form post cannot write
            c.request("POST", "/edit", body, {"Content-Type": "application/json", "Origin": "http://evil.test"})
            self.assertEqual(c.getresponse().status, 403)
            c.request("POST", "/edit", body, {"Content-Type": "application/json"})
            r = c.getresponse()
            self.assertEqual((r.status, json.loads(r.read())["ok"]), (200, True))
            self.assertIn("서버로 고침.", self.md.read_text(encoding="utf-8"))
            c.request("POST", "/edit", body, {"Content-Type": "application/json"})
            r = c.getresponse()
            self.assertEqual(r.status, 409)
            r.read()
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_main_default_out(self):
        self.assertEqual(main([str(self.md)]), 0)
        self.assertTrue(self.md.with_suffix(".html").is_file())


if __name__ == "__main__":
    unittest.main()
