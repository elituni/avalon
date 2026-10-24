import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
].map(([route, [file, type]]) => [route, {
  body: readFileSync(new URL(`./public/${file}`, import.meta.url)), type,
}]));

export function createCounterServer() {
  let count = 0;
  return createServer((req, res) => {
    const path = req.url.split('?')[0];
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (path === '/api/count') {
      if (!['GET', 'POST'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, POST' });
        return res.end();
      }
      // No await between reading and updating: simultaneous requests cannot lose increments.
      if (req.method === 'POST') count += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ count }));
    }
    const asset = assets.get(path);
    if (!asset) {
      res.writeHead(404);
      return res.end('Not found');
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': asset.type });
    res.end(req.method === 'HEAD' ? undefined : asset.body);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const server = createCounterServer();
  server.on('error', (error) => {
    console.error(`Cannot start Avalon: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log(`Avalon counter: http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close());
  }
}
