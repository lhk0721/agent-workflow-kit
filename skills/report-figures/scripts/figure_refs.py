#!/usr/bin/env python3
"""Check that a manuscript's figures and its body text answer each other.

agent-workflow-kit — system-owned. Stdlib only.

    python figure_refs.py report.md [--stop "## 그림 목록"]

Each figure or table block in the manuscript (see figure_sheet.py) should look like

    > **[그림 3 자리]** 파일 `figures/f02.png`
    > 그림 3. 두 번째 모델의 실수 예측 대 정답.
    > 요점: 사사오입 경계 사이의 점들은 정수로 바뀌면 동점이 된다.
    > 본문에 쓸 것: 가로선이 사사오입 경계이고, 대각선은 예측이 정답과 같은 자리다.

The caption is the figure's name only; the claim ("요점" / "Claim") and the reading
notes ("본문에 쓸 것" / "In text") are working lines for whoever writes the body and are
not pasted into the document.

FAIL (exit 1)
  - the caption carries more than a name: a second sentence or a sentence ending
  - the block has no claim line
  - the body never mentions the figure ("그림 3", "표 2", "Figure 3", "Table 2")
WARN
  - the body first mentions the figure only after the figure's block
  - a number in the claim or the reading notes does not appear in the body
The body is the manuscript outside blockquotes, up to the first heading that matches
--stop (default: a heading containing "그림 목록", "Figure list" or "List of figures"),
so a figure list at the end does not count as a mention.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from figure_sheet import from_markdown  # noqa: E402

DEFAULT_STOP = r"^#+ .*(그림 목록|Figure list|List of figures)"
SENTENCE_END = re.compile(r"(다|요|니다|습니다)\.?$")
NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def body_lines(lines: list[str], stop: str) -> list[tuple[int, str]]:
    out = []
    for n, ln in enumerate(lines, 1):
        if re.match(stop, ln):
            break
        if not ln.startswith(">"):
            out.append((n, ln))
    return out


def mention_re(label: str) -> re.Pattern:
    kind, num = re.match(r"(\S+)\s*(\S+)", label).groups()
    return re.compile(rf"{re.escape(kind)}\s*{re.escape(num)}(?![\d.])")


def caption_problem(caption: str) -> str | None:
    text = caption.strip().rstrip(".")
    if re.search(r"[.!?]\s+\S", caption.strip()):
        return "두 문장 이상이다"
    if SENTENCE_END.search(text):
        return "문장으로 끝난다"
    return None


def numbers(text: str) -> set[str]:
    # 1~2자리 정수는 순서나 개수라 흔해서 뺀다. 소수와 세 자리 이상만 대조한다.
    return {n for n in NUMBER.findall(text or "") if "." in n or "," in n or len(n) >= 3}


def check(path: Path, stop: str = DEFAULT_STOP) -> tuple[list[str], list[str]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    body = body_lines(lines, stop)
    body_text = "\n".join(t for _, t in body)
    fails, warns = [], []
    for fig in from_markdown(path):
        label = fig.get("label")
        where = f"{path.name}:{fig.get('line')} {label or Path(fig['file']).name}"
        why = caption_problem(fig["caption"])
        if why:
            fails.append(f"{where}: 캡션은 이름만 둔다 — {why}: {fig['caption']!r}")
        if not fig.get("claim"):
            fails.append(f"{where}: 요점 줄이 없다")
        if not label:
            continue
        hits = [n for n, t in body if mention_re(label).search(t)]
        if not hits:
            fails.append(f"{where}: 본문이 {label}을(를) 가리키지 않는다")
        elif min(hits) > fig["line"]:
            warns.append(f"{where}: 본문이 {label}을(를) 그림 뒤({min(hits)}행)에서야 처음 가리킨다")
        missing = sorted((numbers(fig.get("claim")) | numbers(fig.get("notes"))) - numbers(body_text))
        if missing:
            warns.append(f"{where}: 요점·본문에 쓸 것의 숫자가 본문에 없다: {', '.join(missing)}")
    return fails, warns


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows 콘솔(cp949)에서 한글 경고가 깨지지 않게
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("markdown", type=Path)
    ap.add_argument("--stop", default=DEFAULT_STOP, help="regex of the heading where the body ends")
    a = ap.parse_args(argv)
    fails, warns = check(a.markdown, a.stop)
    for f in fails:
        print(f"FAIL {f}")
    for w in warns:
        print(f"WARN {w}")
    print(f"{a.markdown}: {len(fails)} fail, {len(warns)} warn")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
