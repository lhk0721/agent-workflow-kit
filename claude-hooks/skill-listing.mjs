#!/usr/bin/env node
// agent-workflow-kit — SessionStart(compact): put the skill listing back. System-owned.
//
// After a context compaction Claude Code re-attaches the tool listing, the agent listing,
// MCP instructions and CLAUDE.md — but not the skill listing. Skills invoked before the
// compaction come back (invoked_skills); a skill never invoked is simply gone, and the
// model cannot use what it does not know exists (rack-tracker #413, seen in the session
// transcript). This hook reads the user's and the repo's SKILL.md frontmatter and hands
// the names back through additionalContext. Register it with `"matcher": "compact"`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const git = (...a) => {
  try { return execFileSync('git', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); }
  catch { return null; }
};
const commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir');
const mainRoot = commonDir ? commonDir.replace(/[/\\]\.git\/?$/, '') : process.cwd();

const frontmatter = (file) => {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const fm = {};
  for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i]);
    if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return fm;
};

const skillsIn = (dir, scope) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const fm = frontmatter(file);
    if (!fm || !fm.name || fm['disable-model-invocation'] === 'true') continue;
    out.push({ name: fm.name, description: (fm.description || '').slice(0, 240), paths: fm.paths || '', scope });
  }
  return out;
};

const seen = new Set();
const skills = [
  ...skillsIn(join(mainRoot, '.claude', 'skills'), 'repo'),
  ...skillsIn(join(homedir(), '.claude', 'skills'), 'user'),
].filter((s) => !seen.has(s.name) && seen.add(s.name));
if (!skills.length) process.exit(0);

const lines = skills.map((s) => `- ${s.name}${s.paths ? ` (auto-loads for: ${s.paths})` : ''} — ${s.description}`);
const msg = '[agent-kit] Skill listing, re-sent after context compaction (Claude Code re-sends tools and agents '
  + 'but not skills). Invoke a skill with the Skill tool before the work it covers; the require-skill hook '
  + 'denies edits that write Korean text until the matching skill has been invoked in this session.\n'
  + lines.join('\n');
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: msg },
}));
