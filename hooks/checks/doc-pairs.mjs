// agent-workflow-kit pre-commit check — system-owned.
// Docs declared as pairs in agent-system.yaml must change together.
import { loadConfig } from './config.mjs';
import { staged, skip, fail } from './lib.mjs';

if (skip()) process.exit(0);
const { doc_pairs } = loadConfig();
if (!doc_pairs.length) process.exit(0);

const files = new Set(staged());
const broken = [];
for (const pair of doc_pairs) {
  const [a, b] = pair.split('<->').map((s) => s.trim());
  if (!a || !b) continue;
  if (files.has(a) !== files.has(b)) broken.push(`${a} <-> ${b} (only ${files.has(a) ? a : b} staged)`);
}
if (broken.length) {
  fail([
    'paired docs must change together:',
    ...broken,
    'update the counterpart and stage both (AGENT_KIT_SKIP=1 only for a deliberate, user-approved exception)',
  ]);
}
