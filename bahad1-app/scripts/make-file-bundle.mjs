#!/usr/bin/env node
// Turns the "dist-file" build into a folder that works when index.html is opened straight from disk (file://):
// every content/**/*.json becomes content/**/<name>.json.js that registers its data in window.__BAHAD__ (read by src/content/loader.ts).
//   npx vite build -c vite.file.config.ts && node scripts/make-file-bundle.mjs [dist-file]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/content-lib.mjs';

const dir = path.resolve(ROOT, process.argv[2] ?? 'dist-file');
const contentDir = path.join(dir, 'content');
if (!fs.existsSync(path.join(dir, 'index.html')) || !fs.existsSync(contentDir)) { console.error('Run: npm run content:build && npx vite build -c vite.file.config.ts first'); process.exit(1); }
let n = 0; let bytes = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { walk(f); continue; }
    if (!e.name.endsWith('.json')) continue;
    const key = path.relative(contentDir, f).split(path.sep).join('/');
    const data = fs.readFileSync(f, 'utf8');
    JSON.parse(data); // fail loudly on a corrupt file
    fs.writeFileSync(`${f}.js`, `(window.__BAHAD__=window.__BAHAD__||{})[${JSON.stringify(key)}]=${data};\n`);
    fs.rmSync(f);
    n++; bytes += data.length;
  }
};
walk(contentDir);
console.log(`file bundle ready: ${n} content files converted (${(bytes / 1e6).toFixed(1)} MB) in ${path.relative(ROOT, dir)}`);
