#!/usr/bin/env node
// agent-workflow-kit — tests for shot.mjs. System-owned.
//
// Two layers. The pure functions (argument parsing, viewport rules, config merge
// order, report rendering, DevToolsActivePort parsing, Chrome discovery order) run
// everywhere. One real-Chrome smoke runs only when a Chrome is discoverable, because
// the facts this script encodes — phone width needs emulation, overflow is a number,
// the served build is checked — can only be verified against real pixels. It is
// skipped with a printed reason when Chrome is absent, never silently.
//   node skills/ui-evidence/scripts/shot.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS, UsageError, buildPages, chromeCandidates, discoverChrome, hasOverflow, joinUrl,
  mergeConfig, pageName, parseArgv, parseDevToolsActivePort, parseViewport, renderEvidence,
  slugFromUrl, splitFlags,
} from './shot.mjs';

const SHOT = join(dirname(fileURLToPath(import.meta.url)), 'shot.mjs');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// Async on purpose: the smoke serves its page from THIS process. spawnSync would block
// the event loop, Chrome's request would never be answered, and every shot would sit
// on Page.navigate until the per-shot timeout — which is what happened the first time.
const runShot = (args, timeoutMs = 180000) => new Promise((resolve) => {
  const child = spawn(process.execPath, [SHOT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => child.kill(), timeoutMs);
  child.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});

// --- argument parsing ---------------------------------------------------------

test('parseArgv: repeatables, booleans, --no-, --key=value', () => {
  const a = parseArgv(['--url', 'http://a', '--url', 'http://b', '--viewport', '390x844', '--probe', 'x', '--probe', 'y',
    '--no-overflow', '--console', '--settle=100', '--serve-check', "window.__BUILD_ID === 'x'", '--reduced-motion=false']);
  assert.deepEqual(a.url, ['http://a', 'http://b']);
  assert.deepEqual(a.viewport, ['390x844']);
  assert.deepEqual(a.probe, ['x', 'y']);
  assert.equal(a.overflow, false);
  assert.equal(a.console, true);
  assert.equal(a.settle, '100');
  assert.equal(a.serveCheck, "window.__BUILD_ID === 'x'");
  assert.equal(a.reducedMotion, false);
  assert.equal(a.failOnOverflow, undefined, 'unset booleans stay undefined so the config can decide');
});

test('parseArgv: unknown option, missing value, stray positional are usage errors', () => {
  assert.throws(() => parseArgv(['--bogus', '1']), UsageError);
  assert.throws(() => parseArgv(['--settle']), UsageError);
  assert.throws(() => parseArgv(['http://a']), UsageError);
});

// --- viewports ----------------------------------------------------------------

test('parseViewport: desktop vs phone, dpr, unicode x, rejects junk', () => {
  assert.deepEqual(parseViewport('1600x900'), { width: 1600, height: 900, mobile: false, dpr: 1, label: '1600x900' });
  assert.deepEqual(parseViewport('390x844'), { width: 390, height: 844, mobile: true, dpr: 2, label: '390x844' });
  assert.equal(parseViewport('599x800').mobile, true, 'below 600 is a phone');
  assert.equal(parseViewport('600x800').mobile, false, '600 and up is not');
  assert.equal(parseViewport('390×844').label, '390x844');
  assert.throws(() => parseViewport('wide'), UsageError);
  assert.throws(() => parseViewport('0x10'), UsageError);
});

// --- config merge -------------------------------------------------------------

test('mergeConfig: defaults alone', () => {
  const m = mergeConfig({}, parseArgv([]));
  assert.deepEqual(m.viewports.map((v) => v.label), ['1600x900', '390x844']);
  assert.equal(m.ready, DEFAULTS.ready);
  assert.equal(m.readyTimeout, 20000);
  assert.equal(m.settle, 500);
  assert.equal(m.timeout, 30000);
  assert.equal(m.overflow, true);
  assert.equal(m.reducedMotion, true);
  assert.equal(m.console, false);
  assert.deepEqual(m.flags, []);
});

test('mergeConfig: config overrides defaults, CLI overrides config, flags add up', () => {
  const config = {
    '//': 'comment keys are ignored',
    base: 'http://127.0.0.1:5173',
    viewports: ['1280x720'],
    probes: ['document.title'],
    flags: ['--use-angle=swiftshader'],
    ready: 'window.__frames > 3',
    settle: '900',
    console: true,
    reducedMotion: false,
    hide: ['.cookie-banner'],
    mystery: 1,
  };
  const fromConfig = mergeConfig(config, parseArgv([]));
  assert.deepEqual(fromConfig.viewports.map((v) => v.label), ['1280x720']);
  assert.deepEqual(fromConfig.probes, ['document.title']);
  assert.equal(fromConfig.ready, 'window.__frames > 3');
  assert.equal(fromConfig.settle, 900, 'numeric strings are coerced');
  assert.equal(fromConfig.console, true);
  assert.equal(fromConfig.reducedMotion, false);
  assert.deepEqual(fromConfig.hide, ['.cookie-banner']);
  assert.deepEqual(fromConfig.unknownKeys, ['mystery']);

  const cli = parseArgv(['--viewport', '390x844', '--probe', 'innerWidth', '--flags', '--a --b', '--settle', '0', '--no-console', '--reduced-motion']);
  const m = mergeConfig(config, cli);
  assert.deepEqual(m.viewports.map((v) => v.label), ['390x844'], 'CLI list replaces config list');
  assert.deepEqual(m.probes, ['innerWidth'], 'CLI probes replace config probes');
  assert.deepEqual(m.flags, ['--use-angle=swiftshader', '--a', '--b'], 'flags are additive: config first, then CLI');
  assert.equal(m.settle, 0);
  assert.equal(m.console, false);
  assert.equal(m.reducedMotion, true);
  assert.equal(m.base, 'http://127.0.0.1:5173', 'untouched config values survive');
});

test('mergeConfig: bad numbers are usage errors', () => {
  assert.throws(() => mergeConfig({}, parseArgv(['--timeout', 'soon'])), UsageError);
  assert.throws(() => mergeConfig({ settle: -1 }, parseArgv([])), UsageError);
});

test('splitFlags: string, array, empty', () => {
  assert.deepEqual(splitFlags('--a  --b=1'), ['--a', '--b=1']);
  assert.deepEqual(splitFlags(['--x']), ['--x']);
  assert.deepEqual(splitFlags(undefined), []);
});

// --- pages --------------------------------------------------------------------

test('buildPages: --url, --base + --path, config paths, nothing', () => {
  const m = mergeConfig({ base: 'http://127.0.0.1:5173/', paths: ['/x'] }, parseArgv([]));
  assert.deepEqual(buildPages(m, parseArgv(['--url', 'http://h/about/team?x=1'])).map((p) => [p.url, p.slug]),
    [['http://h/about/team?x=1', 'about-team']]);
  assert.deepEqual(buildPages(m, parseArgv(['--path', '/', '--path', 'docs/'])).map((p) => p.url),
    ['http://127.0.0.1:5173/', 'http://127.0.0.1:5173/docs/']);
  assert.deepEqual(buildPages(m, parseArgv([])).map((p) => p.url), ['http://127.0.0.1:5173/x'], 'config paths are the fallback');
  assert.throws(() => buildPages(mergeConfig({}, parseArgv([])), parseArgv([])), UsageError);
  assert.throws(() => buildPages(mergeConfig({}, parseArgv(['--path', '/'])), parseArgv(['--path', '/'])), UsageError, 'path without base');
});

test('slugFromUrl / pageName / joinUrl', () => {
  assert.equal(slugFromUrl('http://h/'), 'root');
  assert.equal(slugFromUrl('http://h/a/b.html'), 'a-b.html');
  assert.equal(slugFromUrl('http://h/한글/x'), 'x', 'non-ascii collapses; no empty slug');
  assert.equal(pageName('after', 'root', 1), 'after', 'single page keeps the label as given');
  assert.equal(pageName('after', 'about', 2), 'after-about');
  assert.equal(pageName('', 'about', 2), 'about');
  assert.equal(joinUrl('http://h//', 'x'), 'http://h/x');
});

// --- DevToolsActivePort -------------------------------------------------------

test('parseDevToolsActivePort: port + browser path, rejects partial writes', () => {
  assert.deepEqual(parseDevToolsActivePort('9222\n/devtools/browser/abc-123\n'), { port: 9222, browserPath: '/devtools/browser/abc-123' });
  assert.deepEqual(parseDevToolsActivePort('54321\r\n/devtools/browser/x'), { port: 54321, browserPath: '/devtools/browser/x' });
  assert.throws(() => parseDevToolsActivePort(''));
  assert.throws(() => parseDevToolsActivePort('abc\n/x'));
});

// --- Chrome discovery ---------------------------------------------------------

test('chromeCandidates: env CHROME first, Chrome before Edge, PATH last (win32)', () => {
  const env = { CHROME: 'Z:/my/chrome.exe', ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\U\\me\\AppData\\Local', PATH: 'C:\\bin;D:\\tools' };
  const c = chromeCandidates({ platform: 'win32', env });
  assert.equal(c[0], 'Z:/my/chrome.exe');
  const idx = (s) => c.findIndex((p) => p.includes(s));
  assert.ok(idx('PF\\Google\\Chrome') < idx('PF86\\Google\\Chrome'), 'Program Files before (x86)');
  assert.ok(idx('PF86\\Google\\Chrome') < idx('AppData\\Local\\Google'), 'system install before per-user');
  assert.ok(idx('Google\\Chrome') < idx('Microsoft\\Edge'), 'Chrome before Edge');
  assert.ok(idx('Microsoft\\Edge') < idx('C:\\bin'), 'install paths before PATH');
  assert.ok(c.includes(`D:\\tools${sep}msedge.exe`) || c.includes('D:\\tools\\msedge.exe'));
});

test('chromeCandidates: mac app bundles, linux PATH names', () => {
  const mac = chromeCandidates({ platform: 'darwin', env: { PATH: '/usr/local/bin' } });
  assert.equal(mac[0], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.ok(mac.includes('/usr/local/bin/google-chrome'));
  const linux = chromeCandidates({ platform: 'linux', env: { PATH: '/usr/bin:/snap/bin' } });
  assert.deepEqual(linux.slice(0, 5), ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/chrome']);
  assert.ok(linux.includes('/snap/bin/chromium'));
});

test('discoverChrome: first existing candidate wins; explicit path must exist; null when none', () => {
  const env = { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', PATH: '' };
  const exists = (p) => p === 'C:\\PF86\\Google\\Chrome\\Application\\chrome.exe' || p === 'C:\\PF\\Microsoft\\Edge\\Application\\msedge.exe';
  assert.equal(discoverChrome({ platform: 'win32', env }, exists), 'C:\\PF86\\Google\\Chrome\\Application\\chrome.exe');
  assert.equal(discoverChrome({ platform: 'win32', env }, () => false), null);
  assert.equal(discoverChrome({ explicit: '/x/chrome' }, (p) => p === '/x/chrome'), '/x/chrome');
  assert.throws(() => discoverChrome({ explicit: '/nope' }, () => false), /not found/);
});

// --- report -------------------------------------------------------------------

function fakeResult() {
  const desktop = parseViewport('1600x900');
  const phone = parseViewport('390x844');
  return {
    name: 'after', generatedAt: '2026-09-26T00:00:00.000Z', base: 'http://127.0.0.1:5173',
    pages: [{ url: 'http://127.0.0.1:5173/', slug: 'root' }], commit: 'abc1234 (dirty)',
    chrome: { path: 'C:/chrome.exe', version: 'Chrome/140.0.0.0' }, outDir: 'C:/out',
    options: { viewports: [desktop, phone], ready: DEFAULTS.ready, settle: 500, timeout: 30000, reducedMotion: true, console: true, serveCheck: '' },
    shots: [
      { page: '/', viewport: desktop, file: 'after-1600x900.png', ok: true, overflow: { pageScrolls: false, offenderCount: 0, offenders: [] },
        probes: [{ expr: 'getComputedStyle(document.body).fontSize', value: '16px' }, { expr: 'a|b', error: 'page threw: x' }], console: [] },
      { page: '/', viewport: phone, file: 'after-390x844.png', ok: true,
        overflow: { pageScrolls: true, scrollWidth: 812, clientWidth: 390, offenderCount: 7, offenders: [{ selector: 'div#wide', right: 812, width: 800 }, { selector: 'table.data > tr', right: 500, width: 300 }] },
        probes: [], console: ['error: boom', 'warning: meh'] },
      { page: '/', viewport: phone, file: 'x.png', ok: false, error: 'ready expression never became truthy: 1 | 2' },
    ],
  };
}

test('renderEvidence: header, one row per shot, escaping, verdict wording', () => {
  const md = renderEvidence(fakeResult());
  assert.match(md, /^# UI evidence — after\n/);
  assert.match(md, /- Commit: abc1234 \(dirty\)\n/);
  assert.match(md, /- Chrome: Chrome\/140\.0\.0\.0 \(`C:\/chrome\.exe`\)\n/);
  assert.match(md, /- Serve check: not set — what the port serves was not verified/);
  assert.match(md, /\| page \| viewport \| file \| overflow \| probes \| console \|\n\| --- \| --- \| --- \| --- \| --- \| --- \|\n/);
  const rows = md.split('\n').filter((l) => l.startsWith('| /'));
  assert.equal(rows.length, 3);
  assert.match(rows[0], /\| 1600x900 \| after-1600x900\.png \| none \| `getComputedStyle\(document\.body\)\.fontSize` = 16px<br>`a\\\|b` = error: page threw: x \| clean \|/);
  assert.match(rows[1], /\| 390x844 \(mobile, dpr 2\) \| after-390x844\.png \| page scrolls: scrollWidth 812 > clientWidth 390; 7 past right edge: `div#wide` \(right 812\), `table\.data > tr` \(right 500\), … \| — \| 1 error, 1 warning<br>error: boom<br>warning: meh \|/);
  assert.match(rows[2], /\| FAILED \| — \(ready expression never became truthy: 1 \\\| 2\) \| — \| — \|/);
  assert.match(md, /## Failed shots\n\n- \/ @ 390x844 \(mobile, dpr 2\): ready expression/);
  assert.equal(md.split('\n').filter((l) => l.startsWith('| /')).some((l) => /[^\\]\|[^ ]/.test(l.slice(1))), false, 'no unescaped pipes inside cells');
});

test('renderEvidence: console column says off when not captured', () => {
  const r = fakeResult();
  r.options.console = false;
  const md = renderEvidence(r);
  assert.match(md.split('\n').find((l) => l.startsWith('| /')), /\| off \|$/);
});

test('hasOverflow', () => {
  const r = fakeResult();
  assert.equal(hasOverflow(r.shots[0]), false);
  assert.equal(hasOverflow(r.shots[1]), true);
  assert.equal(hasOverflow(r.shots[2]), false, 'a failed shot is not an overflow');
  assert.equal(hasOverflow({ ok: true, overflow: null }), false, 'unchecked is not an overflow');
});

// --- real Chrome smoke --------------------------------------------------------

const SMOKE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>smoke</title>
<style>body{margin:0;font:16px/1.4 sans-serif}#wide{width:800px;height:40px;background:#c33;color:#fff}</style>
</head><body><h1>ui-evidence smoke</h1><div id="wide">800px box — overflows a 390px phone, fits a 1600px desktop</div>
<script>window.__BUILD_ID = 'smoke'; console.error('smoke error');</script></body></html>`;

test('smoke (real Chrome): two PNGs, overflow only at 390x844, serve-check stops a wrong build', async () => {
  const chrome = discoverChrome({ explicit: process.env.CHROME || '' });
  if (!chrome || typeof WebSocket === 'undefined') {
    console.log(`  SKIP: ${!chrome ? 'no Chrome/Chromium/Edge discoverable (set CHROME=<path> to run it)' : 'global WebSocket missing — Node 22+ needed'}`);
    return;
  }
  console.log(`  using ${chrome}`);
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SMOKE_HTML); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const out = mkdtempSync(join(tmpdir(), 'ui-evidence-test-'));
  try {
    const url = `http://127.0.0.1:${port}/demo`;
    const run = (...extra) => runShot(['--url', url, '--name', 'smoke', '--console',
      '--probe', 'getComputedStyle(document.body).fontSize', '--probe', 'document.title', '--out', out, ...extra]);

    const ok = await run('--serve-check', "window.__BUILD_ID === 'smoke'");
    assert.equal(ok.status, 0, `exit ${ok.status}\n--- stdout ---\n${ok.stdout}\n--- stderr ---\n${ok.stderr}`);
    for (const f of ['smoke-1600x900.png', 'smoke-390x844.png']) {
      const p = join(out, f);
      assert.ok(existsSync(p), `${f} missing`);
      assert.ok(statSync(p).size > 2000, `${f} is only ${statSync(p).size} bytes`);
    }
    const json = JSON.parse(readFileSync(join(out, 'evidence.json'), 'utf8'));
    const by = Object.fromEntries(json.shots.map((s) => [s.viewport.label, s]));
    assert.equal(hasOverflow(by['1600x900']), false, JSON.stringify(by['1600x900'].overflow));
    assert.equal(hasOverflow(by['390x844']), true, JSON.stringify(by['390x844'].overflow));
    assert.equal(by['390x844'].viewport.mobile, true);
    assert.equal(by['390x844'].overflow.clientWidth, 390, 'phone width really is 390 — no desktop clamp');
    assert.ok(by['390x844'].overflow.offenders.some((o) => o.selector.includes('#wide')), 'the wide box is named');
    assert.ok(by['390x844'].console.some((m) => m.includes('smoke error')), `console captured: ${JSON.stringify(by['390x844'].console)}`);
    assert.ok(json.chrome.version, 'Chrome version recorded');
    const md = readFileSync(join(out, 'evidence.md'), 'utf8');
    const rows = md.split('\n').filter((l) => l.startsWith('| /demo'));
    assert.equal(rows.length, 2);
    assert.match(rows.find((l) => l.includes('| 1600x900 |')), /\| smoke-1600x900\.png \| none \|/);
    assert.match(rows.find((l) => l.includes('| 390x844')), /\| smoke-390x844\.png \| page scrolls: scrollWidth \d+ > clientWidth 390; \d+ past right edge: /);
    assert.match(md, /`getComputedStyle\(document\.body\)\.fontSize` = 16px<br>`document\.title` = smoke/);

    const bad = await run('--serve-check', "window.__BUILD_ID === 'other'", '--out', join(out, 'bad'));
    assert.equal(bad.status, 1, `expected exit 1\n${bad.stdout}\n${bad.stderr}`);
    assert.match(bad.stderr, /serve check failed .* serves something else/s);
    assert.equal(existsSync(join(out, 'bad', 'smoke-1600x900.png')), false, 'no PNG from a wrong build');
  } finally {
    server.close();
    rmSync(out, { recursive: true, force: true });
  }
});

// --- runner -------------------------------------------------------------------

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`PASS ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${t.name}\n  ${e.stack || e}`);
  }
}
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
