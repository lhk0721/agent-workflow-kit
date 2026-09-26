// agent-workflow-kit — shared helpers for hook checks. System-owned.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const git = (...args) =>
  execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

export function branch() {
  try { return git('symbolic-ref', '--short', '-q', 'HEAD'); } catch { return ''; }
}

export const staged = () =>
  git('diff', '--cached', '--name-only').split('\n').filter(Boolean).map((p) => p.replaceAll('\\', '/'));

// [{ status: 'A'|'M'|'D'|'R'|..., path }] — the status letter is what lets a check tell
// "a new document" from "an edit to an old one". Renames/copies report the NEW path.
export const stagedWithStatus = () =>
  git('diff', '--cached', '--name-status').split('\n').filter(Boolean).map((l) => {
    const parts = l.split('\t');
    return { status: parts[0][0], path: parts[parts.length - 1].replaceAll('\\', '/') };
  });

// Content of a path as it sits in the index — what the commit will contain, which may
// differ from the working tree. null when the path is not in the index.
export function indexContent(path) {
  try { return git('show', `:${path}`); } catch { return null; }
}

export const skip = () => process.env.AGENT_KIT_SKIP === '1';

export function fail(lines) {
  console.error('\n[agent-kit] BLOCKED:');
  for (const l of [].concat(lines)) console.error('  - ' + l);
  process.exit(1);
}

// sha256 of a file with CRLF folded to LF. The lock stores this at install time and
// doctor recomputes it, so a checkout on autocrlf=true does not read as "modified".
export const hashLF = (file) =>
  createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
