// agent-workflow-kit — AGENTS.md size budget. System-owned.
// Warns only; never blocks. Rules: docs/agent-workflow/context-maintenance.md
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { staged, skip } from './lib.mjs';

if (skip()) process.exit(0);
if (!staged().includes('AGENTS.md')) process.exit(0);
if (!existsSync('AGENTS.md')) process.exit(0);

const BASE = process.env.AGENT_KIT_BASE || 'origin/HEAD';
const LIMITS = { file: 12000, bullet: 1200, active: 5, struck: 1, behind: 100, days: 60 };

const text = readFileSync('AGENTS.md', 'utf8');
const lines = text.split('\n');
const warn = [];

if (text.length > LIMITS.file) {
  warn.push(`AGENTS.md is ${text.length} chars (budget ${LIMITS.file}) — move detail into docs/ and link it`);
}

// A bullet runs from "- " until the next bullet or heading.
let cur = null;
const bullets = [];
for (const l of lines) {
  if (/^\s*[-*] /.test(l)) {
    if (cur) bullets.push(cur);
    cur = { head: l.trim(), text: l };
  } else if (cur && /^(#{1,6} |\s*$)/.test(l)) {
    bullets.push(cur);
    cur = null;
  } else if (cur) {
    cur.text += '\n' + l;
  }
}
if (cur) bullets.push(cur);

for (const b of bullets) {
  if (b.text.length > LIMITS.bullet) {
    warn.push(`bullet is ${b.text.length} chars (budget ${LIMITS.bullet}): ${b.head.slice(0, 60)}...`);
  }
}

// Recent Active Context: pointer lines only, bounded by work in progress.
const start = lines.findIndex((l) => /^##+ .*Recent Active Context/i.test(l));
if (start >= 0) {
  const pointers = [];
  for (const l of lines.slice(start + 1)) {
    if (/^##+ /.test(l)) break;
    if (/^\s*[-*] /.test(l) && !/^\s*[-*] \((none|없음)\)/.test(l) && !/^\s*[-*] Use rule/.test(l)) {
      pointers.push(l);
    }
  }
  if (pointers.length > LIMITS.active) {
    warn.push(`Recent Active Context has ${pointers.length} pointers (budget ${LIMITS.active}) — remove merged work`);
  }

  // The failure this check exists for: a pointer that outlived its branch.
  // A count budget never catches one stale line, and one stale line is the
  // expensive case — the agent acts on it without verifying.
  // "merged" must mean "its work landed and the line was never removed", not
  // "it has no commits yet". A freshly branched line is level with the base and
  // `git branch --merged` lists it — so compare both directions instead.
  // Base branch: AGENT_KIT_BASE, else origin/HEAD. A repo whose PR base is a fork
  // remote (upstream/develop) sets it in the hook call.
  const countRev = (range) => {
    try {
      return Number(execFileSync('git', ['rev-list', '--count', range],
        { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim());
    } catch { return null; }
  };
  // Three ways a pointer stops describing work in progress. All are answered from
  // local git, so the check stays offline and fast.
  const staleReason = (br) => {
    const ahead = countRev(`${BASE}..${br}`);
    const behind = countRev(`${br}..${BASE}`);
    if (ahead === null || behind === null) return null;     // unknown ref — say nothing

    // Landed: holds nothing the base lacks, and the base has moved on.
    if (ahead === 0 && behind > 0) return `its work is already in ${BASE}`;

    // Drifted: the base ran far ahead while this line sat still.
    if (behind > LIMITS.behind) return `${BASE} is ${behind} commits ahead of it`;

    // Cold: no commit in a long time.
    let days = null;
    try {
      const ts = Number(execFileSync('git', ['log', '-1', '--format=%ct', br],
        { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim());
      days = Math.floor((Date.now() / 1000 - ts) / 86400);
    } catch { /* ignore */ }
    if (days !== null && days > LIMITS.days) return `last commit was ${days} days ago`;

    return null;
  };

  let known = new Set();
  try {
    known = new Set(
      execFileSync('git', ['branch', '--all', '--format=%(refname:short)'],
        { stdio: ['ignore', 'pipe', 'pipe'] })
        .toString().split('\n').map((s) => s.trim().replace(/^(origin|upstream)\//, '')).filter(Boolean),
    );
  } catch { /* ignore */ }

  for (const p of pointers) {
    const m = p.match(/`([0-9]+-[a-z]+-[a-z0-9-]+)`/i);
    if (!m) continue;
    const br = m[1];
    if (known.size && !known.has(br)) {
      warn.push(`Recent Active Context points at '${br}', which no longer exists as a branch — remove the line`);
      continue;
    }
    const why = staleReason(br);
    if (why) warn.push(`Recent Active Context points at '${br}' — ${why}; remove the line if the work is done`);
  }
}

const struck = (text.match(/~~/g) || []).length / 2;
if (struck > LIMITS.struck) {
  warn.push(`${struck} struck-through runs — superseded history belongs in docs/, not in the always-loaded file`);
}

if (warn.length) {
  console.warn('\n[agent-kit] context budget (warning only — commit proceeds):');
  for (const w of warn) console.warn('  - ' + w);
  console.warn('  see docs/agent-workflow/context-maintenance.md');
}
process.exit(0);
