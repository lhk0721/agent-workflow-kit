#!/usr/bin/env python3
"""Tests for check.py document-level checks (9-12). Run: python skills/ko-writing/scripts/check_test.py"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from check import (  # noqa: E402
    check_demonstratives, check_facts, check_glossary, check_legend_placement,
    check_shorten_signals, classify_lines, dem_stem, paragraphs,
)

MANUSCRIPT = """
## 1. 개요

### 1-1. 모델 개요

점수는 선형 회귀 head가 hidden state를 받아 계산한다. 이 회귀 head를 band head라고 부른다.
그러나 이 채점자들이 어떤 글에 몇 점을 주는지는 학습 데이터에만 있다.

첫 번째 모델 0.2671에서 최종 모델 0.5179까지 올랐다. 세 번째 모델은 0.5103을 냈다.
P는 0.922로 문턱을 넘었다.

그림 3은 예측과 정답이다. 가로선은 사사오입 경계이고, 대각선은 정답과 같은 자리다. 같은 경계 사이의 점은 동점이 된다.

> 그림 3. 예측 대 정답.
> 요점: 경계 사이의 점은 동점이 된다.

### 1-2. 평가 지표

사람 채점자 세 명이 점수를 매긴다. 이 채점자들의 평균이 정답이다. 이 결과로 순서가 정해진다.
프롬프트 채점은 60편에서 0.315이고 두 번째 모델은 400편에서 0.4829이다. 마지막 층 0.4829는
band head보다 낮다. 추가
데이터는 9,599편이다.

### 1-3. 판정

P는 bootstrap에서 새 방법이 이긴 비율이다. 문턱은 0.90이다.
"""

TERMS = """
| 표기 | 뜻 | 쓰지 않을 말 | 정의 위치 |
|---|---|---|---|
| band head | 층마다 릿지로 점수를 계산해 평균하는 부품 | 회귀 head, 선형 회귀 head, head | 1-1 |
| P | 새 방법이 이긴 비율 | | 1-3 |
| 추가 데이터 | 공개 말뭉치의 9,599편 | | 1-2 |
| 문턱 | 채택에 필요한 P의 하한 | | 판정 |
"""

FACTS = """
| 대상 | 지표 | 값 | 표본 | 조건 | 재료 위치 |
|---|---|---|---|---|---|
| 첫 번째 모델 | composite | 0.2671 | 검증 400편 | | 표 2 |
| 세 번째 모델 | composite | 0.4972 | 검증 400편 | | 표 2 |
| 최종 모델 | composite | 0.5179 | 검증 400편 | | 1절 |
| 두 번째 모델 | composite | 0.4829 | 검증 400편 | | 표 2 |
| 마지막 층 | composite | 0.4829 | 검증 400편 | | 4-4 |
| 프롬프트 채점 | composite | 0.315 | 60편 | | 4-4 |
"""


def lines_of(text: str):
    return classify_lines(textwrap.dedent(text))


class StemTest(unittest.TestCase):
    def test_stem(self):
        self.assertEqual(dem_stem("채점자들이"), "채점자")
        self.assertEqual(dem_stem("채점자들이라면"), "채점자")
        self.assertEqual(dem_stem("차이는"), "차이")
        self.assertEqual(dem_stem("차이"), "차이")
        self.assertEqual(dem_stem("기대를"), "기대")
        self.assertEqual(dem_stem("글들을"), "글")


class DemonstrativeTest(unittest.TestCase):
    def test_dangling_is_flagged_and_introduced_is_not(self):
        hits = check_demonstratives(lines_of(MANUSCRIPT))
        phrases = [(i, p) for i, p, _ in hits]
        # 1-1의 "이 채점자들이"는 앞에 채점자가 없다
        self.assertIn((7, "이 채점자들이"), phrases)
        # 1-2의 "이 채점자들의"는 바로 앞 문장이 채점자를 소개했다
        self.assertNotIn("이 채점자들의", [p for _, p in phrases])
        # 요약 명사와 같은 문단 앞에서 나온 명사는 세지 않는다
        self.assertNotIn("이 결과로", [p for _, p in phrases])
        self.assertNotIn("이 회귀", [p for _, p in phrases])

    def test_quotes_and_particles_are_not_demonstratives(self):
        text = '원고에서 "이 채점자들"이 나왔다. 규칙은 `이 값`을 본다.\n'
        self.assertEqual(check_demonstratives(lines_of(text)), [])

    def test_heading_before_window_counts(self):
        text = "## 콜드 리더 검토\n\n이 검토는 새 subagent가 한다.\n"
        self.assertEqual(check_demonstratives(lines_of(text)), [])

    def test_window(self):
        text = "채점자가 있다.\n\n가.\n\n나.\n\n다.\n\n이 채점자들이 본다.\n"
        self.assertEqual(len(check_demonstratives(lines_of(text), window=3)), 1)
        self.assertEqual(check_demonstratives(lines_of(text), window=4), [])


class LegendTest(unittest.TestCase):
    def test_legend_between_claim_and_conclusion(self):
        hits = check_legend_placement(lines_of(MANUSCRIPT))
        self.assertEqual(len(hits), 1)
        self.assertTrue(hits[0][1].startswith("가로선은"))

    def test_legend_at_end_is_fine(self):
        text = "그림 1은 성적이다. 단계마다 올랐다. 파란 점이 최종 모델이다. 점선은 기준이다.\n"
        self.assertEqual(check_legend_placement(lines_of(text)), [])


LONG_DRAFT = """
## 2. 모델

### 2-1. 구조

결합 검출기는 두 부분을 묶는다(1-1). 본 시험은 학습과 같은 생성기로 만들어 실제 성능이 아니다.
문턱을 정한 방법은 2-2에 적는다. 2026-10-03에 처음 쟀고 2026-10-05에 다시 쟀다.

### 2-2. 평가

본 시험은 학습과 같은 생성기로 만들어 실제 성능이 아니다. 이 값은 0.809이고 기준선은 0.738이다.
오경보를 같게 맞춘 비교는 하지 않았다. 지름 8~24px 띠는 세지 않았다.

### 2-3. 결과

본 시험은 학습과 같은 생성기로 만들어 실제 성능이 아니다. 3호기의 하락 원인은 가르지 않았다.
합성 평가의 AP는 0.694에서 0.970으로 올랐다(2-3~2-5).

### 2-4. 한계

본 시험은 학습과 같은 생성기로 만들어 실제 성능이 아니다. 실제 비금속 이물은 재지 못했다.
"""


class ShortenSignalTest(unittest.TestCase):
    def test_signals(self):
        lines = lines_of(LONG_DRAFT)
        s = check_shorten_signals(lines, paragraphs(lines))
        refs = [r for _, r in s["refs"]]
        # "(1-1)", "2-2에", "2-3~2-5" 안의 둘. 날짜의 "10-03"과 "8~24px"는 아니다
        self.assertEqual(sorted(refs), ["1-1", "2-2", "2-3", "2-5"])
        self.assertEqual([d for _, d in s["dates"]], ["2026-10-03", "2026-10-05"])
        # "하지 않았다", "세지 않았다", "가르지 않았다", "재지 못했다"
        self.assertEqual(len(s["unmeasured"]), 4)
        self.assertGreater(s["numbers"], 10)
        # "실제 성능이 아니다" 네 문장이 단서 문장이다
        self.assertEqual(len(s["hedges"]), 4)
        # 같은 단서 문장이 네 문단에 되풀이된다
        self.assertTrue(s["repeats"])
        phrase, paras_ = s["repeats"][0]
        self.assertIn("같은생성기로만들어", phrase)
        self.assertEqual(len(paras_), 4)


class LedgerTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        d = Path(self.dir.name)
        self.terms = d / "terms.md"
        self.facts = d / "facts.md"
        self.doc = d / "doc.md"
        self.terms.write_text(TERMS, encoding="utf-8")
        self.facts.write_text(FACTS, encoding="utf-8")
        self.doc.write_text(textwrap.dedent(MANUSCRIPT), encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def test_glossary(self):
        g = check_glossary(lines_of(MANUSCRIPT), str(self.terms))
        early = {t: (first, d) for t, first, _, d in g["early"]}
        # P는 1-3에서 정의하는데 1-1에서 먼저 쓴다
        self.assertIn("P", early)
        self.assertLess(early["P"][0], early["P"][1])
        # band head는 정의 절에서 처음 나온다
        self.assertNotIn("band head", early)
        # 줄바꿈에 걸친 "추가\n데이터"도 정의 절 안에서 찾는다
        self.assertNotIn(("추가 데이터", "1-2"), g["nodef"])
        # 헤딩 글자로 찾은 절("판정")
        self.assertEqual(g["nosec"], [])
        aliases = [(a, t) for _, a, t, _ in g["alias"]]
        self.assertIn(("선형 회귀 head", "band head"), aliases)
        self.assertIn(("회귀 head", "band head"), aliases)
        # "band head" 속의 "head" 두 곳은 별칭이 아니다. 남는 것은 "선형 회귀 head", "이 회귀 head"
        self.assertEqual(len([a for _, a, _, _ in g["alias"] if a == "head"]), 2)

    def test_facts(self):
        f = check_facts(lines_of(MANUSCRIPT), str(self.facts))
        mism = [(n, x) for _, n, x, _, _ in f["mismatch"]]
        self.assertIn(("세 번째 모델", "0.5103"), mism)
        self.assertNotIn(("첫 번째 모델", "0.2671"), mism)
        self.assertNotIn("최종 모델", [n for n, _ in mism])
        self.assertIn(("0.4829", ["두 번째 모델", "마지막 층"]), f["dup"])
        self.assertIn(("0.4829", ["두 번째 모델", "마지막 층"]), f["shared"])
        self.assertEqual(len(f["mixed"]), 1)
        self.assertEqual(set(f["mixed"][0][1]), {"60편", "검증 400편"})
        self.assertIn("0.922", [x for _, x in f["unlisted"]])

    def test_cli_keeps_old_sections_and_adds_new(self):
        env = dict(os.environ, PYTHONUTF8="1")
        run = lambda *a: subprocess.run([sys.executable, str(HERE / "check.py"), str(self.doc), *a],
                                        capture_output=True, text=True, encoding="utf-8", env=env)
        plain = run()
        self.assertEqual(plain.returncode, 0, plain.stderr)
        for h in ("## 1. 금지 패턴", "## 8.", "## 9. 지시어", "## 10.", "## 11.", "## 12.", "## 13. 줄이기 신호"):
            self.assertIn(h, plain.stdout)
        self.assertIn("건너뜀 (--glossary", plain.stdout)
        full = run("--glossary", str(self.terms), "--facts", str(self.facts))
        self.assertEqual(full.returncode, 0, full.stderr)
        self.assertIn("정의 전 사용: 'P'", full.stdout)
        self.assertIn("값 불일치", full.stdout)
        scoped = run("--from", "### 1-2")
        self.assertIn("파일 줄 번호는", scoped.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=1)
