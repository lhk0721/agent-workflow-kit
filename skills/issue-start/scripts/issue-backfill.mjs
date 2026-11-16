#!/usr/bin/env node
// agent-workflow-kit — issue-backfill: give existing issues the Type, label and assignee
// that issue-start now sets at creation. System-owned.
//
//   node .claude/skills/issue-start/scripts/issue-backfill.mjs            # plan only
//   node .claude/skills/issue-start/scripts/issue-backfill.mjs --apply
//     [--state all|open|closed] [--assign-mine] [--set <n>=<type>]...
//
// Closed issues take a type and labels like open ones, so a list that was registered
// with empty sidebars can be made scannable afterwards.
//
// Nothing is guessed from a title. The kit type of an issue is read from where the kit
// already wrote it down: the management document `<issues_root>/**/<n>-<type>-<slug>.md`
// on the base ref, else a branch `<n>-<type>-<slug>` (local or remote). An issue with
// neither is listed and left alone; `--set <n>=<type>` names its type by hand.
//
// It only fills what is empty: an issue that already has a type keeps it, labels are
// added and never removed, and an assignee is set only with --assign-mine, only on issues
// you opened yourself that have nobody assigned (assigning a teammate notifies them).
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, githubTypeFor, labelFor, pickName, ghJson, loadRepoMeta, ensureLabel, setIssueType } from './issue-start.mjs';

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryRun = (cmd, args, opts) => { try { return sh(cmd, args, opts); } catch { return null; } };
const fail = (msg) => { console.error('issue-backfill: ' + msg); process.exit(1); };

// ---- pure ----
export function parseArgs(argv) {
  const out = { apply: false, state: 'all', assignMine: false, set: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--assign-mine') out.assignMine = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--state') {
      const v = argv[++i];
      if (!['all', 'open', 'closed'].includes(v)) throw new Error('--state must be all|open|closed');
      out.state = v;
    } else if (a === '--set') {
      const m = String(argv[++i] || '').match(/^#?(\d+)=([a-z]+)$/i);
      if (!m) throw new Error('--set wants <issue>=<type>, e.g. --set 31=feature');
      out.set[Number(m[1])] = m[2].toLowerCase();
    } else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

// `<n>-<type>-<slug>` at the end of a path or ref: docs/issues/fix/54-fix-x.md,
// origin/54-fix-x, 54-fix-x. The slash (or start) before the number keeps
// `origin/248-…` from being read as issue 48.
const NAME = /(?:^|\/)(\d+)-([a-z]+)-[a-z0-9][a-z0-9-]*(?:\.md)?$/i;
export function typesFromNames(names, known) {
  const out = {};
  for (const raw of names) {
    const m = String(raw).trim().match(NAME);
    if (!m) continue;
    const t = m[2].toLowerCase() === 'feat' ? 'feature' : m[2].toLowerCase();
    if (!known.includes(t)) continue;
    const n = Number(m[1]);
    if (!(n in out)) out[n] = t;
  }
  return out;
}

// One issue → what to add. `types` is { issue: kitType }, already merged by precedence.
export function planIssue(issue, { types, available, viewer, assignMine }) {
  const kitType = types[issue.number];
  const todo = { number: issue.number, title: issue.title, kitType: kitType || null, setType: null, addLabel: null, assign: null };
  if (kitType) {
    const gt = available ? githubTypeFor(kitType, available) : null;
    if (gt && !issue.type) todo.setType = gt;
    const label = labelFor(kitType).name;
    if (!issue.labels.some((l) => l.toLowerCase() === label.toLowerCase())) todo.addLabel = label;
  }
  if (assignMine && viewer && !issue.assignees.length && issue.author === viewer) todo.assign = viewer;
  todo.change = !!(todo.setType || todo.addLabel || todo.assign);
  return todo;
}

// ---- main ----
function listIssues(cwd, state) {
  const states = state === 'all' ? '[OPEN,CLOSED]' : `[${state.toUpperCase()}]`;
  const out = [];
  let cursor = null;
  for (;;) {
    const q = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){issues(first:100,after:$after,states:${states},orderBy:{field:CREATED_AT,direction:ASC}){pageInfo{hasNextPage endCursor} nodes{number title state author{login} issueType{name} labels(first:50){nodes{name}} assignees(first:10){nodes{login}}}}}}`;
    const args = ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}', '-f', 'query=' + q];
    if (cursor) args.push('-f', 'after=' + cursor);
    let page = ghJson(args, cwd)?.data?.repository?.issues;
    if (!page) {
      // A server without issue types rejects the whole query; ask again without them.
      page = ghJson(args.map((a) => a.replace(' issueType{name}', '')), cwd)?.data?.repository?.issues;
      if (!page) return null;
    }
    for (const n of page.nodes) {
      out.push({ number: n.number, title: n.title, state: n.state, author: n.author?.login || null,
        type: n.issueType?.name || null, labels: n.labels.nodes.map((l) => l.name), assignees: n.assignees.nodes.map((a) => a.login) });
    }
    if (!page.pageInfo.hasNextPage) return out;
    cursor = page.pageInfo.endCursor;
  }
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { fail(e.message); }
  if (args.help) { console.log('usage: node issue-backfill.mjs [--apply] [--state all|open|closed] [--assign-mine] [--set <n>=<type>]...'); return; }

  const common = tryRun('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) fail('not inside a git repository');
  const mainRoot = resolve(dirname(common)).replaceAll('\\', '/');
  const cfg = loadConfig(join(mainRoot, 'agent-system.yaml'));
  if (cfg.issue_first === false) fail('agent-system.yaml sets issue_first: false — this repo has no issues to fill');

  for (const [n, t] of Object.entries(args.set)) {
    const c = t === 'feat' ? 'feature' : t;
    if (!cfg.issue_types.includes(c)) fail(`--set ${n}=${t}: '${t}' is not in issue_types [${cfg.issue_types.join(', ')}]`);
    args.set[n] = c;
  }

  // Where the kit wrote each issue's type down: docs on the base ref first, branches second.
  tryRun('git', ['fetch', '--prune'], { cwd: mainRoot });
  const head = tryRun('git', ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { cwd: mainRoot });
  const baseRef = cfg.base_branch
    ? (cfg.base_branch.includes('/') ? cfg.base_branch : `origin/${cfg.base_branch}`)
    : (head ? head.replace(/^refs\/remotes\//, '') : 'HEAD');
  const docs = (tryRun('git', ['ls-tree', '-r', '--name-only', baseRef, '--', cfg.issues_root], { cwd: mainRoot }) || '').split('\n');
  const branches = (tryRun('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'], { cwd: mainRoot }) || '').split('\n');
  const types = { ...typesFromNames(branches, cfg.issue_types), ...typesFromNames(docs, cfg.issue_types), ...args.set };

  const meta = loadRepoMeta(mainRoot);
  if (!meta.reachable) fail('GitHub did not answer (is gh installed and logged in? does the repo have a GitHub remote?)');
  const issues = listIssues(mainRoot, args.state);
  if (!issues) fail('could not list the issues (gh api graphql)');
  const viewer = args.assignMine ? tryRun('gh', ['api', 'user', '--jq', '.login'], { cwd: mainRoot }) : null;
  if (args.assignMine && !viewer) fail('--assign-mine: could not read your login (gh api user)');

  const plans = issues.map((i) => planIssue(i, { types, available: meta.issueTypes, viewer, assignMine: args.assignMine }));
  const changes = plans.filter((p) => p.change);
  const unknown = plans.filter((p) => !p.kitType);

  console.log(`issue-backfill: ${args.apply ? 'APPLY' : 'PLAN — nothing is changed (rerun with --apply)'}`);
  console.log(`  ${issues.length} issues (${args.state}), type source: ${cfg.issues_root} on ${baseRef} + branch names` +
    (meta.issueTypes ? '' : '\n  this repo has no issue types — only labels are added'));
  console.log('');
  for (const p of changes) {
    const parts = [p.setType && `type ${p.setType}`, p.addLabel && `label ${p.addLabel}`, p.assign && `assignee ${p.assign}`].filter(Boolean);
    console.log(`  #${String(p.number).padEnd(5)}${(p.kitType || '-').padEnd(10)}${parts.join(', ').padEnd(54)}${p.title}`);
  }
  if (!changes.length) console.log('  nothing to add — every issue with a known type already carries it');
  if (unknown.length) {
    console.log('\n  no management document or branch names these — left alone; name the type with --set <n>=<type>:');
    for (const p of unknown) console.log(`  #${String(p.number).padEnd(5)}${p.title}`);
  }
  if (!args.apply || !changes.length) return;

  // Labels the repo lacks are created once, before the first issue needs them.
  const wanted = [...new Set(changes.map((p) => p.kitType).filter(Boolean))].map(labelFor);
  for (const l of wanted) {
    if (changes.some((p) => p.addLabel === l.name) && !pickName(meta.labels, l.name) && !ensureLabel(l, mainRoot)) {
      fail(`could not create the label '${l.name}' (gh label create)`);
    }
  }
  console.log('');
  let failed = 0;
  for (const p of changes) {
    const errs = [];
    if (p.setType && !setIssueType(p.number, p.setType, mainRoot)) errs.push('type');
    const edit = ['issue', 'edit', String(p.number)];
    if (p.addLabel) edit.push('--add-label', p.addLabel);
    if (p.assign) edit.push('--add-assignee', p.assign);
    if (edit.length > 3 && tryRun('gh', edit, { cwd: mainRoot }) === null) errs.push('label/assignee');
    if (errs.length) { failed++; console.log(`  #${p.number}  FAILED: ${errs.join(', ')}`); }
  }
  console.log(`  ${changes.length - failed} of ${changes.length} issues updated${failed ? `, ${failed} FAILED` : ''}`);
  if (failed) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
