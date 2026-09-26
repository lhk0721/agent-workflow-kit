// agent-workflow-kit — setup verification. System-owned. Run: node .githooks/checks/doctor.mjs
// OK/FAIL lines are the install contract; WARN lines are things that work here but
// will not work for a teammate, or a local state the reader must know about.
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { git, hashLF } from './lib.mjs';

let ok = true;
const check = (name, pass, hint) => {
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}${pass ? '' : ' — ' + hint}`);
  if (!pass) ok = false;
};
const warn = (msg) => console.log('WARN ' + msg);
const ignored = (path) => { try { git('check-ignore', '-q', path); return true; } catch { return false; } };

const [maj, min] = process.versions.node.split('.').map(Number);
check(`node ${process.versions.node}`, maj > 18 || (maj === 18 && min >= 17), 'need Node >= 18.17 (onboarding.md §1)');

let hooksPath = '';
try { hooksPath = git('config', 'core.hooksPath'); } catch {}
check('core.hooksPath = .githooks', hooksPath === '.githooks', 'run: git config core.hooksPath .githooks');

for (const h of ['pre-commit', 'commit-msg', 'pre-push']) {
  check(`.githooks/${h}`, existsSync(`.githooks/${h}`), 'reinstall the kit (install.mjs)');
}

for (const s of ['ko-ui-text', 'ko-writing', 'issue-start', 'post-pr-cleanup', 'ui-evidence', 'experiment-gate', 'session-handoff']) {
  check(`.claude/skills/${s}/SKILL.md`, existsSync(`.claude/skills/${s}/SKILL.md`), 'reinstall the kit (install.mjs)');
}
if (ignored('.claude/skills')) warn('.claude/ is git-ignored — skills work in this clone but are not shared with the team');

for (const h of ['guard-destructive', 'memory-freshness', 'agents-freshness', 'repo-tools', 'skill-listing', 'require-skill']) {
  check(`.claude/hooks/${h}.mjs`, existsSync(`.claude/hooks/${h}.mjs`), 'reinstall the kit (install.mjs)');
}

let settings = {};
try { settings = JSON.parse(readFileSync('.claude/settings.json', 'utf8')); } catch {}
const registered = (event, script) => (settings.hooks?.[event] || []).some((g) =>
  (g.hooks || []).some((h) => (h.command || '').includes(script)));
check('PreToolUse guard registered in .claude/settings.json', registered('PreToolUse', 'guard-destructive.mjs'), 'reinstall the kit (install.mjs)');
// The ask tier can be turned down per user (env) or per repo (guard.json). Not a
// failure — but it must be visible, or "the guard is on" means less than it says.
{
  let repoTier;
  try { repoTier = JSON.parse(readFileSync('.claude/guard.json', 'utf8')).askTier; } catch {}
  const tier = String(process.env.AGENT_KIT_GUARD_ASK || repoTier || 'ask').toLowerCase();
  if (tier !== 'ask') {
    console.log(`WARN guard ask tier is '${tier}' (${process.env.AGENT_KIT_GUARD_ASK ? 'AGENT_KIT_GUARD_ASK' : '.claude/guard.json askTier'}) — prompts are ${tier === 'off' ? 'dropped' : 'demoted to notes for the model'}; deny still applies`);
  }
}
for (const s of ['agents-freshness.mjs', 'repo-tools.mjs', 'memory-freshness.mjs']) {
  check(`SessionStart ${s} registered`, registered('SessionStart', s), 'reinstall the kit (install.mjs)');
}
// The gate reads its config at call time and exits 0 without it — registered but
// unconfigured means "on" in settings and "off" in fact (rack-tracker).
if (registered('PreToolUse', 'require-skill.mjs')) {
  check('.claude/require-skill.json present (require-skill gate is registered)', existsSync('.claude/require-skill.json'),
    'gate is silently off without it — rerun install.mjs to seed it');
  if (ignored('.claude/require-skill.json')) warn('.claude/require-skill.json is git-ignored — the require-skill gate works in this clone only');
}

const cfg = loadConfig();
check(
  `agent-system.yaml (profile=${cfg.profile}, protected=[${cfg.protected_branches.join(', ')}], umbrella=${cfg.umbrella_issues}, issue_first=${cfg.issue_first}, issues_root=${cfg.issues_root})`,
  existsSync('agent-system.yaml'),
  'missing — rerun install.mjs to seed it',
);

// A single star does not reach .githooks/checks/*.mjs; on Windows those then sit in the
// worktree as CRLF while the index says LF, and every status is dirty.
const attrs = existsSync('.gitattributes') ? readFileSync('.gitattributes', 'utf8') : '';
if (!attrs.split(/\r?\n/).some((l) => l.trim().startsWith('.githooks/**'))) {
  warn(".gitattributes has no '.githooks/** text eol=lf' line — rerun install.mjs to add it");
}

// Files edited after install are legitimate (a repo may carry a deliberate local
// change) but must be visible: an uncommitted `process.exit(0)` at the top of the
// guard made behaviour differ by cwd for weeks without anyone noticing.
try {
  const lock = JSON.parse(readFileSync('agent-system.lock.json', 'utf8'));
  for (const [path, h] of Object.entries(lock.hashes || {})) {
    if (!existsSync(path)) { warn(`missing since install: ${path}`); continue; }
    if (hashLF(path) !== h) warn(`modified since install: ${path}`);
  }
} catch { warn('agent-system.lock.json missing or unreadable — rerun install.mjs'); }

// cp949 consoles: `print('—')` raises UnicodeEncodeError and the script dies mid-run.
// Seen seven times in one repo's notes. Fixed per user, not per repo.
if (process.platform === 'win32' && !process.env.PYTHONUTF8 && !process.env.PYTHONIOENCODING) {
  warn('neither PYTHONUTF8 nor PYTHONIOENCODING is set — python prints of non-ASCII crash on cp949 consoles; set PYTHONUTF8=1 in the user environment');
}

process.exit(ok ? 0 : 1);
