#!/usr/bin/env node
// agent-workflow-kit — unit cases for issue-start.mjs. System-owned.
//
//   node .claude/skills/issue-start/scripts/issue-start.test.mjs
// Covers the pure parts only: branch naming, worktree paths for both roots, pointer
// insertion into the three AGENTS.md shapes, registry-row append, template fill, the
// yaml reader, base-ref precedence. No git, no gh — main() is guarded and never runs here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseConfig, parseArgs, slugify, branchName, resolveType, worktreePath, fillTemplate,
  registryRow, appendRegistryRow, racLine, insertRacPointer, listRacPointers, removeRacLines,
  refreshRac, detectPrereqs, issueBody, parseIssueNumber, firstCommitCommand, resolveBaseRef,
} from './issue-start.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1; } };

// ---- config reader ----
test('parseConfig: block lists, inline lists, booleans, comments, defaults', () => {
  const cfg = parseConfig([
    'profile: external   # forks',
    'protected_branches: [main, release]',
    'issue_types:',
    '  - feat',
    '  - fix',
    'issue_first: false',
    'issues_root: docs/work',
    'base_branch: ""',
    'notes_dir:',
    'doc_pairs: []',
  ].join('\n'));
  assert.equal(cfg.profile, 'external');
  assert.deepEqual(cfg.protected_branches, ['main', 'release']);
  assert.deepEqual(cfg.issue_types, ['feat', 'fix']);
  assert.equal(cfg.issue_first, false);
  assert.equal(cfg.issues_root, 'docs/work');
  assert.equal(cfg.base_branch, '');
  assert.equal(cfg.notes_dir, '');
  assert.equal(cfg.worktree_root, 'sibling');   // default survives
  assert.deepEqual(cfg.doc_pairs, []);
});

// ---- args ----
test('parseArgs: flags, values, errors', () => {
  const a = parseArgs(['--type', 'docs', '--title', 'x y', '--slug', 'try', '--dry-run', '--parent', '3']);
  assert.deepEqual(a, { dryRun: true, type: 'docs', title: 'x y', slug: 'try', parent: '3' });
  assert.throws(() => parseArgs(['--type']), /needs a value/);
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
});

// ---- branch name ----
test('slugify + branchName', () => {
  assert.equal(slugify('Landing Hero Video!'), 'landing-hero-video');
  assert.equal(slugify('--a__b  c--'), 'a-b-c');
  assert.equal(branchName(42, 'feature', 'login-form'), '42-feature-login-form');
});

test('resolveType: validation, feat alias, sub-issues fallback', () => {
  const cfg = { issue_types: ['feature', 'fix'], issues_root: 'docs/issues' };
  const dirs = (set) => (p) => set.has(p.replaceAll('\\', '/'));
  assert.throws(() => resolveType('perf', cfg, dirs(new Set())), /not in issue_types/);
  // plain repo: docs/issues/feature/
  assert.deepEqual(resolveType('feature', cfg, dirs(new Set(['docs/issues/feature']))),
    { type: 'feature', docDir: 'docs/issues/feature' });
  // repo whose directories use feat/: branch token follows the directory
  assert.deepEqual(resolveType('feature', cfg, dirs(new Set(['docs/issues/feat']))),
    { type: 'feat', docDir: 'docs/issues/feat' });
  assert.deepEqual(resolveType('feat', cfg, dirs(new Set(['docs/issues/feat']))),
    { type: 'feat', docDir: 'docs/issues/feat' });
  // sub-issues/<type>/ exists and <type>/ does not
  assert.deepEqual(resolveType('fix', cfg, dirs(new Set(['docs/issues/sub-issues/fix']))),
    { type: 'fix', docDir: 'docs/issues/sub-issues/fix' });
  // neither exists: default location, created later
  assert.deepEqual(resolveType('fix', cfg, dirs(new Set())), { type: 'fix', docDir: 'docs/issues/fix' });
});

// ---- worktree path ----
test('worktreePath: sibling and claude roots', () => {
  const root = 'C:/code/pipeplot';
  assert.equal(worktreePath('sibling', root, 252, 'landing-hero-video').replaceAll('\\', '/'), 'C:/code/pipeplot-252');
  assert.equal(worktreePath('claude', root, 252, 'landing-hero-video').replaceAll('\\', '/'), 'C:/code/pipeplot/.claude/worktrees/252-landing-hero');
  assert.equal(worktreePath('claude', root, 7, 'x').replaceAll('\\', '/'), 'C:/code/pipeplot/.claude/worktrees/7-x');
  assert.throws(() => worktreePath('elsewhere', root, 1, 'x'), /sibling\|claude/);
});

// ---- template fill ----
test('fillTemplate: every placeholder, umbrella line with and without parent', () => {
  const tpl = readFileSync(join(here, '..', 'assets', 'management-doc-template.md'), 'utf8');
  const withParent = fillTemplate(tpl, { issue: 34, title: 'Login form', branch: '34-feature-login-form', type: 'feature', parent: '12', date: '2026-09-26' });
  assert.match(withParent, /^# 34 Login form$/m);
  assert.match(withParent, /^- Issue: #34$/m);
  assert.match(withParent, /^- Branch: `34-feature-login-form`$/m);
  assert.match(withParent, /^- Umbrella: #12$/m);
  assert.match(withParent, /^### chore: Login form \(#34\)$/m);
  assert.doesNotMatch(withParent, /\{(issue|title|branch|type|parent|date)\}/);
  const noParent = fillTemplate(tpl, { issue: 34, title: 'Login form', branch: '34-feature-login-form', type: 'feature', parent: '', date: '2026-09-26' });
  assert.match(noParent, /^- Umbrella: \(none\)$/m);
  assert.doesNotMatch(noParent, /#\{parent\}|#$/m);
});

// ---- registry ----
test('appendRegistryRow: after the last table row; header when no table; CRLF tolerated', () => {
  const row = registryRow(34, 'docs/issues/feature/34-feature-login-form.md', 'Login form');
  assert.equal(row, '| #34 | docs/issues/feature/34-feature-login-form.md | in progress | Login form |');
  const kit = '# Registry\n\n| Issue | Doc | Status | Summary |\n| --- | --- | --- | --- |\n| #1 | docs/issues/fix/1-fix-a.md | done | a |\n';
  assert.equal(appendRegistryRow(kit, row), kit + row + '\n');
  // prose after the table stays after the table
  const prose = kit + '\nNotes below.\n';
  assert.equal(appendRegistryRow(prose, row), kit + row + '\n\nNotes below.\n');
  // no table: header seeded
  assert.equal(appendRegistryRow('# Registry\n', row), '# Registry\n\n| Issue | Doc | Status | Summary |\n| --- | --- | --- | --- |\n' + row + '\n');
  assert.equal(appendRegistryRow('', row), '| Issue | Doc | Status | Summary |\n| --- | --- | --- | --- |\n' + row + '\n');
  assert.match(appendRegistryRow(kit.replaceAll('\n', '\r\n'), row), new RegExp(row.replace(/[|().]/g, '\\$&') + '\n$'));
});

// ---- RAC pointer: three shapes ----
const line = racLine('34-feature-login-form', 'docs/issues/feature/34-feature-login-form.md', 'Login form');
test('racLine: branch and path in backticks so context-budget.mjs can match the branch', () => {
  assert.equal(line, '- `34-feature-login-form` — `docs/issues/feature/34-feature-login-form.md` — Login form');
});
test('insertRacPointer: replaces the (none) placeholder', () => {
  const agents = '# A\n\n## Recent Active Context (pointer-only slot)\n\n<!-- c -->\n- (none)\n\n## Canon (repo slot)\n\n- (none)\n';
  const out = insertRacPointer(agents, line);
  assert.equal(out, '# A\n\n## Recent Active Context (pointer-only slot)\n\n<!-- c -->\n' + line + '\n\n## Canon (repo slot)\n\n- (none)\n');
});
test('insertRacPointer: appends after the last existing pointer (Use rule line counts as a bullet)', () => {
  const agents = '## Recent Active Context\n\n<!-- c -->\n- Use rule: resume hint only.\n- `1-fix-a` — `docs/issues/fix/1-fix-a.md` — a\n\n## Canon\n- (none)\n';
  const out = insertRacPointer(agents, line);
  assert.equal(out, '## Recent Active Context\n\n<!-- c -->\n- Use rule: resume hint only.\n- `1-fix-a` — `docs/issues/fix/1-fix-a.md` — a\n' + line + '\n\n## Canon\n- (none)\n');
});
test('insertRacPointer: creates the section when missing', () => {
  const out = insertRacPointer('# A\n\n## Domain Rules\n- x\n', line);
  assert.equal(out, '# A\n\n## Domain Rules\n- x\n\n## Recent Active Context\n\n' + line + '\n');
});
test('insertRacPointer: section with only a comment gets the line before the next heading', () => {
  const out = insertRacPointer('## Recent Active Context\n\n<!-- c -->\n\n## Canon\n', line);
  assert.equal(out, '## Recent Active Context\n\n<!-- c -->\n' + line + '\n\n## Canon\n');
});
test('insertRacPointer: keeps CRLF files CRLF', () => {
  const out = insertRacPointer('## Recent Active Context\r\n- (none)\r\n', line);
  assert.equal(out, '## Recent Active Context\r\n' + line + '\r\n');
});

// ---- stale pointers dropped in the same edit (the next branch's first commit) ----
const PL = (b) => `- \`${b}\` — \`docs/issues/fix/${b}.md\` — thing`;
test('listRacPointers: backticked and plain forms; Use rule and placeholder ignored; section-bounded', () => {
  const agents = '## Recent Active Context\n- Use rule: x\n- (none)\n' + PL('7-fix-a') + '\n- 8-docs-b — docs/issues/docs/8-docs-b.md — b\n- prose without a branch\n\n## Canon\n- `9-fix-c` not here\n';
  assert.deepEqual(listRacPointers(agents).map((p) => p.branch), ['7-fix-a', '8-docs-b']);
  assert.deepEqual(listRacPointers('# no section\n'), []);
});
test('removeRacLines: whole-token match, placeholder restored', () => {
  const r = removeRacLines('## Recent Active Context\n' + PL('7-fix-a') + '\n' + PL('17-fix-a') + '\n', '7-fix-a');
  assert.deepEqual(r.removed, [PL('7-fix-a')]);
  assert.equal(r.text, '## Recent Active Context\n' + PL('17-fix-a') + '\n');
  assert.equal(removeRacLines('## Recent Active Context\n' + PL('7-fix-a') + '\n', '7-fix-a').text, '## Recent Active Context\n- (none)\n');
});
test('refreshRac: drops pointers whose branch is gone, keeps live ones, adds the new line', () => {
  const live = new Set(['8-docs-b']);
  const agents = '## Recent Active Context\n\n<!-- c -->\n' + PL('7-fix-a') + '\n' + PL('8-docs-b') + '\n\n## Canon\n- (none)\n';
  const r = refreshRac(agents, line, (b) => live.has(b));
  assert.deepEqual(r.dropped, [PL('7-fix-a')]);
  assert.equal(r.text, '## Recent Active Context\n\n<!-- c -->\n' + PL('8-docs-b') + '\n' + line + '\n\n## Canon\n- (none)\n');
  // only stale pointers: placeholder comes back and is then replaced by the new line
  const r2 = refreshRac('## Recent Active Context\n' + PL('7-fix-a') + '\n\n## Canon\n', line, () => false);
  assert.deepEqual(r2.dropped, [PL('7-fix-a')]);
  assert.equal(r2.text, '## Recent Active Context\n' + line + '\n\n## Canon\n');
  // nothing stale: identical to insertRacPointer
  const r3 = refreshRac(agents, line, () => true);
  assert.deepEqual(r3.dropped, []);
  assert.equal(r3.text, insertRacPointer(agents, line));
});

// ---- prerequisites ----
test('detectPrereqs: lockfile picks the install command', () => {
  const fs = (set) => (p) => set.has(p.replaceAll('\\', '/').split('/').pop());
  assert.deepEqual(detectPrereqs('r', fs(new Set(['package.json', 'package-lock.json']))).map((p) => p.command), ['npm ci']);
  assert.deepEqual(detectPrereqs('r', fs(new Set(['package.json', 'pnpm-lock.yaml']))).map((p) => p.command), ['pnpm install --frozen-lockfile']);
  assert.deepEqual(detectPrereqs('r', fs(new Set(['package.json']))).map((p) => p.command), ['npm install']);
  assert.deepEqual(detectPrereqs('r', fs(new Set(['pyproject.toml', 'uv.lock', '.env']))).map((p) => p.marker), ['uv.lock', '.env']);
  assert.deepEqual(detectPrereqs('r', fs(new Set(['requirements.txt']))).map((p) => p.marker), ['requirements.txt']);
  assert.deepEqual(detectPrereqs('r', fs(new Set())), []);
});

// ---- issue body / number / commit ----
test('issueBody follows the kit template; parseIssueNumber reads the gh URL', () => {
  assert.equal(issueBody({ title: 'Login form' }), '### Goal\nLogin form\n\n### Done criteria\n- [ ] ...\n');
  assert.match(issueBody({ title: 'x', parent: 12 }), /### Umbrella\nSub-issue of #12\.\n$/);
  assert.equal(parseIssueNumber('Creating issue in o/r\n\nhttps://github.com/o/r/issues/123\n'), 123);
  assert.equal(parseIssueNumber('nothing here'), null);
  assert.equal(firstCommitCommand('Login form', 34), 'git commit -m "chore: Login form (#34)"');
});

// ---- base ref precedence ----
test('resolveBaseRef: --base > base_branch (remote-qualified) > origin/HEAD > fallbacks', () => {
  const sym = () => 'refs/remotes/origin/main';
  const none = () => null;
  assert.equal(resolveBaseRef({ argBase: 'origin/dev', cfg: { profile: 'shared', base_branch: 'x' }, symbolicRef: sym, refExists: () => true }), 'origin/dev');
  assert.equal(resolveBaseRef({ cfg: { profile: 'shared', base_branch: 'develop' }, symbolicRef: sym, refExists: () => true }), 'origin/develop');
  assert.equal(resolveBaseRef({ cfg: { profile: 'external', base_branch: 'develop' }, symbolicRef: sym, refExists: () => true }), 'upstream/develop');
  assert.equal(resolveBaseRef({ cfg: { profile: 'external', base_branch: 'origin/x' }, symbolicRef: sym, refExists: () => true }), 'origin/x');
  assert.equal(resolveBaseRef({ cfg: { profile: 'shared', base_branch: '' }, symbolicRef: sym, refExists: () => true }), 'origin/main');
  assert.equal(resolveBaseRef({ cfg: { profile: 'shared', base_branch: '' }, symbolicRef: none, refExists: (r) => r === 'origin/master' }), 'origin/master');
  assert.equal(resolveBaseRef({ cfg: { profile: 'shared', base_branch: '' }, symbolicRef: none, refExists: () => false }), null);
});

if (process.exitCode) { console.error(`\n${n} passed, some FAILED`); } else { console.log(`issue-start.test: ${n} cases passed`); }
