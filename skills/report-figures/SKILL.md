---
name: report-figures
description: Makes figures for documents people read on paper or in a PDF — reports, papers, model write-ups, slides exported to PDF — from one reproducible plotting script. One claim per figure, no explanatory sentences inside the figure (the caption carries them), grayscale data charts, values on the vertical axis, structure drawn as flat 2D box-and-arrow diagrams instead of 3D renders, and every figure rendered and looked at before it ships. Use it whenever a chart, plot, histogram or architecture/flow diagram is about to go into a report or document, and whenever someone says the figures are confusing, cluttered, look AI-made, or need simplifying. Triggers include "그림 만들어", "figure 그려", "기술서 그림", "도식 그려", "구조도", "흐름도", "그래프 단순하게", "그림 안 글씨 빼", "grayscale로", "AI 티 나", "그림이 안 읽혀", "make the figures", "plot for the report", "architecture diagram", "the figure is confusing", "simplify the chart", "remove the text from the figure", and any figure destined for a document rather than an interactive dashboard.
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
  palettes on every histogram made the document look generated. Grayscale with one dark
  emphasis looked deliberate and printed cleanly.
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
   is the caption's job, and the caption lives in the document.
2. **Whatever leaves the figure moves to the caption.** A truncated axis start, what a
   dashed line means, which bar is emphasised and why — write it into the caption in
   the same commit. A figure is now "labels only", so an unexplained encoding is a bug.
3. **One claim per figure.** Before drawing, write the caption's conclusion sentence.
   If the figure needs two conclusion sentences, drop the secondary curve or panel, or
   split it into two figures. Secondary information usually belongs in a table or the
   text.
4. **Structure is a flat 2D box-and-arrow diagram.** Boxes name components; arrows are
   labelled with what is handed over ("3 real scores", "JSON"), not with verbs. Keep one
   meaning per colour across every diagram in the document, for example one fill for
   "where the model runs", one for "parts we trained", dashed outlines for failure
   paths. No perspective, no layer stacks, no floating callouts. A diagram carries no
   invented conclusion; its caption lists what it shows.
5. **Data charts are grayscale.** Emphasis is one dark gray (about `#333333`); everything
   else is mid or light gray (`#8c8c8c`, `#c9c9c9`); reference lines are dashed.
   Background white. Distinguish series by lightness and by line style (solid, dashed,
   dotted), never by hue alone. Use hue only when the categories are the point and gray
   levels cannot carry them — and even then, one accent colour at most.
6. **Values go on the vertical axis.** Comparisons are vertical columns or lines, higher
   means more. Horizontal bars are for ranked lists whose category names are too long to
   sit under a column. Avoid horizontal dot and dumbbell plots in documents.
7. **Show a difference as a difference.** When the point is "A beats B by this much per
   item", plot the difference from zero as columns instead of two dots per row.
8. **Bars start at zero.** If the axis must be truncated to show a small change, bars
   lie about ratios; use points and lines and state the axis start in the caption.
9. **Keep small marks visible.** A long tail or a handful of rare values goes into an
   overflow bin ("> 100 s") with a count label on every bar. A mark the reader cannot
   see at page width is not in the figure.
10. **One script draws everything, and every figure is looked at.** All figures come
    from one plotting script checked into the repo; never hand-edit a PNG. After each
    change, render and open the image: label collisions, text spilling out of diagram
    boxes, legends over data, overflow. The checker below catches text and colour, not
    layout.

## Procedure

1. **Caption first.** For each figure write `Figure n. <what is drawn>. <conclusion>.`
   in the document. If you cannot write the conclusion in one sentence, the figure is
   not ready to draw (rule 3). Structure diagrams have no conclusion (rule 4).
2. **Pick the form from the job.**

   | Job | Form |
   | --- | --- |
   | Compare a few values | vertical columns, value label on each |
   | A changes over steps or time | line with markers, labelled end point |
   | Per-item difference between two methods | difference columns from zero |
   | Distribution | histogram in gray, overflow bin for the tail, counts on bars |
   | Ranking with long names | horizontal bars, emphasis in dark gray |
   | Before/after for two or three things | slope chart, direct labels at both ends |
   | How the parts connect / what happens to one request | 2D box-and-arrow diagram |

3. **Draw it in the plotting script** with `assets/grayscale.mplstyle`
   (`plt.style.use(path)`), then set a font that covers the document's script (for
   Korean, a Hangul font such as Pretendard or Noto Sans KR). Keep diagram helpers
   (box, arrow, label) in the same script so every diagram shares geometry and colour.
   Mark a function that intentionally uses colour with a `figcheck: diagram` comment.
4. **Run the checker.** `python <skills>/report-figures/scripts/figcheck.py <script.py>`
   flags sentence-like strings passed to titles, text, annotations, labels and legends;
   non-gray colour literals outside `figcheck: diagram` functions; horizontal bars; and
   bar charts with a nonzero axis start. Fix or justify each line.
5. **Render and look.** Regenerate all figures and open each PNG (a contact sheet of
   all figures side by side helps catch inconsistencies). Fix layout by geometry, not
   by shrinking fonts below about 8 pt at final size.
6. **Update the captions** with everything rule 2 moved out of the figures, and
   regenerate the document's figure list if it has one.

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
| `scripts/figcheck.py` | stdlib-only static check of a matplotlib script. Exit 1 on sentence text or non-gray colour; warnings for horizontal bars and truncated bar axes. |
| `scripts/figcheck_test.py` | Tests for the checker: `python scripts/figcheck_test.py`. |
