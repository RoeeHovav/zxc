#!/usr/bin/env node
// Prints the source-unit dump of a page range:  node scripts/show-pages.mjs ch2 24 35
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_DIR } from './lib/content-lib.mjs';
const [ch, a, b] = process.argv.slice(2);
const txt = fs.readFileSync(path.join(SOURCE_DIR, 'chapters', `${ch}.txt`), 'utf8');
const parts = txt.split(new RegExp('\\n(?=' + '='.repeat(5) + ' PAGE )'));
const out = parts.filter((p) => { const m = p.match(/^===== PAGE (\d+)/); return m && Number(m[1]) >= Number(a) && Number(m[1]) <= Number(b); });
console.log(out.join('\n'));
