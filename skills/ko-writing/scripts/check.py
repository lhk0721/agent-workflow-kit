#!/usr/bin/env python3
"""ko-writing 기계 검사.

사람 눈으로 진단하기 전에 0/1로 셀 수 있는 것만 센다. 판단은 하지 않는다.

  python check.py 문서.md
  python check.py 문서.md --heading 25 --para 6 --from "## 표지" --to "## 그림 목록"

검사 항목
  1. 금지 패턴: 엠대시, 문장 속 가운뎃점, 세미콜론, "~를 통해", "~에 대한", "~것 같다",
     "~인 셈", "결론적으로", "되어진", 느낌표, 이모지
  2. 빈도 패턴: "~할 수 있다", "또한/따라서/즉"으로 시작하는 문단
  3. 종결어미 혼용: 해라체(~다.) / 하십시오체(~니다.) / 해요체(~요.)
  4. 문단 문장 수: --para 초과
  5. 헤딩 길이: --heading 초과. 번호("3-1.", "2.")는 빼고 센다. 문장형 헤딩(~다, ~한가,
     ~는가, ~나, ~까로 끝남)도 여기서 센다
  6. 볼드 개수: 한 문단에 3개 이상
  7. 수량 후치: "물음 셋", "이유는 넷이다"처럼 수량이 명사 뒤에 붙은 자리
  8. 헤딩과 캡션 속 주장(경고): 헤딩과 "그림 n. 이름." 캡션 앞부분에서 관형절,
     의존명사 끝("~것", "~법"), 부정 대조("~아닌"), 수사 어휘, 숫자로 끝나는 헤딩.
     휴리스틱이라 사람이 판단한다

표, 코드 블록, 인용 블록(>), 목록 항목은 문단 계산에서 뺀다. 인용 블록은 금지
패턴 검사에서도 뺀다. 인용은 원문이기 때문이다.
"""
import argparse
import io
import re
import sys

BANNED = [
    ("엠대시", re.compile(r"—")),
    ("가운뎃점(문장 안)", re.compile(r"[가-힣]\s?·\s?[가-힣]")),
    ("세미콜론", re.compile(r";")),
    ("~를 통해", re.compile(r"[을를] 통해")),
    ("~에 대한/대해", re.compile(r"에 대(한|해|하여)")),
    ("~에 있어서", re.compile(r"에 있어서")),
    ("~와 관련하여", re.compile(r"[와과] 관련(하여|해)")),
    ("~을 제공한다", re.compile(r"[을를] 제공(한다|합니다)")),
    ("~를 가능하게", re.compile(r"가능하게 (한다|합니다)")),
    ("~것 같다", re.compile(r"것 같(다|습니다|아요)")),
    ("~인 셈", re.compile(r"인 셈")),
    ("결론적으로", re.compile(r"결론적으로")),
    ("~라고 할 수 있", re.compile(r"라고 할 수 있")),
    ("되어진/되어졌", re.compile(r"되어[진졌]")),
    ("아마", re.compile(r"(^|\s)아마\s")),
    ("느낌표", re.compile(r"!(?!\[)")),
    ("이모지", re.compile(r"[\U0001F300-\U0001FAFF☀-➿]")),
]
FREQ = [
    ("~할 수 있다", re.compile(r"수 있(다|습니다)")),
]
PARA_STARTERS = re.compile(r"^(또한|따라서|즉|그리고|하지만)[,\s]")
# 헤딩이 문장으로 끝나는가. 명사구 헤딩은 여기 안 걸린다.
HEADING_SENTENCE = re.compile(r"(다|[는인한은된던]가|나|까|니다|는지)$")
# 수량이 명사 뒤에 붙은 자리. "둘"은 대명사("다른 둘은")로 더 자주 쓰여 세지 않는다.
POSTPOSED_COUNT = re.compile(
    r"[가-힣]{2,}(은|는|이|가|을|를|도)? (셋|넷|다섯|여섯|일곱|여덟|아홉)"
    r"(이다|입니다|으로|이고|이었다|였다|이|을|를|은|는|[.,)])"
)

# 8. 헤딩 속 주장. 한국어 관형형을 형태소 분석 없이 어림한다.
# 의존명사로 끝나는 헤딩: "만든 것", "읽는 법"
HID_DEP_END = {"것", "법", "점", "곳", "셈", "바", "데", "수"}
# 이 모양으로 끝나는 어절은 관형형이다: "지키는", "따른", "아닌", "쓸 수 없는"
HID_ADN_SUFFIX = ("는", "던", "아닌", "없는", "있는", "않은", "따른", "위한", "대한", "통한")
HID_ADN_WORD = {"할", "될", "볼", "쓸"}
HID_NOT_ADN = {"또는"}
# 상황 이름 헤딩("~할 때", "~하는 경우")은 주장이 아니다
HID_SITUATION_END = {"때", "경우"}
# 조사로 끝난 어절 바로 뒤에서 받침 ㄴ/ㄹ로 끝나는 어절은 관형형일 가능성이 높다:
# "소수점이 붙은", "성적을 올린", "X로 고른"
HID_PARTICLE = re.compile(r"(을|를|이|으로|로|지)$")
# 받침 ㄴ/ㄹ로 끝나는 흔한 명사. 조사 뒤에 와도 관형형이 아니다
HID_NOUN_NL = {"확인", "변환", "전환", "설명", "판단", "보완", "개선", "선정", "조정", "분산",
               "기준", "수준", "원인", "요인", "결론", "방안", "조건", "시간", "구간", "문단",
               "평균", "같은", "설계", "실험", "결정", "선택", "일", "안", "본", "편"}
HID_POETIC = re.compile(r"(흔적|물음|여정|거친|거쳐 온|퍼짐|한눈에|읽는 법|너머|민낯|속살|열쇠)")
# 헤딩 끝의 큰 수: "새 글 9,000편". "3개", "0안"처럼 작은 수는 세지 않는다
HID_NUM_END = re.compile(r"\s(\d{1,3}(,\d{3})+|\d{3,})[가-힣]{0,2}$")
CAPTION_LABEL = re.compile(r"(?:^|\s)(?:그림|표)\s*\d+\.\s*([^.]+?)\.(?:\s|$)")


def jong(ch):
    """글자의 받침 번호. 0은 받침 없음, 4는 ㄴ, 8은 ㄹ."""
    if not ("가" <= ch <= "힣"):
        return -1
    return (ord(ch) - 0xAC00) % 28


def hidden_claim(title, heading=True):
    """주장이 든 헤딩이면 이유 목록을, 아니면 빈 목록을 돌려준다.

    캡션 앞부분은 "기준선을 이긴 확률"처럼 무엇을 그렸는지 풀어 쓴 관형절이 흔해서
    조사 뒤 관형형 규칙을 헤딩에만 쓴다. 대시로 이은 헤딩은 조각마다 본다.
    """
    title = re.sub(r"\s*\([^)]*\)\s*$", "", title).strip()
    segments = [t.strip() for t in re.split(r"\s[—–-]\s|:\s", title) if t.strip()]
    # 문장형 헤딩은 5번에서 이미 센다. 주제 조사 "는"("데이터는")을 관형형으로 잘못
    # 세지 않으려고 문장 조각이 있으면 뺀다
    if any(HEADING_SENTENCE.search(t.rstrip(".?")) for t in segments):
        return []
    why = []
    for seg in segments:
        words = [re.sub(r"[^\w가-힣.,~\-]", "", w) for w in seg.split()]
        words = [w for w in words if w]
        if words and words[-1] in HID_SITUATION_END:
            continue
        if len(words) >= 2 and words[-1] in HID_DEP_END and "의존명사 끝" not in why:
            why.append("의존명사 끝")
        for k, w in enumerate(words[:-1]):
            # "할 일", "남은 일"은 관례 헤딩이다
            if words[-1] == "일" and k == len(words) - 2:
                break
            # 쉼표 앞 "는"은 주제 조사다("주제는 9개, ...")
            # 수 앞의 "는"은 주제 조사다("주제는 9개")
            if w.endswith(",") or w in HID_NOT_ADN or words[k + 1][:1].isdigit():
                continue
            if w.endswith(HID_ADN_SUFFIX) or w in HID_ADN_WORD:
                why.append(f"관형절 '{w}'")
                break
            # 목적격 조사로 끝난 어절("점수를")은 받침 ㄹ이어도 관형형이 아니다
            ends_obj = w.endswith(("을", "를"))
            if (heading and k > 0 and HID_PARTICLE.search(words[k - 1]) and len(w) >= 2
                    and not ends_obj and w not in HID_NOUN_NL and jong(w[-1]) in (4, 8)):
                why.append(f"관형절 '{words[k - 1]} {w}'")
                break
    if HID_POETIC.search(title):
        why.append("수사 어휘")
    if HID_NUM_END.search(title):
        why.append("숫자로 끝남")
    return why


END_DA = re.compile(r"\S{0,2}다[.)]")
END_HAEYO = re.compile(r"[요죠][.)]")


def has_bieup(ch):
    """글자의 받침이 ㅂ인가. 합니다·입니다·습니다의 앞 글자가 전부 여기 해당한다."""
    if not ("가" <= ch <= "힣"):
        return False
    return (ord(ch) - 0xAC00) % 28 == 17


def split_endings(p):
    """문단 안의 `~다.`를 해라체와 하십시오체로 가른다. '아니다.'는 해라체다."""
    haera, hasipsio = [], []
    for m in END_DA.finditer(p):
        s = m.group(0)
        if s[-2:-1] == "다" and len(s) >= 4 and s[-3] == "니" and has_bieup(s[-4]):
            hasipsio.append(m)
        else:
            haera.append(m)
    return haera, hasipsio
SENT_END = re.compile(r"(?<!\d)[.?!](?!\d)(?=\s|$)")
HEADING_NUM = re.compile(r"^[\d\-.]+\s*")


def slice_body(text, start, end):
    if start:
        i = text.find(start)
        if i >= 0:
            text = text[i:]
    if end:
        j = text.find(end)
        if j >= 0:
            text = text[:j]
    return text


def classify_lines(text):
    """줄마다 (kind, line). kind는 heading / table / quote / list / code / text."""
    out = []
    in_code = False
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("```"):
            in_code = not in_code
            out.append(("code", line))
            continue
        if in_code:
            out.append(("code", line))
        elif s.startswith("#"):
            out.append(("heading", line))
        elif s.startswith("|"):
            out.append(("table", line))
        elif s.startswith(">"):
            out.append(("quote", line))
        elif re.match(r"^(\s*[-*+]\s|\s*\d+\.\s)", line):
            out.append(("list", line))
        else:
            out.append(("text", line))
    return out


def paragraphs(lines):
    """text 줄만 빈 줄로 묶어 문단으로. (시작 줄번호, 본문)"""
    paras = []
    buf = []
    start = None
    for i, (kind, line) in enumerate(lines, 1):
        if kind == "text" and line.strip():
            if not buf:
                start = i
            buf.append(line.strip())
        else:
            if buf:
                paras.append((start, " ".join(buf)))
                buf = []
    if buf:
        paras.append((start, " ".join(buf)))
    return paras


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--heading", type=int, default=15, help="헤딩 글자 수 상한 (기본 15, 외부 보고서 25)")
    ap.add_argument("--para", type=int, default=6, help="문단 문장 수 상한 (기본 6)")
    ap.add_argument("--from", dest="start", default=None, help="이 문자열부터 검사")
    ap.add_argument("--to", dest="end", default=None, help="이 문자열 앞까지 검사")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass

    text = io.open(args.file, encoding="utf-8").read()
    text = slice_body(text, args.start, args.end)
    lines = classify_lines(text)
    checkable = [(i, l) for i, (k, l) in enumerate(lines, 1) if k in ("text", "list", "heading", "table")]

    print(f"# 검사: {args.file}")
    if args.start or args.end:
        print(f"범위: {args.start or '처음'} ~ {args.end or '끝'}")
    print()

    # 1. 금지 패턴
    print("## 1. 금지 패턴")
    total = 0
    for name, rx in BANNED:
        hits = [(i, l) for i, l in checkable if rx.search(l)]
        if hits:
            total += len(hits)
            print(f"- {name}: {len(hits)}건")
            for i, l in hits[:5]:
                print(f"    {i}: {l.strip()[:70]}")
            if len(hits) > 5:
                print(f"    ... 외 {len(hits) - 5}건")
    if total == 0:
        print("- 없음")
    print()

    # 2. 빈도 패턴
    print("## 2. 빈도 패턴")
    body_chars = sum(len(re.sub(r"\s", "", l)) for _, l in checkable)
    for name, rx in FREQ:
        n = sum(len(rx.findall(l)) for _, l in checkable)
        per = n / body_chars * 1000 if body_chars else 0
        print(f"- {name}: {n}건 (1,000자당 {per:.1f})")
    paras = paragraphs(lines)
    starters = [(i, p) for i, p in paras if PARA_STARTERS.match(p)]
    print(f"- 접속사로 시작하는 문단: {len(starters)}개 / {len(paras)}개")
    for i, p in starters[:5]:
        print(f"    {i}: {p[:40]}")
    print()

    # 3. 종결어미
    print("## 3. 종결어미 (본문 문단만)")
    kinds = {"해라체(~다.)": [0, []], "하십시오체(~니다.)": [0, []], "해요체(~요.)": [0, []]}
    for i, p in paras:
        h, s = split_endings(p)
        y = list(END_HAEYO.finditer(p))
        for name, ms in (("해라체(~다.)", h), ("하십시오체(~니다.)", s), ("해요체(~요.)", y)):
            kinds[name][0] += len(ms)
            if ms:
                kinds[name][1].append((i, p, ms[0]))
    for name, (n, _) in kinds.items():
        print(f"- {name}: {n}")
    present = [(name, n, hits) for name, (n, hits) in kinds.items() if n]
    if len(present) > 1:
        print(f"- 혼용: {' + '.join(name for name, _, _ in present)}")
        minor = min(present, key=lambda t: t[1])
        print(f"  소수 쪽 {minor[0]} 자리:")
        for i, p, m in minor[2][:8]:
            print(f"    {i}: ...{p[max(0, m.start() - 20):m.end()]}")
    else:
        print("- 통일됨")
    print()

    # 4. 문단 길이
    print(f"## 4. 문단 문장 수 ({args.para}문장 초과)")
    long = [(i, p, len(SENT_END.findall(p))) for i, p in paras if len(SENT_END.findall(p)) > args.para]
    if long:
        for i, p, n in long:
            print(f"- {i}: {n}문장. {p[:40]}")
    else:
        print("- 없음")
    print()

    # 5. 헤딩 길이와 형태
    print(f"## 5. 헤딩 ({args.heading}자 초과, 문장형)")
    over = []
    sentence = []
    for i, (k, l) in enumerate(lines, 1):
        if k != "heading":
            continue
        title = l.strip().lstrip("#").strip()
        title = HEADING_NUM.sub("", title)
        core = re.sub(r"\s*\([^)]*\)\s*$", "", title)
        n = len(title.replace(" ", ""))
        if n > args.heading:
            over.append((i, n, title))
        if HEADING_SENTENCE.search(core.rstrip(".?")):
            sentence.append((i, title))
    if over:
        for i, n, t in over:
            print(f"- {i}: {n}자. {t}")
    if sentence:
        print(f"- 문장형 헤딩 {len(sentence)}건 (명사구로 고친다)")
        for i, t in sentence:
            print(f"    {i}: {t}")
    if not over and not sentence:
        print("- 없음")
    print()

    # 6. 볼드
    print("## 6. 볼드 (한 문단 3개 이상)")
    bold = [(i, p, p.count("**") // 2) for i, p in paras if p.count("**") // 2 >= 3]
    if bold:
        for i, p, n in bold:
            print(f"- {i}: {n}개. {p[:40]}")
    else:
        print("- 없음")
    print()

    # 7. 수량 후치
    print("## 7. 수량 후치 (수량은 명사 앞에 둔다)")
    hits = [(i, l) for i, l in checkable if POSTPOSED_COUNT.search(l)]
    if hits:
        print(f"- {len(hits)}건")
        for i, l in hits[:8]:
            print(f"    {i}: {l.strip()[:70]}")
        if len(hits) > 8:
            print(f"    ... 외 {len(hits) - 8}건")
    else:
        print("- 없음")


    # 8. 헤딩과 캡션 속 주장
    print("## 8. 헤딩과 캡션 속 주장 (경고, 사람이 판단)")
    hid = []
    for i, (k, l) in enumerate(lines, 1):
        if k == "heading" and not l.lstrip().startswith("# "):
            title = HEADING_NUM.sub("", l.strip().lstrip("#").strip())
            why = hidden_claim(title)
            if why:
                hid.append((i, "헤딩", title, why))
        elif k in ("quote", "text", "list"):
            m = CAPTION_LABEL.search(l.replace("*", ""))
            if m:
                why = hidden_claim(m.group(1), heading=False)
                if why:
                    hid.append((i, "캡션", m.group(1), why))
    if hid:
        print(f"- {len(hid)}건. 주장은 본문 첫 문장으로 내리고 이름은 주제로 짓는다")
        for i, kind, t, why in hid:
            print(f"    {i}: [{kind}] {t}  ({', '.join(why)})")
    else:
        print("- 없음")


if __name__ == "__main__":
    main()
