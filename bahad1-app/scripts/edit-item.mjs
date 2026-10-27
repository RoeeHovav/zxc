#!/usr/bin/env node
// Safe, atomic editing of ONE authored item (compact format) inside private/content/<ch>/src/*.json — for agents that repair content in parallel.
//   node scripts/edit-item.mjs <ch> <id> --show                      print the compact item (facts: f.., lessons: l.., questions: q..)
//   node scripts/edit-item.mjs <ch> <id> '<json patch>'              shallow-merge the given compact fields (arrays/objects are replaced as a whole)
//   node scripts/edit-item.mjs <ch> <id> --delete                    remove the item (the caller must fix dependents; run validate-content afterwards)
// Several agents may call it at the same time: a lock directory serialises read-modify-write and every file is replaced atomically (temp file + rename).
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_SRC } from './lib/content-lib.mjs';

const [ch, rawId, arg] = process.argv.slice(2);
if (!ch || !rawId || !arg) { console.error('usage: edit-item.mjs <ch> <id> --show | --delete | \'{"field":value}\''); process.exit(2); }
const id = rawId.startsWith(`${ch}.`) ? rawId.slice(ch.length + 1) : rawId;
const dir = path.join(CONTENT_SRC, ch, 'src');
const lock = path.join(dir, '.edit-lock');

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let got = false;
for (let i = 0; i < 400 && !got; i++) {
  try { fs.mkdirSync(lock); got = true; } catch {
    try { if (Date.now() - fs.statSync(lock).mtimeMs > 20000) fs.rmdirSync(lock); } catch { /* raced */ }
    sleep(25);
  }
}
if (!got) { console.error('could not acquire the edit lock'); process.exit(3); }
try {
  const prefix = id[0] === 'f' ? 'facts' : id[0] === 'l' ? 'lessons' : id[0] === 'q' ? 'questions' : null;
  if (!prefix) throw new Error(`unknown id kind: ${id}`);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
  let hit = null;
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) { hit = { f, arr, i }; break; }
  }
  if (!hit) throw new Error(`item ${id} not found in ${prefix}-*.json`);
  if (arg === '--show') console.log(JSON.stringify(hit.arr[hit.i], null, 1));
  else {
    if (arg === '--delete') hit.arr.splice(hit.i, 1);
    else {
      const patch = JSON.parse(arg);
      if ('id' in patch && patch.id !== id) throw new Error('the id cannot be changed');
      hit.arr[hit.i] = { ...hit.arr[hit.i], ...patch };
    }
    const target = path.join(dir, hit.f);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(hit.arr, null, 1));
    fs.renameSync(`${target}.tmp`, target);
    console.log(`${arg === '--delete' ? 'deleted' : 'updated'} ${id} in ${hit.f}`);
  }
} catch (e) { console.error(String(e.message ?? e)); process.exitCode = 1; } finally { try { fs.rmdirSync(lock); } catch { /* ignore */ } }
