#!/usr/bin/env node
// agent-workflow-kit — issue-start: the first five steps of every issue, done by a script.
// Registers the GitHub issue, creates the branch + worktree from the REMOTE base ref,
// seeds the management doc, the Master Registry row and the AGENTS.md pointer line.
// System-owned.
//
// Run from the repo (any worktree of it; the main checkout is resolved through git):
//   node .claude/skills/issue-start/scripts/issue-start.mjs \
//     --type feature --title "Login form" --slug login-form [--parent 12] \
//     [--issue 34] [--body-file f] [--base origin/main] [--worktree-root sibling|claude] [--dry-run]
//
// It never commits and never pushes: the Pre-Commit Review Gate (show the user, wait for
// approval, then commit) stays with the agent. It never lets a tool create the worktree
// either — `git worktree add` runs here, and the agent only ENTERS the result.
//
// Why a script: every issue in every kit repo starts with the same five steps, and the
// hand-done version drifts (branch named before the issue exists, worktree branched from
// a stale local main, pointer line forgotten). A script does the steps in the one order
// the rulebook allows, or does nothing at all.
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------------
// agent-system.yaml reader. Mirrors .githooks/checks/config.mjs — vendored here on
// purpose: a hand-installed repo may lack .githooks/checks/, and a skill must not fail
// on a missing import. Same subset: `key: value`, `key: []`, `key: [a, b]`, block lists
// of scalars, `#` comments. Keep the two in step.
// ---------------------------------------------------------------------------------
export const CONFIG_DEFAULTS = () => ({
  profile: 'shared',
  team_language: 'en',
  protected_branches: ['main'],
  issue_types: ['feature', 'fix', 'docs', 'chore', 'refactor', 'perf'],
  umbrella_issues: 'per-member',
  issue_first: true,
  issues_root: 'docs/issues',
  worktree_root: 'sibling',
  base_branch: '',
  notes_dir: '',
  doc_pairs: [],
});
const unq = (s) => s.trim().replace(/^["']|["']$/g, '');
const scalar = (s) => { const u = unq(s); return u === 'true' ? true : u === 'false' ? false : u; };
export function parseConfig(text) {
  const cfg = CONFIG_DEFAULTS();
  let listKey = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && listKey) { cfg[listKey].push(unq(item[1])); continue; }
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!kv) continue;
    listKey = null;
    const [, k, v] = kv;
    if (v === '') { cfg[k] = []; listKey = k; }
    else if (/^\[.*\]$/.test(v)) cfg[k] = v.slice(1, -1).split(',').map(unq).filter(Boolean);
    else cfg[k] = scalar(v);
  }
  // A bare `key:` line reads as an empty list; the string-valued keys want ''.
  for (const k of ['base_branch', 'notes_dir', 'issues_root', 'worktree_root']) if (Array.isArray(cfg[k])) cfg[k] = '';
  if (!cfg.issues_root) cfg.issues_root = 'docs/issues';
  if (!cfg.worktree_root) cfg.worktree_root = 'sibling';
  return cfg;
}
export const loadConfig = (path = 'agent-system.yaml') =>
  existsSync(path) ? parseConfig(readFileSync(path, 'utf8')) : CONFIG_DEFAULTS();

// ---------------------------------------------------------------------------------
// Pure helpers (unit-tested in issue-start.test.mjs without git or gh).
// ---------------------------------------------------------------------------------
export function parseArgs(argv) {
  const out = { dryRun: false };
  const takes = { '--type': 'type', '--title': 'title', '--slug': 'slug', '--parent': 'parent',
    '--body-file': 'bodyFile', '--issue': 'issue', '--base': 'base', '--worktree-root': 'worktreeRoot' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { out.dryRun = true; continue; }
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a in takes) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      out[takes[a]] = v;
      continue;
    }
    throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

// Branch names are the system's axis (branch = doc filename = registry key), so the
// slug is normalised once, here, and everything else derives from it.
export const slugify = (s) => String(s).toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');

export const branchName = (issue, type, slug) => `${issue}-${type}-${slug}`;

// `feat` is accepted as an alias of `feature`: some repos predate the kit and keep a
// docs/issues/feat/ directory; the branch token must match the directory the doc lives in.
export function resolveType(input, cfg, dirExists) {
  const t = String(input || '').toLowerCase();
  const canonical = t === 'feat' ? 'feature' : t;
  if (!cfg.issue_types.includes(canonical) && !cfg.issue_types.includes(t)) {
    throw new Error(`type '${input}' is not in issue_types [${cfg.issue_types.join(', ')}] (agent-system.yaml)`);
  }
  const root = cfg.issues_root;
  let token = canonical;
  if (canonical === 'feature' && dirExists(join(root, 'feat')) && !dirExists(join(root, 'feature'))) token = 'feat';
  // Management docs live one level under the root; a repo that keeps sub-issues in
  // <root>/sub-issues/<type>/ and has no <root>/<type>/ uses that instead.
  let docDir = join(root, token);
  if (!dirExists(docDir) && dirExists(join(root, 'sub-issues', token))) docDir = join(root, 'sub-issues', token);
  return { type: token, docDir: docDir.replaceAll('\\', '/') };
}

// sibling: ../<repo-dir>-<issue>  (the rulebook's `git worktree add ../<repo>-<issue>`)
// claude:  <repo>/.claude/worktrees/<issue>-<first two slug words>  (Claude Code's own layout)
export function worktreePath(mode, mainRoot, issue, slug) {
  if (mode === 'sibling') return join(dirname(mainRoot), `${basename(mainRoot)}-${issue}`);
  if (mode === 'claude') return join(mainRoot, '.claude', 'worktrees', `${issue}-${slug.split('-').slice(0, 2).join('-')}`);
  throw new Error(`worktree_root '${mode}' is not sibling|claude`);
}

export function fillTemplate(template, vars) {
  let out = template;
  if (!vars.parent) out = out.replace(/^- Umbrella: #\{parent\}\r?$/m, '- Umbrella: (none)');
  return out.replace(/\{(issue|title|branch|type|parent|date)\}/g, (_, k) => String(vars[k] ?? ''));
}

export const registryRow = (issue, docPath, summary) => `| #${issue} | ${docPath} | in progress | ${summary} |`;

// Append after the last table row so the row lands in the registry table, wherever the
// README keeps it; a README with no table yet gets the kit's header first.
export function appendRegistryRow(text, row) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let last = -1;
  for (let i = 0; i < lines.length; i++) if (/^\|/.test(lines[i])) last = i;
  if (last < 0) {
    const base = text.endsWith('\n') || text === '' ? text : text + '\n';
    return base + (base ? '\n' : '') + '| Issue | Doc | Status | Summary |\n| --- | --- | --- | --- |\n' + row + '\n';
  }
  lines.splice(last + 1, 0, row);
  let out = lines.join('\n');
  if (!out.endsWith('\n')) out += '\n';
  return out;
}

// The branch sits in backticks so context-budget.mjs (which looks for `<branch>`) can
// tell when the pointer outlives its branch.
export const racLine = (branch, docPath, title) => `- \`${branch}\` — \`${docPath}\` — ${title}`;
const RAC_HEAD = /^##+ .*Recent Active Context/i;
const PLACEHOLDER = /^\s*[-*] \((none|없음)\)\s*$/;

// Three shapes exist in the wild: a `- (none)` placeholder (kernel default), a list of
// pointers (possibly with a non-pointer `- Use rule:` line, pipeplot), no section at all.
export function insertRacPointer(text, line) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => RAC_HEAD.test(l));
  if (start < 0) {
    const body = lines.join(nl).replace(/(\r?\n)*$/, '');
    return body + nl + nl + '## Recent Active Context' + nl + nl + line + nl;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##+ /.test(lines[i])) { end = i; break; }
  const section = lines.slice(start + 1, end);
  const ph = section.findIndex((l) => PLACEHOLDER.test(l));
  if (ph >= 0) { lines[start + 1 + ph] = line; return lines.join(nl); }
  let lastBullet = -1;
  for (let i = 0; i < section.length; i++) if (/^\s*[-*] /.test(section[i])) lastBullet = i;
  if (lastBullet >= 0) { lines.splice(start + 1 + lastBullet + 1, 0, line); return lines.join(nl); }
  // Section exists but holds only comments/blank lines: put the pointer before the next heading.
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, ...(at < lines.length && lines[at].trim() === '' ? [line] : [line, '']));
  return lines.join(nl);
}

const isPointer = (l) => /^\s*[-*] /.test(l) && !PLACEHOLDER.test(l) && !/^\s*[-*] Use rule/.test(l);
// A pointer names its branch either in backticks (kit format) or as the first token
// (older hand-written lines). Nothing else on the line is trusted.
const BRANCH_TOKEN = /`(\d+-[a-z]+-[a-z0-9-]+)`|^\s*[-*] (\d+-[a-z]+-[a-z0-9-]+)(?![a-z0-9-])/i;
export function listRacPointers(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => RAC_HEAD.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##+ /.test(lines[i])) break;
    if (!isPointer(lines[i])) continue;
    const m = lines[i].match(BRANCH_TOKEN);
    if (m) out.push({ line: lines[i], branch: m[1] || m[2] });
  }
  return out;
}

// Same as post-pr-cleanup's: whole-token match on the branch, `- (none)` restored when
// the section empties. Duplicated because each skill is copied on its own.
export function removeRacLines(text, branch) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => RAC_HEAD.test(l));
  if (start < 0) return { text, removed: [] };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##+ /.test(lines[i])) { end = i; break; }
  const re = new RegExp(`(^|[^0-9A-Za-z])${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9A-Za-z-])`);
  const removed = [];
  let firstAt = -1;
  for (let i = end - 1; i > start; i--) {
    if (isPointer(lines[i]) && re.test(lines[i])) { removed.unshift(lines[i]); lines.splice(i, 1); firstAt = i; end--; }
  }
  if (!removed.length) return { text, removed };
  const section = lines.slice(start + 1, end);
  if (!section.some(isPointer) && !section.some((l) => PLACEHOLDER.test(l))) lines.splice(firstAt, 0, '- (none)');
  return { text: lines.join(nl), removed };
}

// The next branch's first commit is the sanctioned place to drop pointers whose branch
// no longer exists (git-rules.md: the line leaves as the branch's last commit; a PR-only
// base cannot take the edit afterwards). So the edit that adds the new pointer also drops
// the stale ones, and says which.
export function refreshRac(text, newLine, branchExists) {
  let cur = text;
  const dropped = [];
  for (const p of listRacPointers(text)) {
    if (branchExists(p.branch)) continue;
    const r = removeRacLines(cur, p.branch);
    cur = r.text;
    dropped.push(...r.removed);
  }
  return { text: insertRacPointer(cur, newLine), dropped };
}

// A fresh worktree is a clean checkout: everything gitignored — node_modules, .venv,
// .env — is missing. Name the install commands so the agent does not discover this by
// a failing test run. Never suggest linking node_modules from the main checkout: a
// junction there is followed by `git worktree remove` and `npm ci` and wipes the main
// checkout's dependencies (pipeplot, three incidents).
export function detectPrereqs(dir, exists = existsSync) {
  const has = (f) => exists(join(dir, f));
  const out = [];
  if (has('package.json')) {
    if (has('package-lock.json')) out.push({ marker: 'package-lock.json', command: 'npm ci' });
    else if (has('pnpm-lock.yaml')) out.push({ marker: 'pnpm-lock.yaml', command: 'pnpm install --frozen-lockfile' });
    else if (has('yarn.lock')) out.push({ marker: 'yarn.lock', command: 'yarn install --frozen-lockfile' });
    else out.push({ marker: 'package.json', command: 'npm install' });
  }
  if (has('uv.lock')) out.push({ marker: 'uv.lock', command: 'uv sync' });
  else if (has('pyproject.toml')) out.push({ marker: 'pyproject.toml', command: 'uv sync   (or: pip install -e .)' });
  if (has('requirements.txt') && !has('uv.lock')) out.push({ marker: 'requirements.txt', command: 'python -m venv .venv && pip install -r requirements.txt   (inside .venv)' });
  if (has('.env.example') || has('.env.sample') || has('.env')) out.push({ marker: '.env', command: 'copy .env from the main checkout by hand — it is gitignored and never travels with a worktree' });
  return out;
}

// Kit issue-body template (rulebook/templates.md). The body is English: agent-read.
export function issueBody({ title, parent }) {
  let b = `### Goal\n${title}\n\n### Done criteria\n- [ ] ...\n`;
  if (parent) b += `\n### Umbrella\nSub-issue of #${parent}.\n`;
  return b;
}

export function parseIssueNumber(stdout) {
  const m = String(stdout).match(/\/issues\/(\d+)\b/);
  return m ? Number(m[1]) : null;
}

export const firstCommitCommand = (title, issue) => `git commit -m "chore: ${title} (#${issue})"`;

// Base ref precedence: --base > agent-system.yaml base_branch > origin/HEAD. Always a
// REMOTE ref: a local main may be days behind, and a branch cut from it starts with
// conflicts baked in.
export function resolveBaseRef({ argBase, cfg, symbolicRef, refExists }) {
  if (argBase) return argBase;
  const remote = cfg.profile === 'external' ? 'upstream' : 'origin';
  if (cfg.base_branch) return cfg.base_branch.includes('/') ? cfg.base_branch : `${remote}/${cfg.base_branch}`;
  const head = symbolicRef();                       // refs/remotes/origin/main
  if (head) return head.replace(/^refs\/remotes\//, '');
  if (refExists(`${remote}/main`)) return `${remote}/main`;
  if (refExists(`${remote}/master`)) return `${remote}/master`;
  return null;
}

// ---------------------------------------------------------------------------------
// main — git/gh side effects live only below this line.
// ---------------------------------------------------------------------------------
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryRun = (cmd, args, opts) => { try { return sh(cmd, args, opts); } catch { return null; } };
const fail = (msg) => { console.error('issue-start: ' + msg); process.exit(1); };
const norm = (p) => p.replaceAll('\\', '/');

const USAGE = `usage: node issue-start.mjs --type <t> --title "<title>" --slug <desc>
         [--parent <n>] [--body-file <f>] [--issue <n>] [--base <ref>]
         [--worktree-root sibling|claude] [--dry-run]`;

function printPrereqs(prereqs) {
  console.log('  2. prerequisites a fresh worktree lacks (gitignored; git does not copy them):');
  if (!prereqs.length) console.log('       (none detected from package.json / pyproject.toml / uv.lock / requirements.txt / .env)');
  for (const p of prereqs) console.log(`       ${p.command.padEnd(44)} <- ${p.marker}`);
  console.log('     run installs INSIDE the worktree; never link node_modules from the main checkout');
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { fail(e.message + '\n' + USAGE); }
  if (args.help) { console.log(USAGE); return; }

  // Where are we: any worktree of the repo. The main checkout is the parent of the
  // common git dir; sibling worktrees are named after IT, not after the current worktree.
  const common = tryRun('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) fail('not inside a git repository');
  const mainRoot = norm(resolve(dirname(common)));
  const cfgPath = join(mainRoot, 'agent-system.yaml');
  const cfg = loadConfig(cfgPath);
  if (!existsSync(cfgPath)) console.warn(`issue-start: no agent-system.yaml at ${mainRoot} — using kit defaults`);

  // issue_first: false means the repo names branches without issue numbers; there is
  // nothing for this script to register, and inventing a number would be worse than stopping.
  if (cfg.issue_first === false) {
    fail('agent-system.yaml sets issue_first: false — this repo does not start work from an issue.\n' +
      '  Follow the branch_pattern flow in docs/agent-workflow/git-rules.md instead (branch + doc by hand).');
  }

  if (!args.type) fail('--type is required\n' + USAGE);
  if (!args.slug) fail('--slug is required\n' + USAGE);
  const slug = slugify(args.slug);
  if (!slug) fail(`--slug '${args.slug}' has no usable characters`);
  const mode = args.worktreeRoot || cfg.worktree_root || 'sibling';
  if (!['sibling', 'claude'].includes(mode)) fail(`--worktree-root must be sibling|claude (got '${mode}')`);

  let typeInfo;
  try { typeInfo = resolveType(args.type, cfg, (p) => existsSync(join(mainRoot, p))); } catch (e) { fail(e.message); }
  const { type, docDir } = typeInfo;

  // Refresh remote state first. Branching from a stale remote-tracking ref is the same
  // mistake as branching from a local main, just quieter.
  const fetched = tryRun('git', ['fetch', '--prune'], { cwd: mainRoot });
  if (fetched === null) {
    if (args.dryRun) console.warn('issue-start: git fetch --prune failed (offline?) — dry run continues on stale refs');
    else fail('git fetch --prune failed — fix connectivity first; a branch must start from the current remote base');
  }
  const baseRef = resolveBaseRef({
    argBase: args.base, cfg,
    symbolicRef: () => tryRun('git', ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { cwd: mainRoot }),
    refExists: (r) => tryRun('git', ['rev-parse', '--verify', '--quiet', r], { cwd: mainRoot }) !== null,
  });
  if (!baseRef) fail('cannot resolve the base ref: set base_branch in agent-system.yaml, pass --base, or run `git remote set-head origin --auto`');
  const baseSha = tryRun('git', ['rev-parse', '--verify', '--quiet', baseRef], { cwd: mainRoot });
  if (!baseSha) fail(`base ref '${baseRef}' does not exist locally (after fetch). Pass --base <ref> or fix base_branch.`);
  if (!/\//.test(baseRef)) console.warn(`issue-start: base '${baseRef}' is a local ref — the rulebook wants a remote one (origin/<name>)`);

  // Title: given, or (when reusing an issue) read from GitHub so the doc and pointer say
  // what the issue says.
  let title = args.title;
  if (!title && args.issue) title = tryRun('gh', ['issue', 'view', String(args.issue), '--json', 'title', '-q', '.title'], { cwd: mainRoot });
  if (!title) fail('--title is required (or pass --issue <n> so the title can be read from GitHub)');
  if (args.parent && !/^\d+$/.test(args.parent)) fail('--parent must be an issue number');
  if (args.issue && !/^\d+$/.test(args.issue)) fail('--issue must be an issue number');

  const templatePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'management-doc-template.md');
  if (!existsSync(templatePath)) fail(`template missing: ${templatePath}`);
  const template = readFileSync(templatePath, 'utf8');
  const registryFile = existsSync(join(mainRoot, cfg.issues_root, 'INDEX.md')) ? null : `${cfg.issues_root}/README.md`;
  const richTemplate = existsSync(join(mainRoot, 'docs/agent-workflow/repo-templates.md'));
  const prereqs = detectPrereqs(mainRoot);
  const date = new Date().toISOString().slice(0, 10);

  // ---- dry run: the whole plan, nothing created (no issue either) ----
  if (args.dryRun) {
    const n = args.issue || '<n>';
    const branch = branchName(n, type, slug);
    const wt = norm(worktreePath(mode, mainRoot, n, slug));
    const docPath = `${docDir}/${branch}.md`;
    console.log('issue-start: DRY RUN — nothing will be created\n');
    console.log(`  main checkout   ${mainRoot}`);
    console.log(`  config          ${existsSync(cfgPath) ? cfgPath : '(defaults; no agent-system.yaml)'}  profile=${cfg.profile} worktree_root=${mode}`);
    console.log(`  issue           ${args.issue ? '#' + args.issue + ' (reuse)' : 'gh issue create --title ' + JSON.stringify(title) + (args.bodyFile ? ' --body-file ' + args.bodyFile : ' --body-file <kit template>')}`);
    console.log(`  type            ${type}${type !== args.type.toLowerCase() ? ' (from ' + args.type + ')' : ''}`);
    console.log(`  branch          ${branch}   from ${baseRef} @ ${baseSha.slice(0, 7)}`);
    console.log(`  worktree        ${wt}`);
    console.log(`  management doc  ${wt}/${docPath}`);
    console.log(`  registry        ${registryFile ? registryFile + '  +1 row' : '(INDEX.md exists — registry row skipped)'}`);
    console.log(`  AGENTS.md       ${existsSync(join(mainRoot, 'AGENTS.md')) ? 'pointer line under ## Recent Active Context' : '(missing in repo — pointer skipped)'}`);
    if (args.parent) console.log(`  umbrella        Sub-issue of #${args.parent} (body line only; GitHub sub-issue link is a manual step)`);
    if (richTemplate) console.log('  repo template   docs/agent-workflow/repo-templates.md exists — adapt the seeded doc to it before the first commit');
    console.log('\n  issue body:\n' + (args.bodyFile ? readFileSync(args.bodyFile, 'utf8') : issueBody({ title, parent: args.parent })).replace(/^/gm, '    '));
    console.log(`  sibling-branch check would run: git branch --list '${n}-*'  |  git branch -r --list '*/${n}-*'`);
    printPrereqs(prereqs);
    console.log(`\n  first commit (after user approval):  ${firstCommitCommand(title, n)}`);
    return;
  }

  // ---- 1. issue ----
  let issue = args.issue ? Number(args.issue) : null;
  let issueUrl = null;
  if (!issue) {
    let bodyFile = args.bodyFile;
    let tmp = null;
    if (!bodyFile) {
      tmp = mkdtempSync(join(tmpdir(), 'issue-start-'));
      bodyFile = join(tmp, 'body.md');
      writeFileSync(bodyFile, issueBody({ title, parent: args.parent }));
    }
    const out = tryRun('gh', ['issue', 'create', '--title', title, '--body-file', bodyFile], { cwd: mainRoot, stdio: ['ignore', 'pipe', 'inherit'] });
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    if (out === null) fail('gh issue create failed (is gh installed and logged in? does the repo have a GitHub remote?)');
    issue = parseIssueNumber(out);
    if (!issue) fail('gh issue create printed no issue URL:\n' + out);
    issueUrl = out.split('\n').find((l) => /\/issues\/\d+/.test(l)) || null;
    console.log(`issue-start: created issue #${issue}  ${issueUrl || ''}`);
  } else {
    issueUrl = tryRun('gh', ['issue', 'view', String(issue), '--json', 'url', '-q', '.url'], { cwd: mainRoot });
  }

  // ---- 2. branch name + sibling check (local AND remote) ----
  const branch = branchName(issue, type, slug);
  const local = (tryRun('git', ['branch', '--list', `${issue}-*`, '--format=%(refname:short)'], { cwd: mainRoot }) || '').split('\n').filter(Boolean);
  // '*/<n>-*' rather than '*<n>-*': the latter makes issue 48 collide with origin/248-....
  const remote = (tryRun('git', ['branch', '-r', '--list', `*/${issue}-*`, '--format=%(refname:short)'], { cwd: mainRoot }) || '').split('\n').filter(Boolean);
  if (local.length || remote.length) {
    fail(`a branch for issue #${issue} already exists — continue there instead of creating a second line:\n` +
      [...local.map((b) => '  local   ' + b), ...remote.map((b) => '  remote  ' + b)].join('\n') +
      '\n  (a squash-merged remote branch may still hold commits the local list does not show)');
  }

  // ---- 3. worktree ----
  const wt = norm(worktreePath(mode, mainRoot, issue, slug));
  if (existsSync(wt)) fail(`worktree path already exists: ${wt}`);
  const made = { worktree: null, branch: null };
  const cleanup = (why) => {
    console.error('issue-start: ' + why + ' — rolling back');
    if (made.worktree) tryRun('git', ['worktree', 'remove', '--force', made.worktree], { cwd: mainRoot });
    if (made.branch) tryRun('git', ['branch', '-D', made.branch], { cwd: mainRoot });
    console.error(`issue-start: rolled back. Issue #${issue} still exists on GitHub — reuse it with --issue ${issue} after fixing the cause.`);
    process.exit(1);
  };
  // --no-track: tracking origin/main would make `git pull` merge main into the issue
  // branch. The upstream is set when the user first asks to push (-u origin <branch>).
  const added = tryRun('git', ['worktree', 'add', '--no-track', wt, '-b', branch, baseRef], { cwd: mainRoot });
  if (added === null) fail(`git worktree add ${wt} -b ${branch} ${baseRef} failed`);
  made.worktree = wt; made.branch = branch;

  try {
    // ---- 4. management doc ----
    const docRel = `${docDir}/${branch}.md`;
    const docAbs = join(wt, docRel);
    if (existsSync(docAbs)) throw new Error(`management doc already exists: ${docAbs}`);
    mkdirSync(dirname(docAbs), { recursive: true });
    writeFileSync(docAbs, fillTemplate(template, { issue, title, branch, type, parent: args.parent || '', date }));

    // ---- 5. registry row (README.md unless the repo generates INDEX.md) ----
    let registryNote = '(INDEX.md exists — registry row skipped; the repo generates its index)';
    if (registryFile) {
      const regAbs = join(wt, registryFile);
      const cur = existsSync(regAbs) ? readFileSync(regAbs, 'utf8') : '';
      writeFileSync(regAbs, appendRegistryRow(cur, registryRow(issue, docRel, title)));
      registryNote = `${registryFile}  +1 row`;
    }

    // ---- 6. AGENTS.md pointer (+ drop pointers whose branch is gone) ----
    let racNote = '(AGENTS.md missing in repo — pointer skipped)';
    let dropped = [];
    const agentsAbs = join(wt, 'AGENTS.md');
    if (existsSync(agentsAbs)) {
      const branchExists = (b) =>
        tryRun('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], { cwd: mainRoot }) !== null ||
        (tryRun('git', ['branch', '-r', '--list', `*/${b}`, '--format=%(refname:short)'], { cwd: mainRoot }) || '') !== '';
      const r = refreshRac(readFileSync(agentsAbs, 'utf8'), racLine(branch, docRel, title), branchExists);
      writeFileSync(agentsAbs, r.text);
      dropped = r.dropped;
      racNote = 'pointer line added under ## Recent Active Context' + (dropped.length ? `; ${dropped.length} stale pointer(s) dropped (branch no longer exists)` : '');
    }

    // ---- summary ----
    console.log('\nissue-start: done — nothing is committed yet\n');
    console.log(`  issue           #${issue}  ${issueUrl || ''}`);
    console.log(`  branch          ${branch}   from ${baseRef} @ ${baseSha.slice(0, 7)}`);
    console.log(`  worktree        ${wt}`);
    console.log(`  management doc  ${norm(docAbs)}`);
    console.log(`  registry        ${registryNote}`);
    console.log(`  AGENTS.md       ${racNote}`);
    for (const l of dropped) console.log(`                  dropped: ${l}`);
    console.log('\nnext:');
    console.log(`  1. move in:  EnterWorktree  path: ${wt}`);
    console.log('     (the worktree exists — never let EnterWorktree create one; it would branch from a local ref)');
    printPrereqs(prereqs);
    if (richTemplate) console.log("  3. docs/agent-workflow/repo-templates.md exists — adapt the seeded doc to the repo's own shape before the first commit");
    console.log('  4. show the user the seeded files, wait for approval (Pre-Commit Review Gate), then in the worktree:');
    console.log(`       git add ${docRel}${registryFile ? ' ' + registryFile : ''}${existsSync(agentsAbs) ? ' AGENTS.md' : ''}`);
    console.log(`       ${firstCommitCommand(title, issue)}`);
    console.log("  5. before opening the PR, remove this pointer line from AGENTS.md as the branch's LAST commit (git-rules.md):");
    console.log('     a PR-only base branch cannot take that edit after the merge, and post-pr-cleanup only reports leftovers');
    if (args.parent) {
      console.log(`  6. umbrella: the issue body says "Sub-issue of #${args.parent}"; the GitHub sub-issue link is a separate step:`);
      console.log(`       gh api -X POST repos/{owner}/{repo}/issues/${args.parent}/sub_issues -F sub_issue_id=$(gh api repos/{owner}/{repo}/issues/${issue} --jq .id)`);
    }
  } catch (e) {
    cleanup(e.message);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
