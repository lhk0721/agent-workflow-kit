---
name: ui-evidence
description: Captures screenshot evidence of rendered pages with headless Chrome over CDP — desktop and phone width (390px, real mobile emulation), readiness-gated so async/WebGL pages are not blank, with a horizontal-overflow verdict, computed-style probes, console errors, and a check that the dev server is serving this checkout — and writes a Markdown table for the work log and PR body. Use it for any UI change that alters what is drawn, before the pre-commit review gate, and whenever someone asks to screenshot, capture, verify visually, compare before/after, or check whether a page fits or is cut off on mobile. Triggers include "스크린샷 찍어", "캡처해서 확인", "before/after", "휴대폰 폭에서", "390px", "모바일에서 잘리는지", "화면 확인해", "렌더링 확인", "verify visually", "screenshot evidence", "check the page renders", "overflow", "does it fit on a phone", "capture the page", and any UI change that alters what is drawn, before the pre-commit review gate.
---

# UI evidence

The review gate wants evidence, not a claim. "Looks fine" is a claim; a PNG at 390×844
with a computed font size and an overflow verdict is evidence. This skill produces the
second thing with one command and tells you where to put it.

## Why a script, and why this one

One repo rewrote the same capture script from the session scratchpad in four consecutive
issues. Each rewrite re-learned the same facts, and each session that did not know them
produced screenshots that were wrong in a way nobody noticed until review:

- Chrome's `--screenshot` flag fires right after `load`. An async or WebGL page is still
  an empty background at that moment. That is not a rendering bug in the page. The
  script instead polls a readiness expression, settles, then asks CDP
  `Page.captureScreenshot` for the pixels.
- `--window-size=390,844` is clamped to the desktop minimum width. The "phone" shot was
  a narrow desktop. Phone width needs `Emulation.setDeviceMetricsOverride({ width: 390,
  height: 844, deviceScaleFactor: 2, mobile: true })`, which the script applies for any
  viewport narrower than 600px.
- A dev server on the expected port was serving **another checkout**. Sixty-five frames
  of the old page looked like a regression for a whole session. The script's
  `--serve-check` evaluates an expression on the served page (a build id, a title, a DOM
  hook only this branch has) and refuses to capture when it is falsy.
- Chrome can hang mid-capture. Every shot has a timeout; on timeout Chrome is killed,
  relaunched once, and the shot retried before the run gives up on it.

`scripts/shot.mjs` encodes all four. Do not write a new one in the scratchpad; extend the
config overlay or this script.

## When

- Any PR that changes rendered output: layout, CSS, a component, a chart, a canvas, a
  theme token. If a pixel moves, the work log needs a capture from after the change.
- Before/after comparisons: run once on the base commit with `--name before`, once on
  the branch with `--name after`, same command otherwise, and put both rows in the table.
- Bug reports of "cut off on mobile", "overlapping", "font too small": capture first,
  then fix, then capture again. The first capture is the reproduction.

Run it before the pre-commit review gate, so the summary the user approves already
contains the table.

## Sequence

1. **Start or verify the dev server.** Never point the script at a port without knowing
   what is behind it. Check with the same eyes the script will use:

   ```
   curl -s http://127.0.0.1:5173/ | head -c 600
   ```

   Look for the title, a build id, or a marker that exists only in this checkout. If the
   port is busy and you did not start the server, find the process (`netstat -ano |
   findstr :5173` on Windows, `lsof -i :5173` elsewhere) before trusting it. Then encode
   that marker as `--serve-check` so the script re-checks on every page. Prefer
   `127.0.0.1` over `localhost` — some dev servers bind IPv4 only while `localhost`
   resolves to `::1` first.

2. **Run the capture** (Node 22+; on Node 20 add `--experimental-websocket`):

   ```
   node <skill>/scripts/shot.mjs --base http://127.0.0.1:5173 --path / --path /settings \
       --name after --console \
       --serve-check "document.querySelector('meta[name=build]')?.content === 'abc1234'" \
       --probe "getComputedStyle(document.querySelector('h1')).fontSize" \
       --probe "document.querySelectorAll('.card').length"
   ```

   Defaults: viewports `1600x900` and `390x844`, readiness
   `document.readyState === 'complete' && document.fonts.status === 'loaded'`, 500 ms
   settle, overflow check on, `prefers-reduced-motion: reduce` on, 30 s per shot.
   Output goes to `./.ui-evidence/<timestamp>/` unless `--out` says otherwise.
   `<skill>` is `.claude/skills/ui-evidence` when installed in the repo.

3. **Read `evidence.md`** and look at the PNGs (the Read tool renders them). The table
   is a summary; the verdict on "does this look right" is yours, from the pixels. An
   overflow of `none` with a squashed layout is still a failed capture.

4. **Paste the table** into the work-log section under `#### Verification` and into the
   PR body. Include the header lines for commit and Chrome version — a table without a
   commit sha cannot be tied to the diff later.

5. **Store the PNGs** where the repo says. When the repo commits captures, copy them to
   `docs/issues/<doc-folder>/captures/` (next to the management doc) and reference them
   from the table's `file` column with a repo-relative path. When the repo does not
   commit captures, leave them in the scratchpad output directory and describe what they
   show in one line each under the table; the probes and the overflow verdict are the
   durable record.

## Per-repo overlay: `ui-evidence.config.json`

A repo that needs the same flags, readiness or probes every time keeps them at the repo
root; the script reads the file when present (or `--config <path>`), and CLI options
win over it. Flags are the one additive field — both sides mean "extra Chrome flags".

```json
{
  "//": "ui-evidence overlay — read by .claude/skills/ui-evidence/scripts/shot.mjs",
  "base": "http://127.0.0.1:5173",
  "paths": ["/", "/settings"],
  "viewports": ["1600x900", "390x844"],
  "ready": "window.__frames > 3 && document.fonts.status === 'loaded'",
  "readyTimeout": 20000,
  "settle": 500,
  "timeout": 30000,
  "probes": ["getComputedStyle(document.body).fontSize"],
  "hide": [".cookie-banner", "#dev-overlay"],
  "serveCheck": "document.documentElement.dataset.build === 'local'",
  "flags": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-gl=angle"],
  "reducedMotion": true,
  "overflow": true,
  "console": true,
  "chrome": "",
  "out": ".ui-evidence"
}
```

| key | meaning |
| --- | --- |
| `base`, `paths` | default origin and pages when the CLI gives no `--url`/`--path` |
| `viewports` | `WxH` list; width < 600 is captured as a phone (mobile emulation, dpr 2) |
| `ready`, `readyTimeout` | expression polled until truthy, and its budget in ms. WebGL pages count frames here |
| `settle` | ms to wait after ready — CSS transitions, layout after fonts |
| `timeout` | per-shot budget; on expiry Chrome is killed and relaunched once |
| `probes` | expressions evaluated after settle; values land in the table |
| `hide` | selectors set to `visibility:hidden` before capture — cookie banners, dev overlays |
| `serveCheck` | expression that must be truthy on the served page, else the run stops |
| `flags` | extra Chrome flags. WebGL-on-headless (SwiftShader) flags are repo-specific and belong here, not in the script; on some Chrome versions they make it exit immediately, so test them in the repo |
| `reducedMotion`, `overflow`, `console` | defaults for the three switches |
| `chrome` | path to the binary when discovery does not find it (`--chrome` and `CHROME` win) |
| `out` | output root; each run makes a timestamped subdirectory |

## Rules that come from the evidence

- **Phone width means emulation.** Any viewport under 600px is captured with
  `mobile: true` and dpr 2. If a page has no `<meta name="viewport">`, mobile emulation
  lays it out at 980px and scales down — the shot then shows the desktop layout shrunk,
  which is itself the finding: the page has no mobile handling.
- **Reduced motion is on by default.** Animations mid-frame make two captures of the
  same state differ, and the diff reads as a regression. Turn it off
  (`--no-reduced-motion`) only when the animation is what is being verified, and say so
  in the table.
- **Readiness is a page fact, not a sleep.** For a canvas or WebGL page expose a frame
  counter (`window.__frames`) or a "scene ready" flag and put it in `ready`. A fixed
  sleep is what produced the blank captures.
- **The overflow verdict is arithmetic**: `scrollWidth > clientWidth` on the document,
  plus every visible element whose `getBoundingClientRect().right` exceeds the layout
  viewport edge by more than 1px (top five selectors named). The edge is
  `min(innerWidth, documentElement.clientWidth)`, not `innerWidth` alone: under mobile
  emulation Chrome stretches `innerWidth` to the overflowing content's width (an 800px
  box on a 390px phone reports `innerWidth` 800), which would hide every offender. An
  off-canvas drawer shows up here on purpose; read the selector and decide.
  `--fail-on-overflow` turns the verdict into exit 1 for CI.
- **When Chrome hangs**, the script already kills and relaunches once per shot. If the
  second attempt also fails, the table row says `FAILED` with the reason; do not loop by
  hand. Raise `--timeout` only when the page genuinely needs longer than 30 s to be
  ready, and write why in the work log.
- **Console errors are evidence too.** Pass `--console`; a `clean` cell next to the PNG
  says the page rendered without throwing. A 404 for a font is the reason a probe shows
  the fallback family.

## Do not

- Do not use Chrome's `--screenshot` flag. It captures before async content exists.
- Do not use `--window-size` for phone width. It is clamped; the emulation override is
  what sets 390px.
- Do not reuse a port you have not verified. `--serve-check` is cheap; a screenshot of
  the wrong build is worse than no screenshot, because it gets approved.
- Do not `strip`, crop or rescale the PNG afterwards. The dpr-2 capture already has real
  pixels; a rescaled image hides the blur that a probe would have caught.
- Do not write a new capture script in the scratchpad. If this one lacks something, add
  it to the overlay or to `shot.mjs` and run `shot.test.mjs`.
- Do not paste the table without the commit line. Evidence that cannot be tied to a diff
  is decoration.

## Files

- `scripts/shot.mjs` — the capture tool; `--help` lists every option. Node ≥ 22 stdlib only.
- `scripts/shot.test.mjs` — unit tests plus a real-Chrome smoke that runs when a Chrome is discoverable:
  `node .claude/skills/ui-evidence/scripts/shot.test.mjs`
- `ui-evidence.config.json` (repo root, optional) — the per-repo overlay described above
