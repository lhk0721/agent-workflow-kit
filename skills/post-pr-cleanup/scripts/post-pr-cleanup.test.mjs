#!/usr/bin/env node
// agent-workflow-kit — cases for post-pr-cleanup.mjs. System-owned.
//
//   node .claude/skills/post-pr-cleanup/scripts/post-pr-cleanup.test.mjs
// Unit part: classification table, pointer-line removal on the three AGENTS.md shapes,
// origin URL forms, orphan detection on a temp layout, worktree-list parsing.
// Integration part: a throwaway repo under <tmp>/claude/ with a bare origin, a merged
// feature branch, its worktree (carrying a node_modules junction back to the main
// checkout — the pipeplot incident), an AGENTS.md pointer, and gh made unavailable.
// Dry run must refuse without --assume-landed, classify `remove` with it, and --apply
// must leave: no worktree, no local/remote branch, pointer gone, main node_modules intact.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseConfig, parseArgs, parseWorktreeList, parseOriginUrl, issueNumberOf, classify,
  removeRacLines, listRacPointers, leftoverPointers, findOrphans, isLink, unlinkJunction, norm,
} from './post-pr-cleanup.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'post-pr-cleanup.mjs');
let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e.message}`); process.exitCode = 1; } };

// ---- config + args ----
test('parseConfig: new keys and inline lists', () => {
  const cfg = parseConfig('profile: external\nworktree_root: claude\nbase_branch: develop\nprotected_branches: [main, develop]\n');
  assert.equal(cfg.profile, 'external'); assert.equal(cfg.worktree_root, 'claude'); assert.equal(cfg.base_branch, 'develop');
  assert.deepEqual(cfg.protected_branches, ['main', 'develop']);
});
test('parseArgs', () => {
  assert.deepEqual(parseArgs(['--apply', '--base', 'upstream/dev', '--json', '--assume-landed']), { apply: true, json: true, assumeLanded: true, base: 'upstream/dev' });
  assert.throws(() => parseArgs(['--base']), /needs a value/);
  assert.throws(() => parseArgs(['--force']), /unknown argument/);
});

// ---- worktree list ----
test('parseWorktreeList: main, branch, detached, prunable', () => {
  const txt = 'worktree C:/r\nHEAD aaa\nbranch refs/heads/main\n\nworktree C:/r-7\nHEAD bbb\nbranch refs/heads/7-fix-x\n\nworktree C:/r-8\nHEAD ccc\ndetached\n\nworktree C:/r-9\nHEAD ddd\nbranch refs/heads/9-docs-y\nprunable gitdir file points to non-existent location\n';
  const w = parseWorktreeList(txt);
  assert.equal(w.length, 4);
  assert.deepEqual(w[0], { path: 'C:/r', head: 'aaa', branch: 'main', bare: false, detached: false, prunable: null });
  assert.equal(w[1].branch, '7-fix-x');
  assert.equal(w[2].detached, true); assert.equal(w[2].branch, null);
  assert.equal(w[3].prunable, 'gitdir file points to non-existent location');
});

// ---- origin url ----
test('parseOriginUrl: https, ssh, scp-like, no .git, trailing slash', () => {
  assert.deepEqual(parseOriginUrl('https://github.com/lhk0721/pipeplot.git'), { host: 'github.com', owner: 'lhk0721', repo: 'pipeplot' });
  assert.deepEqual(parseOriginUrl('https://github.com/lhk0721/pipeplot'), { host: 'github.com', owner: 'lhk0721', repo: 'pipeplot' });
  assert.deepEqual(parseOriginUrl('git@github.com:lhk0721/pipeplot.git'), { host: 'github.com', owner: 'lhk0721', repo: 'pipeplot' });
  assert.deepEqual(parseOriginUrl('ssh://git@github.com/lhk0721/pipeplot.git'), { host: 'github.com', owner: 'lhk0721', repo: 'pipeplot' });
  assert.deepEqual(parseOriginUrl('ssh://git@github.com:22/lhk0721/pipeplot/'), { host: 'github.com', owner: 'lhk0721', repo: 'pipeplot' });
  assert.deepEqual(parseOriginUrl('https://gitlab.example.org/team/proj.git'), { host: 'gitlab.example.org', owner: 'team', repo: 'proj' });
  assert.equal(parseOriginUrl('/srv/git/proj.git'), null);
  assert.equal(parseOriginUrl(''), null);
});
test('issueNumberOf', () => {
  assert.equal(issueNumberOf('248-feature-landing-hero-video'), 248);
  assert.equal(issueNumberOf('main'), null);
  assert.equal(issueNumberOf('v020-skills-flow'), null);
});

// ---- classification ----
test('classify: the decision table', () => {
  const c = (s) => classify({ prKnown: true, prState: null, dirty: false, landed: false, missing: false, assumeLanded: false, ...s }).cls;
  assert.equal(c({ missing: true }), 'prunable');
  assert.equal(c({ missing: true, dirty: true, prState: 'OPEN' }), 'prunable');       // gone directory beats everything
  assert.equal(c({ dirty: true, prState: 'MERGED', landed: true }), 'dirty');         // uncommitted work beats a merged PR
  assert.equal(c({ prState: 'OPEN' }), 'keep-open');
  assert.equal(c({ prState: 'DRAFT', landed: true }), 'keep-open');
  assert.equal(c({ prState: 'MERGED', landed: true }), 'remove');
  assert.equal(c({ prState: 'MERGED', landed: false }), 'merged-ahead');
  assert.equal(c({ prState: 'CLOSED', landed: true }), 'remove');
  assert.equal(c({ prState: 'CLOSED', landed: false }), 'closed-unmerged');
  assert.equal(c({ prState: null, landed: true }), 'landed-no-pr');
  assert.equal(c({ prState: null, landed: false }), 'unpushed');
  // gh absent
  assert.equal(c({ prKnown: false, landed: true }), 'unknown');
  assert.equal(c({ prKnown: false, landed: true, assumeLanded: true }), 'remove');
  assert.equal(c({ prKnown: false, landed: false, assumeLanded: true }), 'unknown');
  assert.equal(c({ prKnown: false, landed: true, assumeLanded: true, dirty: true }), 'dirty');
});

// ---- pointer removal ----
const P = (b) => `- \`${b}\` — \`docs/issues/fix/${b}.md\` — thing`;
test('removeRacLines: last pointer removed -> placeholder restored', () => {
  const agents = '# A\n\n## Recent Active Context\n\n<!-- c -->\n' + P('7-fix-x') + '\n\n## Canon\n- (none)\n';
  const { text, removed } = removeRacLines(agents, '7-fix-x');
  assert.deepEqual(removed, [P('7-fix-x')]);
  assert.equal(text, '# A\n\n## Recent Active Context\n\n<!-- c -->\n- (none)\n\n## Canon\n- (none)\n');
});
test('removeRacLines: other pointers stay; Use rule line is not a pointer; prefix/suffix branches untouched', () => {
  const agents = '## Recent Active Context\n- Use rule: resume hint only.\n' + P('17-fix-x') + '\n' + P('7-fix-x') + '\n' + P('7-fix-x-two') + '\n\n## Canon\n';
  const { text, removed } = removeRacLines(agents, '7-fix-x');
  assert.deepEqual(removed, [P('7-fix-x')]);
  assert.equal(text, '## Recent Active Context\n- Use rule: resume hint only.\n' + P('17-fix-x') + '\n' + P('7-fix-x-two') + '\n\n## Canon\n');
  // only the Use rule line left -> placeholder comes back
  const r2 = removeRacLines('## Recent Active Context\n- Use rule: x\n' + P('7-fix-x') + '\n', '7-fix-x');
  assert.equal(r2.text, '## Recent Active Context\n- Use rule: x\n- (none)\n');
});
test('removeRacLines: missing section or no match -> unchanged; plain (unbackticked) format also matches; CRLF kept', () => {
  assert.deepEqual(removeRacLines('# A\n## Canon\n- 7-fix-x\n', '7-fix-x'), { text: '# A\n## Canon\n- 7-fix-x\n', removed: [] });
  assert.deepEqual(removeRacLines('## Recent Active Context\n- (none)\n', '7-fix-x').removed, []);
  const plain = '## Recent Active Context\n- 7-fix-x — docs/issues/fix/7-fix-x.md — thing\n';
  assert.equal(removeRacLines(plain, '7-fix-x').text, '## Recent Active Context\n- (none)\n');
  const crlf = '## Recent Active Context\r\n' + P('7-fix-x') + '\r\n' + P('8-fix-y') + '\r\n';
  assert.equal(removeRacLines(crlf, '7-fix-x').text, '## Recent Active Context\r\n' + P('8-fix-y') + '\r\n');
});

// ---- leftover pointers ----
test('listRacPointers + leftoverPointers: removed-here vs branch-gone vs live', () => {
  const agents = '## Recent Active Context\n- Use rule: x\n' + P('7-fix-x') + '\n' + P('8-fix-y') + '\n- 9-docs-z — docs/issues/docs/9-docs-z.md — z\n\n## Canon\n- `1-fix-q` not a pointer section\n';
  assert.deepEqual(listRacPointers(agents).map((p) => p.branch), ['7-fix-x', '8-fix-y', '9-docs-z']);
  const left = leftoverPointers(agents, { removed: new Set(['7-fix-x']), exists: (b) => b === '8-fix-y' });
  assert.deepEqual(left.map((p) => [p.branch, p.why.startsWith('its PR finished') ? 'removed' : 'gone']), [['7-fix-x', 'removed'], ['9-docs-z', 'gone']]);
  assert.deepEqual(leftoverPointers('# none\n', { removed: new Set(['7-fix-x']), exists: () => false }), []);
});

// ---- orphans on a temp layout ----
const scratch = join(tmpdir(), 'claude');
mkdirSync(scratch, { recursive: true });
test('findOrphans: sibling and claude layouts', () => {
  const root = mkdtempSync(join(scratch, 'orphans-'));
  try {
    const main = join(root, 'repo');
    for (const d of ['repo', 'repo-7', 'repo-8', 'repo-9', 'repository-1', 'other']) mkdirSync(join(root, d));
    mkdirSync(join(main, '.claude', 'worktrees', '7-x'), { recursive: true });
    mkdirSync(join(main, '.claude', 'worktrees', '8-y'), { recursive: true });
    writeFileSync(join(root, 'repo-10'), 'a file, not a dir');
    const known = [main, join(root, 'repo-7'), join(main, '.claude', 'worktrees', '7-x')];
    assert.deepEqual(findOrphans({ mode: 'sibling', mainRoot: main, known }), [norm(join(root, 'repo-8')), norm(join(root, 'repo-9'))]);
    assert.deepEqual(findOrphans({ mode: 'claude', mainRoot: main, known }), [norm(join(main, '.claude', 'worktrees', '8-y'))]);
    assert.deepEqual(findOrphans({ mode: 'claude', mainRoot: join(root, 'other'), known }), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- junction ----
test('isLink + unlinkJunction: removes the link, keeps the target', () => {
  const root = mkdtempSync(join(scratch, 'junction-'));
  try {
    const target = join(root, 'target'); mkdirSync(target); writeFileSync(join(target, 'keep.txt'), 'x');
    const link = join(root, 'node_modules');
    symlinkSync(target, link, 'junction');
    assert.equal(isLink(link), true);
    assert.equal(isLink(target), false);
    unlinkJunction(link);
    assert.equal(existsSync(link), false);
    assert.equal(existsSync(join(target, 'keep.txt')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- integration smoke ----
test('integration: merged branch + worktree + pointer, gh absent', () => {
  const root = mkdtempSync(join(scratch, 'post-pr-cleanup-'));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
    AGENT_KIT_GH: join(root, 'no-gh-here'),     // gh "absent": the script must degrade, not crash
  };
  writeFileSync(env.GIT_CONFIG_GLOBAL, '[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n');
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const run = (cwd, ...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd, env, encoding: 'utf8' });
  try {
    const origin = join(root, 'origin.git'); mkdirSync(origin); git(origin, 'init', '--bare', '-b', 'main');
    const seed = join(root, 'seed'); mkdirSync(seed); git(seed, 'init', '-b', 'main');
    writeFileSync(join(seed, 'README.md'), '# t\n');
    writeFileSync(join(seed, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(seed, 'AGENTS.md'), '# Agent Entry Point\n\n## Recent Active Context (pointer-only slot)\n\n<!-- c -->\n- (none)\n\n## Canon (repo slot)\n\n- (none)\n');
    git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'chore: seed');
    git(seed, 'remote', 'add', 'origin', origin); git(seed, 'push', '-q', 'origin', 'main');

    const repo = join(root, 'repo');
    git(root, 'clone', '-q', origin, repo);                       // origin/HEAD set by clone
    const wt = join(root, 'repo-7');
    git(repo, 'worktree', 'add', '-q', '--no-track', wt, '-b', '7-feature-x', 'origin/main');
    writeFileSync(join(wt, 'x.txt'), 'x\n');
    git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'feature: x (#7)');
    git(wt, 'push', '-q', '-u', 'origin', '7-feature-x');
    // pointer line on main, committed, then the PR "merges" (merge commit) and main is pushed
    const agentsPath = join(repo, 'AGENTS.md');
    writeFileSync(agentsPath, readFileSync(agentsPath, 'utf8').replace('- (none)\n\n## Canon', '- `7-feature-x` — `docs/issues/feature/7-feature-x.md` — x\n\n## Canon'));
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'chore: pointer (#7)');
    git(repo, 'merge', '-q', '--no-ff', '-m', 'merge #7', '7-feature-x');
    git(repo, 'push', '-q', 'origin', 'main');
    // the hazard: node_modules in the worktree is a junction back to the main checkout
    mkdirSync(join(repo, 'node_modules')); writeFileSync(join(repo, 'node_modules', 'keep.txt'), 'deps');
    symlinkSync(join(repo, 'node_modules'), join(wt, 'node_modules'), 'junction');
    // an orphan directory git does not know
    mkdirSync(join(root, 'repo-99'));

    // dry run, gh absent, no flag: nothing removable
    let r = run(repo, '--json');
    assert.equal(r.status, 0, r.stderr);
    let out = JSON.parse(r.stdout);
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].cls, 'unknown', JSON.stringify(out.rows[0]));
    assert.equal(out.rows[0].landed, true);
    assert.equal(out.rows[0].junction, true);
    assert.equal(out.rows[0].prKnown, false);
    assert.deepEqual(out.orphans, [norm(join(root, 'repo-99'))]);
    assert.equal(existsSync(wt), true);

    // dry run with --assume-landed: classified remove, still nothing changed
    r = run(repo, '--json', '--assume-landed');
    assert.equal(r.status, 0, r.stderr);
    out = JSON.parse(r.stdout);
    assert.equal(out.rows[0].cls, 'remove');
    assert.equal(existsSync(wt), true);
    assert.match(git(repo, 'branch', '--list', '7-feature-x'), /7-feature-x/, 'branch still there after dry run');
    // human table form runs too
    r = run(repo, '--assume-landed');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /remove\s+7-feature-x/);
    assert.match(r.stdout, /orphan directories/);
    assert.match(r.stdout, /Nothing was changed/);

    // dry run already names the leftover pointer (the line should have left with the branch)
    assert.match(r.stdout, /leftover pointer for 7-feature-x/);

    // apply on the default (shared) profile: worktree + branches go, AGENTS.md is NOT edited
    r = run(repo, '--apply', '--assume-landed');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(existsSync(wt), false, 'worktree directory removed');
    assert.equal(git(repo, 'worktree', 'list').split('\n').length, 1, 'only the main checkout remains');
    assert.equal(git(repo, 'branch', '--list', '7-feature-x'), '', 'local branch deleted');
    assert.equal(git(origin, 'branch', '--list', '7-feature-x'), '', 'remote branch deleted');
    assert.throws(() => git(repo, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/7-feature-x'), 'remote-tracking ref gone');
    assert.equal(existsSync(join(repo, 'node_modules', 'keep.txt')), true, 'main checkout node_modules survived the junction');
    assert.match(r.stdout, /junction/);
    let agents = readFileSync(agentsPath, 'utf8');
    assert.match(agents, /7-feature-x/, 'shared profile: pointer left in place');
    assert.match(r.stdout, /leftover pointer for 7-feature-x — it should have been removed on the branch/);
    assert.match(r.stdout, /not edited \(profile shared\)/);
    assert.equal(git(repo, 'status', '--porcelain'), '', 'shared profile: main checkout untouched');

    // solo profile: the leftover (branch now gone everywhere) is dropped, uncommitted
    writeFileSync(join(repo, 'agent-system.yaml'), 'profile: solo\n');
    r = run(repo, '--apply', '--assume-landed');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    agents = readFileSync(agentsPath, 'utf8');
    assert.doesNotMatch(agents, /7-feature-x/, 'solo profile: pointer dropped');
    assert.match(agents, /## Recent Active Context \(pointer-only slot\)\n\n<!-- c -->\n- \(none\)\n/, 'placeholder restored');
    assert.match(r.stdout, /dropped 1 line\(s\) \(solo profile\)/);
    assert.match(r.stdout, /UNCOMMITTED/);
    assert.match(git(repo, 'status', '--porcelain'), /(^|\n) ?M AGENTS\.md/, 'edit left uncommitted');   // git() trims the leading space on line 1

    // third apply is a no-op with exit 0
    r = run(repo, '--apply', '--assume-landed', '--json');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    out = JSON.parse(r.stdout);
    assert.deepEqual(out.leftovers, []); assert.deepEqual(out.rows, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

if (process.exitCode) console.error(`\n${n} passed, some FAILED`); else console.log(`post-pr-cleanup.test: ${n} cases passed`);
