// Zero-dependency static server for the built app (used by start.bat / start.sh in the release bundle).
//   node serve.mjs [port]      then open http://localhost:4173
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// release bundle: index.html sits next to this script; older bundles keep the app in ./app; in the repository it is ../dist
const root = fs.existsSync(path.join(here, 'index.html')) ? here : fs.existsSync(path.join(here, 'app')) ? path.join(here, 'app') : path.join(here, '../dist');
const port = Number(process.argv[2] ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}`;
  console.log(`Bahad 1 learning app: ${url}  (close this window or press Ctrl+C to stop)`);
  if (process.argv.includes('--open')) {
    // open the default browser once the server is really listening
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* the user can open the address by hand */ }
  }
}).on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use - the app may already be running: open http://localhost:${port}` : String(e)); process.exit(1); });
