#!/usr/bin/env node
// Builds a PRIVATE, self-contained release folder + zip (app + content + local server). Never commit or publish the output.
//   npm run content:build && npm run build && node scripts/package-release.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/content-lib.mjs';

const dist = path.join(ROOT, 'dist');
if (!fs.existsSync(path.join(dist, 'content', 'manifest.json'))) { console.error('Run: npm run content:build && npm run build first'); process.exit(1); }
const out = path.join(ROOT, 'release', 'bahad1-app');
fs.rmSync(path.join(ROOT, 'release'), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(dist, path.join(out, 'app'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'scripts', 'serve.mjs'), path.join(out, 'serve.mjs'));
fs.writeFileSync(path.join(out, 'start.bat'), '@echo off\r\nchcp 65001 >nul\r\necho Starting the Bahad 1 learning app...\r\nstart "" http://localhost:4173\r\nnode serve.mjs 4173\r\npause\r\n');
fs.writeFileSync(path.join(out, 'start.sh'), '#!/bin/sh\ncd "$(dirname "$0")"\nnode serve.mjs 4173\n', { mode: 0o755 });
fs.writeFileSync(path.join(out, 'README.txt'), [
  'Bahad 1 learning app - private local bundle',
  '1. Install Node.js 18 or newer (https://nodejs.org) once.',
  '2. Windows: double-click start.bat.  macOS/Linux: ./start.sh.  Then open http://localhost:4173',
  '3. Progress is stored in this browser only. Use Settings > Export backup regularly.',
  '4. This bundle contains material derived from the official book. Keep it private; do not upload or share it.',
].join('\r\n'));
const zip = path.join(ROOT, 'release', 'bahad1-app-release.zip');
try { execFileSync('python3', ['-c', `import shutil;shutil.make_archive(${JSON.stringify(zip.replace(/\.zip$/, ''))},'zip',${JSON.stringify(path.join(ROOT, 'release'))},'bahad1-app')`]); } catch (e) { console.error('zip failed', e.message); }
console.log('release folder:', out, '\nzip:', fs.existsSync(zip) ? `${zip} (${(fs.statSync(zip).size / 1e6).toFixed(1)} MB)` : 'not created');
