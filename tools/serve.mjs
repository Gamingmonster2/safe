/* =============================================================================
 * مصروفي — tools/serve.mjs
 * سيرفر ثابت صغير بلا أي مكتبة، لتشغيل التطبيق على http://127.0.0.1:5173
 * (مطلوب لتفعيل Service Worker والتثبيت على الجوال — file:// لا يكفي).
 * الاستخدام:  node tools/serve.mjs [منفذ]
 * ========================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const full = path.normalize(path.join(ROOT, rel));
    if (!full.startsWith(ROOT)) {
      res.writeHead(403).end('ممنوع');
      return;
    }
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('غير موجود: ' + rel);
      return;
    }
    const body = fs.readFileSync(full);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/'
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('خطأ: ' + e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('💼 مصروفي يعمل على:  http://127.0.0.1:' + PORT);
  console.log('   المجلد: ' + ROOT);
  console.log('   أوقفه بـ Ctrl+C');
});
