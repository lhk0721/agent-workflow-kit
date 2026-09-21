#!/usr/bin/env node
// agent-workflow-kit — regression cases for guard-destructive.mjs. System-owned.
//
// Run from a repo root so the repo's .claude/guard.json is picked up:
//   node .claude/hooks/guard-destructive.test.mjs
// Each case is a command the guard must allow, ask about, or deny. The "allow" cases
// are the shape of real false positives that trained the user to click through
// (rack-tracker #408): `rm -f one-file`, `2>/dev/null`, heredoc text written to disk,
// `datasets/` mentioned inside a grep.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'guard-destructive.mjs');

const CASES = [
  // recursive delete — ask
  ['rm -rf build/', 'ask'],
  ['rm -fr build/', 'ask'],
  ['rm -r build/', 'ask'],
  ['rm -Rf build/', 'ask'],
  ['rm --recursive build/', 'ask'],
  ['rm -f -r build/', 'ask'],
  ['Remove-Item -Recurse -Force build', 'ask', 'PowerShell'],
  ["ssh jetson 'rm -rf ~/captures/run3'", 'ask'],
  ["bash <<'EOF'\nrm -rf /tmp/build\nEOF", 'ask'],
  ["cat > s.sh <<'EOF'\nrm -rf /tmp/build\nEOF\nrm -rf /tmp/other", 'ask'],
  // single-file delete outside guarded paths — allow
  ['rm -f build/one.log', 'allow'],
  ["ssh jetson 'rm -f /tmp/x.log'", 'allow'],
  ['Remove-Item build\\x.txt', 'allow', 'PowerShell'],
  // heredoc text written to disk is data, not a command — allow
  ["cat > s.sh <<'EOF'\nrm -rf /tmp/build\nEOF", 'allow'],
  // git history
  ['git reset --hard HEAD~1', 'ask'],
  ['git push -f origin x', 'ask'],
  ['git push --force origin x', 'ask'],
  ['git push --force-with-lease origin x', 'allow'],
  ['git clean -fd', 'ask'],
  ['git branch -D x', 'ask'],
  ['git status 2>&1', 'allow'],
  // root delete — deny
  ['rm -rf / ', 'deny'],
  ['rm -rf ~', 'deny'],
];

// Guarded-path cases only mean something when .claude/guard.json lists the path.
// They use the rack-tracker seed (`datasets/`, `docs/etc/camera-sync/evidence`,
// `~/captures`); a repo with a different list will see them skipped.
const GUARDED = process.env.GUARD_TEST_PATH || 'datasets/';
const PATH_CASES = [
  [`rm -f ${GUARDED}x.json`, 'ask'],
  [`rm ${GUARDED}x.json`, 'ask'],
  [`sudo rm ${GUARDED}x.json`, 'ask'],
  [`mv ${GUARDED}a ${GUARDED}b`, 'ask'],
  [`python gen.py > ${GUARDED}out.json`, 'ask'],
  [`python gen.py >> ${GUARDED}out.json`, 'ask'],
  [`cmd 1> ${GUARDED}out.txt`, 'ask'],
  [`git checkout -- ${GUARDED}x`, 'ask'],
  [`ls ${GUARDED} 2>/dev/null`, 'allow'],
  [`grep -rn ${GUARDED} backend 2>&1 | head`, 'allow'],
  [`cat ${GUARDED}README.md >/dev/null`, 'allow'],
  [`echo hi > /dev/null; ls ${GUARDED}`, 'allow'],
  [`cat > /tmp/notes.md <<'MD'\nsee ${GUARDED}\nMD`, 'allow'],
];

const run = (command, tool) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: tool, tool_input: { command } }),
    encoding: 'utf8',
  });
  if (r.status !== 0) return `error: ${r.stderr.trim()}`;
  if (!r.stdout.trim()) return 'allow';
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
};

let pathCases = PATH_CASES;
try {
  const repo = JSON.parse(readFileSync('.claude/guard.json', 'utf8'));
  if (!(repo.askPaths || []).includes(GUARDED)) throw new Error('not listed');
} catch {
  console.log(`(skipping ${PATH_CASES.length} guarded-path cases: .claude/guard.json here does not list "${GUARDED}")`);
  pathCases = [];
}

let fail = 0;
for (const [command, expect, tool = 'Bash'] of [...CASES, ...pathCases]) {
  const got = run(command, tool);
  const ok = got === expect;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  expect=${expect.padEnd(5)} got=${got.padEnd(5)} ${command.split('\n')[0]}`);
}
const total = CASES.length + pathCases.length;
console.log(`\n${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
