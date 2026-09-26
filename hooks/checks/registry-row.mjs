// agent-workflow-kit pre-commit check — system-owned.
// A new management document must land with its Master Registry row in the same commit.
// The rule already says so; this is the backstop. pipeplot reached 123 management docs
// with 14 missing from the registry and 3 named `feature-<slug>.md` with no issue
// number — each one a doc nobody can find from the index.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { loadConfig } from './config.mjs';
import { git, stagedWithStatus, indexContent, skip, fail } from './lib.mjs';

if (skip()) process.exit(0);
if (existsSync(git('rev-parse', '--git-path', 'MERGE_HEAD'))) process.exit(0); // merge commits pass

const cfg = loadConfig();
const root = String(cfg.issues_root || 'docs/issues').replace(/\/+$/, '');
// A generated index (INDEX.md) replaces the hand-kept table; nothing to require then.
if (existsSync(`${root}/INDEX.md`)) process.exit(0);

const esc = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// <root>/(sub-issues/)?<type>/<file>.md — one level under a type directory.
// umbrella/ is exempt: umbrella docs have no branch of their own (management-doc.mjs).
const docRe = new RegExp(`^${esc}/(?!umbrella/)(?:sub-issues/)?([^/]+)/([^/]+\\.md)$`);

const added = stagedWithStatus().filter((f) => f.status === 'A');
const missing = [];
const placeholders = [];
for (const { path } of added) {
  const m = path.match(docRe);
  if (!m) continue;
  const file = m[2];
  if (/^(README|INDEX)\.md$/i.test(file)) continue;
  if (!/^\d+-/.test(file)) { placeholders.push(path); continue; }
  const index = indexContent(`${root}/README.md`);
  if (index === null) { missing.push(`${path} (no ${root}/README.md in the index)`); continue; }
  if (!index.includes(path) && !index.includes(basename(path))) missing.push(path);
}

// A doc created before the issue number is known is a real workflow (draft first, open
// the issue when the shape is clear) — but the file must be renamed once it is known,
// or the branch = doc equality that the whole system rests on is broken for good.
for (const p of placeholders) {
  console.warn(`[agent-kit] ${p}: placeholder name — rename once the issue number is known (<issue>-<type>-<desc>.md)`);
}

if (missing.length) {
  fail([
    `new management doc(s) have no row in ${root}/README.md:`,
    ...missing,
    `add the Master Registry row (see docs/agent-workflow/templates.md) and stage ${root}/README.md with the doc`,
    'deliberate exception: AGENT_KIT_SKIP=1',
  ]);
}
