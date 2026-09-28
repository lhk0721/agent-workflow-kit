#!/usr/bin/env python3
"""Tests for figure_refs.py. Run: python skills/report-figures/scripts/figure_refs_test.py"""

from __future__ import annotations

import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from figure_refs import caption_problem, check  # noqa: E402


class RefsTest(unittest.TestCase):
    def run_check(self, text: str):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "report.md"
            p.write_text(textwrap.dedent(text), encoding="utf-8")
            (Path(d) / "f.png").write_bytes(b"")
            return check(p)

    def test_caption_is_a_name(self):
        self.assertIsNone(caption_problem("두 번째 모델의 실수 예측 대 정답."))
        self.assertIsNone(caption_problem("band head."))
        self.assertEqual(caption_problem("정답 분포. 소수점이 붙는다."), "두 문장 이상이다")
        self.assertEqual(caption_problem("예측은 가운데로 몰립니다."), "문장으로 끝난다")

    def test_good_manuscript_passes(self):
        fails, warns = self.run_check("""
            그림 1에서 보듯 단계마다 올라 0.4829에서 0.5179가 됐습니다. 세로축은 0.475에서 시작합니다.

            > **[그림 1 자리]** 파일 `f.png`
            > 그림 1. 다섯 단계의 composite.
            > 요점: 단계마다 올라 0.4829에서 0.5179가 됐다.
            > 본문에 쓸 것: 세로축은 0.475에서 시작한다.

            ## 그림 목록

            | 그림 2 | 이 줄은 본문이 아니다 |
        """)
        self.assertEqual(fails, [])
        self.assertEqual(warns, [])

    def test_problems_found(self):
        fails, warns = self.run_check("""
            본문은 그림을 가리키지 않는다. 0.4829만 적는다.

            > **[그림 1 자리]** 파일 `f.png`
            > 그림 1. 다섯 단계의 composite. 단계마다 올랐습니다.

            > **[그림 2 자리]** 파일 `f.png`
            > 그림 2. 층별 성적.
            > 요점: 40층이 0.5021로 가장 높다.

            그림 2를 여기서야 말한다.

            ## 그림 목록

            | 그림 1 | 목록의 언급은 세지 않는다 |
        """)
        text = "\n".join(fails)
        self.assertIn("캡션은 이름만", text)
        self.assertIn("요점 줄이 없다", text)
        self.assertIn("그림 1을(를) 가리키지 않는다", text)
        self.assertEqual(len(fails), 3)
        wtext = "\n".join(warns)
        self.assertIn("그림 뒤", wtext)
        self.assertIn("0.5021", wtext)


if __name__ == "__main__":
    unittest.main(verbosity=1)
