#!/usr/bin/env node
// agent-workflow-kit — install/update into the repo you run it from:
//   cd <target-repo> && node <kit-path>/install.mjs
// System-owned files are overwritten every run; repo-owned files are seeded once and
// never overwritten. Writes agent-system.lock.json (version pin + manifest + hashes).
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadConfig } from './hooks/checks/config.mjs';
import { hashLF } from './hooks/checks/lib.mjs';

const kit = dirname(fileURLToPath(import.meta.url));
const target = process.cwd();
const git = (...a) => execFileSync('git', a, { cwd: target }).toString().trim();
const fail = (m) => { console.error('ERROR: ' + m); process.exit(1); };
const ignored = (path) => {
  try { execFileSync('git', ['check-ignore', '-q', path], { cwd: target, stdio: 'ignore' }); return true; }
  catch { return false; }
};

try { git('rev-parse', '--git-dir'); } catch { fail('not a git repository: ' + target); }
if (resolve(kit) === resolve(target)) fail('run this from the TARGET repo, not the kit repo');

const version = readFileSync(join(kit, 'VERSION'), 'utf8').trim();
const installed = [];

const copy = (fromRel, toRel) => {
  const dst = join(target, toRel);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(join(kit, fromRel), dst);
  installed.push(toRel.replaceAll('\\', '/'));
};
// `adopt`: a predicate over the destination path — when it returns false the existing
// file is left alone (and left out of the manifest, so uninstall does not remove it).
const copyDir = (fromDir, toDir, adopt = () => true) => {
  const src = join(kit, fromDir);
  for (const e of readdirSync(src, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const rel = relative(src, join(e.parentPath || e.path, e.name));
    const toRel = join(toDir, rel);
    if (!adopt(toRel)) continue;
    copy(join(fromDir, rel), toRel);
  }
};
const seed = (fromRel, toRel) => {
  const dst = join(target, toRel);
  if (existsSync(dst)) return;
  mkdirSync(dirname(dst), { recursive: true });
  if (fromRel) cpSync(join(kit, fromRel), dst); else writeFileSync(dst, '');
  console.log('seeded (repo-owned): ' + toRel.replaceAll('\\', '/'));
};
const seedText = (toRel, content) => {
  const dst = join(target, toRel);
  if (existsSync(dst)) return;
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, content);
  console.log('seeded (repo-owned): ' + toRel.replaceAll('\\', '/'));
};

// ---- system-owned (overwritten) ----
// Rulebook adopt mode: a repo that wrote its own docs/agent-workflow/<file>.md before
// the kit arrived (or forked one on purpose) must not have it clobbered. Kit-managed
// copies carry the marker comment in their first lines — same test CLAUDE.md uses.
const kitMarked = (toRel) => {
  const dst = join(target, toRel);
  if (!existsSync(dst)) return true;
  const head = readFileSync(dst, 'utf8').split(/\r?\n/).slice(0, 5).join('\n');
  if (head.includes('<!-- agent-workflow-kit')) return true;
  console.warn(`WARN: ${toRel.replaceAll('\\', '/')} exists and is not kit-managed — left untouched (repo-owned copy)`);
  return false;
};
copyDir('rulebook', 'docs/agent-workflow', kitMarked);
copyDir('hooks', '.githooks');
copyDir('skills', '.claude/skills');
copyDir('claude-hooks', '.claude/hooks');

// Skills only reach teammates if they are committed. A repo that ignores .claude/
// installs them for this clone only, so say it out loud instead of failing silently.
if (ignored('.claude/skills')) {
  console.warn('WARN: .claude/ is git-ignored here — skills install for this clone only. Un-ignore .claude/skills/ to share them with the team.');
}

const claudePath = join(target, 'CLAUDE.md');
// kit-managed = the file STARTS with the kernel marker comment (present since v0.1.0).
// A substring test is wrong: repos legitimately mention the kit name in their own
// CLAUDE.md prose, and a substring match would silently clobber that file on update.
const kitManaged = existsSync(claudePath) &&
  readFileSync(claudePath, 'utf8').trimStart().startsWith('<!-- agent-workflow-kit');
if (!existsSync(claudePath) || kitManaged) {
  copy('kernel/CLAUDE.md', 'CLAUDE.md');
} else {
  console.warn('WARN: CLAUDE.md exists and is not kit-managed — left untouched. Add "Read AGENTS.md first" to it yourself.');
}

const BEGIN = '<!-- kernel:begin';
const END = '<!-- kernel:end -->';
const kernelSrc = readFileSync(join(kit, 'kernel/AGENTS.md'), 'utf8');
const agentsPath = join(target, 'AGENTS.md');
if (!existsSync(agentsPath)) {
  writeFileSync(agentsPath, kernelSrc);
  installed.push('AGENTS.md#kernel-block');
} else {
  const cur = readFileSync(agentsPath, 'utf8');
  const b = cur.indexOf(BEGIN);
  const e = cur.indexOf(END);
  if (b >= 0 && e > b) {
    const block = kernelSrc.slice(kernelSrc.indexOf(BEGIN), kernelSrc.indexOf(END) + END.length);
    let next = cur.slice(0, b) + block + cur.slice(e + END.length);
    // Repo slots: every `## ` section the kernel carries AFTER the kernel block. The
    // block is replaced on update, but the slots are repo-owned and never touched — so
    // a slot the kernel gained later (Environment) or one a repo lost would never
    // appear. A missing slot is appended once, at the end; matched on the heading text
    // before its parenthetical so a repo that reworded "(repo slot)" keeps its own.
    const nl = next.includes('\r\n') ? '\r\n' : '\n';
    const kernelTail = kernelSrc.slice(kernelSrc.indexOf(END) + END.length).replace(/\r\n/g, '\n');
    const slotSections = [...kernelTail.matchAll(/^## .*$(?:\n(?!## ).*$)*/gm)].map((m) => m[0].trim());
    for (const section of slotSections) {
      const heading = section.split('\n')[0].replace(/^## /, '').trim();
      const name = heading.replace(/\s*\(.*\)\s*$/, '');
      // Whole heading, parenthetical optional: `\b` alone let `## Canon Rule` inside the
      // kernel stand in for the Canon slot.
      const has = new RegExp(`^##+ ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*\\(.*\\))?\\s*$`, 'm').test(next);
      if (has) continue;
      next = next.replace(/\s*$/, '') + nl + nl + section.replace(/\n/g, nl) + nl;
      console.log(`added slot: ${heading}`);
    }
    writeFileSync(agentsPath, next);
    installed.push('AGENTS.md#kernel-block');
  } else {
    console.warn('WARN: AGENTS.md exists without kernel markers — left untouched. Insert the kernel block manually from kernel/AGENTS.md.');
  }
}

// ---- Claude Code hook registration ----
// settings.json is shared with the repo's own config, so replace only the kit's own
// entries (identified by the script path) and leave every other hook untouched.
const settingsPath = join(target, '.claude/settings.json');
let settings = {};
if (existsSync(settingsPath)) {
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); }
  catch { fail('.claude/settings.json is not valid JSON — fix it, then rerun install'); }
}
settings.hooks ||= {};
// Idempotent: find the group whose command names this script, replace it in place;
// otherwise append. Rerunning install never duplicates an entry.
const register = (event, script, matcher) => {
  const list = (settings.hooks[event] ||= []);
  const entry = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: `node .claude/hooks/${script}` }] };
  const at = list.findIndex((g) => (g.hooks || []).some((h) => (h.command || '').includes(script)));
  if (at >= 0) list[at] = entry; else list.push(entry);
};
register('PreToolUse', 'guard-destructive.mjs', 'Bash|PowerShell');

// Session memory lives outside the repo, so no git hook can reach it. This one runs
// at session start and reports memory claims that contradict git.
register('SessionStart', 'memory-freshness.mjs');
// AGENTS.md is loaded on every request; a stale pointer in it is acted on without a
// check. The pre-commit budget only runs when AGENTS.md itself is staged, so this
// asks the same questions at session start — and covers an untracked AGENTS.md.
register('SessionStart', 'agents-freshness.mjs');
// Repo tools (graphify and the like) are announced only when their artifact exists here.
register('SessionStart', 'repo-tools.mjs');

// Claude Code does not re-send the skill listing after a context compaction, so a skill
// never invoked before it is unknown afterwards. Two layers: the listing comes back on
// SessionStart(compact); an edit that writes Korean text is denied until the matching
// skill (per .claude/require-skill.json, repo-owned) has been invoked in the session.
register('SessionStart', 'skill-listing.mjs', 'compact');
register('PreToolUse', 'require-skill.mjs', 'Write|Edit|MultiEdit|NotebookEdit|Skill');
mkdirSync(dirname(settingsPath), { recursive: true });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
installed.push('.claude/settings.json#PreToolUse');

// ---- repo-owned (seeded once) ----
// Read the repo's settings BEFORE seeding: on an update run they already exist and
// decide what else to seed (issues_root, Korean config files).
const hadConfig = existsSync(join(target, 'agent-system.yaml'));
const cfg = loadConfig(join(target, 'agent-system.yaml'));
seed('config/agent-system.yaml', 'agent-system.yaml');
seed('config/guard.json', '.claude/guard.json');
seed('config/require-skill.json', '.claude/require-skill.json');
// The require-skill gate reads its config from the repo at call time; if that file is
// ignored, the gate is on in this clone and silently off in every other (rack-tracker).
if (ignored('.claude/require-skill.json')) {
  console.warn('WARN: .claude/require-skill.json is git-ignored — the require-skill gate works in this clone only. Un-ignore it to share the gate with the team.');
}
// A repo without issues (issue_first: false) has no management documents, so seeding
// docs/issues/ there only plants an empty tree its own rules may forbid (bajak: docs/
// holds competition-issued documents only). Registry and type directories are seeded
// only while the issue workflow is on.
const issuesRoot = String(cfg.issues_root || 'docs/issues').replace(/\/+$/, '');
if (cfg.issue_first !== false) {
  seedText(`${issuesRoot}/README.md`,
    '# Issue Management Documents — Master Registry\n\n' +
    'One row per management document, added in the same commit that creates the doc.\n\n' +
    '| Issue | Doc | Status | Summary |\n| --- | --- | --- | --- |\n');
  for (const d of ['feature', 'fix', 'docs', 'chore', 'refactor', 'perf', 'umbrella', 'sub-issues']) {
    seed(null, join(issuesRoot, d, '.gitkeep'));
  }
}

// A repo that writes Korean gets the skills' project config seeded (never overwritten):
// without them the skills ask instead of guessing, and a template with the blanks is
// easier to fill than a prompt. Only when team_language was set before this run —
// a fresh install still has the default 'en' and the interview has not happened yet.
if (hadConfig && /^ko/i.test(String(cfg.team_language || ''))) {
  seed('skills/ko-writing/assets/config-template.md', 'ko-writing.config.md');
  seed('skills/ko-ui-text/assets/config-template.md', 'ui-text.config.md');
  seed('skills/ko-ui-text/assets/glossary-template.md', 'ui-text.glossary.md');
}

// sh hooks must stay LF on every platform (CRLF breaks /bin/sh). `.githooks/**`, not
// `.githooks/*`: a single star does not reach .githooks/checks/*.mjs, and pipeplot's
// checks sat in the index as LF and in the worktree as CRLF on every Windows clone.
const attrsPath = join(target, '.gitattributes');
const attrLine = '.githooks/** text eol=lf';
const oldLine = '.githooks/* text eol=lf';
let attrs = existsSync(attrsPath) ? readFileSync(attrsPath, 'utf8') : '';
if (attrs.split(/\r?\n/).some((l) => l.trim() === oldLine)) {
  attrs = attrs.split(/\r?\n/).map((l) => (l.trim() === oldLine ? attrLine : l)).join('\n');
  writeFileSync(attrsPath, attrs);
  console.log(`replaced .gitattributes line: ${oldLine} -> ${attrLine} (a single star does not reach .githooks/checks/)`);
} else if (!attrs.split(/\r?\n/).some((l) => l.trim() === attrLine)) {
  writeFileSync(attrsPath, (attrs && !attrs.endsWith('\n') ? attrs + '\n' : attrs) + attrLine + '\n');
  console.log('ensured .gitattributes line: ' + attrLine);
}

// ---- manifest + hooks activation ----
// `hashes` lets doctor tell an installed file from a locally edited one — the
// uncommitted `process.exit(0)` at the top of a guard is invisible otherwise.
const hashes = {};
for (const f of installed) {
  if (f.includes('#')) continue;          // AGENTS.md#kernel-block, settings.json#PreToolUse: partial owners
  hashes[f] = hashLF(join(target, f));
}
writeFileSync(join(target, 'agent-system.lock.json'),
  JSON.stringify({ kit_version: version, files: installed.sort(), hashes }, null, 2) + '\n');
git('config', 'core.hooksPath', '.githooks');
for (const h of ['pre-commit', 'commit-msg', 'pre-push']) {
  try { git('update-index', '--add', '--chmod=+x', `.githooks/${h}`); } catch {}
}

console.log(`\nagent-workflow-kit v${version} -> ${target}`);
console.log(`system-owned files written: ${installed.length} (manifest: agent-system.lock.json)`);
console.log('note: hook files were staged to preserve their executable bit.');
console.log('next: fill agent-system.yaml -> node .githooks/checks/doctor.mjs -> review diff -> commit (see SETUP.md §5).');
