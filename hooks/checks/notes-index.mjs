// agent-workflow-kit pre-commit check — system-owned.
// Every new note under <notes_dir>/ must be linked from <notes_dir>/README.md in the
// same commit. Only runs when agent-system.yaml sets notes_dir.
// bajak kept 63/63 notes indexed by hand — but 5 of 39 note-adding commits forgot the
// line and fixed it later. The index is how the next session finds the note; an
// unindexed note is the one it will re-derive from scratch.
import { existsSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { git, stagedWithStatus, indexContent, skip, fail } from './lib.mjs';

if (skip()) process.exit(0);
const cfg = loadConfig();
const dir = String(cfg.notes_dir || '').replace(/^\.\//, '').replace(/\/+$/, '');
if (!dir) process.exit(0);
if (existsSync(git('rev-parse', '--git-path', 'MERGE_HEAD'))) process.exit(0); // merge commits pass

const indexPath = `${dir}/README.md`;
const added = stagedWithStatus().filter((f) => f.status === 'A' && f.path.startsWith(dir + '/') && f.path.endsWith('.md'));
const notes = added
  .map((f) => f.path)
  .filter((p) => p !== indexPath)
  // refs/ holds external material copied in verbatim; it is not the repo's own notes.
  .filter((p) => !p.slice(dir.length + 1).split('/').slice(0, -1).includes('refs'));
if (!notes.length) process.exit(0);

const index = indexContent(indexPath);
const missing = [];
for (const p of notes) {
  const rel = p.slice(dir.length + 1);           // link target relative to the index
  if (index === null || !(index.includes(rel) || index.includes(p))) missing.push(p);
}
if (missing.length) {
  fail([
    `new note(s) are not linked from ${indexPath}${index === null ? ' (not in the index — create and stage it)' : ''}:`,
    ...missing,
    `add one line per note to ${indexPath} (link target: path relative to the index, e.g. ${missing[0].slice(dir.length + 1)}) and stage it with the note`,
    'deliberate exception: AGENT_KIT_SKIP=1',
  ]);
}
