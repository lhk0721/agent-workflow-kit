#!/usr/bin/env node
// agent-workflow-kit — screenshot evidence over headless Chrome + CDP. System-owned.
//
// Why this exists: one repo rewrote the same capture script from the session
// scratchpad in four consecutive issues (pipeplot #225, #228, #243, #245), each time
// re-learning the same facts. They are encoded here so no session learns them again:
//   - Chrome's `--screenshot` flag fires right after load. An async or WebGL page is
//     still an empty background at that moment; that is not a rendering bug. This
//     script polls a readiness expression, settles, then asks CDP for the pixels.
//   - `--window-size=390,844` is clamped to the desktop minimum. Phone width needs
//     `Emulation.setDeviceMetricsOverride({ mobile: true, deviceScaleFactor: 2 })`.
//   - The dev server on the expected port may be serving ANOTHER checkout (65 frames
//     of the old page looked like a regression for a whole session). `--serve-check`
//     evaluates an expression on the served page and stops the run when it is falsy.
//   - Chrome can hang mid-capture. Every shot has a timeout; on timeout Chrome is
//     killed, relaunched once, and the shot retried before the run gives up on it.
// Launch details that each cost a session somewhere: address the CDP endpoint as
// 127.0.0.1 (the listener is IPv4-only and `localhost` resolves to ::1 first); a unique
// --user-data-dir per run (a second run otherwise attaches to the first profile);
// --remote-allow-origins=* (or the WebSocket upgrade is rejected); a port of 0 read
// back from DevToolsActivePort (no fixed port to collide on). Screenshots come back
// as base64 over CDP and Node writes them, so Chrome never sees an output path.
//
// Node >= 22 for the global WebSocket (Node 20: `node --experimental-websocket`).
// No npm packages. Windows, macOS and Linux.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULTS = Object.freeze({
  viewports: ['1600x900', '390x844'],
  ready: "document.readyState === 'complete' && document.fonts.status === 'loaded'",
  readyTimeout: 20000,
  settle: 500,
  timeout: 30000,
  probes: [],
  flags: [],
  hide: [],
  paths: [],
  overflow: true,
  reducedMotion: true,
  console: false,
  failOnOverflow: false,
  serveCheck: '',
  base: '',
  chrome: '',
  out: '',
  name: '',
});

// Below this CSS width the shot is taken as a phone: mobile viewport semantics
// (meta viewport honoured, no desktop minimum) at device pixel ratio 2.
export const MOBILE_MAX_WIDTH = 600;

export const USAGE = `usage: node shot.mjs (--url <u> ... | --base <origin> --path <p> ...) [options]

pages
  --url <u>              page to capture (repeatable)
  --base <origin>        origin for --path, e.g. http://127.0.0.1:5173
  --path <p>             path under --base (repeatable)
capture
  --viewport WxH         repeatable; default 1600x900 and 390x844 (width < ${MOBILE_MAX_WIDTH} = phone, dpr 2)
  --ready "<js>"         poll until truthy; default readyState complete + fonts loaded
  --ready-timeout <ms>   default 20000
  --settle <ms>          wait after ready; default 500
  --probe "<js>"         evaluated after settle, value goes into the table (repeatable)
  --overflow / --no-overflow          horizontal overflow check; default on
  --reduced-motion / --no-reduced-motion   emulate prefers-reduced-motion; default on
  --console              record console errors/warnings and uncaught exceptions
  --serve-check "<js>"   must be truthy on the served page (a build id); else stop
  --timeout <ms>         per shot; default 30000 — on timeout Chrome is relaunched once
  --fail-on-overflow     exit 1 when any shot overflows
chrome
  --chrome <path>        else env CHROME, config "chrome", else discovery
  --flags "<flags>"      extra Chrome flags, space separated (added to config flags)
output
  --config <path>        default ./ui-evidence.config.json when present; CLI wins
  --out <dir>            default ./.ui-evidence/<timestamp>/
  --name <label>         file prefix; default from the URL path
  --help
`;

export class UsageError extends Error {}
export class ServeCheckError extends Error {}

const REPEAT = new Set(['url', 'path', 'viewport', 'probe']);
const BOOL = new Set(['overflow', 'reduced-motion', 'console', 'fail-on-overflow', 'help']);
const VALUE = new Set(['base', 'ready', 'ready-timeout', 'settle', 'timeout', 'serve-check', 'chrome', 'flags', 'config', 'out', 'name']);

const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** @param {string[]} argv */
export function parseArgv(argv) {
  /** @type {any} */
  const out = { url: [], path: [], viewport: [], probe: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) throw new UsageError(`unexpected argument: ${tok}`);
    let key = tok.slice(2);
    let val;
    const eq = key.indexOf('=');
    if (eq >= 0) { val = key.slice(eq + 1); key = key.slice(0, eq); }
    if (key.startsWith('no-') && BOOL.has(key.slice(3))) { out[camel(key.slice(3))] = false; continue; }
    if (BOOL.has(key)) { out[camel(key)] = val === undefined ? true : val !== 'false'; continue; }
    if (!REPEAT.has(key) && !VALUE.has(key)) throw new UsageError(`unknown option: --${key}`);
    if (val === undefined) {
      val = argv[++i];
      if (val === undefined) throw new UsageError(`--${key} needs a value`);
    }
    if (REPEAT.has(key)) out[key].push(val);
    else out[camel(key)] = val;
  }
  return out;
}

/** '390x844' -> { width, height, mobile, dpr, label } */
export function parseViewport(spec) {
  const m = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/.exec(String(spec));
  if (!m) throw new UsageError(`bad viewport "${spec}" — expected WxH like 390x844`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width < 1 || height < 1) throw new UsageError(`bad viewport "${spec}"`);
  const mobile = width < MOBILE_MAX_WIDTH;
  return { width, height, mobile, dpr: mobile ? 2 : 1, label: `${width}x${height}` };
}

const toList = (v) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : []);
export const splitFlags = (s) => (typeof s === 'string' ? s.split(/\s+/).filter(Boolean) : toList(s));

function toInt(name, v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`--${name} must be a non-negative number, got "${v}"`);
  return n;
}

/**
 * Merge order: built-in defaults < config file < CLI. Lists on the CLI replace the
 * config list (a repo's "default probes" are what you get when you pass none), except
 * `flags`, which are additive — both sides are "extra Chrome flags".
 * @param {object} config parsed ui-evidence.config.json (may be {})
 * @param {object} cli result of parseArgv
 */
export function mergeConfig(config = {}, cli = {}) {
  /** @type {any} */
  const m = { ...DEFAULTS, unknownKeys: [] };
  for (const [k, v] of Object.entries(config)) {
    if (k === 'flags' || k.startsWith('//') || k === '$schema') continue;
    if (!(k in DEFAULTS)) { m.unknownKeys.push(k); continue; }
    m[k] = Array.isArray(DEFAULTS[k]) ? toList(v) : v;
  }
  m.flags = [...toList(config.flags), ...splitFlags(cli.flags)];
  if (cli.viewport?.length) m.viewports = cli.viewport;
  if (cli.probe?.length) m.probes = cli.probe;
  for (const k of ['ready', 'serveCheck', 'chrome', 'base', 'out', 'name']) if (cli[k] !== undefined) m[k] = cli[k];
  for (const k of ['readyTimeout', 'settle', 'timeout']) if (cli[k] !== undefined) m[k] = cli[k];
  for (const k of ['overflow', 'reducedMotion', 'console', 'failOnOverflow']) if (cli[k] !== undefined) m[k] = cli[k];
  for (const k of ['readyTimeout', 'settle', 'timeout']) m[k] = toInt(k, m[k]);
  for (const k of ['overflow', 'reducedMotion', 'console', 'failOnOverflow']) m[k] = Boolean(m[k]);
  m.viewports = m.viewports.map(parseViewport);
  return m;
}

/** URL path -> file-safe slug: '/' -> 'root', '/about/team?x' -> 'about-team' */
export function slugFromUrl(url) {
  let p = '';
  try { p = new URL(url).pathname; } catch { p = String(url); }
  try { p = decodeURIComponent(p); } catch { /* keep the encoded form */ }
  const s = p.replace(/^\/+|\/+$/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'root';
}

export function pageName(name, slug, pageCount) {
  if (name && pageCount === 1) return name;
  return [name, slug].filter(Boolean).join('-');
}

/** Resolve --url / --base + --path / config paths into [{ url, label }]. */
export function buildPages(merged, cli) {
  const pages = [];
  for (const u of cli.url ?? []) pages.push({ url: u });
  const paths = cli.path?.length ? cli.path : cli.url?.length ? [] : merged.paths;
  if (paths.length) {
    if (!merged.base) throw new UsageError('--path needs --base (or "base" in the config)');
    for (const p of paths) pages.push({ url: joinUrl(merged.base, p) });
  }
  if (!pages.length) throw new UsageError('nothing to capture: give --url, or --base with --path');
  for (const p of pages) p.slug = slugFromUrl(p.url);
  return pages;
}

export function joinUrl(base, path) {
  const b = base.replace(/\/+$/, '');
  const p = String(path).startsWith('/') ? path : `/${path}`;
  return b + p;
}

/** Chrome's profile writes "<port>\n<browser ws path>\n" once DevTools listens. */
export function parseDevToolsActivePort(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim());
  const port = Number(lines[0]);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`DevToolsActivePort has no port: ${JSON.stringify(text)}`);
  return { port, browserPath: lines[1] || '' };
}

/** Ordered discovery list. env.CHROME first, then OS install paths, then PATH. */
export function chromeCandidates({ platform = process.platform, env = process.env } = {}) {
  // Path rules follow the platform being described, not the host, so the list is
  // testable for every OS from any OS.
  const P = platform === 'win32' ? win32 : posix;
  const list = [];
  if (env.CHROME) list.push(env.CHROME);
  if (platform === 'win32') {
    const pf = env.ProgramFiles || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    list.push(P.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    list.push(P.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    if (env.LOCALAPPDATA) list.push(P.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    list.push(P.join(pf, 'Chromium', 'Application', 'chrome.exe'));
    // Edge is Chromium and speaks the same CDP; last resort when Chrome is absent.
    list.push(P.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    list.push(P.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  } else if (platform === 'darwin') {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    list.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    list.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  }
  const names = platform === 'win32'
    ? ['chrome.exe', 'msedge.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];
  for (const dir of (env.PATH || '').split(P.delimiter)) {
    if (!dir) continue;
    for (const n of names) list.push(P.join(dir, n));
  }
  return list;
}

/**
 * @param {{ explicit?: string, platform?: string, env?: object }} opts
 * @param {(p: string) => boolean} exists injectable for tests
 */
export function discoverChrome(opts = {}, exists = existsSync) {
  if (opts.explicit) {
    if (exists(opts.explicit)) return opts.explicit;
    throw new Error(`Chrome not found at ${opts.explicit}`);
  }
  for (const c of chromeCandidates(opts)) if (exists(c)) return c;
  return null;
}

// ---------------------------------------------------------------------------
// CDP client — one page target over one WebSocket.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.dead = null;
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.method}: ${msg.error.message} (${msg.error.code})`));
        else p.resolve(msg.result ?? {});
        return;
      }
      for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
    });
    // A dead socket must fail every waiter, or a hung capture waits forever.
    ws.addEventListener('close', () => this.fail(new Error('CDP connection closed')));
    ws.addEventListener('error', () => this.fail(new Error('CDP connection error')));
  }

  fail(err) {
    this.dead = err;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  send(method, params = {}) {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      try { this.ws.send(JSON.stringify({ id, method, params })); } catch (e) { this.pending.delete(id); reject(e); }
    });
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  off(event, fn) {
    const l = this.listeners.get(event);
    if (l) this.listeners.set(event, l.filter((f) => f !== fn));
  }

  async evaluate(expression, { awaitPromise = false } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`page threw: ${d.exception?.description ?? d.text}`);
    }
    return r.result?.value;
  }
}

async function fetchJson(url, init = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${url} -> HTTP ${r.status}`);
  return r.json();
}

// /json/new is PUT in current Chrome and GET in old ones; try both, then fall back to
// the about:blank page target Chrome opened at launch.
async function newTarget(http) {
  for (const method of ['PUT', 'GET']) {
    try { return await fetchJson(`${http}/json/new?about:blank`, { method }); } catch { /* next */ }
  }
  const list = await fetchJson(`${http}/json/list`);
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('Chrome reports no page target');
  return page;
}

const BASE_FLAGS = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  '--remote-allow-origins=*',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--window-size=1600,900', // the real size comes from device-metrics emulation per shot
];

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}

async function removeDir(dir) {
  // Windows keeps profile files locked for a moment after the process dies.
  for (let i = 0; i < 15; i++) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* retry */ }
    if (!existsSync(dir)) return true;
    await sleep(200);
  }
  return !existsSync(dir);
}

/** @returns {Promise<{cdp: Cdp, version: string, cleanup: () => Promise<void>, cleanupSync: () => void}>} */
async function launchChrome(bin, extraFlags, warn) {
  const profile = mkdtempSync(join(tmpdir(), 'ui-evidence-'));
  const child = spawn(bin, [...BASE_FLAGS, `--user-data-dir=${profile}`, ...extraFlags, 'about:blank'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  let exited = null;
  child.on('exit', (code) => { exited = code ?? -1; });
  const cleanupSync = () => { killTree(child); try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ } };
  const cleanup = async () => {
    killTree(child);
    if (!(await removeDir(profile))) warn(`could not delete Chrome profile ${profile}`);
  };
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    const deadline = Date.now() + 20000;
    let info = null;
    while (Date.now() < deadline) {
      if (exited !== null) throw new Error(`Chrome exited with code ${exited} before DevTools came up\n${output.trim()}`);
      if (existsSync(portFile)) {
        try { info = parseDevToolsActivePort(readFileSync(portFile, 'utf8')); break; } catch { /* partial write */ }
      }
      await sleep(100);
    }
    if (!info) throw new Error(`timed out waiting for DevToolsActivePort in ${profile}\n${output.trim()}`);
    const http = `http://127.0.0.1:${info.port}`;
    let version = '';
    try { version = (await fetchJson(`${http}/json/version`)).Browser || ''; } catch { /* cosmetic */ }
    const target = await newTarget(http);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', () => res(null), { once: true });
      ws.addEventListener('error', () => rej(new Error('CDP WebSocket failed to open')), { once: true });
    });
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    return { cdp, version, cleanup, cleanupSync };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

// ---------------------------------------------------------------------------
// One shot.

// Elements past the right edge widen the page or are cut off; either is what "does it
// fit on a phone" asks. Invisible elements are skipped; everything else is reported and
// the reader decides (an off-canvas drawer shows up here on purpose).
// The edge is the layout viewport, not window.innerWidth alone: under mobile emulation
// Chrome stretches innerWidth to the overflowing content's width (the same thing a phone
// does), so measured against innerWidth the 800px box on a 390px phone is "inside".
const OVERFLOW_SCRIPT = `(() => {
  const de = document.documentElement, body = document.body;
  const cw = de.clientWidth;
  const iw = Math.min(window.innerWidth, cw || window.innerWidth);
  const sw = Math.max(de.scrollWidth, body ? body.scrollWidth : 0);
  const sel = (el) => {
    const parts = [];
    let cur = el;
    for (let depth = 0; cur && cur.nodeType === 1 && cur !== body && depth < 3; depth++) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(s + '#' + cur.id); break; }
      const cls = (typeof cur.className === 'string' ? cur.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const offenders = [];
  for (const el of (body ? body.querySelectorAll('*') : [])) {
    const r = el.getBoundingClientRect();
    if (r.right <= iw + 1 || (r.width === 0 && r.height === 0)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    offenders.push({ selector: sel(el), right: Math.round(r.right), width: Math.round(r.width) });
  }
  offenders.sort((a, b) => b.right - a.right);
  return { innerWidth: iw, scrollWidth: sw, clientWidth: cw, pageScrolls: sw > cw,
           offenderCount: offenders.length, offenders: offenders.slice(0, 5) };
})()`;

const hideScript = (selectors) =>
  `(() => { for (const s of ${JSON.stringify(selectors)}) for (const el of document.querySelectorAll(s)) el.style.visibility = 'hidden'; return true; })()`;

const fmtArg = (a) => (a.value !== undefined ? String(a.value) : a.description ?? a.type);

function waitEvent(cdp, event, ms) {
  return new Promise((res, rej) => {
    const fn = () => { cdp.off(event, fn); clearTimeout(t); res(null); };
    const t = setTimeout(() => { cdp.off(event, fn); rej(new Error(`${event} did not fire`)); }, ms);
    cdp.on(event, fn);
  });
}

async function waitReady(cdp, expr, deadline) {
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      if ((await cdp.evaluate(`!!(${expr})`)) === true) return;
      lastErr = null;
    } catch (e) {
      lastErr = e.message; // mid-navigation the context is gone for a moment; keep polling
    }
    await sleep(100);
  }
  throw new Error(`ready expression never became truthy: ${expr}${lastErr ? ` (last error: ${lastErr})` : ''}`);
}

async function takeShot(session, page, vp, opts, file) {
  const { cdp } = session;
  const consoleBuf = [];
  const onConsole = (p) => { if (p.type === 'error' || p.type === 'warning') consoleBuf.push(`${p.type}: ${(p.args || []).map(fmtArg).join(' ')}`); };
  const onExc = (p) => consoleBuf.push(`uncaught: ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`);
  const onLog = (p) => {
    const e = p.entry;
    if (e && (e.level === 'error' || e.level === 'warning')) consoleBuf.push(`${e.level}: ${e.text}${e.url ? ` (${e.url})` : ''}`);
  };
  if (opts.console) {
    cdp.on('Runtime.consoleAPICalled', onConsole);
    cdp.on('Runtime.exceptionThrown', onExc);
    cdp.on('Log.entryAdded', onLog);
  }
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile,
      screenWidth: vp.width, screenHeight: vp.height,
    });
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: opts.reducedMotion ? 'reduce' : 'no-preference' }],
    });
    const deadline = Date.now() + opts.readyTimeout;
    const loaded = waitEvent(cdp, 'Page.loadEventFired', opts.readyTimeout);
    loaded.catch(() => {});
    const nav = await cdp.send('Page.navigate', { url: page.url });
    if (nav.errorText) throw new Error(`navigation to ${page.url} failed: ${nav.errorText}`);
    // load may never fire on a long-polling page; the readiness expression decides
    await loaded.catch(() => {});
    await waitReady(cdp, opts.ready, deadline);
    if (opts.serveCheck) {
      let raw;
      let threw = null;
      try { raw = await cdp.evaluate(`(${opts.serveCheck})`); } catch (e) { threw = e.message; }
      if (threw || !raw) {
        throw new ServeCheckError(
          `serve check failed on ${page.url}: \`${opts.serveCheck}\` -> ${threw ? `threw (${threw})` : JSON.stringify(raw ?? null)}. `
          + 'The port serves something else (another checkout, a stale build, a different app). '
          + 'Stop, find out what is listening there, and capture again — screenshots of the wrong build are not evidence.'
        );
      }
    }
    if (opts.settle > 0) await sleep(opts.settle);
    if (opts.hide.length) await cdp.evaluate(hideScript(opts.hide));
    const probes = [];
    for (const expr of opts.probes) {
      try { probes.push({ expr, value: await cdp.evaluate(expr, { awaitPromise: true }) }); } catch (e) { probes.push({ expr, error: e.message }); }
    }
    const overflow = opts.overflow ? await cdp.evaluate(OVERFLOW_SCRIPT) : null;
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
    return { probes, overflow, console: consoleBuf };
  } finally {
    cdp.off('Runtime.consoleAPICalled', onConsole);
    cdp.off('Runtime.exceptionThrown', onExc);
    cdp.off('Log.entryAdded', onLog);
  }
}

function withTimeout(promise, ms, what) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} exceeded ${ms} ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// ---------------------------------------------------------------------------
// Report.

export const hasOverflow = (s) => Boolean(s.ok && s.overflow && (s.overflow.pageScrolls || s.overflow.offenderCount > 0));

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

export function viewportLabel(vp) {
  return `${vp.width}x${vp.height}${vp.mobile ? ` (mobile, dpr ${vp.dpr})` : ''}`;
}

function overflowText(s) {
  if (!s.ok) return `— (${s.error})`;
  const o = s.overflow;
  if (!o) return 'not checked';
  if (!o.pageScrolls && o.offenderCount === 0) return 'none';
  const parts = [];
  if (o.pageScrolls) parts.push(`page scrolls: scrollWidth ${o.scrollWidth} > clientWidth ${o.clientWidth}`);
  if (o.offenderCount) {
    const list = o.offenders.map((e) => `\`${e.selector}\` (right ${e.right})`).join(', ');
    parts.push(`${o.offenderCount} past right edge: ${list}${o.offenderCount > o.offenders.length ? ', …' : ''}`);
  }
  return parts.join('; ');
}

const fmtValue = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

function probesText(s) {
  if (!s.ok) return '—';
  if (!s.probes?.length) return '—';
  return s.probes.map((p) => `\`${p.expr}\` = ${p.error ? `error: ${p.error}` : fmtValue(p.value)}`).join('<br>');
}

function consoleText(s, enabled) {
  if (!enabled) return 'off';
  if (!s.ok) return '—';
  const c = s.console || [];
  if (!c.length) return 'clean';
  const errors = c.filter((m) => /^(error|uncaught)/.test(m)).length;
  const head = `${errors} error${errors === 1 ? '' : 's'}, ${c.length - errors} warning${c.length - errors === 1 ? '' : 's'}`;
  return [head, ...c.slice(0, 3)].join('<br>') + (c.length > 3 ? '<br>…' : '');
}

/** Render evidence.md from the result object (also what evidence.json holds). */
export function renderEvidence(r) {
  const o = r.options;
  const lines = [];
  lines.push(`# UI evidence${r.name ? ` — ${r.name}` : ''}`, '');
  lines.push(`- Generated: ${r.generatedAt}`);
  lines.push(`- Base: ${r.base ? `\`${r.base}\`` : '—'}`);
  lines.push(`- Pages: ${r.pages.map((p) => `\`${p.url}\``).join(', ')}`);
  lines.push(`- Commit: ${r.commit || '—'}`);
  lines.push(`- Chrome: ${r.chrome?.version || '?'} (\`${r.chrome?.path || '?'}\`)`);
  lines.push(`- Viewports: ${o.viewports.map(viewportLabel).join(', ')}`);
  lines.push(`- Ready: \`${o.ready}\` · settle ${o.settle} ms · reduced-motion ${o.reducedMotion ? 'on' : 'off'} · per-shot timeout ${o.timeout} ms`);
  lines.push(`- Serve check: ${o.serveCheck ? `\`${o.serveCheck}\`` : 'not set — what the port serves was not verified'}`);
  lines.push(`- Files: \`${r.outDir}\``);
  lines.push('', '| page | viewport | file | overflow | probes | console |', '| --- | --- | --- | --- | --- | --- |');
  for (const s of r.shots) {
    lines.push(`| ${cell(s.page)} | ${cell(viewportLabel(s.viewport))} | ${s.ok ? cell(s.file) : 'FAILED'} | ${cell(overflowText(s))} | ${cell(probesText(s))} | ${cell(consoleText(s, o.console))} |`);
  }
  const failed = r.shots.filter((s) => !s.ok);
  if (failed.length) {
    lines.push('', '## Failed shots', '');
    for (const s of failed) lines.push(`- ${s.page} @ ${viewportLabel(s.viewport)}: ${s.error}`);
  }
  return lines.join('\n') + '\n';
}

function gitCommit() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== '';
    return dirty ? `${sha} (dirty)` : sha;
  } catch { return ''; }
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');

// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  const warn = (m) => process.stderr.write(`shot: ${m}\n`);
  let cli;
  try { cli = parseArgv(argv); } catch (e) { process.stderr.write(`shot: ${e.message}\n\n${USAGE}`); return 2; }
  if (cli.help) { process.stdout.write(USAGE); return 0; }

  const configPath = cli.config || (existsSync('ui-evidence.config.json') ? 'ui-evidence.config.json' : '');
  let config = {};
  if (configPath) {
    try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch (e) { warn(`cannot read config ${configPath}: ${e.message}`); return 2; }
  }
  let opts, pages;
  try { opts = mergeConfig(config, cli); pages = buildPages(opts, cli); } catch (e) { process.stderr.write(`shot: ${e.message}\n\n${USAGE}`); return 2; }
  for (const k of opts.unknownKeys) warn(`config key "${k}" is not known and was ignored`);

  if (typeof WebSocket === 'undefined') {
    warn('global WebSocket is missing — run with Node 22+ or `node --experimental-websocket shot.mjs ...`');
    return 2;
  }
  let chromePath;
  try { chromePath = discoverChrome({ explicit: cli.chrome || process.env.CHROME || opts.chrome }); } catch (e) { warn(e.message); return 2; }
  if (!chromePath) { warn('no Chrome/Chromium/Edge found — pass --chrome <path> or set CHROME'); return 2; }

  const outDir = resolve(opts.out || join('.ui-evidence', stamp()));
  mkdirSync(outDir, { recursive: true });

  const result = {
    name: opts.name, generatedAt: new Date().toISOString(), base: opts.base, pages, commit: gitCommit(),
    chrome: { path: chromePath, version: '' }, outDir,
    options: { viewports: opts.viewports, ready: opts.ready, readyTimeout: opts.readyTimeout, settle: opts.settle, timeout: opts.timeout, reducedMotion: opts.reducedMotion, console: opts.console, serveCheck: opts.serveCheck, probes: opts.probes, hide: opts.hide, flags: opts.flags, config: configPath || null },
    shots: [],
  };

  let session = null;
  const onSignal = () => { if (session) session.cleanupSync(); process.exit(130); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let stop = false;
  try {
    session = await launchChrome(chromePath, opts.flags, warn);
    result.chrome.version = session.version;
    for (const page of pages) {
      for (const vp of opts.viewports) {
        const label = pageName(opts.name, page.slug, pages.length);
        const file = `${label}-${vp.label}.png`;
        let pathLabel = page.url;
        try { pathLabel = new URL(page.url).pathname || page.url; } catch { /* keep the raw string */ }
        const shot = { page: pathLabel, url: page.url, viewport: vp, file, ok: false };
        const started = Date.now();
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const p = takeShot(session, page, vp, opts, join(outDir, file));
            p.catch(() => {}); // after a timeout the abandoned attempt must not surface as unhandled
            Object.assign(shot, await withTimeout(p, opts.timeout, `${file}`), { ok: true });
            delete shot.error;
            break;
          } catch (e) {
            shot.error = e.message;
            if (e instanceof ServeCheckError) { stop = true; break; }
            // A refused connection with Chrome still healthy is the server's fault, not
            // Chrome's — relaunching would only repeat it. Everything else (timeout, dead
            // socket, page error) gets one fresh Chrome.
            const serverDown = session.cdp.dead === null && /navigation to .* failed/.test(e.message);
            if (attempt === 2 || serverDown) {
              shot.error = attempt === 2 ? `${e.message} (after Chrome relaunch)` : e.message;
              break;
            }
            warn(`${file}: ${e.message} — killing Chrome and relaunching once`);
            await session.cleanup();
            session = await launchChrome(chromePath, opts.flags, warn);
          }
        }
        shot.durationMs = Date.now() - started;
        result.shots.push(shot);
        process.stderr.write(`shot: ${shot.ok ? 'ok    ' : 'FAILED'} ${file}${shot.ok && hasOverflow(shot) ? '  [overflow]' : ''}\n`);
        if (stop) break;
      }
      if (stop) break;
    }
  } catch (e) {
    warn(e.message);
    if (!result.shots.length) return 1;
  } finally {
    if (session) await session.cleanup();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  const md = renderEvidence(result);
  writeFileSync(join(outDir, 'evidence.md'), md);
  writeFileSync(join(outDir, 'evidence.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(md);
  process.stdout.write(`\nevidence: ${join(outDir, 'evidence.md')}\n`);

  const failed = result.shots.filter((s) => !s.ok);
  const overflowed = result.shots.filter(hasOverflow);
  if (stop) { process.stderr.write(`shot: ${failed[0]?.error}\n`); return 1; }
  if (failed.length) { process.stderr.write(`shot: ${failed.length} shot(s) failed\n`); return 1; }
  if (opts.failOnOverflow && overflowed.length) { process.stderr.write(`shot: overflow in ${overflowed.length} shot(s) (--fail-on-overflow)\n`); return 1; }
  return 0;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();
if (invokedDirectly) main().then((code) => process.exit(code), (e) => { process.stderr.write(`shot: ${e.stack || e}\n`); process.exit(1); });
