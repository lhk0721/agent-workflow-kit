#!/usr/bin/env python3
"""Tests for figcheck.py. Run: python skills/report-figures/scripts/figcheck_test.py"""

from __future__ import annotations

import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from figcheck import Checker, is_gray, sentence_problem  # noqa: E402


def check(src: str) -> Checker:
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(textwrap.dedent(src))
    c = Checker(Path(f.name))
    c.run()
    Path(f.name).unlink()
    return c


class SentenceTest(unittest.TestCase):
    def test_labels_pass(self):
        for s in ["composite", "편당 처리 시간 (초)", "정답", "상수 모델 0.1323", "24~48층 평균 {}",
                  "Judge 평균 점수", "gemma 12B  {}", "Validation (Qwen3.6-35B-A3B)", "latency (s)"]:
            self.assertIsNone(sentence_problem(s), s)

    def test_sentences_fail(self):
        for s in [
            "정답 점수는 채점자 평균이라 소수점이 붙는다",
            "관찰을 먼저 모으는 방식이 확정 점수 방식보다 낮습니다.",
            "Bigger backbones do not help.",
            "head를 맞춘 편 수. 파랑은 4비트 특징이라 두 계열은 직접 비교하지 않는다",
            "학습 데이터 LOO (어댑터가 정답을 학습한 값이라 부풀려짐)",
            "one two three four five six seven eight nine",
        ]:
            self.assertIsNotNone(sentence_problem(s), s)

    def test_each_line_checked(self):
        self.assertIsNone(sentence_problem("최종 모델\n0.5179"))
        self.assertIsNotNone(sentence_problem("최종 모델\n(새 글 9,599편으로 재학습한 것)"))


class GrayTest(unittest.TestCase):
    def test_gray(self):
        for c in ["#333333", "#c3c2b7", "#fcfcfb", "#fff", "black", "0.6", "C0", "none"]:
            self.assertTrue(is_gray(c), c)

    def test_colour(self):
        for c in ["#2a78d6", "#eb6834", "tab:blue", "red", "#1baf7a"]:
            self.assertFalse(is_gray(c), c)


class ScriptTest(unittest.TestCase):
    def test_title_sentence_and_constant_colour(self):
        c = check('''
            BLUE = "#2a78d6"
            GRAY = "#8c8c8c"
            def fig(ax):
                ax.bar([1, 2], [3, 4], color=BLUE)
                ax.plot([1], [2], color=GRAY, label="예측")
                ax.set_title("예측은 가운데로 몰린다")
        ''')
        msgs = " ".join(m for _, m in c.fails)
        self.assertIn("non-gray colour '#2a78d6'", msgs)
        self.assertIn("set_title", msgs)
        self.assertEqual(len(c.fails), 2)

    def test_dict_and_comprehension_colours(self):
        c = check('''
            PAL = {"a": "#2a78d6", "b": "#333333"}
            def fig(ax, keys):
                ax.bar(keys, [1, 2], color=[PAL[k] for k in keys])
        ''')
        self.assertEqual(len(c.fails), 1)

    def test_diagram_marker_allows_colour(self):
        c = check('''
            def fig(ax):
                """figcheck: diagram"""
                ax.add_patch(box(facecolor="#dbe9fb", edgecolor="#2a78d6"))
                ax.text(0, 0, "band head")
        ''')
        self.assertEqual(c.fails, [])

    def test_fstring_and_labels(self):
        c = check('''
            def fig(ax, med):
                ax.text(med, 1, f"중앙값 {med:.1f}초")
                ax.set_xticklabels(["학습 전", "학습 후는 동률이다"])
        ''')
        self.assertEqual(len(c.fails), 1)
        self.assertIn("set_xticklabels", c.fails[0][1])

    def test_warnings(self):
        c = check('''
            def fig(ax):
                ax.barh(["a"], [1], color="#333333")
                ax.set_xlim(0.47, 0.52)
            def ok(ax):
                ax.bar([1], [1])
                ax.set_ylim(0, 1)
            def hist_x_range_is_fine(ax):
                ax.hist([1, 2, 3])
                ax.set_xlim(0.9, 5.1)
        ''')
        self.assertEqual(c.fails, [])
        kinds = sorted(m.split(" ")[0] for _, m in c.warns)
        self.assertEqual(kinds, ["bars", "horizontal"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
