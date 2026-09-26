#!/usr/bin/env node
// agent-workflow-kit — post-pr-cleanup: refresh state, classify every worktree and branch,
// and (only with --apply) remove what a finished PR left behind. System-owned.
//
//   node .claude/skills/post-pr-cleanup/scripts/post-pr-cleanup.mjs            # dry run: table only
//   node .claude/skills/post-pr-cleanup/scripts/post-pr-cleanup.mjs --apply    # after the user confirmed
//   options: --base <ref>  --json  --assume-landed
//
// Why a script: the cleanup gate in git-rules.md is six checks in a fixed order, and every
// skipped check has a name — rack-tracker holds 13 worktree branches never pushed and 8
// orphan directories git no longer knows; pipeplot spent 5 commits on pointer-line
// bookkeeping. Memory is the wrong tool: the script refreshes state first and decides
// from what git and GitHub say now.
//
// What it never does: touch a worktree with uncommitted work, delete a branch whose commits
// are not provably on the base, delete a directory git does not list, or commit anything.
import { existsSync, lstatSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------------
// agent-system.yaml reader. Mirrors .githooks/checks/config.mjs — vendored on purpose:
// a hand-installed repo may lack .githooks/checks/. Same subset: `key: value`, `key: []`,
// `key: [a, b]`, block lists of scalars, `#` comments. Keep the two in step.
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
  for (const k of ['base_branch', 'notes_dir', 'issues_root', 'worktree_root']) if (Array.isArray(cfg[k])) cfg[k] = '';
  if (!cfg.issues_root) cfg.issues_root = 'docs/issues';
  if (!cfg.worktree_root) cfg.worktree_root = 'sibling';
  return cfg;
}
export const loadConfig = (path = 'agent-system.yaml') =>
  existsSync(path) ? parseConfig(readFileSync(path, 'utf8')) : CONFIG_DEFAULTS();

// ---------------------------------------------------------------------------------
// Pure helpers (unit-tested without git/gh in post-pr-cleanup.test.mjs).
// ---------------------------------------------------------------------------------
export function parseArgs(argv) {
  const out = { apply: false, json: false, assumeLanded: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--json') out.json = true;
    else if (a === '--assume-landed') out.assumeLanded = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--base') { out.base = argv[++i]; if (!out.base || out.base.startsWith('--')) throw new Error('--base needs a value'); }
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

export const norm = (p) => String(p).replaceAll('\\', '/');
// Windows paths compare case-insensitively; git prints them as it stored them.
const samePath = (a, b) => process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);

// `git worktree list --porcelain`: stanzas separated by blank lines; a missing directory
// shows as `prunable <reason>`.
export function parseWorktreeList(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) { if (cur) out.push(cur); cur = null; continue; }
    if (line.startsWith('worktree ')) { cur = { path: norm(line.slice(9)), head: null, branch: null, bare: false, detached: false, prunable: null }; continue; }
    if (!cur) continue;
    if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'bare') cur.bare = true;
    else if (line === 'detached') cur.detached = true;
    else if (line.startsWith('prunable')) cur.prunable = line.slice(8).trim() || 'prunable';
  }
  if (cur) out.push(cur);
  return out;
}

// https://github.com/o/r(.git) | git@github.com:o/r(.git) | ssh://git@github.com(:22)/o/r(.git)
export function parseOriginUrl(url) {
  const u = String(url || '').trim();
  let m = u.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) m = u.match(/^(?:[^@]+@)?([^:/]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/);   // scp-like
  if (!m) return null;
  return { host: m[1].toLowerCase(), owner: m[2], repo: m[3] };
}

export const issueNumberOf = (branch) => { const m = String(branch || '').match(/^(\d+)-/); return m ? Number(m[1]) : null; };

// The decision table. `landed` = every commit on the branch is on the base (cherry-pick
// log empty) OR the PR is MERGED and its head is exactly the local tip (a multi-commit
// squash merge defeats --cherry-pick, the PR head does not). Uncommitted work wins over
// everything: the script never touches it, whatever GitHub says.
export function classify(s) {
  const { prKnown, prState, dirty, landed, missing, assumeLanded } = s;
  if (missing) return { cls: 'prunable', reason: landed ? 'directory gone; branch fully on base' : 'directory gone; branch keeps commits not on base — worktree entry pruned, branch kept' };
  if (dirty) return { cls: 'dirty', reason: 'uncommitted changes — never touched' };
  if (prKnown && (prState === 'OPEN' || prState === 'DRAFT')) return { cls: 'keep-open', reason: `PR ${prState.toLowerCase()}` };
  if (prKnown && prState === 'MERGED') {
    return landed ? { cls: 'remove', reason: 'PR merged, worktree clean, commits on base' }
      : { cls: 'merged-ahead', reason: 'PR merged but the local branch holds commits beyond the merged head — decide' };
  }
  if (prKnown && prState === 'CLOSED') {
    return landed ? { cls: 'remove', reason: 'PR closed without merge, but every commit is on base' }
      : { cls: 'closed-unmerged', reason: 'PR closed without merge; branch holds commits not on base — decide' };
  }
  if (prKnown && !prState) {
    return landed ? { cls: 'landed-no-pr', reason: 'no PR; holds nothing beyond base — landed, or never started; decide' }
      : { cls: 'unpushed', reason: 'no PR; commits not on base — never touched' };
  }
  // gh unavailable or failed: GitHub state unknown.
  if (landed && assumeLanded) return { cls: 'remove', reason: 'PR state unknown (gh unavailable); --assume-landed given and commits are on base' };
  if (landed) return { cls: 'unknown', reason: 'PR state unknown (gh unavailable); commits are on base — rerun with --assume-landed to remove' };
  return { cls: 'unknown', reason: 'PR state unknown (gh unavailable); commits not on base — never touched' };
}

const RAC_HEAD = /^##+ .*Recent Active Context/i;
const PLACEHOLDER = /^\s*[-*] \((none|없음)\)\s*$/;
const isPointer = (l) => /^\s*[-*] /.test(l) && !PLACEHOLDER.test(l) && !/^\s*[-*] Use rule/.test(l);

// Remove the pointer line(s) naming the branch (whole-token match: 7-feature-x must not
// hit 17-feature-x or 7-feature-x-two). Only `- ` lines inside the section are candidates.
// When no pointer is left, the `- (none)` placeholder comes back so the slot reads as
// deliberately empty, not as forgotten.
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

// A pointer is a leftover when its branch just got removed here, or when no such branch
// exists anywhere any more. The rule (git-rules.md) is that the line leaves as the
// branch's LAST commit, so a leftover means that step was skipped — report it always;
// only the solo profile may fix it in place (see main).
export function leftoverPointers(text, { removed, exists }) {
  return listRacPointers(text).map((p) => {
    if (removed.has(p.branch)) return { ...p, why: 'its PR finished and the branch was removed' };
    if (!exists(p.branch)) return { ...p, why: 'no such branch exists locally or on a remote' };
    return null;
  }).filter(Boolean);
}

// Directories that look like worktrees but git no longer lists (rack-tracker: 8 of them).
// Reported only — a directory git does not know might be anything.
export function findOrphans({ mode, mainRoot, known }) {
  const knownSet = known.map((p) => norm(p).toLowerCase());
  const isKnown = (p) => process.platform === 'win32' ? knownSet.includes(norm(p).toLowerCase()) : known.map(norm).includes(norm(p));
  const out = [];
  const scan = (dir, accept) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      if (!accept(e.name)) continue;
      const full = norm(join(dir, e.name));
      if (!isKnown(full) && !samePath(full, mainRoot)) out.push(full);
    }
  };
  if (mode === 'claude') scan(join(mainRoot, '.claude', 'worktrees'), () => true);
  else { const prefix = basename(mainRoot) + '-'; scan(dirname(mainRoot), (n) => n.startsWith(prefix)); }
  return out.sort();
}

export const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

// Remove the link itself, never its target. Verified 2026-09-26 on Windows 11 / Node 24:
// for a junction (`mklink /J`) lstat reports isSymbolicLink() = true, and BOTH unlinkSync
// and rmdirSync remove it with the target left intact; unlinkSync also removes a true
// directory symlink. So unlinkSync first, rmdirSync as the fallback for older Node/Windows
// combinations where unlink refuses a directory reparse point.
export function unlinkJunction(p) {
  try { unlinkSync(p); return 'unlink'; } catch { /* fall through */ }
  rmdirSync(p);
  return 'rmdir';
}

// ---------------------------------------------------------------------------------
// main — everything below talks to git/gh.
// ---------------------------------------------------------------------------------
const GH = process.env.AGENT_KIT_GH || 'gh';   // tests point this at a missing binary to simulate "gh absent"
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryRun = (cmd, args, opts) => { try { return sh(cmd, args, opts); } catch { return null; } };
const fail = (msg) => { console.error('post-pr-cleanup: ' + msg); process.exit(1); };

const USAGE = 'usage: node post-pr-cleanup.mjs [--apply] [--base <ref>] [--json] [--assume-landed]';

function resolveBase(argBase, cfg, cwd) {
  if (argBase) return argBase;
  const remote = cfg.profile === 'external' ? 'upstream' : 'origin';
  if (cfg.base_branch) return cfg.base_branch.includes('/') ? cfg.base_branch : `${remote}/${cfg.base_branch}`;
  const head = tryRun('git', ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { cwd });
  if (head) return head.replace(/^refs\/remotes\//, '');
  for (const c of [`${remote}/main`, `${remote}/master`]) if (tryRun('git', ['rev-parse', '--verify', '--quiet', c], { cwd }) !== null) return c;
  return null;
}

const ghJson = (args, cwd) => { const out = tryRun(GH, args, { cwd }); if (out === null) return null; try { return JSON.parse(out); } catch { return null; } };

function cherryLanded(base, branch, cwd) {
  const out = tryRun('git', ['log', '--right-only', '--cherry-pick', '--oneline', `${base}...${branch}`], { cwd });
  if (out === null) return null;
  return out.trim() === '';
}

function pad(s, w) { s = String(s ?? ''); return s.length >= w ? s : s + ' '.repeat(w - s.length); }
function table(rows, cols) {
  const widths = cols.map((c) => Math.max(c.label.length, ...rows.map((r) => String(c.get(r) ?? '').length)));
  const line = (vals) => '  ' + vals.map((v, i) => pad(v, widths[i])).join('  ').trimEnd();
  const out = [line(cols.map((c) => c.label)), line(widths.map((w) => '-'.repeat(w)))];
  for (const r of rows) out.push(line(cols.map((c) => c.get(r))));
  return out.join('\n');
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { fail(e.message + '\n' + USAGE); }
  if (args.help) { console.log(USAGE); return; }
  const say = (...a) => { if (!args.json) console.log(...a); };

  const common = tryRun('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) fail('not inside a git repository');
  const mainRoot = norm(resolve(dirname(common)));
  const cfg = loadConfig(join(mainRoot, 'agent-system.yaml'));
  const failures = [];
  const step = (label, fn) => { try { const r = fn(); say(`  ok    ${label}`); return r; } catch (e) { failures.push(`${label}: ${e.message.split('\n')[0]}`); say(`  FAIL  ${label}: ${e.message.split('\n')[0]}`); return null; } };

  // 1. refresh — never clean up from memory
  say(`post-pr-cleanup: ${args.apply ? 'APPLY' : 'dry run'}  (main checkout ${mainRoot}, profile ${cfg.profile})`);
  if (tryRun('git', ['fetch', '--all', '--prune'], { cwd: mainRoot }) === null) {
    if (args.apply) fail('git fetch --all --prune failed — cleanup needs current remote state');
    say('  warn  git fetch failed (offline?) — classification uses stale remote refs');
  }
  const base = resolveBase(args.base, cfg, mainRoot);
  if (!base) fail('cannot resolve the base ref: pass --base, set base_branch, or `git remote set-head origin --auto`');
  const baseSha = tryRun('git', ['rev-parse', '--verify', '--quiet', base], { cwd: mainRoot });
  if (!baseSha) fail(`base ref '${base}' does not exist locally`);
  const baseName = base.includes('/') ? base.slice(base.indexOf('/') + 1) : base;
  say(`  base  ${base} @ ${baseSha.slice(0, 7)}`);

  // 2. worktrees
  const wts = parseWorktreeList(sh('git', ['worktree', 'list', '--porcelain'], { cwd: mainRoot }));
  const rows = [];
  let ghSeen = true;
  for (const w of wts) {
    if (w.bare || samePath(w.path, mainRoot)) continue;
    const r = { path: w.path, branch: w.branch, head: w.head, detached: w.detached, missing: !!w.prunable || !existsSync(w.path) };
    if (!r.branch) { r.cls = 'detached'; r.reason = 'detached HEAD — not issue work; decide by hand'; rows.push(r); continue; }
    r.issue = issueNumberOf(r.branch);
    r.dirty = r.missing ? false : (tryRun('git', ['-C', r.path, 'status', '--porcelain=v1', '-uall']) || '') !== '';
    r.junction = r.missing ? false : isLink(join(r.path, 'node_modules'));
    const tip = tryRun('git', ['rev-parse', '--verify', '--quiet', r.branch], { cwd: mainRoot });
    const cherry = cherryLanded(base, r.branch, mainRoot);
    const pr = ghJson(['pr', 'list', '--head', r.branch, '--state', 'all', '--json', 'number,state,mergedAt,url,headRefOid', '--limit', '1'], mainRoot);
    r.prKnown = Array.isArray(pr);
    if (!r.prKnown) ghSeen = false;
    r.pr = r.prKnown && pr.length ? pr[0] : null;
    r.prState = r.pr ? r.pr.state : null;
    r.landed = cherry === true || (r.pr?.state === 'MERGED' && !!tip && r.pr.headRefOid === tip);
    r.landedBy = cherry === true ? 'cherry-pick' : r.landed ? 'pr-head' : null;
    r.issueState = null;
    if (r.issue && r.prKnown) { const iss = ghJson(['issue', 'view', String(r.issue), '--json', 'state,url'], mainRoot); if (iss) { r.issueState = iss.state; r.issueUrl = iss.url; } }
    Object.assign(r, classify({ prKnown: r.prKnown, prState: r.prState, dirty: r.dirty, landed: r.landed, missing: r.missing, assumeLanded: args.assumeLanded }));
    rows.push(r);
  }
  if (!ghSeen) say('  warn  gh unavailable or failed — PR/issue state unknown; nothing is removed unless --assume-landed and commits are on base');

  // 3. orphans (report only)
  const orphans = findOrphans({ mode: cfg.worktree_root, mainRoot, known: wts.map((w) => w.path) });

  say('');
  say(table(rows, [
    { label: 'class', get: (r) => r.cls },
    { label: 'branch', get: (r) => r.branch || '(detached)' },
    { label: 'worktree', get: (r) => r.path },
    { label: 'PR', get: (r) => r.pr ? `#${r.pr.number} ${r.pr.state}` : r.prKnown ? '-' : '?' },
    { label: 'issue', get: (r) => r.issue ? `#${r.issue}${r.issueState ? ' ' + r.issueState : ''}` : '-' },
    { label: 'dirty', get: (r) => r.missing ? 'gone' : r.dirty ? 'yes' : 'no' },
    { label: 'landed', get: (r) => r.landed ? `yes (${r.landedBy})` : 'no' },
    { label: 'nm-link', get: (r) => r.junction ? 'JUNCTION' : '-' },
  ]));
  if (!rows.length) say('  (no worktrees besides the main checkout)');
  for (const r of rows) say(`    ${pad(r.cls, 15)} ${r.branch || r.path}: ${r.reason}`);

  // 4. apply
  const removedBranches = new Set();
  const agentsPath = join(mainRoot, 'AGENTS.md');
  const mainBranch = tryRun('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: mainRoot });
  const mainClean = (tryRun('git', ['status', '--porcelain=v1', '-uno'], { cwd: mainRoot }) || '') === '';
  if (args.apply) {
    say('\napply:');
    // Sync the local base first: `git branch -d` judges "merged" against HEAD, so a main
    // checkout that is behind its remote refuses to delete a branch that did land.
    if (mainBranch === baseName && mainClean) step(`git merge --ff-only ${base}  (main checkout on ${baseName})`, () => sh('git', ['merge', '--ff-only', base], { cwd: mainRoot }));
    else say(`  skip  local ${baseName} not fast-forwarded (main checkout is on '${mainBranch || 'detached'}'${mainClean ? '' : ', has tracked changes'})`);

    for (const r of rows) {
      if (r.cls !== 'remove' && r.cls !== 'prunable') continue;
      say(`- ${r.branch}`);
      if (r.junction) step(`unlink node_modules junction in ${r.path} (link only; target untouched)`, () => unlinkJunction(join(r.path, 'node_modules')));
      if (r.cls === 'prunable') step('git worktree prune', () => sh('git', ['worktree', 'prune'], { cwd: mainRoot }));
      else if (step(`git worktree remove ${r.path}`, () => sh('git', ['worktree', 'remove', r.path], { cwd: mainRoot })) === null) continue;

      if (!r.landed) { say(`  keep  branch ${r.branch} (commits not on base)`); continue; }
      // -d first. After a squash merge git cannot see the merge and -d refuses; the
      // cherry-pick log / PR-head check above is the proof git lacks, so -D is justified
      // by it and only by it.
      const d = tryRun('git', ['branch', '-d', r.branch], { cwd: mainRoot });
      if (d !== null) say(`  ok    git branch -d ${r.branch}`);
      else step(`git branch -D ${r.branch}  (-d refused: squash merge; landed by ${r.landedBy})`, () => sh('git', ['branch', '-D', r.branch], { cwd: mainRoot }));

      const remote = tryRun('git', ['config', `branch.${r.branch}.remote`], { cwd: mainRoot }) || 'origin';
      if (tryRun('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${r.branch}`], { cwd: mainRoot }) !== null) {
        step(`git push ${remote} --delete ${r.branch}`, () => sh('git', ['push', remote, '--delete', r.branch], { cwd: mainRoot }));
      } else say(`  skip  remote branch ${remote}/${r.branch} already gone`);
      removedBranches.add(r.branch);
    }

    // Fork sync (external profile): the pre-push hook forbids pushing the base directly,
    // so the fork's base branch is fast-forwarded through the API instead.
    if (cfg.profile === 'external') {
      const origin = parseOriginUrl(tryRun('git', ['remote', 'get-url', 'origin'], { cwd: mainRoot }));
      if (!origin || origin.host !== 'github.com') say('  skip  fork fast-forward: origin is not a GitHub URL');
      else {
        const sha = tryRun('git', ['rev-parse', base], { cwd: mainRoot });
        step(`gh api -X PATCH repos/${origin.owner}/${origin.repo}/git/refs/heads/${baseName} -f sha=${sha.slice(0, 7)}  (fork fast-forward)`,
          () => sh(GH, ['api', '-X', 'PATCH', `repos/${origin.owner}/${origin.repo}/git/refs/heads/${baseName}`, '-f', `sha=${sha}`], { cwd: mainRoot }));
      }
    }
  }

  // 5. AGENTS.md pointers. The rule is that the line leaves as the branch's LAST commit,
  //    so any pointer still here for a finished branch is reported as a leftover — always.
  //    Only the solo profile may fix it in place: on shared/external the main checkout sits
  //    on a PR-only base that cannot take a direct commit (management-doc.mjs blocks it on
  //    every profile, and the push rule blocks it too), so the fix belongs in the next
  //    branch's first commit (issue-start does that).
  const wouldRemove = new Set(rows.filter((r) => r.cls === 'remove' || (r.cls === 'prunable' && r.landed)).map((r) => r.branch));
  const branchExists = (b) =>
    tryRun('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], { cwd: mainRoot }) !== null ||
    (tryRun('git', ['branch', '-r', '--list', `*/${b}`, '--format=%(refname:short)'], { cwd: mainRoot }) || '') !== '';
  let leftovers = [];
  const racRemoved = [];
  if (existsSync(agentsPath)) {
    let agents = readFileSync(agentsPath, 'utf8');
    leftovers = leftoverPointers(agents, { removed: args.apply ? removedBranches : wouldRemove, exists: branchExists });
    if (args.apply && cfg.profile === 'solo' && leftovers.length) {
      for (const p of leftovers) { const r = removeRacLines(agents, p.branch); agents = r.text; racRemoved.push(...r.removed); }
      writeFileSync(agentsPath, agents);
    }
  }

  // 6. finish: auditable state
  const wtOut = sh('git', ['worktree', 'list'], { cwd: mainRoot });
  const branches = (tryRun('git', ['branch', '--list', '--format=%(refname:short)'], { cwd: mainRoot }) || '').split('\n').filter(Boolean).map((b) => {
    const tags = [];
    if (b !== baseName && cherryLanded(base, b, mainRoot) === true) tags.push('merged');
    const remote = tryRun('git', ['config', `branch.${b}.remote`], { cwd: mainRoot }) || 'origin';
    if (b !== baseName && tryRun('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${b}`], { cwd: mainRoot }) === null) tags.push('unpushed');
    return { branch: b, tags };
  });

  if (args.json) {
    console.log(JSON.stringify({ apply: args.apply, mainRoot, base, baseSha, profile: cfg.profile, rows, orphans, branches, leftovers, racRemoved, failures }, null, 2));
  } else {
    say('\nworktrees:\n' + wtOut.replace(/^/gm, '  '));
    say('\nbranches:');
    for (const b of branches) say(`  ${b.branch}${b.tags.length ? '  [' + b.tags.join('] [') + ']' : ''}`);
    if (branches.some((b) => b.tags.includes('merged'))) say(`  [merged] = holds no commits beyond ${base}: landed, or branched and never started — git cannot tell which`);
    if (orphans.length) {
      say(`\norphan directories (look like worktrees, unknown to git — NOT deleted; inspect, then remove by hand):`);
      for (const o of orphans) say('  ' + o);
    }
    if (leftovers.length) {
      say('\nAGENTS.md pointers:');
      for (const p of leftovers) say(`  leftover pointer for ${p.branch} — it should have been removed on the branch; remove it in your next branch's first commit (${p.why})\n    ${p.line}`);
      if (args.apply && cfg.profile === 'solo') say(`  dropped ${racRemoved.length} line(s) (solo profile) — ${agentsPath} now holds an UNCOMMITTED change; commit it yourself, the script never commits`);
      else if (args.apply) say(`  not edited (profile ${cfg.profile}): a PR-only base branch cannot take this edit here`);
    }
    if (args.apply) {
      const manual = rows.filter((r) => !['remove', 'prunable', 'keep-open'].includes(r.cls));
      if (manual.length) { say('\nstill manual:'); for (const r of manual) say(`  ${pad(r.cls, 15)} ${r.branch || r.path}: ${r.reason}`); }
      const openIssues = rows.filter((r) => (r.cls === 'remove') && r.issueState === 'OPEN');
      for (const r of openIssues) say(`  issue #${r.issue} is still OPEN after its PR finished — close it or record the blocker: gh issue close ${r.issue}`);
      if (failures.length) { say('\nFAILED steps:'); for (const f of failures) say('  ' + f); }
    } else {
      const would = rows.filter((r) => r.cls === 'remove' || r.cls === 'prunable');
      say(`\ndry run: ${would.length} worktree(s) would be removed with --apply${would.length ? ': ' + would.map((r) => r.branch).join(', ') : ''}. Nothing was changed.`);
    }
  }
  process.exit(args.apply && failures.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
