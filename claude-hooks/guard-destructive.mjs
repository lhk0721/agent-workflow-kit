#!/usr/bin/env node
// agent-workflow-kit — PreToolUse guard. System-owned.
//
// Runs BEFORE a tool call, which is the only layer that can stop a destructive
// command: a git hook fires at commit time, long after `rm -rf` already ran.
// Reads the tool call as JSON on stdin and answers with a permission decision.
//
// Decisions: "ask" forces a confirmation even under bypassPermissions/--dangerously-*,
// "deny" refuses outright. Patterns are repo-owned in .claude/guard.json.
import { existsSync, readFileSync } from 'node:fs';

const DEFAULTS = {
  // Asked about even when permissions are bypassed. Recoverable but expensive to undo.
  ask: [
    { re: 'rm\\s+(-[a-zA-Z]*[rf][a-zA-Z]*\\s+)+', why: 'recursive/forced delete' },
    { re: '\\bgit\\s+reset\\s+--hard\\b', why: 'discards working-tree changes' },
    { re: '\\bgit\\s+clean\\s+-[a-zA-Z]*f', why: 'deletes untracked files' },
    { re: '\\bgit\\s+push\\b.*(--force|-f)\\b(?!.*--force-with-lease)', why: 'force push rewrites remote history' },
    { re: '\\bgit\\s+branch\\s+-D\\b', why: 'deletes an unmerged branch' },
    { re: '\\bgit\\s+worktree\\s+remove\\b.*--force|\\bgit\\s+worktree\\s+prune\\b', why: 'removes a worktree that may hold uncommitted work' },
    { re: '\\b(DROP|TRUNCATE)\\s+(TABLE|DATABASE|SCHEMA)\\b', why: 'destroys database objects' },
    { re: '\\bmkfs\\b|\\bdd\\s+.*of=/dev/', why: 'writes to a raw device' },
    { re: '\\bssh\\b.*\\brm\\s+-[a-zA-Z]*[rf]', why: 'remote recursive delete' },
  ],
  // Never allowed, whatever the mode.
  deny: [
    { re: 'rm\\s+-[a-zA-Z]*[rf][a-zA-Z]*\\s+(/|~)\\s*$', why: 'deletes the filesystem or home root' },
  ],
  // Substring match on the command; any hit is asked about. Repo-specific.
  askPaths: [],
};

const read = () =>
  new Promise((res) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => res(s));
  });

const decide = (decision, reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: `[agent-kit] ${reason}`,
    },
  }));
  process.exit(0);
};

const input = await read();
let call;
try { call = JSON.parse(input); } catch { process.exit(0); }

// Only shell commands carry this risk; file edits are already reversible via git.
const tool = call.tool_name || '';
if (tool !== 'Bash' && tool !== 'PowerShell') process.exit(0);
const cmd = (call.tool_input || {}).command || '';
if (!cmd.trim()) process.exit(0);

let cfg = DEFAULTS;
if (existsSync('.claude/guard.json')) {
  try {
    const repo = JSON.parse(readFileSync('.claude/guard.json', 'utf8'));
    cfg = {
      ask: [...DEFAULTS.ask, ...(repo.ask || [])],
      deny: [...DEFAULTS.deny, ...(repo.deny || [])],
      askPaths: [...DEFAULTS.askPaths, ...(repo.askPaths || [])],
    };
  } catch { /* malformed repo config must not disable the guard */ }
}

for (const r of cfg.deny) {
  if (new RegExp(r.re, 'i').test(cmd)) decide('deny', `${r.why} — refused`);
}
for (const r of cfg.ask) {
  if (new RegExp(r.re, 'i').test(cmd)) decide('ask', `${r.why} — confirm before running`);
}
// A guarded path only matters when the command can change it. Prompting on `ls` or
// `grep` trains the user to click through every prompt, which costs more than it saves.
const WRITES = /(^|[|&;]\s*)(rm|mv|dd|truncate|shred|chmod|chown)\b|\brsync\b|\bscp\b|>\s*\S|\bgit\s+(clean|checkout|restore)\b/;
if (WRITES.test(cmd)) {
  for (const p of cfg.askPaths) {
    if (cmd.includes(p)) decide('ask', `writes to a guarded path (${p}) — confirm before running`);
  }
}

process.exit(0);
