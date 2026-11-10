#!/usr/bin/env node
// Minimal static server for local development: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../public', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (path.endsWith(sep)) path += 'index.html';
  const file = join(ROOT, path);
  try {
    if (!file.startsWith(ROOT) || !statSync(file).isFile()) throw new Error('not found');
  } catch {
    res.writeHead(404).end('Not found');
    return;
  }
  const type = TYPES[extname(file)] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
  const gzip = /text|json|javascript|svg/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gzip) headers['Content-Encoding'] = 'gzip';
  res.writeHead(200, headers);
  const stream = createReadStream(file);
  (gzip ? stream.pipe(createGzip({ level: 1 })) : stream).pipe(res);
}).listen(PORT, () => console.log(`Manabi running at http://localhost:${PORT}`));
