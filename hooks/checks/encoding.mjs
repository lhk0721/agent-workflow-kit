// agent-workflow-kit pre-commit check — system-owned. Warns only; never blocks.
// Two encoding traps that only show up on the OTHER platform:
//  - Windows PowerShell 5.1 reads a .ps1 without a UTF-8 BOM as the ANSI code page, so
//    a Korean string in the script becomes mojibake at run time (cp949 consoles).
//  - /bin/sh, dtc, systemd and udev all choke on CRLF; a file that looks fine in the
//    editor on Windows fails on the device with `^M: command not found`.
// Both are judged on the INDEX content — that is what the commit ships.
import { execFileSync } from 'node:child_process';
import { staged, skip } from './lib.mjs';

if (skip()) process.exit(0);

const indexBytes = (path) => {
  try { return execFileSync('git', ['show', `:${path}`], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { return null; }
};

const warn = [];
for (const p of staged()) {
  const ext = (p.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  if (ext === 'ps1') {
    const b = indexBytes(p);
    if (!b) continue;
    const hasBom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
    if (!hasBom && b.some((x) => x >= 0x80)) {
      warn.push(`${p}: non-ASCII text without a UTF-8 BOM — PowerShell 5.1 reads this as the ANSI code page — save with BOM`);
    }
  } else if (['sh', 'dts', 'service', 'rules'].includes(ext)) {
    const b = indexBytes(p);
    if (!b) continue;
    if (b.includes('\r\n')) {
      warn.push(`${p}: CRLF line endings — /bin/sh, dtc, systemd and udev reject them; add '*.${ext} text eol=lf' to .gitattributes and renormalize`);
    }
  }
}

if (warn.length) {
  console.warn('\n[agent-kit] encoding (warning only — commit proceeds):');
  for (const w of warn) console.warn('  - ' + w);
}
process.exit(0);
