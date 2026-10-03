import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/demo/popup-preview.html') {
      const popup = (await readFile(resolve(root, 'extension/popup.html'), 'utf8'))
        .replace('<head>', '<head><base href="/extension/">')
        .replace('<script type="module" src="popup.js">', '<script src="/demo/preview-api.js"></script><script type="module" src="popup.js">');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(popup); return;
    }
    const path = resolve(root, '.' + (pathname === '/' ? '/demo/index.html' : pathname));
    if (!path.startsWith(root + sep) || !['/extension/', '/demo/'].some(p => pathname.startsWith(p)) && pathname !== '/') {
      response.writeHead(403); response.end('Forbidden'); return;
    }
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(8765, '127.0.0.1', () => console.log('Demo: http://127.0.0.1:8765'));
