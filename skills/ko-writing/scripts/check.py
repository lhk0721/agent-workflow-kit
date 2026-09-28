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

문서 단위 검사 (9~12). 문장 하나가 아니라 앞뒤 문단과 대장을 대조한다. 전부 경고다
  9. 지시어: "이 채점자들"처럼 "이/해당 + 명사"의 명사가 앞 세 문단(--dem-window)과
     같은 문단 앞부분에 없는 자리
 10. 그림 읽는 법 문장의 위치: "그림에서 파랑은", "점선은" 같은 문장이 문단 가운데에
     끼어 주장과 결론 사이를 끊는 자리
 11. 용어표 대조(--glossary 파일): 정의 절보다 앞에서 처음 쓴 용어, 쓰지 않을 말
 12. 사실 대장 대조(--facts 파일): 대상 이름 바로 뒤의 숫자가 대장 값과 다른 자리,
     한 숫자가 두 대상에 붙은 자리, 표본이 다른 숫자가 한 문단에 나란히 나온 자리,
     대장에 없는 소수
대장 형식은 references/ledgers.md, 템플릿은 assets/의 두 ledger 파일이다.
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


# ---------------------------------------------------------------------------
# 문서 단위 검사 (9~12)
#
# 한 문장만 봐서는 못 잡는 결함을 센다. 실제 기술서 원고에서 check.py 1~8은 거의
# 깨끗했는데 팀원이 "안 읽힌다"고 했고, 원고만 읽은 검토에서 나온 결함은 이랬다.
# 가리킬 대상이 없는 "이 채점자들", 정의 절보다 앞에서 쓴 용어, 한 부품의 이름 다섯
# 개, 절마다 다른 숫자, 60편과 400편 숫자의 직접 비교, 주장과 결론 사이에 끼어든
# 그림 범례 문장. 9~12는 그중 기계로 셀 수 있는 것만 센다. 전부 휴리스틱이라 경고다.

# 원고 작업용 줄. hwp에 붙지 않으므로 용어와 숫자 대조에서 뺀다(report-figures 관례)
WORKING_LINE = re.compile(r"^\s*>\s*(\*\*\[.*자리\]\*\*|요점\s*:|본문에 쓸 것\s*:)")
NUM = re.compile(r"(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?!\d)")


def blocks(lines):
    """빈 줄로 나눈 덩어리. [(kind, [(줄번호, 줄)])]. 코드와 작업용 줄은 뺀다."""
    out, cur, kind = [], [], None
    for i, (k, l) in enumerate(lines, 1):
        if k == "code" or not l.strip() or WORKING_LINE.match(l):
            if cur:
                out.append((kind, cur))
            cur, kind = [], None
            continue
        if k == "heading":
            if cur:
                out.append((kind, cur))
            out.append(("heading", [(i, l)]))
            cur, kind = [], None
            continue
        if not cur:
            kind = k
        cur.append((i, l.strip().lstrip(">").strip() if k == "quote" else l.strip()))
    if cur:
        out.append((kind, cur))
    return out


def joined(block):
    """덩어리의 줄을 공백으로 이은 글과, 글자 위치를 줄번호로 바꾸는 함수."""
    text, starts = "", []
    for i, l in block:
        if text:
            text += " "
        starts.append((len(text), i))
        text += l

    def line_at(pos):
        n = starts[0][1]
        for s, i in starts:
            if s <= pos:
                n = i
        return n
    return text, line_at


def sentences(p):
    out, last = [], 0
    for m in SENT_END.finditer(p):
        out.append(p[last:m.end()].strip())
        last = m.end()
    if p[last:].strip():
        out.append(p[last:].strip())
    return out


def norm_num(s):
    return s.replace(",", "")


def decimals(s):
    return len(s.split(".")[1]) if "." in s else 0


# 9. 지시어 ------------------------------------------------------------------
# 앞이 따옴표나 괄호면 지시어가 아니라 조사다('"이 채점자들"이 나왔다'의 뒤쪽 "이")
DEMONSTRATIVE = re.compile(r"(?<![가-힣A-Za-z0-9\"'”’)\]`])(이|해당)\s+([가-힣A-Za-z]+)")
# 인용 안의 지시어는 원문이다. 세지 않는다
QUOTED = re.compile(r"\"[^\"]*\"|“[^”]*”|'[^']*'|‘[^’]*’|`[^`]*`")
# 글 자신이나 글이 놓인 자리를 가리키는 말. 앞에 나오지 않아도 독자가 안다
DEM_SELF = {"글", "절", "장", "문서", "기술서", "보고서", "원고", "대회", "과제", "프로젝트",
            "연구", "스킬", "저장소", "책", "경우", "때", "뒤", "밖", "중", "외", "점", "정도"}
# 앞 문장 전체를 받는 요약 명사. "이 결과", "이 차이"는 앞에 같은 낱말이 없어도 읽힌다.
# 실제 원고에서 경고 14건 중 11건이 이 낱말이었다
DEM_SUMMARY = {"결과", "차이", "방식", "방법", "비교", "실험", "변경", "판정", "과정", "문제",
               "현상", "사실", "조건", "이유", "뜻", "범위", "구간", "데이터", "기준", "선택",
               "결정", "가정", "기대", "주장", "결론", "관찰", "경향", "손실", "효과", "이득",
               "계산", "수치", "숫자", "상태", "상황", "절차", "순서", "단계", "시험", "측정"}
# 명사가 아니라 수, 관형사, 부사가 온 자리
DEM_NOT_NOUN = {"한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열", "몇", "모든",
                "같은", "밖에", "때문에", "외에", "중", "모두", "둘", "셋", "넷"}
DEM_PARTICLES = sorted(["이라면", "라면", "인지", "이란", "에서는", "에서도", "에서", "으로는", "으로", "에게", "에는", "에도", "까지",
                        "부터", "보다", "처럼", "마다", "이라", "이다", "이고", "이며", "로는", "로",
                        "에", "이", "가", "을", "를", "은", "는", "의", "와", "과", "도", "만"],
                       key=len, reverse=True)


def dem_stem(word):
    """"채점자들이" → "채점자". 조사 하나와 "들"을 뗀다. "차이"의 "이"는 떼지 않는다."""
    for p in DEM_PARTICLES:
        if word.endswith(p) and len(word) > len(p):
            rest = word[:-len(p)]
            if len(rest) == 1 and p in ("이", "가"):
                break
            word = rest
            break
    if word.endswith("들") and len(word) > 1:
        word = word[:-1]
    return word


def check_demonstratives(lines, window=3):
    """앞 window개 문단과 같은 문단 앞부분에 없는 명사를 가리키는 "이 + 명사"."""
    bl = blocks(lines)
    prose = [n for n, (k, _) in enumerate(bl) if k in ("text", "list")]
    hits = []
    for pos, n in enumerate(prose):
        if bl[n][0] != "text":
            continue
        text, line_at = joined(bl[n][1])
        # 앞 window개 문단과 그 사이의 헤딩, 표, 인용까지 본다
        first = prose[pos - window - 1] + 1 if pos - window - 1 >= 0 else 0
        before = " ".join(joined(b)[0] for _, b in bl[first:n])
        quoted = [q.span() for q in QUOTED.finditer(text)]
        for m in DEMONSTRATIVE.finditer(text):
            word = m.group(2)
            # 수, 관형사, 서술어("이 나왔다")는 명사가 아니다
            if word in DEM_NOT_NOUN or word.endswith("다"):
                continue
            if any(s <= m.start() < e for s, e in quoted):
                continue
            stem = dem_stem(word)
            # "이 절이", "이 글이": 한 글자 명사 뒤의 "이"는 dem_stem이 떼지 않는다
            if stem[-1] in "이가" and stem[:-1] in DEM_SELF:
                continue
            if len(stem) < 2 or stem in DEM_SELF or stem in DEM_SUMMARY or stem.startswith("하나"):
                continue
            ctx = before + " " + text[:m.start()]
            if stem.lower() not in ctx.lower():
                hits.append((line_at(m.start()), f"{m.group(1)} {word}", stem))
    return hits


# 10. 그림 읽는 법 문장 -------------------------------------------------------
LEGEND = re.compile(
    r"^(그림에서|그림의|표에서)"
    r"|(파랑|파란|주황|빨강|빨간|초록|회색|검정|점선|실선|가로선|세로선|대각선|오차 막대|세로축|가로축|띠)"
    r"[^.]{0,6}?(은|는|이|가)\s")


def check_legend_placement(lines):
    """읽는 법 문장이 문단 처음이나 끝에 모여 있지 않고 가운데에 낀 문단."""
    hits = []
    for kind, block in blocks(lines):
        if kind != "text":
            continue
        text, line_at = joined(block)
        sents = sentences(text)
        flags = [bool(LEGEND.search(s)) for s in sents]
        for k, f in enumerate(flags):
            if f and not all(flags[:k]) and not all(flags[k + 1:]) and k + 1 < len(sents):
                hits.append((line_at(text.find(sents[k])), sents[k], sents[k + 1]))
    return hits


# 11. 용어표 ------------------------------------------------------------------
def read_table(path, need):
    """need 열이 전부 있는 첫 마크다운 표를 [{열: 값}]으로 읽는다. 백틱은 뗀다."""
    rows, header = [], None
    with io.open(path, encoding="utf-8") as fh:
        source = fh.read().splitlines()
    for line in source:
        s = line.strip()
        if not s.startswith("|"):
            if rows:
                break
            header = None
            continue
        cells = [c.strip().replace("`", "") for c in s.strip("|").split("|")]
        if header is None:
            if all(n in cells for n in need):
                header = cells
            continue
        if set(s) <= set("|-: "):
            continue
        row = dict(zip(header, cells))
        if any(row.get(n) for n in need):
            rows.append(row)
    return rows


def term_rx(t):
    """영문 표기는 낱말 경계, 한글 표기는 앞이 한글이 아닐 때만. 뒤는 조사가 붙으니 열어 둔다."""
    esc = re.escape(t)
    if re.fullmatch(r"[A-Za-z0-9 _.\-]+", t):
        return re.compile(r"(?<![A-Za-z0-9_])" + esc + r"(?![A-Za-z0-9_])")
    return re.compile(r"(?<![가-힣])" + esc)


def split_aliases(cell):
    return [a.strip() for a in re.split(r"[,，]", cell or "") if a.strip() and a.strip() != "-"]


def section_range(lines, where):
    """"1-4"나 헤딩 글자로 절을 찾아 (시작 줄, 끝 줄)을 돌려준다. 없으면 None."""
    heads = [(i, len(l.strip()) - len(l.strip().lstrip("#")), l.strip().lstrip("#").strip())
             for i, (k, l) in enumerate(lines, 1) if k == "heading"]
    numbered = re.fullmatch(r"[\d][\d.\-]*", where)
    for n, (i, lv, title) in enumerate(heads):
        hit = (re.match(re.escape(where) + r"[.\s]", title + " ") if numbered else where in title)
        if hit:
            end = len(lines)
            for j, lv2, _ in heads[n + 1:]:
                if lv2 <= lv:
                    end = j - 1
                    break
            return i, end
    return None


def check_glossary(lines, path):
    """줄이 아니라 덩어리 단위로 찾는다. 용어가 줄바꿈에 걸쳐도("추가
데이터") 잡힌다."""
    rows = [r for r in read_table(path, ["표기"]) if r.get("표기")]
    texts = [joined(b) for _, b in blocks(lines)]
    terms = [(r["표기"], term_rx(r["표기"])) for r in rows]
    out = {"early": [], "nodef": [], "alias": [], "nosec": []}
    for r in rows:
        t = r["표기"]
        rx = term_rx(t)
        where = (r.get("정의 위치") or "").strip()
        occ = [(line_at(m.start()), text[max(0, m.start() - 15):m.end() + 40])
               for text, line_at in texts for m in rx.finditer(text)]
        if where and where not in ("-", "상식"):
            rng = section_range(lines, where)
            if rng is None:
                out["nosec"].append((t, where))
            else:
                inside = [(i, c) for i, c in occ if rng[0] <= i <= rng[1]]
                if not inside:
                    out["nodef"].append((t, where))
                elif occ and occ[0][0] < inside[0][0]:
                    out["early"].append((t, occ[0][0], occ[0][1], inside[0][0]))
        for a in split_aliases(r.get("쓰지 않을 말")):
            arx = term_rx(a)
            for text, line_at in texts:
                # 확정 표기 안에 든 별칭("band head" 속 "head")은 세지 않는다
                covers = [m.span() for tt, trx in terms if tt != a and a in tt
                          for m in trx.finditer(text)]
                for m in arx.finditer(text):
                    if not any(s <= m.start() and m.end() <= e for s, e in covers):
                        out["alias"].append((line_at(m.start()), a, t,
                                             text[max(0, m.start() - 15):m.end() + 35]))
    out["alias"].sort()
    return out


# 12. 사실 대장 ---------------------------------------------------------------
FACT_WINDOW = 25


def read_facts(path):
    facts = []
    for r in read_table(path, ["대상", "값"]):
        m = NUM.search(r.get("값", ""))
        if not r.get("대상") or not m:
            continue
        facts.append({"name": r["대상"], "metric": r.get("지표", ""), "value": norm_num(m.group(0)),
                      "raw": m.group(0), "n": (r.get("표본") or "").strip(),
                      "src": r.get("재료 위치", "")})
    return facts


def check_facts(lines, path):
    facts = read_facts(path)
    out = {"mismatch": [], "shared": [], "mixed": [], "dup": [], "unlisted": []}
    by_name = {}
    for f in facts:
        by_name.setdefault(f["name"], []).append(f)
    # 대장 안에서 같은 값이 두 대상에 붙었다. 한 대상을 두 이름으로 부르는지 본다
    by_value = {}
    for f in facts:
        by_value.setdefault(f["value"], set()).add(f["name"])
    out["dup"] = sorted((v, sorted(ns)) for v, ns in by_value.items() if len(ns) > 1)

    names = sorted(by_name, key=len, reverse=True)
    name_rx = [(n, term_rx(n)) for n in names]
    attached = {}
    known = {f["value"] for f in facts}
    for kind, block in blocks(lines):
        if kind not in ("text", "list", "quote"):
            continue
        text, line_at = joined(block)
        # 긴 이름부터 겹치지 않게 잡는다
        spans = []
        for n, rx in name_rx:
            for m in rx.finditer(text):
                if not any(s < m.end() and m.start() < e for s, e, _ in spans):
                    spans.append((m.start(), m.end(), n))
        spans.sort()
        ends = [m.end() for m in SENT_END.finditer(text)]
        for k, (s, e, n) in enumerate(spans):
            stop = min([e + FACT_WINDOW] + [x for x in ends if x > e][:1]
                       + ([spans[k + 1][0]] if k + 1 < len(spans) else []))
            vals = {f["value"] for f in by_name[n]}
            decs = {decimals(v) for v in vals}
            nums = [norm_num(m.group(0)) for m in NUM.finditer(text[e:stop])]
            nums = [x for x in nums if decimals(x) in decs]
            if not nums:
                continue
            attached.setdefault(nums[0], set()).add(n)
            if not any(x in vals for x in nums):
                out["mismatch"].append((line_at(s), n, nums[0], sorted(vals), text[s:stop].strip()))
        # 표본이 다른 대장 값이 한 문단에 나란히 나온다
        if kind == "text":
            present = {norm_num(m.group(0)) for m in NUM.finditer(text)}
            samples = {}
            for f in facts:
                if f["value"] in present and f["n"] not in ("", "-"):
                    samples.setdefault(f["n"], set()).add(f["raw"])
            if len(samples) > 1:
                out["mixed"].append((block[0][0], {k: sorted(v) for k, v in samples.items()}))
            for m in NUM.finditer(text):
                x = norm_num(m.group(0))
                if decimals(x) >= 2 and x not in known:
                    out["unlisted"].append((line_at(m.start()), m.group(0)))
    out["shared"] = sorted((v, sorted(ns)) for v, ns in attached.items() if len(ns) > 1)
    return out


def print_document_checks(lines, args):
    print()
    print(f"## 9. 지시어 (경고, 앞 {args.dem_window}문단에 없는 명사)")
    dem = check_demonstratives(lines, args.dem_window)
    if dem:
        print(f"- {len(dem)}건. 가리키는 대상을 이름으로 다시 쓰거나 앞에서 먼저 소개한다")
        for i, phrase, stem in dem:
            print(f"    {i}: \"{phrase}\" ('{stem}'이 앞에 없음)")
    else:
        print("- 없음")
    print()

    print("## 10. 그림 읽는 법 문장의 위치 (경고)")
    leg = check_legend_placement(lines)
    if leg:
        print(f"- {len(leg)}건. 색, 선, 축 설명은 문단 처음이나 끝으로 모은다")
        for i, s, nxt in leg:
            print(f"    {i}: {s[:50]}  → 다음 문장: {nxt[:30]}")
    else:
        print("- 없음")

    print()
    print("## 11. 용어표 대조")
    if not args.glossary:
        print("- 건너뜀 (--glossary 용어표.md로 켠다)")
    else:
        g = check_glossary(lines, args.glossary)
        if not any(g.values()):
            print("- 없음")
        for t, first, l, d in g["early"]:
            print(f"- 정의 전 사용: '{t}' {first}줄에서 처음 쓰고 {d}줄에서 정의한다")
            print(f"    {first}: {l[:70]}")
        for t, where in g["nodef"]:
            print(f"- 정의 절에 없음: '{t}'가 '{where}' 절에 나오지 않는다")
        for t, where in g["nosec"]:
            print(f"- 정의 위치를 못 찾음: '{t}'의 '{where}'에 맞는 헤딩이 없다")
        if g["alias"]:
            print(f"- 쓰지 않을 말 {len(g['alias'])}건")
            for i, a, t, l in g["alias"][:15]:
                print(f"    {i}: '{a}' → '{t}'. {l[:50]}")
            if len(g["alias"]) > 15:
                print(f"    ... 외 {len(g['alias']) - 15}건")

    print()
    print("## 12. 사실 대장 대조 (경고, 숫자는 사람이 확인)")
    if not args.facts:
        print("- 건너뜀 (--facts 사실대장.md로 켠다)")
        return
    f = check_facts(lines, args.facts)
    if not any(f.values()):
        print("- 없음")
    for i, n, x, vals, ctx in f["mismatch"]:
        print(f"- 값 불일치 {i}: '{n}' 뒤에 {x}, 대장은 {', '.join(vals)}. \"{ctx[:40]}\"")
    for v, ns in f["shared"]:
        print(f"- 한 숫자 두 대상: {v}가 본문에서 {', '.join(ns)}에 붙었다")
    for v, ns in f["dup"]:
        print(f"- 대장 안 같은 값: {v} = {', '.join(ns)}. 같은 대상이면 이름을 하나로, 아니면 우연인지 확인")
    for i, samples in f["mixed"]:
        desc = "; ".join(f"{k}: {', '.join(v)}" for k, v in samples.items())
        print(f"- 표본 섞임 {i}: 한 문단에 표본이 다른 숫자. {desc}")
    if f["unlisted"]:
        print(f"- 대장에 없는 소수 {len(f['unlisted'])}건 (대장에 올리거나 본문에서 뺀다)")
        for i, x in f["unlisted"][:15]:
            print(f"    {i}: {x}")
        if len(f["unlisted"]) > 15:
            print(f"    ... 외 {len(f['unlisted']) - 15}건")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--heading", type=int, default=15, help="헤딩 글자 수 상한 (기본 15, 외부 보고서 25)")
    ap.add_argument("--para", type=int, default=6, help="문단 문장 수 상한 (기본 6)")
    ap.add_argument("--from", dest="start", default=None, help="이 문자열부터 검사")
    ap.add_argument("--to", dest="end", default=None, help="이 문자열 앞까지 검사")
    ap.add_argument("--glossary", default=None, help="용어표 파일. 정의 전 사용과 쓰지 않을 말을 센다")
    ap.add_argument("--facts", default=None, help="사실 대장 파일. 본문 숫자를 대장과 대조한다")
    ap.add_argument("--dem-window", type=int, default=3, help="지시어가 가리킬 명사를 찾을 앞 문단 수 (기본 3)")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass

    full = io.open(args.file, encoding="utf-8").read()
    text = slice_body(full, args.start, args.end)
    lines = classify_lines(text)
    checkable = [(i, l) for i, (k, l) in enumerate(lines, 1) if k in ("text", "list", "heading", "table")]

    print(f"# 검사: {args.file}")
    if args.start or args.end:
        print(f"범위: {args.start or '처음'} ~ {args.end or '끝'}")
        skipped = full[:full.find(text)].count("\n") if text else 0
        if skipped:
            print(f"줄 번호는 범위 첫 줄을 1로 센다. 파일 줄 번호는 {skipped}을 더한다")
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

    # 9~12. 문서 단위 검사
    print_document_checks(lines, args)


if __name__ == "__main__":
    main()
