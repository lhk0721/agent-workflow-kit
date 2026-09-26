#!/usr/bin/env node
// agent-workflow-kit — SKILL.md frontmatter lint. System-owned.
//
// Claude Code parses the frontmatter as YAML. An unquoted `description:` that carries
// ": " (or " #") inside its value is a YAML error, and the skill then shows up in the
// listing with its H1 title instead of its description — which is the text that decides
// whether the skill fires at all (session-handoff, v0.2.1: "work in flight: a long job"
// listed as "Session handoff"). Run from the kit root: node skills/frontmatter.test.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
let fail = 0, n = 0;
const bad = (dir, why) => { fail++; console.error(`FAIL ${dir}/SKILL.md — ${why}`); };

for (const dir of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
  const file = join(root, dir, 'SKILL.md');
  if (!existsSync(file)) continue;
  n++;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  if (lines[0] !== '---') { bad(dir, 'no frontmatter'); continue; }
  const end = lines.indexOf('---', 1);
  if (end < 0) { bad(dir, 'frontmatter never closes'); continue; }
  const fm = {};
  for (const l of lines.slice(1, end)) {
    const m = /^([A-Za-z_-]+):\s?(.*)$/.exec(l);
    if (!m) { bad(dir, `frontmatter line is not key: value — ${l.slice(0, 60)}`); continue; }
    fm[m[1]] = m[2];
  }
  if (fm.name !== dir) bad(dir, `name '${fm.name}' does not match the directory`);
  const d = fm.description || '';
  if (!d) bad(dir, 'description missing');
  const quoted = /^(["']).*\1$/.test(d);
  if (!quoted && /: /.test(d)) bad(dir, 'unquoted description contains ": " — YAML reads it as a nested key; rephrase or quote the whole value');
  if (!quoted && / #/.test(d)) bad(dir, 'unquoted description contains " #" — YAML starts a comment there');
  if (d.length < 60) bad(dir, `description is ${d.length} chars — too short to trigger on`);
  if ('paths' in fm) bad(dir, '`paths:` hides the skill on Claude Code 2.1.278 (see skills.md)');
}
console.log(`${n - fail}/${n} SKILL.md frontmatters ok`);
process.exit(fail ? 1 : 0);
