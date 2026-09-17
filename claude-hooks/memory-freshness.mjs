#!/usr/bin/env node
// agent-workflow-kit — SessionStart check for stale session memory. System-owned.
//
// Session memory (~/.claude/projects/<slug>/memory/) is loaded into context at the
// start of every session, exactly like AGENTS.md — but it lives outside the repo, so
// no git hook can reach it. A line that says a branch is unpushed keeps saying so
// years after the branch merged, and the agent acts on it without checking.
//
// This reads the memory files, pulls out every claim of the form
// "<branch> is unpushed / uncommitted", and checks each against real git state.
// Reports through additionalContext so the finding lands in the session that needs it.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const git = (...a) => {
  try {
    return execFileSync('git', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch { return null; }
};

// Memory belongs to the MAIN worktree. A session started inside a worktree gets its
// own slug directory, so resolving from cwd would read the wrong (usually empty) one.
const commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir');
if (!commonDir) process.exit(0);
const mainRoot = commonDir.replace(/[/\\]\.git\/?$/, '');

// Claude Code's project-directory slug: drive colon, separators and dots all become '-'.
const slug = mainRoot.replace(/[:\\/.]/g, '-');
const memDir = join(homedir(), '.claude', 'projects', slug, 'memory');
if (!existsSync(memDir)) process.exit(0);

// Base branch: whatever the repo's PRs land on. Try the configured one, then origin.
const BASE = process.env.AGENT_KIT_BASE
  || ['upstream/develop', 'upstream/main', 'origin/develop', 'origin/main', 'origin/HEAD']
    .find((r) => git('rev-parse', '--verify', '--quiet', r));

// "not pushed" and "not committed" are different claims and git answers them
// differently. Conflating them reports a branch whose work merged but whose
// worktree still holds real uncommitted edits — which is not stale at all.
const PUSH_WORDS = /(미\s*push|미\s*푸시|미\s*머지|unpushed|not pushed|unmerged|PR\s*전)/i;
const COMMIT_WORDS = /(미\s*커밋|uncommitted|not committed)/i;
const BRANCH_RE = /`?\b(\d+[a-z0-9-]*-[a-z][a-z0-9-]+)`?/gi;

// How far a branch name may sit from the claim and still be its subject. A memory
// line often mentions several branches ("312 … 195 브랜치(미push)는 그대로"), and
// without this the claim gets pinned on the wrong one.
const NEAR = 45;

const dirtyWorktrees = new Set();
for (const blk of (git('worktree', 'list', '--porcelain') || '').split('\n\n')) {
  let path = null, branch = null;
  for (const l of blk.split('\n')) {
    if (l.startsWith('worktree ')) path = l.slice(9);
    else if (l.startsWith('branch ')) branch = l.slice(7).replace('refs/heads/', '');
  }
  if (!path || !branch) continue;
  try {
    const out = execFileSync('git', ['-C', path, 'status', '--porcelain'],
      { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    if (out) dirtyWorktrees.add(branch);
  } catch { /* worktree gone from disk — nothing to say */ }
}

const findings = [];
const files = readdirSync(memDir).filter((f) => f.endsWith('.md'));

for (const f of files) {
  const text = readFileSync(join(memDir, f), 'utf8');
  for (const raw of text.split('\n')) {
    const hasPush = PUSH_WORDS.test(raw);
    const hasCommit = COMMIT_WORDS.test(raw);
    if (!hasPush && !hasCommit) continue;
    if (!BASE) continue;

    const claimAt = [...raw.matchAll(new RegExp(`${PUSH_WORDS.source}|${COMMIT_WORDS.source}`, 'gi'))]
      .map((m) => m.index);

    const seen = new Set();
    for (const m of raw.matchAll(BRANCH_RE)) {
      const br = m[1];
      if (seen.has(br)) continue;
      // The claim must sit near this branch name, not merely on the same line.
      if (!claimAt.some((i) => Math.abs(i - m.index) <= NEAR)) continue;
      seen.add(br);
      if (!git('rev-parse', '--verify', '--quiet', br)) continue;

      if (hasPush && git('rev-list', '--count', `${BASE}..${br}`) === '0') {
        findings.push({ f, br, why: `called unpushed, but ${BASE} already contains it`, raw });
      }
      // An uncommitted claim is only stale once the worktree is actually clean.
      if (hasCommit && !dirtyWorktrees.has(br)) {
        findings.push({ f, br, why: 'called uncommitted, but no worktree holds changes for it', raw });
      }
    }
  }
}

// Files nobody has touched in a long time are not wrong by themselves, so this is
// reported separately and only when something else already went stale.
const OLD_DAYS = 120;
const old = files.filter((f) => {
  const age = (Date.now() - statSync(join(memDir, f)).mtimeMs) / 86400000;
  return age > OLD_DAYS;
});

if (!findings.length) process.exit(0);

// Quote the line. The check reads prose, so the reader must be able to judge the
// call without opening the file — and to spot a misread when there is one.
let msg = '[agent-kit] Stale session memory detected — these claims contradict git:\n';
for (const { f, br, why, raw } of findings) {
  msg += `  - ${f} — '${br}' ${why}\n`;
  msg += `      "${raw.trim().slice(0, 120)}${raw.trim().length > 120 ? '…' : ''}"\n`;
}
if (old.length) {
  msg += `  (${old.length} memory file(s) untouched for ${OLD_DAYS}+ days; check them when you touch the same work)\n`;
}
msg += '  Fix the memory file before relying on it. Stale memory is worse than none.\n';

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: msg,
  },
}));
