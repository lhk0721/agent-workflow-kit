#!/usr/bin/env node
// agent-workflow-kit — SessionStart check: is AGENTS.md still telling the truth? System-owned.
//
// AGENTS.md ships in full on every request, and the agent acts on it without checking.
// context-budget.mjs (pre-commit) warns about stale Recent Active Context pointers — but
// only on a commit that stages AGENTS.md, so a pointer whose branch merged months ago
// survives every commit that touches other files (one lived 101 days in rack-tracker).
// This hook asks the same questions at session start, when the answer can still change
// what the session does. It also covers a file no git hook can see: an AGENTS.md kept
// out of git via .git/info/exclude (bajak) that fell 149 commits behind HEAD.
//
// Config is read from <main root>/.githooks/checks/config.mjs when the kit is installed;
// a hand-vendored .claude/hooks has no such file, so the defaults below apply instead.
// Reports through additionalContext; silent when there is nothing to say.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const git = (...a) => {
  try { return execFileSync('git', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); }
  catch { return null; }
};

// Main worktree root: config and the shared branch list live there. The AGENTS.md that
// this session loaded is the one in its own checkout (a worktree has its own copy).
const commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir');
if (!commonDir) process.exit(0);
const mainRoot = commonDir.replace(/[/\\]\.git\/?$/, '');
const top = git('rev-parse', '--show-toplevel') || mainRoot;
const agentsPath = join(top, 'AGENTS.md');
if (!existsSync(agentsPath)) process.exit(0);

let cfg = { issue_first: true, base_branch: '' };
try {
  const mod = await import(pathToFileURL(join(mainRoot, '.githooks', 'checks', 'config.mjs')).href);
  cfg = mod.loadConfig(join(mainRoot, 'agent-system.yaml'));
} catch { /* not kit-installed: defaults */ }
const BASE = process.env.AGENT_KIT_BASE || cfg.base_branch || 'origin/HEAD';
const LIMITS = { file: 12000, behind: 100, days: 60, untrackedCommits: 100 };

const text = readFileSync(agentsPath, 'utf8');
const lines = text.split('\n');
const findings = [];

// (a) Recent Active Context pointers — same three stale tests as context-budget.mjs.
const countRev = (range) => {
  const n = git('rev-list', '--count', range);
  return n === null ? null : Number(n);
};
const staleReason = (br) => {
  const ahead = countRev(`${BASE}..${br}`);
  const behind = countRev(`${br}..${BASE}`);
  if (ahead === null || behind === null) return null;     // unknown ref or base — say nothing
  if (ahead === 0 && behind > 0) return `holds no commits beyond ${BASE} — landed, or never started`;
  if (behind > LIMITS.behind) return `${BASE} is ${behind} commits ahead of it`;
  const ts = Number(git('log', '-1', '--format=%ct', br));
  if (ts) {
    const days = Math.floor((Date.now() / 1000 - ts) / 86400);
    if (days > LIMITS.days) return `last commit was ${days} days ago`;
  }
  return null;
};

const start = lines.findIndex((l) => /^##+ .*Recent Active Context/i.test(l));
if (start >= 0) {
  const pointers = [];
  for (const l of lines.slice(start + 1)) {
    if (/^##+ /.test(l)) break;
    if (/^\s*[-*] /.test(l) && !/^\s*[-*] \((none|없음)\)/.test(l) && !/^\s*[-*] Use rule/.test(l)) pointers.push(l);
  }
  const known = new Set((git('branch', '--all', '--format=%(refname:short)') || '')
    .split('\n').map((s) => s.trim().replace(/^(origin|upstream)\//, '')).filter(Boolean));
  for (const p of pointers) {
    // `<issue>-<type>-<desc>` is the kit's branch shape. With issue_first off the
    // repo's own pattern (e.g. `lhk/scoring-pipeline`) is a backticked token with one
    // slash; that form is only checked for staleness, never for existence — a
    // backticked path could look the same and "no longer exists" would be a lie.
    const m = p.match(/`([0-9]+-[a-z]+-[a-z0-9-]+)`/i);
    const m2 = cfg.issue_first === false ? p.match(/`([a-z0-9._-]+\/[a-z0-9._-]+)`/i) : null;
    const br = m ? m[1] : m2 ? m2[1] : null;
    if (!br) continue;
    if (m && known.size && !known.has(br)) {
      findings.push(`Recent Active Context points at '${br}', which no longer exists as a branch — remove the line`);
      continue;
    }
    const why = staleReason(br);
    if (why) findings.push(`Recent Active Context points at '${br}' — ${why}; remove the line if that work is done`);
  }
}

// (b) An AGENTS.md git never sees ages silently. Commits since its last write is the
// honest measure of how far the repo moved without the file noticing.
if (git('ls-files', '--error-unmatch', 'AGENTS.md') === null) {
  const since = statSync(agentsPath).mtime.toISOString();
  const n = Number(git('rev-list', '--count', `--since=${since}`, 'HEAD') || 0);
  if (n > LIMITS.untrackedCommits) {
    findings.push(`AGENTS.md is untracked and ${n} commits older than HEAD — re-read it against the repo before trusting it`);
  }
}

// (c) Size: the always-loaded file stopped being an entry point.
if (text.length > LIMITS.file) {
  findings.push(`AGENTS.md is ${text.length} chars (budget ${LIMITS.file}) — move detail into docs/ and link it`);
}

if (!findings.length) process.exit(0);

let msg = '[agent-kit] AGENTS.md freshness — check before acting on it:\n';
for (const f of findings) msg += `  - ${f}\n`;
msg += '  Rules: docs/agent-workflow/context-maintenance.md\n';
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: msg },
}));
