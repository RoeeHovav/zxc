#!/usr/bin/env node
// Builds a PRIVATE, self-contained release folder + zip. Never commit or publish the output (it contains material derived from the book).
//   npm run content:build && npm run build:file && node scripts/package-release.mjs
// The release opens by double-clicking index.html (no installation, no scripts); serve.mjs/start.bat are an optional local-server fallback.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/content-lib.mjs';

const dist = path.join(ROOT, 'dist-file');
if (!fs.existsSync(path.join(dist, 'content', 'manifest.json.js'))) { console.error('Run: npm run content:build && npm run build:file first'); process.exit(1); }
const out = path.join(ROOT, 'release', 'bahad1-app');
fs.rmSync(path.join(ROOT, 'release'), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(dist, out, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'scripts', 'serve.mjs'), path.join(out, 'serve.mjs'));
fs.writeFileSync(path.join(out, 'start.bat'), [
  '@echo off', 'chcp 65001 >nul', 'cd /d "%~dp0"', 'where node >nul 2>nul',
  'if errorlevel 1 (', '  echo Node.js is not installed. Either install it from https://nodejs.org or simply open index.html directly.', '  pause', '  exit /b 1', ')',
  'echo Starting the Bahad 1 learning app...', 'node serve.mjs 4173 --open', 'pause', '',
].join('\r\n'));
fs.writeFileSync(path.join(out, 'start.sh'), '#!/bin/sh\ncd "$(dirname "$0")"\nnode serve.mjs 4173 --open\n', { mode: 0o755 });
const readme = [
  'בה״ד 1 – מרכז הלמידה (חבילה פרטית)',
  '',
  'איך מפעילים (הדרך הפשוטה):',
  '1. מחלצים את קובץ ה-ZIP לתיקייה רגילה (קליק ימני על הקובץ > "חלץ הכול" – לא להריץ מתוך ה-ZIP).',
  '2. לוחצים פעמיים על הקובץ index.html. האפליקציה נפתחת בדפדפן (מומלצים Chrome או Edge). אין צורך בהתקנה.',
  '3. ההתקדמות נשמרת בדפדפן הזה. לפני שמחליפים לגרסה חדשה: הגדרות > ייצוא גיבוי, ואחר כך ייבוא בגרסה החדשה.',
  '',
  'אם Windows מתריע על הקובץ: זה קורה כי הקובץ הורד מהאינטרנט ואינו חתום. קליק ימני על קובץ ה-ZIP > מאפיינים > "בטל חסימה" (Unblock) > אישור – ורק אחר כך לחלץ.',
  'הקבצים אינם מכילים תוכנה זדונית; כל הקוד פתוח לעיון בתיקייה assets.',
  '',
  'חלופה (דורשת Node.js): start.bat (Windows) או start.sh (Mac/Linux) מפעילים שרת מקומי ופותחים את http://localhost:4173.',
  '',
  'החבילה מכילה חומר שנגזר מהספר הרשמי. נא לא להעלות או לשתף.',
  '',
  'How to run: extract the zip to a normal folder and double-click index.html (Chrome or Edge recommended). Nothing to install.',
  'Progress is stored in this browser only - use Settings > Export backup regularly, and before replacing the app with a newer build.',
  'Windows may warn because the file was downloaded and is unsigned: right-click the zip > Properties > Unblock, then extract.',
  'Optional: start.bat / start.sh run a tiny local server (needs Node.js) at http://localhost:4173.',
  'This bundle contains material derived from the official book. Keep it private; do not upload or share it.',
].join('\r\n');
fs.writeFileSync(path.join(out, 'README.txt'), '\uFEFF' + readme);
const zip = path.join(ROOT, 'release', 'bahad1-app-release.zip');
try { execFileSync('python3', ['-c', `import shutil;shutil.make_archive(${JSON.stringify(zip.replace(/\.zip$/, ''))},'zip',${JSON.stringify(path.join(ROOT, 'release'))},'bahad1-app')`]); } catch (e) { console.error('zip failed', e.message); }
console.log('release folder:', out, '\nzip:', fs.existsSync(zip) ? `${zip} (${(fs.statSync(zip).size / 1e6).toFixed(1)} MB)` : 'not created');
