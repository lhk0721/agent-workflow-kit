// agent-workflow-kit — setup verification. System-owned. Run: node .githooks/checks/doctor.mjs
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { git } from './lib.mjs';

let ok = true;
const check = (name, pass, hint) => {
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}${pass ? '' : ' — ' + hint}`);
  if (!pass) ok = false;
};

const [maj, min] = process.versions.node.split('.').map(Number);
check(`node ${process.versions.node}`, maj > 18 || (maj === 18 && min >= 17), 'need Node >= 18.17 (onboarding.md §1)');

let hooksPath = '';
try { hooksPath = git('config', 'core.hooksPath'); } catch {}
check('core.hooksPath = .githooks', hooksPath === '.githooks', 'run: git config core.hooksPath .githooks');

for (const h of ['pre-commit', 'commit-msg', 'pre-push']) {
  check(`.githooks/${h}`, existsSync(`.githooks/${h}`), 'reinstall the kit (install.mjs)');
}

for (const s of ['ko-ui-text', 'ko-writing']) {
  check(`.claude/skills/${s}/SKILL.md`, existsSync(`.claude/skills/${s}/SKILL.md`), 'reinstall the kit (install.mjs)');
}
try {
  git('check-ignore', '-q', '.claude/skills');
  console.log('WARN .claude/ is git-ignored — skills work in this clone but are not shared with the team');
} catch {}

for (const h of ['guard-destructive', 'memory-freshness']) {
  check(`.claude/hooks/${h}.mjs`, existsSync(`.claude/hooks/${h}.mjs`), 'reinstall the kit (install.mjs)');
}
let registered = false;
try {
  const s = JSON.parse(readFileSync('.claude/settings.json', 'utf8'));
  registered = (s.hooks?.PreToolUse || []).some((g) =>
    (g.hooks || []).some((h) => (h.command || '').includes('guard-destructive.mjs')));
} catch {}
check('PreToolUse guard registered in .claude/settings.json', registered, 'reinstall the kit (install.mjs)');

const cfg = loadConfig();
check(
  `agent-system.yaml (profile=${cfg.profile}, protected=[${cfg.protected_branches.join(', ')}], umbrella=${cfg.umbrella_issues})`,
  existsSync('agent-system.yaml'),
  'missing — rerun install.mjs to seed it',
);

process.exit(ok ? 0 : 1);
