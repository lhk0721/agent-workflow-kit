#!/usr/bin/env node
// agent-workflow-kit — regression cases for require-skill.mjs. System-owned.
//
//   node .claude/hooks/require-skill.test.mjs
// Self-contained: writes its own config and marker dir under os.tmpdir(), so it does not
// depend on the repo's .claude/require-skill.json. Each case is one hook call; the
// expected decision is 'allow' (no output) or 'deny'. Marker state carries across cases
// in order, exactly as it does inside a session.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'require-skill.mjs');
const root = mkdtempSync(join(tmpdir(), 'require-skill-test-'));
const cfgPath = join(root, 'require-skill.json');
const stateDir = join(root, 'state');
writeFileSync(cfgPath, JSON.stringify({
  minHangul: 20,
  ttlHours: 2,
  exclude: ['docs/INDEX.md', 'node_modules/**'],
  rules: [
    { skill: 'ko-ui-text', paths: ['app/**', '**/*.html'] },
    { skill: 'ko-writing', paths: ['**'] },
  ],
}));
const sid = `test-${process.pid}`;
const KO = '한국어 산문을 쓰고 다듬는다. 보고와 요약과 설명이 대상이다.'; // 30 Hangul
const KO_SHORT = '한국어 다섯자';                                        // 5 Hangul

const run = (tool_name, tool_input) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: sid, cwd: root, tool_name, tool_input }),
    encoding: 'utf8',
    env: { ...process.env, REQUIRE_SKILL_CONFIG: cfgPath, REQUIRE_SKILL_STATE_DIR: stateDir },
  });
  if (r.status !== 0) return `error: ${r.stderr.trim()}`;
  if (!r.stdout.trim()) return 'allow';
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  return out.permissionDecision + (out.permissionDecisionReason.includes('Skill(ko-ui-text)') ? ':ko-ui-text'
    : out.permissionDecisionReason.includes('Skill(ko-writing)') ? ':ko-writing' : '');
};

const ageMarkers = (hours) => {
  const t = new Date(Date.now() - hours * 3600e3);
  for (const f of readdirSync(stateDir)) utimesSync(join(stateDir, f), t, t);
};

const CASES = [
  ['Korean doc before any skill', () => run('Write', { file_path: 'docs/x.md', content: KO }), 'deny:ko-writing'],
  ['English doc', () => run('Write', { file_path: 'docs/x.md', content: 'plain english text only' }), 'allow'],
  ['Korean below threshold', () => run('Write', { file_path: 'docs/y.md', content: KO_SHORT }), 'allow'],
  ['excluded generated file', () => run('Write', { file_path: 'docs/INDEX.md', content: KO }), 'allow'],
  ['not an edit tool', () => run('Bash', { command: `echo ${KO}` }), 'allow'],
  ['file outside the repo', () => run('Write', { file_path: join(tmpdir(), 'elsewhere.md'), content: KO }), 'allow'],
  ['Skill call records ko-writing', () => run('Skill', { skill: 'ko-writing' }), 'allow'],
  ['Korean doc after ko-writing', () => run('Write', { file_path: 'docs/x.md', content: KO }), 'allow'],
  ['Korean Edit in a .py after ko-writing', () => run('Edit', { file_path: 'src/a.py', old_string: 'x', new_string: `# ${KO}` }), 'allow'],
  ['UI file needs ko-ui-text, not ko-writing', () => run('Edit', { file_path: 'app/screens-hub.js', old_string: 'a', new_string: KO }), 'deny:ko-ui-text'],
  ['html also routes to ko-ui-text', () => run('Write', { file_path: 'kiosk/index.html', content: KO }), 'deny:ko-ui-text'],
  ['plugin-qualified skill name', () => run('Skill', { skill: 'kit:ko-ui-text' }), 'allow'],
  ['UI file after ko-ui-text', () => run('MultiEdit', { file_path: 'app/screens-hub.js', edits: [{ old_string: 'a', new_string: KO }] }), 'allow'],
  ['Windows absolute path inside repo', () => run('Write', { file_path: join(root, 'app', 'x.js'), content: KO }), 'allow'],
  ['markers older than the TTL', () => { ageMarkers(3); return run('Write', { file_path: 'docs/x.md', content: KO }); }, 'deny:ko-writing'],
  ['notebook cell', () => run('NotebookEdit', { notebook_path: 'nb/a.ipynb', new_source: KO }), 'deny:ko-writing'],
];

let fail = 0;
for (const [name, fn, expect] of CASES) {
  const got = fn();
  const ok = got === expect;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  expect=${expect.padEnd(16)} got=${got.padEnd(16)} ${name}`);
}
rmSync(root, { recursive: true, force: true });
console.log(`\n${CASES.length - fail}/${CASES.length} passed`);
process.exit(fail ? 1 : 0);
