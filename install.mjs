#!/usr/bin/env node
// agent-workflow-kit — install/update into the repo you run it from:
//   cd <target-repo> && node <kit-path>/install.mjs
// System-owned files are overwritten every run; repo-owned files are seeded once and
// never overwritten. Writes agent-system.lock.json (version pin + manifest).
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const kit = dirname(fileURLToPath(import.meta.url));
const target = process.cwd();
const git = (...a) => execFileSync('git', a, { cwd: target }).toString().trim();
const fail = (m) => { console.error('ERROR: ' + m); process.exit(1); };

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
const copyDir = (fromDir, toDir) => {
  const src = join(kit, fromDir);
  for (const e of readdirSync(src, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const rel = relative(src, join(e.parentPath || e.path, e.name));
    copy(join(fromDir, rel), join(toDir, rel));
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
copyDir('rulebook', 'docs/agent-workflow');
copyDir('hooks', '.githooks');

const claudePath = join(target, 'CLAUDE.md');
if (!existsSync(claudePath) || readFileSync(claudePath, 'utf8').includes('agent-workflow-kit')) {
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
    writeFileSync(agentsPath, cur.slice(0, b) + block + cur.slice(e + END.length));
    installed.push('AGENTS.md#kernel-block');
  } else {
    console.warn('WARN: AGENTS.md exists without kernel markers — left untouched. Insert the kernel block manually from kernel/AGENTS.md.');
  }
}

// ---- repo-owned (seeded once) ----
seed('config/agent-system.yaml', 'agent-system.yaml');
seedText('docs/issues/README.md',
  '# Issue Management Documents — Master Registry\n\n' +
  'One row per management document, added in the same commit that creates the doc.\n\n' +
  '| Issue | Doc | Status | Summary |\n| --- | --- | --- | --- |\n');
for (const d of ['feature', 'fix', 'docs', 'chore', 'refactor', 'perf', 'umbrella', 'sub-issues']) {
  seed(null, join('docs/issues', d, '.gitkeep'));
}

// sh hooks must stay LF on every platform (CRLF breaks /bin/sh)
const attrsPath = join(target, '.gitattributes');
const attrLine = '.githooks/* text eol=lf';
const attrs = existsSync(attrsPath) ? readFileSync(attrsPath, 'utf8') : '';
if (!attrs.includes(attrLine)) {
  writeFileSync(attrsPath, (attrs && !attrs.endsWith('\n') ? attrs + '\n' : attrs) + attrLine + '\n');
  console.log('ensured .gitattributes line: ' + attrLine);
}

// ---- manifest + hooks activation ----
writeFileSync(join(target, 'agent-system.lock.json'),
  JSON.stringify({ kit_version: version, files: installed.sort() }, null, 2) + '\n');
git('config', 'core.hooksPath', '.githooks');
for (const h of ['pre-commit', 'commit-msg', 'pre-push']) {
  try { git('update-index', '--add', '--chmod=+x', `.githooks/${h}`); } catch {}
}

console.log(`\nagent-workflow-kit v${version} -> ${target}`);
console.log(`system-owned files written: ${installed.length} (manifest: agent-system.lock.json)`);
console.log('note: hook files were staged to preserve their executable bit.');
console.log('next: fill agent-system.yaml -> node .githooks/checks/doctor.mjs -> review diff -> commit (see SETUP.md §5).');
