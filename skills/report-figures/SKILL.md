---
name: report-figures
description: Makes figures for documents people read on paper or in a PDF — reports, papers, model write-ups, slides exported to PDF — from one reproducible plotting script. One claim per figure, no explanatory sentences inside the figure and a caption that is only the figure's name (the body text explains it, from a claim line and an in-text line kept next to each figure), gray data charts with one colour-blind-safe accent for the claim, values on the vertical axis, structure drawn as flat 2D box-and-arrow diagrams instead of 3D renders, every figure rendered and looked at before it ships, tables drawn as images like figures, one figure sheet per document whose buttons copy each image, its path and its caption, and a manuscript page where clicking a heading, paragraph, section bracket, table or figure copies it, or in select mode copies a selector down to a single bar, point or label of a figure. Use it whenever a chart, plot, histogram or architecture/flow diagram is about to go into a report or document, and whenever someone says the figures are confusing, cluttered, look AI-made, or need simplifying. Triggers include "그림 만들어", "figure 그려", "기술서 그림", "도식 그려", "구조도", "흐름도", "그래프 단순하게", "그림 안 글씨 빼", "grayscale로", "AI 티 나", "그림이 안 읽혀", "make the figures", "plot for the report", "architecture diagram", "the figure is confusing", "simplify the chart", "remove the text from the figure", "표도 이미지로", "그림 모아 보기", "캡션 복사", "figure sheet", "copy the caption", "캡션 줄여", "본문이 그림을 설명", "그림이 글을 설명하는지", "원고를 웹으로", "원고 복사", "문단 복사", "요소 선택", "selector 복사", "그림 요소 지정", "원고 편집", "페이지에서 고쳐", "실시간 수정", "manuscript page", and any figure destined for a document rather than an interactive dashboard.
---

# Report figures

A figure in a report has one job: let a reader who skips the paragraph still get the
point. Everything in this skill follows from that. It is written for static figures in
documents (PDF, print, word processors, slide exports). An interactive dashboard is a
different medium with different rules; do not apply these to one.

## Why these rules

They come from a model write-up whose figures a team reviewed the day before the
deadline. Every figure was accurate and most were redrawn anyway:

- **3D renders of the model confused readers.** The architecture had been drawn with a
  3D pipeline visualiser: layer stacks in perspective, floating panels, callout text in
  the scene. Readers could not tell what flowed where. The one figure everybody praised
  was a flat six-box flow chart with the handed-over thing written on each arrow.
- **Sentences inside the figure were noise.** Titles such as "X rises but Y does not
  because Z", footnotes inside the axes, legends with parenthetical explanations. They
  duplicated the caption, fought the data for attention, and shrank to unreadable size
  once the figure was scaled to the page width.
- **Saturated default colours read as machine-made.** Blue/orange/green categorical
  palettes on every histogram made the document look generated; the panel titles already
  named each series, so the hue added nothing.
- **All-gray went too far.** The next draft painted everything gray, emphasis included,
  and the emphasised bar no longer stood out. Published guidance never asks for pure
  grayscale: it asks for gray everywhere except the one thing that matters, and for a
  figure that still reads when printed in black and white (see Sources).
- **Values on the horizontal axis were not intuitive.** Dot and dumbbell plots with the
  measured value running left to right had to be decoded. Vertical columns, where
  higher means more, were read at a glance.
- **Small marks vanished.** A latency histogram with a long tail drew eight outliers as
  one-pixel slivers across 400 seconds of empty axis. Nobody saw them.
- **A figure with two claims got neither across.** A layer-by-layer curve also carried a
  second, inflated curve that explained a side point; readers read the wrong line.

## The rules

1. **No explanatory text inside the figure.** Allowed: axis names with units, tick
   labels, value labels on marks, legends of two or three words, the short name of a
   reference line ("baseline 0.13"). Not allowed: sentence titles, suptitles,
   annotation sentences, footnotes, parenthetical legends. Panel titles are labels
   (a domain name, a metric name), never claims. The sentence that says what to look at
   belongs to the body text.
2. **The caption is the figure's name; the body explains it.** `그림 3. 두 번째 모델의
   실수 예측 대 정답.` and nothing more: no conclusion, no reading instructions. Next to
   the caption, the manuscript's figure block carries two working lines that are never
   pasted into the document:
   `요점:` / `Claim:` — the one sentence the figure shows; and
   `본문에 쓸 것:` / `In text:` — everything a reader needs that the figure does not say
   (a truncated axis start, what a colour or dashed line means, what was compared, how a
   value was measured). The body paragraph that mentions the figure states the claim and
   carries the reading notes, numbers included. Whatever leaves the figure goes there in
   the same commit; an encoding nobody explains is a bug.
3. **One claim per figure.** Before drawing, write the claim line.
   If the figure needs two conclusion sentences, drop the secondary curve or panel, or
   split it into two figures. Secondary information usually belongs in a table or the
   text.
4. **Structure is a flat 2D box-and-arrow diagram.** Boxes name components; arrows are
   labelled with what is handed over ("3 real scores", "JSON"), not with verbs. Keep one
   meaning per colour across every diagram in the document, for example one fill for
   "where the model runs", one for "parts we trained", dashed outlines for failure
   paths. No perspective, no layer stacks, no floating callouts. A diagram carries no
   invented conclusion; its claim line says what it lets the reader follow.
5. **Data charts are gray with one accent.** The series that carries the claim gets one
   colour-blind-safe accent (Okabe-Ito blue `#0072B2`); everything else is mid or light
   gray (`#8c8c8c`, `#c9c9c9`); reference lines are dark gray and dashed; a highlighted
   range may sit on a very light tint of the accent. Background white. A chart with no
   single claim-carrying series stays all gray. A second accent (Okabe-Ito vermilion
   `#D55E00`) is allowed only when three categories must be told apart; never red with
   green, never a rainbow scale. The accent must stay darker than the grays so the
   figure still reads printed in black and white, and lightness or line style (solid,
   dashed) carries the distinction too, never hue alone.
6. **Values go on the vertical axis.** Comparisons are vertical columns or lines, higher
   means more. Horizontal bars are for ranked lists whose category names are too long to
   sit under a column. Avoid horizontal dot and dumbbell plots in documents.
7. **Show a difference as a difference.** When the point is "A beats B by this much per
   item", plot the difference from zero as columns instead of two dots per row.
8. **Bars start at zero.** If the axis must be truncated to show a small change, bars
   lie about ratios; use points and lines and state the axis start in the body text (the in-text line).
9. **Keep small marks visible.** A long tail or a handful of rare values goes into an
   overflow bin ("> 100 s") with a count label on every bar. A mark the reader cannot
   see at page width is not in the figure.
10. **One script draws everything, and every figure is looked at.** All figures come
    from one plotting script checked into the repo; never hand-edit a PNG. After each
    change, render and open the image: label collisions, text spilling out of diagram
    boxes, legends over data, overflow. The checker below catches text and colour, not
    layout.
11. **Tables are figures too.** A table that goes into the document is drawn by the same
    script as an image, read from its Markdown source (the manuscript, or a tables file
    the manuscript's table blocks point to) so the two never drift:
    no vertical rules, a heavy rule above and below, a thin rule under the header,
    numbers right-aligned with their header. Measure text with the real font instead of
    estimating widths from character counts; estimates either overlap or leave gaps.
    Its caption sits in the manuscript like a figure's, as `Table n.` / `표 n.`.
    When a cell wraps, break at a clause boundary (after a comma or semicolon) before
    filling to the width, and fill words only inside a clause that alone is too wide.
    The renderer checks every wrapped cell and prints a warning for a break in the middle
    of a clause when a boundary was available, and for a last line holding a single short
    word; fix the text or the column width until the table renders with no warning.
12. **Hand the writer one page per document.** Build a figure sheet: every figure and
    table of the document on one page, each with buttons to copy the image, copy its
    absolute path and copy the caption. The writer pasting into a word processor should
    never hunt for files or retype captions.

## Procedure

1. **Block first.** For each figure write its block in the manuscript: the image path,
   `Figure n. <name>.`, the claim line and the in-text line (rule 2). If the claim does
   not fit one sentence, the figure is not ready to draw (rule 3). A structure diagram's
   claim names what it lets the reader follow, not an invented finding (rule 4).
   - **Text first:** read each section's claims; one about a comparison, a trend, a
     distribution or how parts connect gets a figure block, and that sentence becomes
     its claim. A claim a single number carries needs no figure.
   - **Figure first:** the claim and in-text lines are the brief for whoever writes the
     body; hand them over rather than writing a long caption.
2. **Pick the form from the job.**

   | Job | Form |
   | --- | --- |
   | Compare a few values | vertical columns, value label on each |
   | A changes over steps or time | line with markers, labelled end point |
   | Per-item difference between two methods | difference columns from zero |
   | Distribution | histogram in gray, overflow bin for the tail, counts on bars |
   | Ranking with long names | horizontal bars in gray, the claimed item in the accent |
   | Before/after for two or three things | slope chart, direct labels at both ends |
   | How the parts connect / what happens to one request | 2D box-and-arrow diagram |

3. **Draw it in the plotting script** with `assets/grayscale.mplstyle`
   (`plt.style.use(path)`), then set a font that covers the document's script (for
   Korean, a Hangul font such as Pretendard or Noto Sans KR). Keep diagram helpers
   (box, arrow, label) in the same script so every diagram shares geometry and colour.
   Mark a function that intentionally uses colour with a `figcheck: diagram` comment.
4. **Run the checker.** `python <skills>/report-figures/scripts/figcheck.py <script.py>`
   flags sentence-like strings passed to titles, text, annotations, labels and legends;
   colours that are neither gray, an Okabe-Ito accent nor a light background tint
   outside `figcheck: diagram` functions; more than two accents in one chart; horizontal
   bars; and bar charts with a nonzero axis start. Fix or justify each line.
5. **Render and look.** Regenerate all figures and open each PNG (a contact sheet of
   all figures side by side helps catch inconsistencies). Fix layout by geometry, not
   by shrinking fonts below about 8 pt at final size.
6. **Tie text and figures together.**
   `python <skills>/report-figures/scripts/figure_refs.py <manuscript.md>` fails when a
   caption is more than a name, a block has no claim, or the body never mentions
   `그림 n` / `표 n` / `Figure n` / `Table n`; it warns when the first mention comes after
   the figure and when a number in the claim or in-text line is missing from the body. A
   figure list at the end does not count as a mention (`--stop` sets that heading).
   Then run the **cold-read test**: give a fresh agent with no project context only the
   PNGs and ask, per image, for the one-sentence point and for anything it could not
   tell without explanation. Where its point differs from the claim, fix the figure;
   what it could not tell goes into the in-text line. Regenerate the figure list.
7. **Build the figure sheet.**
   `python <skills>/report-figures/scripts/figure_sheet.py --markdown <manuscript.md>`
   reads every blockquote block that names an image and carries a `그림 n.` / `표 n.` /
   `Figure n.` / `Table n.` caption line, in document order, and writes one
   self-contained HTML page (images embedded) next to the figures. `--manifest` takes a
   JSON list instead. It is HTML, not PDF, on purpose: a PDF viewer cannot put an image
   on the clipboard. The caption button drops the `그림 n.` number by default because
   word processors number captions themselves (`--keep-number` keeps it). Open it in a
   browser; it works from `file://`. Do not commit it: it duplicates every image.
8. **Build the manuscript sheet** when the body text is pasted into a word processor
   too, or when someone reviews the draft and points at parts of it.
   `python <skills>/report-figures/scripts/manuscript_sheet.py <manuscript.md>` writes
   `<manuscript>.html`: the whole manuscript, a bracket line left of each section nested
   by heading depth, "그림 n" references that scroll the figure to the vertical middle of
   the viewport (plain scrolling is never snapped), and a floating switch
   at the bottom right. There are no buttons beside the text, so nothing narrows it.
   - **Copy mode.** Clicking a heading, paragraph, list or table copies it; clicking a
     bracket copies that section (text only, figures skipped, tables as tab-separated
     rows). A figure is copied only by clicking the figure (its PNG); its caption and path
     lines copy the caption and the absolute path. Text is copied plain so the word
     processor applies its template style; tables also carry HTML. Claim and in-text
     lines are shown, never copied.
   - **Select mode.** Clicking copies a selector: file, line and section path for text;
     for a figure, the matplotlib element under the pointer (text, bar or box, line, grid
     line, single point, tick, axis, legend, plot area) with its SVG id path, its text and
     its position. Moving off a small element toward the figure's edge selects the next
     larger group. Shift-click collects several; Esc clears. Paste the selectors into the
     request so the next edit names exactly what to change.
   - **Edit mode**, with `--serve`: the script serves the page on 127.0.0.1 instead of
     writing it. Clicking a heading, paragraph, list, table or caption opens its Markdown
     source in place; Ctrl+Enter writes it back. Only that block's lines are rewritten,
     and the write is refused when the block changed on disk since the page loaded (the
     manuscript may be edited by another person or agent at the same time), so the
     reader copies their text and reloads instead of overwriting. Any change to the
     Markdown or a figure file reloads the page, so edits made in an editor show at once.

   Element-level selection needs an SVG next to each PNG. Save both from the plotting
   script, with stable ids and no date:
   `fig.savefig(path.with_suffix(".svg"), metadata={"Date": None})` and
   `rcParams["svg.hashsalt"] = "<fixed>"`. Keep the default `svg.fonttype = "path"`:
   glyphs stay exact and matplotlib writes each label's text as a comment the selector
   reads. A figure with only a PNG is selected as a whole. Do not commit the HTML.

## What this skill does not do

- Decide whether a claim is true or whether a comparison is fair. For "did B beat A"
  use a pre-registered comparison (`experiment-gate`) before drawing the winner.
- Write the caption prose. Korean captions follow `ko-writing` (§3: caption = figure
  name + conclusion, labels inside the figure are noun phrases).
- Build interactive dashboards. Hover, tooltips and categorical colour systems are a
  different medium; a general data-visualisation palette guide may apply there.

## Files

| File | Purpose |
| --- | --- |
| `assets/grayscale.mplstyle` | matplotlib style: white background, gray cycle (dark → light), light grid, no top/right spines, 200 dpi tight bounding box. No font family; set one for your script's language. |
| `scripts/figcheck.py` | stdlib-only static check of a matplotlib script. Exit 1 on sentence text or a colour outside gray, Okabe-Ito accents and light tints; warnings for more than two accents, horizontal bars and truncated bar axes. |
| `scripts/figcheck_test.py` | Tests for the checker: `python scripts/figcheck_test.py`. |
| `scripts/figure_sheet.py` | stdlib-only builder of the one-page figure sheet: every figure and table with copy-image, copy-path and copy-caption buttons. Exit 1 on a missing file or no figure found. |
| `scripts/figure_sheet_test.py` | Tests for the sheet builder: `python scripts/figure_sheet_test.py`. |
| `scripts/manuscript_sheet.py` | stdlib-only builder of the whole manuscript as one page: section brackets, copy mode (click an element or a bracket to copy it), select mode (click to copy a selector, down to single SVG elements of a figure) and, with `--serve`, edit mode that writes a block back to the Markdown with a conflict check and reloads on file changes. Reuses `figure_sheet.py`'s figure-block reader. Exit 1 on a missing figure file (page still written). |
| `scripts/manuscript_sheet_test.py` | Tests for the manuscript page: `python scripts/manuscript_sheet_test.py`. |
| `scripts/figure_refs.py` | stdlib-only check that captions are names, every block has a claim, and the body mentions every figure and repeats its numbers. |
| `scripts/figure_refs_test.py` | Tests for the reference check: `python scripts/figure_refs_test.py`. |

## Sources

- Rougier, Droettboom, Bourne. "Ten Simple Rules for Better Figures." PLOS Comput Biol
  10(9): e1003833, 2014. Rule 4 (captions are not optional), rule 6 (colour for the
  highlighted element, the rest gray or black), rule 8 (no chartjunk).
- Wilke. *Fundamentals of Data Visualization*, §4.3 (colour as a tool to highlight) and
  ch. 19 (qualitative scales work best with three to five categories; no colour for its
  own sake).
- ACL publication formatting guidelines: grayscale readability strongly encouraged;
  colour allowed but critical distinctions must not rely on colour alone.
- Wong. "Points of view: Color blindness." Nature Methods 8: 441, 2011; Okabe and Ito,
  Color Universal Design, 2008: the accent palette.
- Crameri, Shephard, Heron. "The misuse of colour in science communication." Nat Commun
  11: 5444, 2020: rainbow and red–green maps distort data and exclude readers.
