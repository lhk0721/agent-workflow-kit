// agent-workflow-kit pre-commit check — system-owned.
// Enforces: no direct commits on protected branches; issue branches stage their own
// management doc; no foreign-issue docs; no committing while a sibling branch is ahead.
import { existsSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { git, branch, staged, skip, fail } from './lib.mjs';

if (skip()) process.exit(0);
if (existsSync(git('rev-parse', '--git-path', 'MERGE_HEAD'))) process.exit(0); // merge commits pass

const cfg = loadConfig();
const br = branch();
const files = staged();
if (!br || !files.length) process.exit(0); // detached HEAD / empty commit: not governed

if (cfg.protected_branches.includes(br)) {
  fail([
    `direct commit on protected branch '${br}'`,
    'work belongs on an issue branch: gh issue create -> git worktree add ../<repo>-<n> -b <n>-<type>-<desc> main',
    'deliberate exception (e.g. kit install): AGENT_KIT_SKIP=1',
  ]);
}

const issue = br.match(/^(\d+)-/);
if (!issue) process.exit(0); // non-issue branch: not governed

// management docs live exactly one level under docs/issues/ (deeper paths are attachments).
// umbrella/ is exempt: umbrella docs have no branch of their own and take their
// sub-issue rows from sub-issue branches.
const docRe = /^docs\/issues\/(?!umbrella\/)[^/]+\/((?:\d+)-[^/]+)\.md$/;
const mgmtDocs = files.map((f) => f.match(docRe)).filter(Boolean);

const foreign = mgmtDocs.filter((m) => m[1] !== br);
if (foreign.length) {
  fail([
    `staged management doc(s) belong to a different branch: ${foreign.map((m) => m[0]).join(', ')}`,
    `HEAD is '${br}' — switch to the matching branch (its worktree) before editing another issue's doc`,
  ]);
}

if (!mgmtDocs.some((m) => m[1] === br)) {
  fail([
    `no update to docs/issues/**/${br}.md is staged`,
    'this hook is a backstop — the management doc should have been written before the file change',
    'write the work-log section for this commit, stage it, and commit again',
  ]);
}

// sibling branch ahead of HEAD = the live line for this issue is elsewhere
const siblings = git('branch', '--list', `${issue[1]}-*`, '--format=%(refname:short)')
  .split('\n').filter((s) => s && s !== br);
for (const s of siblings) {
  const ahead = Number(git('rev-list', '--count', s, '--not', 'HEAD') || '0');
  if (ahead > 0) {
    fail([
      `sibling branch '${s}' is ahead of HEAD by ${ahead} commit(s) — it is the live line for issue #${issue[1]}`,
      `switch to '${s}' (its worktree) and continue there`,
    ]);
  }
}
