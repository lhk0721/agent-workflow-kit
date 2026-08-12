#!/usr/bin/env node
// agent-workflow-kit — uninstall from the repo you run it from: replays the install
// manifest. Removes system-owned files + the AGENTS.md kernel block, unsets
// core.hooksPath. Keeps everything repo-owned (agent-system.yaml, docs/issues/**,
// AGENTS.md slots) — that is the repo's work record, not the kit's.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const lockPath = 'agent-system.lock.json';
if (!existsSync(lockPath)) {
  console.error('ERROR: agent-system.lock.json not found — nothing to uninstall');
  process.exit(1);
}
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

for (const f of lock.files) {
  if (f === 'AGENTS.md#kernel-block') {
    const cur = readFileSync('AGENTS.md', 'utf8');
    const b = cur.indexOf('<!-- kernel:begin');
    const END = '<!-- kernel:end -->';
    const e = cur.indexOf(END);
    if (b >= 0 && e > b) {
      writeFileSync('AGENTS.md', cur.slice(0, b) + cur.slice(e + END.length).replace(/^\r?\n/, ''));
      console.log('removed kernel block from AGENTS.md (slots kept)');
    }
  } else {
    try { rmSync(f); console.log('removed ' + f); } catch {}
  }
}

try { execFileSync('git', ['config', '--unset', 'core.hooksPath']); } catch {}
rmSync(lockPath);
console.log('\nuninstalled. Repo-owned files kept: agent-system.yaml, docs/issues/**, AGENTS.md slots.');
console.log('NOTE: core.hooksPath is per-clone — unset it in other clones of this repo too.');
