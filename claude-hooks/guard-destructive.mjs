#!/usr/bin/env node
// agent-workflow-kit — PreToolUse guard. System-owned.
//
// Runs BEFORE a tool call, which is the only layer that can stop a destructive
// command: a git hook fires at commit time, long after `rm -rf` already ran.
// Reads the tool call as JSON on stdin and answers with a permission decision.
//
// Decisions: "ask" forces a confirmation even under bypassPermissions/--dangerously-*,
// "deny" refuses outright, "warn" lets the call through but hands the model a note
// (additionalContext) it can act on. Patterns are repo-owned in .claude/guard.json.
//
// A guard that asks too often is worse than none: the user learns to click through,
// and the one prompt that matters gets the same reflex. So the defaults below aim at
// what is actually irreversible — recursive deletes, history rewrites, raw devices —
// and not at `rm -f one-file`, `2>/dev/null`, or script text being written to disk.
// The warn tier is for the rest: commands that are not destructive but have bitten
// before (`pkill -f` killing the ssh session it ran in, a heredoc eating backslashes).
// Those were removed from `ask` as nuisances (rack-tracker #408) and then re-hit;
// a note the model reads costs nothing and prevents the repeat.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// `rm` whose option tokens carry a recursive flag: -r, -rf, -fr, -Rf, -f -r, --recursive.
// Plain `rm -f file` is one file; if it sits in a guarded path, askPaths catches it.
const RM_RECURSIVE = '\\brm\\s+(?:-{1,2}\\S*\\s+)*-(?:[a-zA-Z]*r[a-zA-Z]*|-recursive)\\b';

// `git checkout <ref>` / `git switch <ref>` that moves HEAD: not `-b`/`-c` (creates a
// branch), not `-- <path>` (restores a file), not `<ref> -- <path>` either.
const GIT_SWITCH = '\\bgit\\s+(checkout|switch)\\s+(?!-b\\b|-c\\b|--\\s|-\\s)(?![^\\n]*\\s--(?:\\s|$))[^\\s-]';

// Counted once, only when a rule needs it. One worktree = nobody else's HEAD to move.
let worktreeCount = null;
const sharedCheckout = () => {
  if (worktreeCount === null) {
    try {
      worktreeCount = execFileSync('git', ['worktree', 'list', '--porcelain'], { stdio: ['ignore', 'pipe', 'pipe'] })
        .toString().split('\n').filter((l) => l.startsWith('worktree ')).length;
    } catch { worktreeCount = 0; }
  }
  return worktreeCount > 1;
};

const DEFAULTS = {
  // Asked about even when permissions are bypassed. Recoverable but expensive to undo.
  ask: [
    { re: RM_RECURSIVE, why: 'recursive delete' },
    { re: '\\bRemove-Item\\b[^\\n|;]*\\s-Recurse\\b', why: 'recursive delete (PowerShell)' },
    { re: '\\bgit\\s+reset\\s+--hard\\b', why: 'discards working-tree changes' },
    { re: '\\bgit\\s+clean\\s+-[a-zA-Z]*f', why: 'deletes untracked files' },
    { re: '\\bgit\\s+push\\b.*(\\s--force\\b(?!-with-lease)|\\s-f\\b)', why: 'force push rewrites remote history' },
    { re: '\\bgit\\s+branch\\s+-D\\b', why: 'deletes an unmerged branch' },
    { re: '\\bgit\\s+worktree\\s+remove\\b.*(?:--force|\\s-f\\b)|\\bgit\\s+worktree\\s+prune\\b', why: 'removes a worktree that may hold uncommitted work' },
    { re: '\\b(DROP|TRUNCATE)\\s+(TABLE|DATABASE|SCHEMA)\\b', why: 'destroys database objects' },
    { re: '\\bmkfs\\b|\\bdd\\s+.*of=/dev/', why: 'writes to a raw device' },
    { re: '\\bssh\\b.*' + RM_RECURSIVE, why: 'remote recursive delete' },
    // Leaves the repo: a registry, a CDN, a release page. Not undoable by git, and the
    // Push Rule already says the user asks for it; a scheduled task cannot (bajak).
    { re: '\\b(docker\\s+push|wrangler\\s+(pages\\s+)?deploy|npm\\s+publish|gh\\s+release\\s+create|twine\\s+upload)\\b', why: "publishes outside the repo — needs the user's explicit ask" },
    // Another session's `git checkout` moved HEAD of the shared main checkout while a
    // worktree session was reading it (rack-tracker). Only asked when a second
    // worktree exists — in a lone checkout there is nobody to disturb.
    { re: GIT_SWITCH, why: 'switching branches in a checkout shared with other sessions moves their HEAD', when: sharedCheckout },
  ],
  // Never allowed, whatever the mode.
  deny: [
    { re: 'rm\\s+-[a-zA-Z]*[rf][a-zA-Z]*\\s+(/|~)\\s*$', why: 'deletes the filesystem or home root' },
  ],
  // Substring match on the command; any hit is asked about. Repo-specific.
  askPaths: [],
  // Allowed, with a note to the model. `tool` restricts a rule to one shell.
  warn: [
    { re: '\\bpkill\\s+-f\\b', why: '`pkill -f` matches every process whose command line contains the pattern, including the ssh session running it — use `pkill -x <name>` or a pid' },
    { re: '\\bssh\\b[^\\n]*2>&1', tool: 'PowerShell', why: 'PowerShell 5.1 wraps native stderr as a terminating error and flips `$?` — drop `2>&1` on `ssh`; stderr is captured for you anyway' },
    { re: '\\bgit\\s+commit\\b[^\\n]*-m\\s+"\\$\\(|--body\\s+"\\$\\(', why: 'inline command-substitution bodies are refused in worktree-isolated sessions — write the body to a file and use `-F`/`--body-file`' },
    { re: '\\bgit\\s+worktree\\s+remove\\b(?![^\\n]*(?:--force|\\s-f\\b))', why: 'on Windows a node_modules junction inside the worktree is followed — check with lstat / unlink the junction first' },
  ],
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

// additionalContext is what reaches the model, and the model is the one that can change
// the command before it runs. No permissionDecision on purpose: an explicit "allow"
// skips the interactive permission prompt (hooks guide: "allow: skip the interactive
// permission prompt"), which would auto-approve exactly the commands this tier flags
// whenever the session is NOT in bypass mode. Exit 0 with context only = "no objection,
// normal permission flow applies, and here is what to know".
const warn = (whys) => {
  const msg = `[agent-kit] warning: ${whys.join('; ')}`;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecisionReason: msg,
      additionalContext: msg,
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

// An UNQUOTED heredoc (`<<EOF`, `<<-EOF`) that writes a CODE file and carries a
// backslash: the shell expands an unquoted body, so `\\` becomes `\` — three times in
// one repo the resulting .mjs parsed fine and matched nothing. A quoted delimiter
// (`<<'EOF'`, `<<"EOF"`) keeps the body verbatim and is the correct form, so it is not
// flagged. Judged on the raw command because stripWrittenHeredocs has already removed
// the body from `cmd`.
const CODE_EXT = '(?:mjs|js|cjs|ts|py|json|ps1|sh)';
const HEREDOC_BLOCK = /(?:^|[\n;|&])[ \t]*((?:cat|tee)\b[^\n]*?<<-?[ \t]*(['"]?)(\w+)\2[^\n]*)\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\n|$)/g;
const WRITES_CODE = new RegExp(`>\\s*\\S+\\.${CODE_EXT}\\b|\\btee\\s+(?:-a\\s+)?\\S+\\.${CODE_EXT}\\b`, 'i');
const heredocWritesCodeWithBackslash = (s) => {
  for (const m of s.matchAll(HEREDOC_BLOCK)) {
    const unquoted = m[2] === '';
    if (unquoted && WRITES_CODE.test(m[1]) && m[4].includes('\\')) return true;
  }
  return false;
};

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
      warn: [...DEFAULTS.warn, ...(repo.warn || [])],
      askTier: repo.askTier,
    };
  } catch { /* malformed repo config must not disable the guard */ }
}

// A rule may be scoped to one shell and may carry a runtime condition.
const hits = (r) => (!r.tool || r.tool === tool) && new RegExp(r.re, 'i').test(cmd) && (!r.when || r.when());

// The ask tier can be turned down without editing this file. A user who runs in bypass
// mode and has said "no prompts until I say otherwise" used to get that by planting a
// `process.exit(0)` at the top of the hook — an uncommitted edit that also switched deny
// off, drifted between worktrees, and hid from doctor. The switch keeps deny, keeps the
// rule text, and is visible: AGENT_KIT_GUARD_ASK (personal, wins) or guard.json askTier
// (repo). `warn` turns every would-be prompt into a note the model reads; `off` drops it.
const askTier = String(process.env.AGENT_KIT_GUARD_ASK || cfg.askTier || 'ask').toLowerCase();
const demoted = [];
const ask = (reason) => {
  if (askTier === 'off') return;
  if (askTier === 'warn') { demoted.push(`(ask tier is warn) ${reason}`); return; }
  decide('ask', `${reason} — confirm before running`);
};

for (const r of cfg.deny) {
  if (hits(r)) decide('deny', `${r.why} — refused`);
}
for (const r of cfg.ask) {
  if (hits(r)) ask(r.why);
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
    if (writes && head.includes(p)) ask(`writes to a guarded path (${p})`);
    if (redirectTargets.some((t) => t.includes(p))) ask(`redirects output into a guarded path (${p})`);
    if (body && body.includes(p) && DELETE_CALLS.test(body)) ask(`script fed to an interpreter deletes inside a guarded path (${p})`);
  }
}

// Warn tier last: nothing above decided, so the call runs — with a note. All matching
// notes travel together; one output is all a hook gets. Demoted asks come first.
const notes = [...demoted, ...cfg.warn.filter(hits).map((r) => r.why)];
if (tool === 'Bash' && heredocWritesCodeWithBackslash(raw)) {
  notes.push('an unquoted heredoc writing a code file with backslashes in it — the shell strips backslashes; write code files with the Write tool (or quote the delimiter: <<\'EOF\')');
}
if (notes.length) warn(notes);

process.exit(0);
