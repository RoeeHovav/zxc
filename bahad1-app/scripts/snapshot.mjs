#!/usr/bin/env node
// Snapshot of the private authored content (never committed; lives under private/backups).
//   node scripts/snapshot.mjs [label]        -> private/backups/content-<UTC stamp>[-label].tar.gz  (keeps the 8 newest)
//   node scripts/snapshot.mjs --restore <file>   -> restores private/content from a snapshot (the current folder is first moved to private/content.broken-<stamp>)
// Run it before every wave of agents: a session cut-off can kill an agent in the middle of writing a file.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PRIV } from './lib/content-lib.mjs';

const args = process.argv.slice(2);
const dir = path.join(PRIV, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
if (args[0] === '--restore') {
  const file = path.resolve(args[1]);
  if (!fs.existsSync(file)) { console.error('no such snapshot'); process.exit(2); }
  const cur = path.join(PRIV, 'content');
  if (fs.existsSync(cur)) fs.renameSync(cur, path.join(PRIV, `content.broken-${stamp}`));
  execFileSync('tar', ['-xzf', file, '-C', path.dirname(PRIV)]);
  console.log(`restored ${file}`);
} else {
  const label = args[0] ? `-${args[0].replace(/[^A-Za-z0-9_-]/g, '')}` : '';
  const out = path.join(dir, `content-${stamp}${label}.tar.gz`);
  execFileSync('tar', ['-czf', out, '-C', path.dirname(PRIV), '--exclude=*/content/*/_seg-*', 'private/content', 'private/chapters.json']);
  const all = fs.readdirSync(dir).filter((f) => f.startsWith('content-') && f.endsWith('.tar.gz')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - 8))) fs.rmSync(path.join(dir, f));
  console.log(`snapshot ${path.relative(path.dirname(PRIV), out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}
