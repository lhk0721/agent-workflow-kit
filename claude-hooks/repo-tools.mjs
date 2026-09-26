#!/usr/bin/env node
// agent-workflow-kit — SessionStart: announce repo-installed agent tools. System-owned.
//
// A "Repo Tools" line in AGENTS.md says a tool exists; it does not say whether it exists
// HERE, in this clone, today. pipeplot's line pointed at a .githooks/post-commit that
// was never installed; a graphify graph is git-ignored and absent from a fresh clone.
// So the announcement is made only when the artifact (or command) is actually present,
// from `tools:` in agent-system.yaml — "<doc> | <artifact>". An artifact with a slash is
// a path under the main worktree; without one it is a command looked up on PATH.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const git = (...a) => {
  try { return execFileSync('git', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); }
  catch { return null; }
};
const commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir');
if (!commonDir) process.exit(0);
const mainRoot = commonDir.replace(/[/\\]\.git\/?$/, '');

let tools = [];
try {
  const mod = await import(pathToFileURL(join(mainRoot, '.githooks', 'checks', 'config.mjs')).href);
  tools = mod.loadConfig(join(mainRoot, 'agent-system.yaml')).tools || [];
} catch { /* not kit-installed: nothing declared */ }
if (!tools.length) process.exit(0);

const onPath = (name) => {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' });
    return true;
  } catch { return false; }
};

const lines = [];
for (const entry of tools) {
  const [doc, artifact] = String(entry).split('|').map((s) => s.trim());
  if (!doc || !artifact) continue;
  const present = artifact.includes('/') ? existsSync(join(mainRoot, artifact)) : onPath(artifact);
  if (present) lines.push(`[agent-kit] Repo tool available: read ${doc} before codebase/architecture questions.`);
}
if (!lines.length) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') },
}));
