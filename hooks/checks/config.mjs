// agent-workflow-kit — minimal reader for agent-system.yaml. System-owned.
// Supports the subset the kit uses: `key: value`, `key: []`, and block lists of scalars.
// Deliberately not a YAML parser: the hooks run on every commit with no dependencies,
// and the config has a dozen flat keys. Nested maps are not supported on purpose.
import { readFileSync, existsSync } from 'node:fs';

const DEFAULTS = () => ({
  profile: 'shared',
  team_language: 'en',
  protected_branches: ['main'],
  issue_types: ['feature', 'fix', 'docs', 'chore', 'refactor', 'perf'],
  umbrella_issues: 'per-member',
  // false = no GitHub issues; branch_pattern governs branch names and management docs
  // are optional. A repo that never opened an issue (bajak: 194 commits on
  // `lhk/scoring-pipeline`) still wants the protected-branch and commit-format checks.
  issue_first: true,
  branch_pattern: '',            // read only when issue_first is false, e.g. "<member>/<desc>"
  issues_root: 'docs/issues',    // <root>/<type>/ and <root>/sub-issues/<type>/ both accepted
  worktree_root: 'sibling',      // sibling = ../<repo>-<issue> | claude = .claude/worktrees/<issue>-<short>
  base_branch: '',               // '' -> origin/HEAD; external profile usually upstream/<branch>
  notes_dir: '',                 // working-notes tree; its index is <notes_dir>/README.md
  doc_pairs: [],                 // "a <-> b" | "a <-> b | warn | why it matters"
  tools: [],                     // "<doc> | <artifact-or-command>"
});

export function loadConfig(path = 'agent-system.yaml') {
  const defaults = DEFAULTS();
  const cfg = DEFAULTS();
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
    else if (/^\[.*\]$/.test(v)) cfg[k] = flowList(v);
    else cfg[k] = scalar(v);
  }
  // A scalar key left empty (`notes_dir:`) parses as an empty block list. That is
  // "unset", not "a list" — restore the default so `if (!cfg.notes_dir)` stays honest.
  // And a list key given one bare value (`doc_pairs: "a <-> b"`) is a one-item list,
  // not a string to iterate character by character.
  for (const [k, d] of Object.entries(defaults)) {
    if (!Array.isArray(d) && Array.isArray(cfg[k]) && cfg[k].length === 0) cfg[k] = d;
    if (Array.isArray(d) && !Array.isArray(cfg[k])) cfg[k] = cfg[k] === '' ? [] : [cfg[k]];
  }
  return cfg;
}

const unq = (s) => s.trim().replace(/^["']|["']$/g, '');
// `[a, "b c", 'd']` — split on commas outside quotes. Enough for the one-line form the
// docs show; nested lists are not YAML the kit reads.
const flowList = (v) => {
  const out = [];
  let cur = '', q = null;
  for (const ch of v.slice(1, -1)) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(unq).filter(Boolean);
};
// `issue_first: false` must become a boolean; the string 'false' is truthy.
const scalar = (v) => {
  const s = unq(v);
  if (/^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === 'true';
  return s;
};

// "a <-> b" or "a <-> b | warn | why it matters" (also "| fail |"). The mode is optional
// and defaults to fail; the reason is free text and may itself contain '|'.
// A file-level pair that must ALWAYS change together is rare; most couplings are
// section-level, and a hard fail there forces no-op edits just to satisfy the hook
// (pipeplot had to fork the check to drop fail()). `warn` is the honest tier for those.
export function parsePair(entry) {
  const [pairPart, ...rest] = String(entry).split('|').map((s) => s.trim());
  const [a = '', b = ''] = pairPart.split('<->').map((s) => s.trim());
  let mode = 'fail';
  let why = '';
  if (rest.length) {
    const m = rest[0].toLowerCase();
    if (m === 'warn' || m === 'fail') { mode = m; why = rest.slice(1).join(' | '); }
    else why = rest.join(' | ');
  }
  return { a, b, mode, why };
}

// Base branch every "is this branch stale / merged" question is asked against.
// The env var wins so a one-off hook call can override; then the repo setting; then
// origin/HEAD, which git sets on clone.
export const baseRef = (cfg) => process.env.AGENT_KIT_BASE || cfg.base_branch || 'origin/HEAD';
