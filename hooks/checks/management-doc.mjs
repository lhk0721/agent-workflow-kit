// agent-workflow-kit pre-commit check — system-owned.
// Enforces: no direct commits on protected branches; issue branches stage their own
// management doc; no foreign-issue docs; no committing while a sibling branch is ahead.
// With `issue_first: false` only the protected-branch check and the branch-name
// pattern apply — a repo without GitHub issues has no doc to require.
import { existsSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { git, branch, staged, skip, fail } from './lib.mjs';

if (skip()) process.exit(0);
if (existsSync(git('rev-parse', '--git-path', 'MERGE_HEAD'))) process.exit(0); // merge commits pass

const cfg = loadConfig();
const br = branch();
const files = staged();
if (!br || !files.length) process.exit(0); // detached HEAD / empty commit: not governed

const root = String(cfg.issues_root || 'docs/issues').replace(/\/+$/, '');
// The hint names the layout the repo actually uses; a wrong path in a BLOCKED message
// is the kind of thing an agent copies verbatim.
const startAt = cfg.protected_branches[0] || 'main';
const worktreeHint = cfg.worktree_root === 'claude'
  ? `git worktree add .claude/worktrees/<n>-<short> -b <branch> ${startAt}`
  : `git worktree add ../<repo>-<n> -b <branch> ${startAt}`;

if (cfg.protected_branches.includes(br)) {
  fail([
    `direct commit on protected branch '${br}'`,
    cfg.issue_first === false
      ? `work belongs on a branch${cfg.branch_pattern ? ` named like '${cfg.branch_pattern}'` : ''}: ${worktreeHint}`
      : `work belongs on an issue branch: gh issue create -> ${worktreeHint.replace('<branch>', '<n>-<type>-<desc>')}`,
    'deliberate exception (e.g. kit install): AGENT_KIT_SKIP=1',
  ]);
}

if (cfg.issue_first === false) {
  // <member>/<desc> -> ^[a-z0-9-]+/[a-z0-9-]+$ ; '/' and '-' stay literal, anything
  // else that means something to a regex is escaped so the pattern reads as written.
  const pattern = String(cfg.branch_pattern || '').trim();
  if (pattern) {
    const re = new RegExp('^' + pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/<(member|desc|type|issue)>/g, '[a-z0-9-]+') + '$');
    if (!re.test(br)) {
      fail([
        `branch '${br}' does not match branch_pattern '${pattern}' (agent-system.yaml)`,
        'placeholders <member>/<desc>/<type>/<issue> each mean [a-z0-9-]+; rename with: git branch -m <new-name>',
      ]);
    }
  }
  process.exit(0); // no issues -> no management doc, no sibling-branch rule
}

const issue = br.match(/^(\d+)-/);
if (!issue) process.exit(0); // non-issue branch: not governed

// management docs live one level under <issues_root>/ or <issues_root>/sub-issues/
// (deeper paths are attachments). umbrella/ is exempt: umbrella docs have no branch of
// their own and take their sub-issue rows from sub-issue branches.
const esc = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const docRe = new RegExp(`^${esc}/(?:sub-issues/)?(?!umbrella/)[^/]+/((?:\\d+)-[^/]+)\\.md$`);
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
    `no update to ${root}/**/${br}.md is staged`,
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
