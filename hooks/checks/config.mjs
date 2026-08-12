// agent-workflow-kit — minimal reader for agent-system.yaml. System-owned.
// Supports the subset the kit uses: `key: value`, `key: []`, and block lists of scalars.
import { readFileSync, existsSync } from 'node:fs';

export function loadConfig(path = 'agent-system.yaml') {
  const cfg = {
    profile: 'shared',
    team_language: 'en',
    protected_branches: ['main'],
    issue_types: ['feature', 'fix', 'docs', 'chore', 'refactor', 'perf'],
    umbrella_issues: 'per-member',
    doc_pairs: [],
  };
  if (!existsSync(path)) return cfg;
  let listKey = null;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && listKey) { cfg[listKey].push(unq(item[1])); continue; }
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!kv) continue;
    listKey = null;
    const [, k, v] = kv;
    if (v === '') { cfg[k] = []; listKey = k; }
    else if (v === '[]') cfg[k] = [];
    else cfg[k] = unq(v);
  }
  return cfg;
}

const unq = (s) => s.trim().replace(/^["']|["']$/g, '');
