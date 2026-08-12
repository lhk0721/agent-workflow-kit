// agent-workflow-kit — setup verification. System-owned. Run: node .githooks/checks/doctor.mjs
import { existsSync } from 'node:fs';
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

const cfg = loadConfig();
check(
  `agent-system.yaml (profile=${cfg.profile}, protected=[${cfg.protected_branches.join(', ')}], umbrella=${cfg.umbrella_issues})`,
  existsSync('agent-system.yaml'),
  'missing — rerun install.mjs to seed it',
);

process.exit(ok ? 0 : 1);
