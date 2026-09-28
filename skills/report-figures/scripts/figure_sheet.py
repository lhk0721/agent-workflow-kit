#!/usr/bin/env python3
"""Build one self-contained HTML page that shows every figure of a document, each with
buttons to copy the image, copy its absolute path and copy its caption.

agent-workflow-kit — system-owned. Stdlib only.

    python figure_sheet.py --markdown report.md [--out figures.html] [--title T]
    python figure_sheet.py --manifest figures.json [--out figures.html] [--title T]

Where the figures come from
  --markdown  Every blockquote block that names an image file and carries a caption
              line. The image is a backticked path or a Markdown image link; the caption
              is the block line that starts with "그림 N." / "표 N." / "Figure N." /
              "Fig. N." / "Table N.". Tables rendered to images join the page this way.
              Markdown image links outside blockquotes count too; their alt text is the
              caption. Paths resolve against the Markdown file's folder first, then the
              current folder.
  --manifest  A JSON list of {"file": ..., "caption": ..., "label": ...}; label is
              optional. Paths resolve against the manifest's folder, then the current
              folder.

The page embeds every image as base64, so it opens from disk (file://) and the image
button can write a PNG to the clipboard. A PDF cannot do this: PDF viewers do not let a
button put an image on the clipboard. Print the page to PDF only for reading.

By default the "copy caption" button drops the leading "그림 N." / "표 N." number,
because word processors number captions themselves; --keep-number keeps it.
Exit 1 if a figure file is missing or no figure is found.
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

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp")
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml", ".gif": "image/gif", ".webp": "image/webp"}
CAPTION_RE = re.compile(r"^(?:\*\*)?((?:그림|표|Figure|Fig\.|Table)\s*[\w-]+)[.:](?:\*\*)?\s*(.*)$")
TICK_PATH_RE = re.compile(r"`([^`]+\.(?:png|jpe?g|svg|gif|webp))`", re.I)
MD_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+\.(?:png|jpe?g|svg|gif|webp))\)", re.I)

STRINGS = {
    "ko": {"image": "이미지 복사", "path": "경로 복사", "caption": "캡션 복사",
           "done": "복사 완료", "failed": "복사 실패", "count": "그림 {n}장",
           "source": "원고", "made": "만든 때"},
    "en": {"image": "Copy image", "path": "Copy path", "caption": "Copy caption",
           "done": "Copied", "failed": "Copy failed", "count": "{n} figures",
           "source": "Source", "made": "Built"},
}


def resolve(raw: str, bases: list[Path]) -> Path:
    p = Path(raw)
    if p.is_absolute():
        return p
    for b in bases:
        if (b / p).exists():
            return (b / p).resolve()
    return (bases[0] / p).resolve()


def split_caption(line: str) -> tuple[str, str] | None:
    m = CAPTION_RE.match(line.strip())
    if not m:
        return None
    return m.group(1).strip(), m.group(2).strip()


def from_markdown(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    bases = [path.parent, Path.cwd()]
    figs: list[dict] = []
    block: list[str] = []

    def flush() -> None:
        if not block:
            return
        image, label, caption = None, None, None
        for ln in block:
            if image is None:
                m = TICK_PATH_RE.search(ln) or MD_IMAGE_RE.search(ln)
                if m:
                    image = m.group(1) if m.re is TICK_PATH_RE else m.group(2)
            if caption is None:
                cap = split_caption(ln)
                if cap:
                    label, caption = cap
        if image and caption is not None:
            figs.append({"file": str(resolve(image, bases)), "label": label, "caption": caption})
        block.clear()

    for ln in lines:
        if ln.startswith(">"):
            block.append(ln[1:].strip())
            continue
        flush()
        m = MD_IMAGE_RE.search(ln)
        if m:
            figs.append({"file": str(resolve(m.group(2), bases)), "label": None, "caption": m.group(1).strip()})
    flush()
    return figs


def from_manifest(path: Path) -> list[dict]:
    bases = [path.parent, Path.cwd()]
    rows = json.loads(path.read_text(encoding="utf-8"))
    return [{"file": str(resolve(r["file"], bases)), "label": r.get("label"), "caption": r.get("caption", "")} for r in rows]


def caption_to_copy(fig: dict, keep_number: bool) -> str:
    if keep_number and fig.get("label"):
        return f'{fig["label"]}. {fig["caption"]}'
    return fig["caption"]


def build(figs: list[dict], title: str, source: str, lang: str, keep_number: bool) -> str:
    t = STRINGS[lang]
    cards = []
    for i, fig in enumerate(figs, 1):
        p = Path(fig["file"])
        data = base64.b64encode(p.read_bytes()).decode("ascii")
        src = f"data:{MIME[p.suffix.lower()]};base64,{data}"
        label = fig.get("label") or f"#{i}"
        copy_caption = caption_to_copy(fig, keep_number)
        cards.append(f"""
<section class="fig" id="fig-{i}">
  <header><span class="label">{html.escape(label)}</span><span class="name">{html.escape(p.name)}</span></header>
  <img src="{src}" alt="{html.escape(fig['caption'])}">
  <p class="caption">{html.escape(fig['caption'])}</p>
  <p class="path">{html.escape(str(p))}</p>
  <div class="actions">
    <button data-kind="image">{t['image']}</button>
    <button data-kind="path" data-text="{html.escape(str(p))}">{t['path']}</button>
    <button data-kind="caption" data-text="{html.escape(copy_caption)}">{t['caption']}</button>
  </div>
</section>""")
    meta = f"{t['count'].format(n=len(figs))} · {t['source']} {html.escape(source)} · {t['made']} {datetime.now():%Y-%m-%d %H:%M}"
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>
  :root {{ --ink:#1a1a1a; --ink2:#555; --line:#e3e3e3; --bg:#fff; --soft:#f6f6f6; --accent:#0072B2; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; background:var(--soft); color:var(--ink);
         font-family: Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; }}
  main {{ max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }}
  h1 {{ font-size: 20px; margin: 0 0 4px; }}
  .meta {{ color: var(--ink2); font-size: 13px; margin: 0 0 24px; }}
  .fig {{ background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 0 0 20px; }}
  .fig header {{ display: flex; gap: 12px; align-items: baseline; margin-bottom: 12px; }}
  .label {{ font-weight: 700; }}
  .name {{ color: var(--ink2); font-size: 13px; font-family: ui-monospace, Consolas, monospace; }}
  .fig img {{ display: block; max-width: 100%; height: auto; margin: 0 auto; }}
  .caption {{ margin: 12px 0 4px; line-height: 1.6; }}
  .path {{ margin: 0 0 12px; color: var(--ink2); font-size: 12px; font-family: ui-monospace, Consolas, monospace; overflow-wrap: anywhere; }}
  .actions {{ display: flex; flex-wrap: wrap; gap: 8px; }}
  button {{ font: inherit; font-size: 14px; padding: 6px 14px; border-radius: 6px; cursor: pointer;
           border: 1px solid #bdbdbd; background: #fff; color: var(--ink); min-width: 96px; }}
  button:hover {{ border-color: var(--accent); }}
  button.done {{ border-color: var(--accent); color: var(--accent); }}
  button.failed {{ border-color: #D55E00; color: #D55E00; }}
  @media print {{ body {{ background: #fff; }} .actions, .path {{ display: none; }} .fig {{ break-inside: avoid; border: none; }} }}
</style>
</head>
<body>
<main>
<h1>{html.escape(title)}</h1>
<p class="meta">{meta}</p>
{''.join(cards)}
</main>
<script>
const T = {json.dumps({"done": t["done"], "failed": t["failed"]}, ensure_ascii=False)};
async function imagePng(img) {{
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0);
  return await new Promise(r => c.toBlob(r, "image/png"));
}}
async function copyText(text) {{
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text; document.body.appendChild(ta); ta.select();
  const ok = document.execCommand("copy"); ta.remove();
  if (!ok) throw new Error("execCommand failed");
}}
function flash(btn, ok) {{
  const label = btn.dataset.label || (btn.dataset.label = btn.textContent);
  btn.classList.remove("done", "failed");
  btn.classList.add(ok ? "done" : "failed");
  btn.textContent = ok ? T.done : T.failed;
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {{ btn.textContent = label; btn.classList.remove("done", "failed"); }}, 1500);
}}
document.addEventListener("click", async e => {{
  const btn = e.target.closest("button[data-kind]");
  if (!btn) return;
  try {{
    if (btn.dataset.kind === "image") {{
      const blob = await imagePng(btn.closest(".fig").querySelector("img"));
      await navigator.clipboard.write([new ClipboardItem({{"image/png": blob}})]);
    }} else {{
      await copyText(btn.dataset.text);
    }}
    flash(btn, true);
  }} catch (err) {{
    console.error(err);
    flash(btn, false);
  }}
}});
</script>
</body>
</html>
"""


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--markdown", type=Path)
    src.add_argument("--manifest", type=Path)
    ap.add_argument("--out", type=Path, help="default: figure-sheet.html next to the first figure")
    ap.add_argument("--title", help="default: the source file name")
    ap.add_argument("--lang", choices=sorted(STRINGS), default="ko")
    ap.add_argument("--keep-number", action="store_true", help='keep "그림 N." in the copied caption')
    a = ap.parse_args(argv)

    source = a.markdown or a.manifest
    figs = from_markdown(source) if a.markdown else from_manifest(source)
    if not figs:
        print(f"no figures found in {source}", file=sys.stderr)
        return 1
    missing = [f["file"] for f in figs if not Path(f["file"]).is_file()]
    if missing:
        for m in missing:
            print(f"missing figure: {m}", file=sys.stderr)
        return 1
    out = a.out or Path(figs[0]["file"]).parent / "figure-sheet.html"
    page = build(figs, a.title or source.name, str(source), a.lang, a.keep_number)
    out.write_text(page, encoding="utf-8")
    print(f"wrote {out} ({len(figs)} figures, {out.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
