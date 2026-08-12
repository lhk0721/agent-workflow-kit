// agent-workflow-kit pre-push check — system-owned.
// Blocks direct pushes to protected branches (except solo profile), protected-branch
// deletion, and force pushes. Server-side branch protection is the source of truth;
// this is its local backstop.
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { git, skip, fail } from './lib.mjs';

if (skip()) process.exit(0);
const cfg = loadConfig();
const ZERO = /^0+$/;
const problems = [];

for (const line of readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
  const [, localSha, remoteRef, remoteSha] = line.split(' ');
  const name = remoteRef.replace('refs/heads/', '');
  const isProtected = cfg.protected_branches.includes(name);

  if (ZERO.test(localSha)) {
    if (isProtected) problems.push(`deleting protected branch '${name}'`);
    continue;
  }
  if (isProtected && cfg.profile !== 'solo') {
    problems.push(`direct push to protected branch '${name}' — open a PR instead`);
  }
  if (!ZERO.test(remoteSha)) {
    try { git('merge-base', '--is-ancestor', remoteSha, localSha); }
    catch {
      problems.push(`non-fast-forward push to '${name}' — fetch/rebase first; genuine force push needs AGENT_KIT_SKIP=1`);
    }
  }
}

if (problems.length) problems.push('deliberate override: AGENT_KIT_SKIP=1 git push ...'), fail(problems);
