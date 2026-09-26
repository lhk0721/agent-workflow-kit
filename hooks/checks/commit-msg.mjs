// agent-workflow-kit commit-msg check — system-owned.
// Subject: `<type>: <summary>` + ` (#<issue>)` on issue branches.
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { branch, skip, fail } from './lib.mjs';

if (skip()) process.exit(0);
const subject = (readFileSync(process.argv[2], 'utf8').split(/\r?\n/)[0] || '').trim();
if (/^(Merge|Revert|fixup!|squash!)/.test(subject)) process.exit(0);

const cfg = loadConfig();
// branch types (issue_types, e.g. `feature`) + conventional commit prefixes (e.g. `feat`).
// `repo` is for repo-level housekeeping (hooks, kit install, settings) — a team that
// documents it as a type must not have the hook reject it (rack-tracker).
const types = [...new Set([...cfg.issue_types, 'feat', 'fix', 'docs', 'chore', 'refactor', 'perf', 'merge', 'revert', 'test', 'build', 'ci', 'style', 'repo'])];
const re = new RegExp(`^(${types.join('|')})(\\(.+\\))?: .+`);
if (!re.test(subject)) {
  fail([
    `commit subject '${subject}' does not match '<type>: <summary>'`,
    `types: ${types.join(', ')}`,
  ]);
}

// No issues, no issue number to carry.
if (cfg.issue_first === false) process.exit(0);

const issue = branch().match(/^(\d+)-/);
if (issue && !subject.includes(`(#${issue[1]})`)) {
  fail([`issue-tracked branch — subject must carry the issue suffix (#${issue[1]})`]);
}
