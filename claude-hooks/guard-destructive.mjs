#!/usr/bin/env node
// agent-workflow-kit — PreToolUse guard. System-owned.
//
// Runs BEFORE a tool call, which is the only layer that can stop a destructive
// command: a git hook fires at commit time, long after `rm -rf` already ran.
// Reads the tool call as JSON on stdin and answers with a permission decision.
//
// Decisions: "ask" forces a confirmation even under bypassPermissions/--dangerously-*,
// "deny" refuses outright. Patterns are repo-owned in .claude/guard.json.
//
// A guard that asks too often is worse than none: the user learns to click through,
// and the one prompt that matters gets the same reflex. So the defaults below aim at
// what is actually irreversible — recursive deletes, history rewrites, raw devices —
// and not at `rm -f one-file`, `2>/dev/null`, or script text being written to disk.
import { existsSync, readFileSync } from 'node:fs';

// `rm` whose option tokens carry a recursive flag: -r, -rf, -fr, -Rf, -f -r, --recursive.
// Plain `rm -f file` is one file; if it sits in a guarded path, askPaths catches it.
const RM_RECURSIVE = '\\brm\\s+(?:-{1,2}\\S*\\s+)*-(?:[a-zA-Z]*r[a-zA-Z]*|-recursive)\\b';

const DEFAULTS = {
  // Asked about even when permissions are bypassed. Recoverable but expensive to undo.
  ask: [
    { re: RM_RECURSIVE, why: 'recursive delete' },
    { re: '\\bRemove-Item\\b[^\\n|;]*\\s-Recurse\\b', why: 'recursive delete (PowerShell)' },
    { re: '\\bgit\\s+reset\\s+--hard\\b', why: 'discards working-tree changes' },
    { re: '\\bgit\\s+clean\\s+-[a-zA-Z]*f', why: 'deletes untracked files' },
    { re: '\\bgit\\s+push\\b.*(\\s--force\\b(?!-with-lease)|\\s-f\\b)', why: 'force push rewrites remote history' },
    { re: '\\bgit\\s+branch\\s+-D\\b', why: 'deletes an unmerged branch' },
    { re: '\\bgit\\s+worktree\\s+remove\\b.*--force|\\bgit\\s+worktree\\s+prune\\b', why: 'removes a worktree that may hold uncommitted work' },
    { re: '\\b(DROP|TRUNCATE)\\s+(TABLE|DATABASE|SCHEMA)\\b', why: 'destroys database objects' },
    { re: '\\bmkfs\\b|\\bdd\\s+.*of=/dev/', why: 'writes to a raw device' },
    { re: '\\bssh\\b.*' + RM_RECURSIVE, why: 'remote recursive delete' },
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

// Text that `cat`/`tee` writes to a file through a heredoc is data, not a command
// that runs now. A script saved to the scratchpad that contains `rm -rf` must not
// trip the guard until something executes it. Heredocs fed to an interpreter
// (`bash <<EOF`, `python - <<PY`, `ssh host <<EOF`) do run, so those stay visible.
const stripWrittenHeredocs = (s) =>
  s.replace(
    /((?:^|[\n;|&])[ \t]*(?:cat|tee)\b[^\n]*?<<-?[ \t]*(['"]?)(\w+)\2[^\n]*\n)[\s\S]*?(\n[ \t]*\3[ \t]*(?=\n|$))/g,
    '$1$4',
  );

const input = await read();
let call;
try { call = JSON.parse(input); } catch { process.exit(0); }

// Only shell commands carry this risk; file edits are already reversible via git.
const tool = call.tool_name || '';
if (tool !== 'Bash' && tool !== 'PowerShell') process.exit(0);
const raw = (call.tool_input || {}).command || '';
if (!raw.trim()) process.exit(0);
const cmd = stripWrittenHeredocs(raw);

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

// A guarded path only matters when the command can change it — and only when the
// command that changes things is the one naming the path. Matching "a write verb
// anywhere" against "the path anywhere" trips on `rm -f a.md` sitting next to a python
// heredoc whose *document text* mentions ~/captures (rack-tracker #417). So the command
// is split into simple commands first (`;`, `&&`, `||`, `|`, newline — never inside
// quotes or a heredoc body), and each simple command is judged on its own:
//  1. a writing command in command position and the path among its own arguments;
//  2. a redirect inside that simple command targeting the path (`2>/dev/null`, `2>&1`,
//     `&>`, `>/dev/null` are not writes to anything the user cares about);
//  3. a heredoc fed to an interpreter (`python - <<EOF`, `bash <<EOF`) whose body holds
//     both a delete call and the path — code that runs now, not prose.
const WRITE_CMDS = /(^|[|&;\n'"]\s*)(sudo\s+)?(rm|mv|dd|truncate|shred|chmod|chown|rsync|scp|Remove-Item|Move-Item|Set-Content|Out-File)\b|\bgit\s+(clean|checkout|restore)\b/;
const REDIRECT_TARGET = /(?<![2&])>>?\s*(?!\/dev\/null\b|&)(\S+)/g;
const DELETE_CALLS = /\b(rmtree|os\.remove|os\.unlink|unlink|remove_dir|rmdir|Remove-Item|rm\s+-[a-zA-Z]*r|del\s+\/[sq])\b/i;

// Split on separators outside quotes; a heredoc body (`<<TAG` … `TAG`) travels with the
// simple command that opened it, so `python - <<EOF … EOF` is one unit.
const splitSimple = (s) => {
  const out = [];
  let cur = '', q = null, i = 0;
  const heredocs = [];              // pending terminators for the current line
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === q && s[i - 1] !== '\\') q = null;
      i++; continue;
    }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; i++; continue; }
    const hd = /^<<-?\s*(['"]?)(\w+)\1/.exec(s.slice(i));
    if (hd) { heredocs.push(hd[2]); cur += hd[0]; i += hd[0].length; continue; }
    if (ch === '\n' && heredocs.length) {
      // swallow the body up to the terminator line
      const rest = s.slice(i + 1);
      const tag = heredocs.shift();
      const m = new RegExp('^([\\s\\S]*?\\n)?[ \\t]*' + tag + '[ \\t]*(?=\\n|$)').exec(rest);
      const bodyLen = m ? m[0].length : rest.length;
      cur += '\n' + rest.slice(0, bodyLen);
      i += 1 + bodyLen; continue;
    }
    const sep = /^(\|\||&&|[;|\n])/.exec(s.slice(i));
    if (sep) { if (cur.trim()) out.push(cur.trim()); cur = ''; i += sep[0].length; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur.trim());       // trimmed: WRITE_CMDS anchors the verb at the start
  return out;
};

const heredocBody = (simple) => {
  const m = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*)$/.exec(simple);
  return m ? m[3] : '';
};

for (const simple of splitSimple(cmd)) {
  const body = heredocBody(simple);
  const head = body ? simple.slice(0, simple.length - body.length) : simple;
  const writes = WRITE_CMDS.test(head);
  const redirectTargets = [...head.matchAll(REDIRECT_TARGET)].map((m) => m[1]);
  for (const p of cfg.askPaths) {
    if (writes && head.includes(p)) decide('ask', `writes to a guarded path (${p}) — confirm before running`);
    if (redirectTargets.some((t) => t.includes(p))) decide('ask', `redirects output into a guarded path (${p}) — confirm before running`);
    if (body && body.includes(p) && DELETE_CALLS.test(body)) decide('ask', `script fed to an interpreter deletes inside a guarded path (${p}) — confirm before running`);
  }
}

process.exit(0);
