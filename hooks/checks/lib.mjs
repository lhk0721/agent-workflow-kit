// agent-workflow-kit — shared helpers for hook checks. System-owned.
import { execFileSync } from 'node:child_process';

export const git = (...args) =>
  execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

export function branch() {
  try { return git('symbolic-ref', '--short', '-q', 'HEAD'); } catch { return ''; }
}

export const staged = () =>
  git('diff', '--cached', '--name-only').split('\n').filter(Boolean).map((p) => p.replaceAll('\\', '/'));

export const skip = () => process.env.AGENT_KIT_SKIP === '1';

export function fail(lines) {
  console.error('\n[agent-kit] BLOCKED:');
  for (const l of [].concat(lines)) console.error('  - ' + l);
  process.exit(1);
}
