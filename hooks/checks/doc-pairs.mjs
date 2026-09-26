// agent-workflow-kit pre-commit check — system-owned.
// Docs declared as pairs in agent-system.yaml must change together.
// Two tiers: `fail` blocks the commit; `warn` prints the reminder and lets it through.
// The warn tier exists because most real couplings are section-level (one table in A
// mirrors one table in B), and a file-level XOR check forces a no-op edit to the
// counterpart just to pass the hook — pipeplot forked this file to drop fail() for
// exactly that reason. Say why the pair matters, and the reader can judge.
import { loadConfig, parsePair } from './config.mjs';
import { staged, skip, fail } from './lib.mjs';

if (skip()) process.exit(0);
const { doc_pairs } = loadConfig();
if (!doc_pairs.length) process.exit(0);

const files = new Set(staged());
const broken = [];
const reminders = [];
for (const entry of doc_pairs) {
  const { a, b, mode, why } = parsePair(entry);
  if (!a || !b) continue;
  if (files.has(a) === files.has(b)) continue;
  const only = files.has(a) ? a : b;
  if (mode === 'warn') reminders.push(`${a} <-> ${b}${why ? ' — ' + why : ''} (only ${only} staged)`);
  else broken.push(`${a} <-> ${b} (only ${only} staged)${why ? ' — ' + why : ''}`);
}
for (const r of reminders) {
  console.warn(`[agent-kit] doc-pair reminder (warn — commit proceeds): ${r}`);
}
if (broken.length) {
  fail([
    'paired docs must change together:',
    ...broken,
    'update the counterpart and stage both (AGENT_KIT_SKIP=1 only for a deliberate, user-approved exception)',
  ]);
}
