#!/usr/bin/env python3
"""Build one self-contained HTML page of a whole Markdown manuscript where clicking an
element copies it, copies a selector that names it, or (served) edits it.

agent-workflow-kit — system-owned. Stdlib only.

    python manuscript_sheet.py report.md [--out report.html] [--title T] [--lang ko|en]
    python manuscript_sheet.py report.md --serve [--port 8765] [--no-open]

The page
  Each section has a bracket line on its left, nested by heading depth. A floating switch
  at the bottom right picks the mode.

  Copy mode    click a heading, paragraph, list or table to copy it, or a bracket to copy
               that whole section (text only: figures are skipped, tables go in as
               tab-separated rows). A figure is copied only by clicking the figure: its
               PNG. Its caption line copies the caption (number dropped unless
               --keep-number), its path line the absolute path. Copied text is plain, so a
               word processor applies its template style; tables also carry HTML so they
               paste as tables, each cell with its column's Markdown alignment. The
               "요점" / "본문에 쓸 것" work lines are never copied.
  Select mode  click to copy a selector — file, line and section for text; for a figure
               with an SVG next to its PNG, the matplotlib element under the pointer (text,
               bar, line, dot, tick, axis, legend, plot area) with its id path, text and
               position. Moving the pointer off a small element toward the figure's edge
               selects the next larger group. Shift-click adds to the selection; Esc clears.
  Edit mode    only with --serve: click a heading, paragraph, list, table or caption to
               edit its Markdown source in place; Ctrl+Enter saves it to the file. The
               server rewrites only that block's lines and refuses when the block changed
               on disk since the page loaded (another editor or agent), so nothing is
               overwritten. Any change to the Markdown or a figure file reloads the page.

"그림 N" / "표 N" in the text link to that figure and scroll it to the vertical middle of
the viewport; plain scrolling is never adjusted. Images are
embedded, so the written page opens from disk. Exit 1 if a figure file is missing (the
page is still written, with a placeholder).

A table drawn as an image ("표 N" / "Table N") is shown no wider than it is on paper, read
from the SVG's width or the PNG's pixel size and dpi, so a narrow table keeps the type size
of the wide ones; figures fill the column.
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from figure_sheet import MD_IMAGE_RE, MIME, caption_to_copy, figure_from_block, resolve  # noqa: E402

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*$")
HR_RE = re.compile(r"^(?:-{3,}|\*{3,}|_{3,})$")
LIST_RE = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
TABLE_SEP_RE = re.compile(r"^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$")
CODE_SPAN_RE = re.compile(r"`([^`]+)`")
BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)\s]+)\)")
FIG_REF_RE = re.compile(r"(그림|표|Figure|Table)\s?(\d+)")

STRINGS = {
    "ko": {"copy": "요소 복사", "select": "요소 선택", "done": "복사 완료", "failed": "복사 실패",
           "selected": "selector {n}개 복사 완료", "missing": "파일 없음", "toc": "차례",
           "source": "원고", "made": "만든 때", "claim": "요점", "notes": "본문에 쓸 것",
           "heading": "제목", "section": "절", "para": "문단", "list": "목록", "table": "표",
           "quote": "인용", "code": "코드", "figure": "그림", "caption": "캡션", "path": "경로",
           "axes": "그래프 영역", "xaxis": "가로축", "yaxis": "세로축", "xtick": "가로 눈금",
           "ytick": "세로 눈금", "legend": "범례", "text": "글자", "patch": "도형", "line": "선",
           "points": "점 묶음", "lines": "선 묶음", "dot": "점", "pos": "가로 {x}% 세로 {y}%",
           "edit": "편집", "save": "저장", "cancel": "취소", "saved": "저장 완료", "hint": "Ctrl+Enter 저장 · Esc 취소",
           "conflict": "그사이 원고가 바뀌어 저장하지 못했습니다. 고친 글을 복사해 두고 취소를 누르면 새 원고를 불러옵니다.",
           "offline": "서버에 연결하지 못했습니다. manuscript_sheet.py --serve가 실행 중인지 확인하세요."},
    "en": {"copy": "Copy element", "select": "Select element", "done": "Copied", "failed": "Copy failed",
           "selected": "{n} selector(s) copied", "missing": "Missing file", "toc": "Contents",
           "source": "Source", "made": "Built", "claim": "Claim", "notes": "In text",
           "heading": "heading", "section": "section", "para": "paragraph", "list": "list", "table": "table",
           "quote": "quote", "code": "code", "figure": "figure", "caption": "caption", "path": "path",
           "axes": "plot area", "xaxis": "x axis", "yaxis": "y axis", "xtick": "x tick",
           "ytick": "y tick", "legend": "legend", "text": "text", "patch": "shape", "line": "line",
           "points": "points", "lines": "lines", "dot": "point", "pos": "x {x}% y {y}%",
           "edit": "Edit", "save": "Save", "cancel": "Cancel", "saved": "Saved", "hint": "Ctrl+Enter save · Esc cancel",
           "conflict": "The manuscript changed meanwhile, so this was not saved. Copy your text, then Cancel to load the new version.",
           "offline": "Could not reach the server. Check that manuscript_sheet.py --serve is running."},
}


# ---- inline -------------------------------------------------------------------------

def inline_plain(text: str) -> str:
    text = LINK_RE.sub(r"\1", text)
    text = CODE_SPAN_RE.sub(r"\1", text)
    return text.replace("**", "")


def _spans(text: str, anchors: dict[str, str]) -> str:
    out = []
    for i, part in enumerate(CODE_SPAN_RE.split(text)):
        if i % 2:
            out.append(f"<code>{html.escape(part)}</code>")
            continue
        s = BOLD_RE.sub(r"<strong>\1</strong>", html.escape(part, quote=False))
        if anchors:
            s = FIG_REF_RE.sub(lambda m: (f'<a class="ref" href="#{anchors[m.group(0).replace(" ", "")]}">{m.group(0)}</a>'
                                          if m.group(0).replace(" ", "") in anchors else m.group(0)), s)
        out.append(s)
    return "".join(out)


def inline_html(text: str, anchors: dict[str, str] | None = None) -> str:
    anchors = anchors or {}
    out, pos = [], 0
    for m in LINK_RE.finditer(text):
        out.append(_spans(text[pos:m.start()], anchors))
        out.append(f'<a href="{html.escape(m.group(2))}">{_spans(m.group(1), {})}</a>')
        pos = m.end()
    out.append(_spans(text[pos:], anchors))
    return "".join(out)


# ---- blocks -------------------------------------------------------------------------

def _starts_block(line: str) -> bool:
    s = line.strip()
    return bool(s.startswith((">", "|", "```")) or HEADING_RE.match(s) or HR_RE.match(s) or LIST_RE.match(line))


def _cells(row: str) -> list[str]:
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|"):
        row = row[:-1]
    return [c.strip() for c in row.split("|")]


def _aligns(sep: str) -> list[str | None]:
    """Column alignment from a table's separator row: ``:---:`` center, ``---:`` right, ``:---`` left."""
    out: list[str | None] = []
    for c in _cells(sep):
        left, right = c.startswith(":"), c.endswith(":")
        out.append("center" if left and right else "right" if right else "left" if left else None)
    return out


def parse(text: str, bases: list[Path]) -> list[dict]:
    lines = text.splitlines()
    blocks: list[dict] = []
    i, n = 0, len(lines)
    while i < n:
        if blocks and "end" not in blocks[-1]:
            blocks[-1]["end"] = min(i, n)   # the last line the previous block consumed (1-based)
        ln, s = lines[i], lines[i].strip()
        start = i + 1
        if not s:
            i += 1
            continue
        if s.startswith("```"):
            body, i = [], i + 1
            while i < n and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            blocks.append({"kind": "code", "text": "\n".join(body), "line": start})
            i += 1
            continue
        m = HEADING_RE.match(s)
        if m:
            blocks.append({"kind": "heading", "level": len(m.group(1)), "text": m.group(2), "line": start})
            i += 1
            continue
        if HR_RE.match(s):
            blocks.append({"kind": "hr", "line": start})
            i += 1
            continue
        if s.startswith(">"):
            body = []
            while i < n and lines[i].strip().startswith(">"):
                body.append(lines[i].strip()[1:].strip())
                i += 1
            fig = figure_from_block(body, bases, start)
            blocks.append({"kind": "figure", **fig} if fig else {"kind": "quote", "lines": body, "line": start})
            continue
        if s.startswith("|"):
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                rows.append(lines[i])
                i += 1
            head = _cells(rows[0])
            sep = rows[1].strip() if len(rows) > 1 else ""
            align = _aligns(sep) if TABLE_SEP_RE.match(sep) else []
            body_rows = [_cells(r) for r in rows[1:] if not TABLE_SEP_RE.match(r.strip())]
            blocks.append({"kind": "table", "head": head, "rows": body_rows, "align": align, "line": start})
            continue
        if LIST_RE.match(ln):
            items: list[dict] = []
            while i < n and lines[i].strip():
                m = LIST_RE.match(lines[i])
                if m:
                    items.append({"depth": len(m.group(1).expandtabs(4)) // 2, "marker": m.group(2), "text": m.group(3).strip()})
                elif _starts_block(lines[i]):
                    break
                else:
                    items[-1]["text"] += " " + lines[i].strip()
                i += 1
            blocks.append({"kind": "list", "items": items, "ordered": items[0]["marker"][0].isdigit(), "line": start})
            continue
        body = []
        while i < n and lines[i].strip() and not (body and _starts_block(lines[i])):
            body.append(lines[i].strip())
            i += 1
        joined = " ".join(body)
        m = MD_IMAGE_RE.fullmatch(joined)
        if m:
            blocks.append({"kind": "figure", "file": str(resolve(m.group(2), bases)), "label": None,
                           "caption": m.group(1).strip(), "claim": None, "notes": None, "line": start})
        else:
            blocks.append({"kind": "para", "text": joined, "line": start})
    if blocks and "end" not in blocks[-1]:
        blocks[-1]["end"] = n
    return blocks


def plain(block: dict) -> str:
    k = block["kind"]
    if k in ("heading", "para"):
        return inline_plain(block["text"])
    if k == "list":
        return "\n".join("  " * it["depth"] + f'{it["marker"]} {inline_plain(it["text"])}' for it in block["items"])
    if k == "table":
        return "\n".join("\t".join(inline_plain(c) for c in r) for r in [block["head"], *block["rows"]])
    if k == "quote":
        return "\n".join(inline_plain(x) for x in block["lines"])
    if k == "code":
        return block["text"]
    return ""


def table_html(block: dict, anchors: dict[str, str] | None = None, fmt=None) -> str:
    fmt = fmt or (lambda c: inline_html(c, anchors))
    align = block.get("align") or []

    def cell(tag: str, c: str, j: int) -> str:
        # inline style, so a table pasted into a word processor keeps the column alignment
        a = align[j] if j < len(align) else None
        style = f' style="text-align:{a}"' if a else ""
        return f"<{tag}{style}>{fmt(c)}</{tag}>"

    head = "".join(cell("th", c, j) for j, c in enumerate(block["head"]))
    rows = "".join("<tr>" + "".join(cell("td", c, j) for j, c in enumerate(r)) + "</tr>" for r in block["rows"])
    return f"<table><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>"


# ---- figures ------------------------------------------------------------------------

def inline_svg(path: Path, prefix: str) -> str:
    """matplotlib SVG -> inline markup. Ids get a per-figure prefix so figures on one page
    do not collide; the original id stays in data-id for selectors."""
    s = path.read_text(encoding="utf-8")
    s = s[s.index("<svg"):]
    s = re.sub(r"<metadata>.*?</metadata>", "", s, flags=re.S)
    s = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{prefix}{m.group(1)}" data-id="{m.group(1)}"', s)
    s = re.sub(r'((?:xlink:)?href)="#([^"]+)"', lambda m: f'{m.group(1)}="#{prefix}{m.group(2)}"', s)
    s = re.sub(r"url\(#([^)]+)\)", lambda m: f"url(#{prefix}{m.group(1)})", s)
    head_end = s.index(">")
    head = re.sub(r'\s(?:width|height)="[^"]*"', "", s[:head_end])
    return head + s[head_end:]


SVG_WIDTH_RE = re.compile(r'\swidth="\s*([0-9.]+)\s*(pt|px|in|mm|cm)?\s*"')
CSS_PX = {"px": 1.0, "pt": 96 / 72, "in": 96.0, "mm": 96 / 25.4, "cm": 96 / 2.54}


def paper_width_px(path: Path) -> float | None:
    """The width the image has on paper, in CSS px: an SVG's width attribute, or a PNG's
    pixel width over its pHYs density (96 dpi when the chunk is absent). None when the file
    cannot be read that way."""
    try:
        suffix = path.suffix.lower()
        if suffix == ".svg":
            s = path.read_text(encoding="utf-8")
            head = s[s.index("<svg"):]
            m = SVG_WIDTH_RE.search(head[:head.index(">")])
            return float(m.group(1)) * CSS_PX[m.group(2) or "px"] if m else None
        if suffix == ".png":
            data = path.read_bytes()
            if data[:8] != b"\x89PNG\r\n\x1a\n":
                return None
            width, dpi, pos = int.from_bytes(data[16:20], "big"), 96.0, 8
            while pos + 8 <= len(data):
                length, kind = int.from_bytes(data[pos:pos + 4], "big"), data[pos + 4:pos + 8]
                if kind == b"pHYs" and data[pos + 16] == 1:   # unit 1 = pixels per metre
                    dpi = int.from_bytes(data[pos + 8:pos + 12], "big") * 0.0254
                if kind in (b"pHYs", b"IDAT"):
                    break
                pos += 12 + length
            return width / dpi * 96
    except (OSError, ValueError, IndexError):
        return None
    return None


def _cap(markup: str, width: float | None) -> str:
    """A table drawn as an image is shown no wider than it is on paper. Stretched to the
    column like a figure, a narrow table's type comes out larger than the other tables'."""
    if width is None:
        return markup
    tag = "<svg" if markup.startswith("<svg") else "<img"
    return markup.replace(tag, f'{tag} style="max-width:{width:.0f}px"', 1)


def _anchor(label: str) -> str:
    return "fig-" + label.replace(" ", "")


def _clip(text: str, n: int = 40) -> str:
    return text if len(text) <= n else text[:n].rstrip() + "…"


# ---- page ---------------------------------------------------------------------------

def build(blocks: list[dict], title: str, source: str, lang: str, keep_number: bool,
          last_line: int | None = None, source_lines: list[str] | None = None) -> tuple[str, list[str]]:
    """source_lines turns on the edit mode: each block carries its Markdown source and line
    range, which only the --serve page can write back."""
    t = STRINGS[lang]
    last_line = last_line or (blocks[-1]["line"] if blocks else 0)
    anchors = {b["label"].replace(" ", ""): _anchor(b["label"]) for b in blocks if b["kind"] == "figure" and b.get("label")}
    data, out, toc, missing = [], [], [], []
    stack: list[int] = []          # open section levels
    crumbs: dict[int, str] = {}    # level -> heading text
    counts: dict[str, int] = {}    # per-section ordinal of each kind
    for i, b in enumerate(blocks):
        k = b["kind"]
        crumb = " › ".join(crumbs[lv] for lv in sorted(crumbs) if lv >= 2)
        where = f"{source}:{b['line']}"
        item: dict = {"kind": k, "plain": plain(b)}
        if k == "heading":
            lvl = b["level"]
            while stack and stack[-1] >= lvl:
                out.append("</section>")
                stack.pop()
            crumbs = {lv: s for lv, s in crumbs.items() if lv < lvl}
            crumbs[lvl] = inline_plain(b["text"])
            counts = {}
            end = next((x["line"] - 1 for x in blocks[i + 1:] if x["kind"] == "heading" and x["level"] <= lvl), last_line)
            item.update(level=lvl, sel=f'{where} · {t["heading"]} "{item["plain"]}"',
                        sel_sec=f'{source}:{b["line"]}-{end} · {t["section"]} "{item["plain"]}"')
            out.append(f'<section class="sec lv{lvl}" data-i="{i}"><div class="brk" data-i="{i}"></div>')
            out.append(f'<h{lvl} class="el" data-k="heading" data-i="{i}" id="b{i}">{inline_html(b["text"])}</h{lvl}>')
            stack.append(lvl)
            if 2 <= lvl <= 3:
                toc.append(f'<a class="toc{lvl}" href="#b{i}">{html.escape(item["plain"])}</a>')
        elif k == "figure":
            p = Path(b["file"])
            label = b.get("label") or ""
            svg = p.with_suffix(".svg")
            name = (svg if svg.is_file() else p).name
            head = f"{label} " if label else ""
            item.update(label=label, path=str(p), caption=caption_to_copy(b, keep_number),
                        sel=f"{where} · {head}{name}", sel_caption=f'{where} · {head}{t["caption"]} "{b["caption"]}"',
                        sel_path=f"{where} · {head}{t['path']}")
            if svg.is_file():
                art = inline_svg(svg, f"s{i}-")
            elif p.is_file():
                art = f'<img src="data:{MIME.get(p.suffix.lower(), "image/png")};base64,{base64.b64encode(p.read_bytes()).decode("ascii")}" alt="{html.escape(b["caption"])}">'
            else:
                art = f'<div class="missing">{t["missing"]}</div>'
            if label.startswith(("표", "Table")) and (svg.is_file() or p.is_file()):
                art = _cap(art, paper_width_px(svg if svg.is_file() else p))
            if p.is_file():
                if p.suffix.lower() == ".png":
                    item["png"] = base64.b64encode(p.read_bytes()).decode("ascii")
            else:
                missing.append(str(p))
            cap = f'{html.escape(label + ". ") if label else ""}{html.escape(b["caption"])}'
            notes = "".join(f'<p class="note"><b>{t[key]}</b> {html.escape(b[key])}</p>'
                            for key in ("claim", "notes") if b.get(key))
            fid = f' id="{_anchor(label)}"' if label else ""
            out.append(f'<figure class="fig"{fid}><div class="art el" data-k="figure" data-i="{i}">{art}</div>'
                       f'<figcaption class="el" data-k="caption" data-i="{i}">{cap}</figcaption>{notes}'
                       f'<p class="path el" data-k="path" data-i="{i}">{html.escape(str(p))}</p></figure>')
        elif k == "hr":
            pass
        else:
            counts[k] = counts.get(k, 0) + 1
            path_txt = f"{crumb} › " if crumb else ""
            item["sel"] = f'{where} · {path_txt}{t[k]} {counts[k]} · "{_clip(item["plain"].splitlines()[0] if item["plain"] else "")}"'
            if k == "para":
                body = f'<p class="el" data-k="para" data-i="{i}">{inline_html(b["text"], anchors)}</p>'
            elif k == "list":
                tag = "ol" if b["ordered"] else "ul"
                lis = "".join(f'<li style="margin-left:{it["depth"] * 1.5}em">{inline_html(it["text"], anchors)}</li>' for it in b["items"])
                body = f'<{tag} class="el" data-k="list" data-i="{i}">{lis}</{tag}>'
            elif k == "table":
                item["html"] = table_html(b, fmt=lambda c: html.escape(inline_plain(c)))
                body = f'<div class="el tbl" data-k="table" data-i="{i}">{table_html(b, anchors)}</div>'
            elif k == "quote":
                body = f'<blockquote class="el" data-k="quote" data-i="{i}">' + "<br>".join(inline_html(x, anchors) for x in b["lines"]) + "</blockquote>"
            else:
                body = f'<pre class="el" data-k="code" data-i="{i}"><code>{html.escape(b["text"])}</code></pre>'
            out.append(body)
        if source_lines is not None and "end" in b:
            item.update(line=b["line"], end=b["end"], src="\n".join(source_lines[b["line"] - 1:b["end"]]))
        data.append(item)
    out.extend("</section>" for _ in stack)

    meta = f"{t['source']} {html.escape(source)} · {t['made']} {datetime.now():%Y-%m-%d %H:%M}"
    toc_html = f'<nav><b>{t["toc"]}</b>{"".join(toc)}</nav>' if toc else ""
    page = (TEMPLATE
            .replace("__LANG__", lang)
            .replace("__TITLE__", html.escape(title))
            .replace("__META__", meta)
            .replace("__TOC__", toc_html)
            .replace("__COPY__", t["copy"])
            .replace("__SELECT__", t["select"])
            .replace("__EDIT_BUTTON__", f'<button type="button" data-mode="edit">{t["edit"]}</button>' if source_lines is not None else "")
            .replace("__EDITABLE__", "true" if source_lines is not None else "false")
            .replace("__STRINGS__", json.dumps(t, ensure_ascii=False))
            .replace("__DATA__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
            .replace("__BODY__", "\n".join(out)))
    return page, missing


TEMPLATE = r"""<!doctype html>
<html lang="__LANG__">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<link rel="icon" href="data:,">
<style>
  :root { --ink:#1a1a1a; --ink2:#555; --line:#d0d0d0; --bg:#fff; --soft:#f6f6f6; --accent:#0072B2; --tint:rgba(0,114,178,.07); --warn:#D55E00; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); line-height:1.8;
         font-family: Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 24px 16px 160px; }
  .meta { color: var(--ink2); font-size: 13px; margin: 0 0 16px; }
  nav { display: flex; flex-direction: column; gap: 2px; font-size: 14px; padding: 12px 16px; margin: 0 0 32px;
        background: var(--soft); border-radius: 8px; }
  nav b { margin-bottom: 4px; }
  nav a { color: var(--ink); text-decoration: none; }
  nav a:hover { color: var(--accent); }
  nav .toc3 { padding-left: 1.2em; color: var(--ink2); }
  .sec { position: relative; padding-left: 22px; }
  .sec.lv2 { margin-top: 72px; }
  .sec.lv3 { margin-top: 40px; }
  .sec.lv4, .sec.lv5, .sec.lv6 { margin-top: 24px; }
  .brk { position: absolute; left: 2px; top: 4px; bottom: 4px; width: 12px; cursor: pointer;
         border: 1.5px solid var(--line); border-right: none; }
  .brk:hover, .brk.on { border-color: var(--accent); }
  h1, h2, h3, h4 { line-height: 1.4; margin: 0 0 16px; scroll-margin-top: 24px; }
  h1 { font-size: 24px; } h2 { font-size: 20px; } h3 { font-size: 17px; }
  p { margin: 0 0 16px; }
  a { color: var(--accent); }
  a.ref { text-decoration: none; border-bottom: 1px dotted var(--accent); }
  code { font-family: ui-monospace, Consolas, monospace; font-size: .9em; background: var(--soft); padding: 0 3px; border-radius: 3px; }
  pre { background: var(--soft); padding: 12px; overflow-x: auto; margin: 0 0 16px; }
  blockquote { margin: 0 0 16px; padding-left: 12px; border-left: 3px solid var(--line); color: var(--ink2); }
  ul, ol { margin: 0 0 16px; padding-left: 1.4em; }
  .tbl { margin: 0 0 16px; overflow-x: auto; }
  table { border-collapse: collapse; font-size: 14px; margin: 0 auto; }
  th, td { border-bottom: 1px solid var(--line); padding: 4px 10px; text-align: left; vertical-align: top; }
  th { border-top: 2px solid var(--ink); border-bottom: 1px solid var(--ink); }
  .fig { margin: 32px 0; }
  .art { display: flex; justify-content: center; }
  .art svg, .art img { display: block; width: 100%; height: auto; max-height: calc(100vh - 200px); }
  figcaption { margin: 12px auto 4px; font-weight: 600; text-align: center; }
  .note { color: var(--ink2); font-size: 13px; line-height: 1.5; margin: 0 0 2px; }
  .note b { font-weight: 600; margin-right: 4px; }
  .path { color: var(--ink2); font-size: 12px; font-family: ui-monospace, Consolas, monospace; overflow-wrap: anywhere; margin: 6px 0 0; }
  .missing { padding: 48px; width: 100%; text-align: center; color: var(--warn); border: 1px dashed var(--warn); }
  body[data-mode="copy"] .el { cursor: copy; }
  body[data-mode="select"] .el { cursor: pointer; }
  body[data-mode="select"] .art { cursor: crosshair; }
  .box { position: absolute; pointer-events: none; z-index: 20; border-radius: 3px; }
  .box.hover { border: 1.5px dashed var(--accent); background: var(--tint); }
  body[data-mode="select"] .box.hover { border-style: solid; }
  .box.picked { border: 2px solid var(--accent); background: rgba(0,114,178,.12); }
  .box .tip { position: absolute; left: -2px; bottom: 100%; margin-bottom: 3px; white-space: nowrap;
              font-size: 11px; line-height: 1.4; padding: 1px 6px; border-radius: 3px; color: #fff; background: var(--accent); }
  .box.hidden { display: none; }
  .fab { position: fixed; right: 16px; bottom: 16px; z-index: 30; display: flex; padding: 3px; gap: 2px;
         background: #fff; border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,.12); }
  .fab button { font: inherit; font-size: 13px; padding: 6px 12px; border: none; border-radius: 6px; background: none;
                color: var(--ink2); cursor: pointer; }
  .fab button[aria-pressed="true"] { background: var(--accent); color: #fff; }
  .toast { position: fixed; right: 16px; bottom: 64px; z-index: 30; max-width: min(460px, calc(100vw - 32px));
           font-size: 13px; line-height: 1.5; padding: 8px 12px; border-radius: 6px; background: #333; color: #fff;
           white-space: pre-wrap; overflow-wrap: anywhere; opacity: 0; transition: opacity .15s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .toast.bad { background: var(--warn); }
  body[data-mode="edit"] .el { cursor: text; }
  body[data-mode="edit"] .art, body[data-mode="edit"] .path, body[data-mode="edit"] .brk { cursor: default; }
  .editor { margin: 0 0 16px; }
  .editor textarea { display: block; width: 100%; min-height: 3em; resize: vertical; padding: 8px 10px; border: 1.5px solid var(--accent);
                     border-radius: 4px; font: 15px/1.75 Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; color: var(--ink); background: #fff; }
  .editor .ebar { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; color: var(--ink2); }
  .editor button { font: inherit; font-size: 13px; padding: 3px 12px; border-radius: 5px; border: 1px solid #c4c4c4; background: #fff; cursor: pointer; }
  .editor button[data-e="save"] { background: var(--accent); border-color: var(--accent); color: #fff; }
  @media (max-width: 640px) { .sec { padding-left: 16px; } .brk { width: 9px; } }
  @media print { .fab, .toast, .box, nav, .note, .path, .meta, .brk { display: none; } .fig { break-inside: avoid; } }
</style>
</head>
<body data-mode="copy">
<main>
<p class="meta">__META__</p>
__TOC__
__BODY__
</main>
<div class="fab" role="group"><button type="button" data-mode="copy">__COPY__</button><button type="button" data-mode="select">__SELECT__</button>__EDIT_BUTTON__</div>
<div class="toast" role="status" aria-live="polite"></div>
<script id="data" type="application/json">__DATA__</script>
<script>
const T = __STRINGS__;
const EDITABLE = __EDITABLE__;
const DATA = JSON.parse(document.getElementById("data").textContent);
const SKIP = new Set(["figure", "hr"]);
const LEAF = /^(text|patch|line2d|PathCollection|LineCollection|PolyCollection)_\d+$/;
const GROUP = /^(figure|axes|matplotlib\.axis|xtick|ytick|legend|PathCollection|LineCollection|PolyCollection|text|patch)_\d+$/;
const KIND = {figure: T.figure, axes: T.axes, xtick: T.xtick, ytick: T.ytick, legend: T.legend, text: T.text,
              patch: T.patch, line2d: T.line, PathCollection: T.points, LineCollection: T.lines, PolyCollection: T.patch};
let mode = "copy";
try { mode = localStorage.getItem("manuscript-sheet-mode") || "copy"; } catch (e) {}

// ---- boxes ----
function box(cls) { const b = document.createElement("div"); b.className = "box " + cls; const tip = document.createElement("span"); tip.className = "tip"; b.appendChild(tip); document.body.appendChild(b); return b; }
const hoverBox = box("hover hidden");
let picked = [];   // {key, target, box, sel}
function place(b, r, tip) {
  const pad = 3;
  b.style.left = (r.left + scrollX - pad) + "px"; b.style.top = (r.top + scrollY - pad) + "px";
  b.style.width = (r.right - r.left + 2 * pad) + "px"; b.style.height = (r.bottom - r.top + 2 * pad) + "px";
  b.firstChild.textContent = tip || ""; b.firstChild.style.display = tip ? "" : "none";
  b.classList.remove("hidden");
}
const hide = () => hoverBox.classList.add("hidden");

// ---- figure parts ----
function markBackgrounds(svg) {
  for (const g of svg.querySelectorAll('g[data-id^="patch_"]')) {
    const p = g.querySelector("path"); const st = p && p.getAttribute("style") || "";
    if (/fill:\s*#ffffff/i.test(st) && !/stroke:\s*#/.test(st)) { g.classList.add("bg"); g.style.pointerEvents = "none"; }
  }
}
document.querySelectorAll(".art svg").forEach(markBackgrounds);
const R = r => ({left: r.left, top: r.top, right: r.right, bottom: r.bottom});
const union = (u, r) => u ? {left: Math.min(u.left, r.left), top: Math.min(u.top, r.top), right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom)} : r;
function drawnRect(node) {   // what is painted, ignoring marker and glyph definitions in <defs>
  if (!(node instanceof SVGGElement)) { const r = node.getBoundingClientRect(); return r.width || r.height ? R(r) : null; }
  let u = null;
  for (const el of node.querySelectorAll("path, use, rect, text, image, line, polyline, polygon")) {
    if (el.closest("defs")) continue;
    const r = el.getBoundingClientRect();
    if (r.width || r.height) u = union(u, R(r));
  }
  return u;
}
function computeRect(node) {
  const base = node.dataset && node.dataset.id ? node.dataset.id.replace(/_\d+$/, "") : "";
  if (base === "matplotlib.axis" || base === "xtick" || base === "ytick") {
    let u = null;   // ticks and labels only: grid lines would make the axis as big as the plot
    for (const c of node.querySelectorAll('g[data-id^="text_"], g[data-id^="line2d_"]')) {
      const r = rectOf(c);
      if (!r || (c.dataset.id.startsWith("line2d_") && Math.max(r.right - r.left, r.bottom - r.top) > 24)) continue;
      u = union(u, r);
    }
    if (u) return u;
  }
  return drawnRect(node);
}
const RECTS = new Map();   // svg -> Map(node -> rect relative to the svg); cleared on resize
function rectOf(node) {
  const svg = node.ownerSVGElement || node;
  let cache = RECTS.get(svg);
  if (!cache) RECTS.set(svg, cache = new Map());
  const s = svg.getBoundingClientRect();
  if (!cache.has(node)) {
    const r = computeRect(node);
    cache.set(node, r && {left: r.left - s.left, top: r.top - s.top, right: r.right - s.left, bottom: r.bottom - s.top});
  }
  const r = cache.get(node);
  return r && {left: r.left + s.left, top: r.top + s.top, right: r.right + s.left, bottom: r.bottom + s.top};
}
function thin(r, tol) { return (r.right - r.left < 8 || r.bottom - r.top < 8) ? {left: r.left - tol, top: r.top - tol, right: r.right + tol, bottom: r.bottom + tol} : r; }
function leafAt(target, svg) {
  if (!(target instanceof SVGElement) || target === svg) return null;
  const txt = target.closest('g[data-id^="text_"]');
  if (txt && svg.contains(txt)) return {node: txt};
  let g = target.closest("g[data-id]");
  while (g && svg.contains(g) && !LEAF.test(g.dataset.id)) g = g.parentElement.closest("g[data-id]");
  if (!g || !svg.contains(g) || g.classList.contains("bg")) return null;
  if (target.tagName === "use") {
    const uses = [...g.querySelectorAll("use")];
    if (uses.length > 1) return {node: target, dot: uses.indexOf(target) + 1, parent: g};
  }
  return {node: g};
}
const areaOf = r => r ? (r.right - r.left) * (r.bottom - r.top) : Infinity;
function partAt(svg, e) {
  const hit = leafAt(e.target, svg);
  let best = null, bestArea = Infinity;
  for (const g of svg.querySelectorAll("g[data-id]")) {
    const id = g.dataset.id;
    if (g.classList.contains("bg")) continue;
    const isLine = id.startsWith("line2d_");
    if (!isLine && !GROUP.test(id)) continue;
    let r = rectOf(g);
    if (!r || (isLine && r.right - r.left >= 8 && r.bottom - r.top >= 8)) continue;
    r = thin(r, 4);
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue;
    const a = (r.right - r.left) * (r.bottom - r.top);
    if (a <= bestArea) { best = g; bestArea = a; }   // on a tie the later, deeper group wins
  }
  if (hit) {
    // between the strokes of a label the pointer is over the box behind it: the label wins
    if (best && best !== hit.node && best.dataset.id.startsWith("text_") && bestArea < areaOf(rectOf(hit.node))) return {node: best};
    return hit;
  }
  return {node: best || svg.querySelector('g[data-id="figure_1"]') || svg};
}
function kindOf(p) {
  if (p.dot) return T.dot;
  const id = p.node.dataset.id || "";
  const base = id.replace(/_\d+$/, "");
  if (base === "matplotlib.axis") return (+id.split("_").pop()) % 2 ? T.xaxis : T.yaxis;
  return KIND[base] || base || T.figure;
}
function textOf(node) {
  const out = [], w = document.createTreeWalker(node, NodeFilter.SHOW_COMMENT);
  while (w.nextNode()) out.push(w.currentNode.data.trim());
  const s = out.join(" / ");
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}
function partSelector(i, p, svg) {
  const chain = [];
  for (let n = p.dot ? p.parent : p.node; n && n !== svg; n = n.parentElement) {
    if (n.dataset && n.dataset.id && n.dataset.id !== "figure_1") chain.unshift(n.dataset.id);
  }
  if (p.dot) chain.push(T.dot + " " + p.dot);
  const id = p.node.dataset && p.node.dataset.id;
  if (id === "figure_1" || p.node === svg) return DATA[i].sel + " · " + T.figure;
  const s = svg.getBoundingClientRect(), r = rectOf(p.node);
  const x = Math.round(((r.left + r.right) / 2 - s.left) / s.width * 100), y = Math.round(((r.top + r.bottom) / 2 - s.top) / s.height * 100);
  const base = (id || "").replace(/_\d+$/, "");
  const text = !p.dot && /^(text|xtick|ytick|legend|matplotlib\.axis)$/.test(base) ? textOf(p.node) : "";
  const kind = p.dot ? "" : ` · ${kindOf(p)}${text ? ` "${text}"` : ""}`;
  return `${DATA[i].sel} › ${chain.join(" › ")}${kind} · ${T.pos.replace("{x}", x).replace("{y}", y)}`;
}

// ---- what is under the pointer ----
function resolve(e) {
  const t = e.target;
  if (!(t instanceof Element) || t.closest(".fab, nav, .meta, .editor")) return null;
  const brk = t.closest(".brk");
  if (brk) { const sec = brk.parentElement; return {key: "s" + brk.dataset.i, i: +brk.dataset.i, k: "section", rect: () => R(sec.getBoundingClientRect()), tip: T.section}; }
  const art = t.closest(".art");
  if (art && mode === "select" && art.querySelector("svg")) {
    const svg = art.querySelector("svg"), i = +art.dataset.i, p = partAt(svg, e);
    const key = "f" + i + ":" + (p.node.id || "") + (p.dot ? ":" + p.dot : "");
    return {key, i, k: "part", rect: () => rectOf(p.node), tip: kindOf(p) + (p.node.dataset && p.node.dataset.id && !p.dot ? " " + p.node.dataset.id : ""), sel: () => partSelector(i, p, svg)};
  }
  const el = t.closest(".el");
  if (!el) return null;
  const k = el.dataset.k, i = +el.dataset.i;
  return {key: k + i, i, k, rect: () => R(el.getBoundingClientRect()), tip: T[k] || k};
}
let raf = 0, lastEv = null, current = null;
document.addEventListener("mousemove", e => { lastEv = e; if (!raf) raf = requestAnimationFrame(() => {
  raf = 0; current = resolve(lastEv);
  if (current) place(hoverBox, current.rect(), current.tip); else hide();
}); });
document.addEventListener("mouseleave", hide);
addEventListener("scroll", () => { if (current && !hoverBox.classList.contains("hidden")) place(hoverBox, current.rect(), current.tip); }, {passive: true});
addEventListener("resize", () => { RECTS.clear(); for (const p of picked) place(p.box, p.target.rect(), ""); hide(); });

// ---- copy ----
function section(i) {
  const lvl = DATA[i].level, out = [DATA[i].plain];
  for (let j = i + 1; j < DATA.length; j++) {
    const d = DATA[j];
    if (d.kind === "heading" && d.level <= lvl) break;
    if (!SKIP.has(d.kind) && d.plain) out.push(d.plain);
  }
  return out.join("\n\n");
}
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text; document.body.appendChild(ta); ta.select();
  const ok = document.execCommand("copy"); ta.remove();
  if (!ok) throw new Error("execCommand failed");
}
async function figurePng(i) {
  const d = DATA[i];
  if (d.png) return await (await fetch("data:image/png;base64," + d.png)).blob();
  const node = document.querySelector(`.art[data-i="${i}"] svg, .art[data-i="${i}"] img`);
  const img = new Image();
  img.src = node.tagName === "img" ? node.src : "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(node));
  await img.decode();
  const c = document.createElement("canvas"), s = 2;
  c.width = img.naturalWidth * s; c.height = img.naturalHeight * s;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise(r => c.toBlob(r, "image/png"));
}
async function copyTarget(r) {
  const d = DATA[r.i];
  if (r.k === "figure") await navigator.clipboard.write([new ClipboardItem({"image/png": await figurePng(r.i)})]);
  else if (r.k === "table") await navigator.clipboard.write([new ClipboardItem({
    "text/html": new Blob([d.html], {type: "text/html"}), "text/plain": new Blob([d.plain], {type: "text/plain"})})]);
  else await copyText(r.k === "section" ? section(r.i) : r.k === "caption" ? d.caption : r.k === "path" ? d.path : d.plain);
}
function selectorOf(r) {
  const d = DATA[r.i];
  if (r.k === "part") return r.sel();
  if (r.k === "section") return d.sel_sec;
  if (r.k === "caption") return d.sel_caption;
  if (r.k === "path") return d.sel_path;
  return d.sel;
}
function clearPicked() { for (const p of picked) p.box.remove(); picked = []; document.querySelectorAll(".brk.on").forEach(b => b.classList.remove("on")); }
const toastEl = document.querySelector(".toast");
function toast(msg, bad) {
  toastEl.textContent = msg; toastEl.classList.toggle("bad", !!bad); toastEl.classList.add("show");
  clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove("show"), bad ? 3000 : 2200);
}
document.addEventListener("click", async e => {
  if (!(e.target instanceof Element) || e.target.closest(".fab, .editor")) return;
  const a = e.target.closest("a");
  if (a) {
    if (a.classList.contains("ref")) {
      e.preventDefault();
      const f = document.querySelector(a.getAttribute("href"));
      if (f) f.scrollIntoView({block: "center", behavior: "smooth"});
      history.replaceState(null, "", a.getAttribute("href"));
    }
    return;
  }
  if (String(getSelection())) return;   // the reader was selecting text by hand
  const r = resolve(e);
  if (!r) return;
  if (mode === "edit") { if (!editing) startEdit(r); return; }
  if (mode === "copy") {
    try { await copyTarget(r); toast(T.done + " · " + (T[r.k] || r.k)); }
    catch (err) { console.error(err); toast(T.failed, true); }
    return;
  }
  const sel = selectorOf(r);
  if (!e.shiftKey) clearPicked();
  const at = picked.findIndex(p => p.key === r.key);
  if (at >= 0) { picked[at].box.remove(); picked.splice(at, 1); }
  else { const b = box("picked"); place(b, r.rect(), ""); picked.push({key: r.key, target: r, box: b, sel}); }
  if (!picked.length) return;
  try { await copyText(picked.map(p => p.sel).join("\n")); toast(T.selected.replace("{n}", picked.length) + "\n" + picked.map(p => p.sel).join("\n")); }
  catch (err) { console.error(err); toast(T.failed, true); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && !editing) clearPicked(); });

// ---- edit (only on the --serve page) ----
let editing = null, pendingReload = false;
function reloadKeep() {
  try { sessionStorage.setItem("manuscript-sheet-scroll", String(scrollY)); } catch (e) {}
  location.reload();
}
try {
  const y = sessionStorage.getItem("manuscript-sheet-scroll");
  if (y !== null) { sessionStorage.removeItem("manuscript-sheet-scroll"); history.scrollRestoration = "manual"; scrollTo(0, +y); }
} catch (e) {}
function stopEdit() {
  if (!editing) return;
  editing.editor.remove(); editing.target.style.display = "";
  editing = null;
  if (pendingReload) reloadKeep();
}
function startEdit(r) {
  const d = DATA[r.i];
  if (!EDITABLE || d.src === undefined || ["section", "part", "figure", "path"].includes(r.k)) return;
  const el = r.k === "caption" ? document.querySelector(`.art[data-i="${r.i}"]`).closest(".fig") : document.querySelector(`.el[data-i="${r.i}"]`);
  const editor = document.createElement("div");
  editor.className = "editor";
  editor.innerHTML = '<textarea spellcheck="false"></textarea><div class="ebar"><button type="button" data-e="save"></button><button type="button" data-e="cancel"></button><span></span></div>';
  const ta = editor.querySelector("textarea");
  ta.value = d.src;
  editor.querySelector('[data-e="save"]').textContent = T.save;
  editor.querySelector('[data-e="cancel"]').textContent = T.cancel;
  editor.querySelector("span").textContent = T.hint;
  el.after(editor);
  if (r.k !== "caption") el.style.display = "none";
  editing = {i: r.i, target: el, editor};
  hide();
  const fit = () => { ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 2) + "px"; };
  ta.addEventListener("input", fit); fit(); ta.focus();
  ta.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); stopEdit(); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  });
  editor.addEventListener("click", e => {
    const b = e.target.closest("button[data-e]");
    if (b) { if (b.dataset.e === "save") save(); else stopEdit(); }
  });
  async function save() {
    if (ta.value === d.src) { stopEdit(); return; }
    try {
      const res = await fetch("/edit", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({line: d.line, end: d.end, old: d.src, new: ta.value})});
      const j = await res.json();
      if (!j.ok) { toast(T.conflict, true); pendingReload = true; return; }
      toast(T.saved); pendingReload = true; stopEdit();
    } catch (err) { console.error(err); toast(T.offline, true); }
  }
}
if (EDITABLE && window.EventSource) {
  new EventSource("/events").onmessage = () => { if (editing) pendingReload = true; else reloadKeep(); };
}

// ---- mode switch ----
function setMode(m) {
  if (m === "edit" && !EDITABLE) m = "copy";
  stopEdit();
  mode = m; document.body.dataset.mode = m;
  for (const b of document.querySelectorAll(".fab button")) b.setAttribute("aria-pressed", String(b.dataset.mode === m));
  try { localStorage.setItem("manuscript-sheet-mode", m); } catch (e) {}
  hide(); if (m === "copy") clearPicked();
}
document.querySelector(".fab").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setMode(b.dataset.mode); });
setMode(["select", "edit"].includes(mode) ? mode : "copy");
</script>
</body>
</html>
"""


# ---- --serve: live page with edit mode ------------------------------------------------

def apply_edit(path: Path, line: int, old: str, new: str) -> tuple[bool, int]:
    """Replace the block whose source is `old` with `new`. The block is looked for at
    `line` first, then anywhere if it is there exactly once (lines above it moved). Any
    other state means someone else changed it: nothing is written. Line endings and a
    final newline are kept."""
    raw = path.read_bytes().decode("utf-8")
    nl = "\r\n" if "\r\n" in raw else "\n"
    lines = raw.split(nl)
    want = old.split("\n")
    n = len(want)

    def at(k: int) -> bool:
        return lines[k:k + n] == want

    k = line - 1
    if not (0 <= k and at(k)):
        hits = [j for j in range(len(lines) - n + 1) if at(j)]
        if len(hits) != 1:
            return False, 0
        k = hits[0]
    lines[k:k + n] = new.replace("\r\n", "\n").split("\n")
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(nl.join(lines).encode("utf-8"))
    tmp.replace(path)
    return True, k + 1


def make_server(src: Path, port: int, title: str | None, lang: str, keep_number: bool):
    import threading
    import time
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    watched: list[Path] = [src]
    lock = threading.Lock()

    def render() -> bytes:
        text = src.read_text(encoding="utf-8")
        lines = text.splitlines()
        blocks = parse(text, [src.parent, Path.cwd()])
        files = [src]
        for b in blocks:
            if b["kind"] == "figure":
                files += [Path(b["file"]), Path(b["file"]).with_suffix(".svg")]
        watched[:] = files
        first_h1 = next((inline_plain(b["text"]) for b in blocks if b["kind"] == "heading" and b["level"] == 1), None)
        page, _ = build(blocks, title or first_h1 or src.name, src.as_posix(), lang, keep_number,
                        last_line=len(lines), source_lines=lines)
        return page.encode("utf-8")

    def stamp() -> tuple:
        return tuple(p.stat().st_mtime_ns if p.exists() else 0 for p in list(watched))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path in ("/", "/index.html"):
                self.reply(200, render(), "text/html; charset=utf-8")
            elif path == "/events":
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                last, idle = stamp(), 0
                try:
                    while True:
                        time.sleep(0.5)
                        now = stamp()
                        if now != last:
                            last, idle = now, 0
                            self.wfile.write(b"data: reload\n\n")
                        elif (idle := idle + 1) >= 30:
                            idle = 0
                            self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    return
            else:
                self.reply(404, b"not found", "text/plain")

        def do_POST(self):
            if self.path != "/edit":
                return self.reply(404, b"not found", "text/plain")
            # a JSON content type forces a CORS preflight, which this server never answers,
            # so another site open in the browser cannot write to the manuscript
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                return self.reply(415, b"json only", "text/plain")
            origin = self.headers.get("Origin")
            if origin and origin != f"http://{self.headers.get('Host')}":
                return self.reply(403, b"forbidden", "text/plain")
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                with lock:
                    ok, at = apply_edit(src, int(req["line"]), str(req["old"]), str(req["new"]))
            except (ValueError, KeyError, TypeError):
                return self.reply(400, b"bad request", "text/plain")
            body = json.dumps({"ok": ok, "line": at}).encode()
            self.reply(200 if ok else 409, body, "application/json")

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    return httpd


def serve(src: Path, port: int, title: str | None, lang: str, keep_number: bool, open_browser: bool = True) -> int:
    import webbrowser

    httpd = make_server(src, port, title, lang, keep_number)
    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    print(f"serving {src} at {url} (Ctrl+C to stop)")
    if open_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows 콘솔(cp949)에서 한글이 깨지지 않게
        sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("markdown", type=Path)
    ap.add_argument("--out", type=Path, help="default: the Markdown file with .html")
    ap.add_argument("--title", help="default: the first # heading, else the file name")
    ap.add_argument("--lang", choices=sorted(STRINGS), default="ko")
    ap.add_argument("--keep-number", action="store_true", help='keep "그림 N." in the copied caption')
    ap.add_argument("--serve", action="store_true", help="serve a live page with an edit mode instead of writing a file")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-open", action="store_true", help="with --serve: do not open a browser")
    a = ap.parse_args(argv)
    if a.serve:
        return serve(a.markdown, a.port, a.title, a.lang, a.keep_number, open_browser=not a.no_open)

    src: Path = a.markdown
    text = src.read_text(encoding="utf-8")
    blocks = parse(text, [src.parent, Path.cwd()])
    first_h1 = next((inline_plain(b["text"]) for b in blocks if b["kind"] == "heading" and b["level"] == 1), None)
    out = a.out or src.with_suffix(".html")
    page, missing = build(blocks, a.title or first_h1 or src.name, src.as_posix(), a.lang, a.keep_number,
                          last_line=len(text.splitlines()))
    out.write_text(page, encoding="utf-8")
    figs = sum(b["kind"] == "figure" for b in blocks)
    print(f"wrote {out} ({len(blocks)} blocks, {figs} figures, {out.stat().st_size / 1e6:.1f} MB)")
    for m in missing:
        print(f"missing figure: {m}", file=sys.stderr)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
