#!/usr/bin/env node
// agent-workflow-kit — regression cases for guard-destructive.mjs. System-owned.
//
// Run from a repo root so the repo's .claude/guard.json is picked up:
//   node .claude/hooks/guard-destructive.test.mjs
// Each case is a command the guard must allow, warn about, ask about, or deny. The
// "allow" cases are the shape of real false positives that trained the user to click
// through (rack-tracker #408): `rm -f one-file`, `2>/dev/null`, heredoc text written to
// disk, `datasets/` mentioned inside a grep.
// "warn" = the call is allowed and the hook attached additionalContext for the model.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  // publishing leaves the repo — ask
  ['docker push krjin234/korean-essay:2026-08-13', 'ask'],
  ['wrangler deploy', 'ask'],
  ['wrangler pages deploy dist', 'ask'],
  ['npm publish --access public', 'ask'],
  ['gh release create v1.0.0 --notes x', 'ask'],
  ['twine upload dist/*', 'ask'],
  ['docker build -t x .', 'allow'],
  ['gh release list', 'allow'],
  // worktree removal: --force/-f asks (may drop uncommitted work); plain form warns
  // (a node_modules junction inside is followed on Windows)
  ['git worktree remove --force ../repo-12', 'ask'],
  ['git worktree remove -f ../repo-12', 'ask'],
  ['git worktree prune', 'ask'],
  ['git worktree remove ../repo-12', 'warn'],
  ['git worktree list', 'allow'],
  // pkill -f kills the ssh session it runs in — warn; -x / pid are the fix
  ['pkill -f vision_server', 'warn'],
  ["ssh jetson 'pkill -f vision_server'", 'warn'],
  ['pkill -x node', 'allow'],
  ['kill 1234', 'allow'],
  // inline command-substitution bodies are refused by worktree isolation — warn
  ['git commit -m "$(cat <<\'EOF\'\nfeat: x\n\nbody\nEOF\n)"', 'warn'],
  ['gh pr create --title x --body "$(cat body.md)"', 'warn'],
  ['git commit -F /tmp/msg.txt', 'allow'],
  ['gh pr create --title x --body-file body.md', 'allow'],
  // PowerShell 5.1 turns native stderr into a terminating error — warn, PowerShell only
  ['ssh ins25 "docker ps" 2>&1', 'warn', 'PowerShell'],
  ['ssh ins25 "docker ps" 2>&1', 'allow'],
  ['ssh ins25 "docker ps"', 'allow', 'PowerShell'],
  // UNQUOTED heredoc writing a code file whose body carries a backslash — warn (the
  // shell expands the body and eats `\\`); quoted delimiter keeps it verbatim — allow;
  // prose target or no backslash — allow; the write is still data (never ask)
  ["cat > x.mjs <<EOF\nconst re = /\\bfoo\\b/;\nEOF", 'warn'],
  ["cat <<-EOF > x.py\nprint('a\\tb')\nEOF", 'warn'],
  ["tee hooks/a.sh <<EOF\necho \"a\\nb\"\nEOF", 'warn'],
  ["cat > x.mjs <<'EOF'\nconst re = /\\bfoo\\b/;\nEOF", 'allow'],
  ['cat > x.mjs <<"EOF"\nconst re = /\\bfoo\\b/;\nEOF', 'allow'],
  ["cat > notes.md <<EOF\nsee C:\\Users\\me\\x\nEOF", 'allow'],
  ["cat > x.mjs <<EOF\nconst a = 1;\nEOF", 'allow'],
  ["cat > s.sh <<'EOF'\nrm -rf /tmp/build\nEOF", 'allow'],
  // branch switch that creates a branch or restores a file never asks
  ['git checkout -b x', 'allow'],
  ['git switch -c x', 'allow'],
  ['git checkout -- README.md', 'allow'],
  ['git checkout HEAD -- README.md', 'allow'],
];

// `git checkout <ref>` asks only when another worktree shares the repo. Two throwaway
// repos exercise both answers; the hook reads `git worktree list` from its cwd.
const gitIn = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tmp = mkdtempSync(join(tmpdir(), 'guard-test-'));
const lone = join(tmp, 'lone');
const shared = join(tmp, 'shared');
for (const d of [lone, shared]) {
  gitIn(tmp, 'init', '-q', '-b', 'main', d);
  gitIn(d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
}
gitIn(shared, 'worktree', 'add', '-q', join(tmp, 'shared-wt'), '-b', 'other');
const WORKTREE_CASES = [
  ['git checkout main', 'allow', 'Bash', lone],
  ['git switch main', 'allow', 'Bash', lone],
  ['git checkout main', 'ask', 'Bash', shared],
  ['git switch main', 'ask', 'Bash', shared],
  ['git checkout -b feature-x', 'allow', 'Bash', shared],
  ['git checkout -- README.md', 'allow', 'Bash', shared],
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
  // #417 — judged per simple command: a delete elsewhere + the path as prose in an
  // interpreter heredoc is not a write to the path; a delete call in that body is.
  [`rm -f docs/x.md; python - <<'EOF'\nprint("see ${GUARDED} in the table")\nEOF`, 'allow'],
  [`rm -f docs/x.md\npython - <<'EOF'\ntext = "row 15: ${GUARDED}"\nEOF`, 'allow'],
  [`ls ${GUARDED}; rm -f build/x.log`, 'allow'],
  [`python - <<'EOF'\nimport shutil; shutil.rmtree("${GUARDED}run3")\nEOF`, 'ask'],
  [`python - <<'EOF'\nimport os; os.remove("${GUARDED}a.json")\nEOF`, 'ask'],
  [`ls ${GUARDED}; mv ${GUARDED}a ${GUARDED}b`, 'ask'],
  [`echo x > /tmp/a && cat /tmp/a > ${GUARDED}out.json`, 'ask'],
];

const run = (command, tool, cwd, env) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: tool, tool_input: { command } }),
    encoding: 'utf8',
    cwd,
    env: { ...process.env, AGENT_KIT_GUARD_ASK: '', ...(env || {}) },
  });
  if (r.status !== 0) return `error: ${r.stderr.trim()}`;
  if (!r.stdout.trim()) return 'allow';
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  // warn = the call goes through (no decision, or an explicit allow) + a note for the
  // model. A note next to deny/ask would be a bug and surfaces as a mismatch.
  if (!out.permissionDecision || out.permissionDecision === 'allow') {
    return typeof out.additionalContext === 'string' && out.additionalContext.startsWith('[agent-kit] warning:') ? 'warn' : 'allow';
  }
  return out.permissionDecision;
};

let pathCases = PATH_CASES;
try {
  const repo = JSON.parse(readFileSync('.claude/guard.json', 'utf8'));
  if (!(repo.askPaths || []).includes(GUARDED)) throw new Error('not listed');
} catch {
  console.log(`(skipping ${PATH_CASES.length} guarded-path cases: .claude/guard.json here does not list "${GUARDED}")`);
  pathCases = [];
}

// The ask tier switch: AGENT_KIT_GUARD_ASK=warn demotes every would-be prompt to a note,
// =off drops it; deny and the warn tier are untouched either way.
const TIER_CASES = [
  ['rm -rf build/', 'warn', 'Bash', undefined, { AGENT_KIT_GUARD_ASK: 'warn' }],
  ['rm -rf build/', 'allow', 'Bash', undefined, { AGENT_KIT_GUARD_ASK: 'off' }],
  ['git push -f origin x', 'warn', 'Bash', undefined, { AGENT_KIT_GUARD_ASK: 'warn' }],
  ['rm -rf /', 'deny', 'Bash', undefined, { AGENT_KIT_GUARD_ASK: 'off' }],
  ['pkill -f serve', 'warn', 'Bash', undefined, { AGENT_KIT_GUARD_ASK: 'off' }],
];

let fail = 0;
const all = [...CASES, ...pathCases, ...WORKTREE_CASES, ...TIER_CASES];
for (const [command, expect, tool = 'Bash', cwd, env] of all) {
  const got = run(command, tool, cwd, env);
  const ok = got === expect;
  if (!ok) fail++;
  const where = cwd ? (cwd === lone ? ' [lone worktree]' : ' [shared worktree]') : env ? ` [ask tier ${env.AGENT_KIT_GUARD_ASK}]` : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  expect=${expect.padEnd(5)} got=${got.padEnd(5)} ${command.split('\n')[0]}${where}`);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${all.length - fail}/${all.length} passed`);
process.exit(fail ? 1 : 0);
