// MiniEdit 本地服务：静态页面 + 原版数据包（只读）
// 不依赖任何第三方包；Node 22 自带 ICU，可以直接用 TextDecoder('gbk')。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = HERE;
const REF = path.resolve(HERE, '..', 'everedit-ref');
const BASE_PORT = Number(process.env.PORT || 5178);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function decode(buf) {
  // setting.ini 是 UTF-16LE（带 BOM），其它多为 UTF-8，个别 .mac 是 GBK
  if (buf.length > 1 && buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  if (buf.length > 1 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.slice(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return buf.toString('utf8');
    }
  }
}

function readText(p) {
  return decode(fs.readFileSync(p));
}

let cachedBundle = null;
function bundle() {
  if (cachedBundle) return cachedBundle;
  const synDir = path.join(REF, 'syntax');
  const themeDir = path.join(REF, 'theme');
  const syntaxes = fs.readdirSync(synDir).filter((f) => f.toLowerCase().endsWith('.mac')).sort();
  const themes = fs.readdirSync(themeDir).filter((f) => f.toLowerCase().endsWith('.ini')).sort();
  const files = {};
  for (const f of syntaxes) files[f] = readText(path.join(synDir, f));
  const themeFiles = {};
  for (const f of themes) themeFiles[f] = readText(path.join(themeDir, f));
  let settings = '';
  try { settings = readText(path.join(REF, 'setting.ini')); } catch { settings = ''; }
  cachedBundle = { syntaxes, themes, files, themeFiles, settings, root: REF };
  return cachedBundle;
}

function listRef(dir, prefix = '') {
  const abs = path.join(REF, dir);
  const out = [];
  if (!fs.existsSync(abs)) return out;
  for (const name of fs.readdirSync(abs)) {
    const full = path.join(abs, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push({ name: prefix + name + '/', dir: true, size: 0 });
    else out.push({ name: prefix + name, dir: false, size: st.size });
  }
  return out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/bundle') {
    return send(res, 200, MIME['.json'], JSON.stringify(bundle()));
  }

  if (pathname === '/api/list') {
    const dir = url.searchParams.get('dir') || '';
    return send(res, 200, MIME['.json'], JSON.stringify(listRef(dir)));
  }

  if (pathname === '/api/ref') {
    const rel = url.searchParams.get('path') || '';
    const abs = path.resolve(REF, rel);
    if (!abs.startsWith(REF) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      return send(res, 404, MIME['.txt'], 'not found');
    }
    return send(res, 200, MIME['.txt'], readText(abs));
  }

  let filePath = pathname === '/' ? '/index.html' : pathname;
  const abs = path.resolve(ROOT, '.' + filePath);
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    return send(res, 404, MIME['.txt'], 'not found');
  }
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  return send(res, 200, type, fs.readFileSync(abs));
});

function listen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) listen(port + 1, attempt + 1);
    else { console.error(err); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`MiniEdit ready: http://127.0.0.1:${port}`);
    console.log(`reference: ${REF}`);
  });
}

listen(BASE_PORT);
