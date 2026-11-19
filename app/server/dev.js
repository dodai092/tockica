// Local development server: the /api routes plus the pages in web/, on one port, so a browser can try the app.
// Run it with: npm run dev (needs app/.env). It serves nothing outside web/: the app folder holds .env.
// Netlify does this job in production (netlify.toml), so this file is only for working on a laptop.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

async function serveStatic(rawUrl, res) {
  const notFound = () => {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  };
  let pathname = rawUrl.split('?')[0].split('#')[0];
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return notFound();
  }
  // The site proxies /prijava and /en/prijava (one page, the language comes from the path). netlify.toml rewrites the same.
  if (pathname === '/' || pathname === '/prijava' || pathname === '/en/prijava') pathname = '/prijava.html';
  const parts = pathname.split('/').filter(Boolean);
  // No dot-files, no parent folders, no backslashes or nul bytes, only known page types.
  if (!parts.length || parts.some((p) => p.startsWith('.') || p.includes('\\') || p.includes('\0'))) return notFound();
  const file = path.resolve(webRoot, ...parts);
  if (!file.startsWith(webRoot) || !TYPES[path.extname(file)]) return notFound();
  try {
    if (!(await stat(file)).isFile()) return notFound();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)], 'cache-control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    notFound();
  }
}

export function createDevServer(route) {
  return http.createServer(async (req, res) => {
    if (!req.url.startsWith('/api/')) return serveStatic(req.url, res);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) headers.append(k, Array.isArray(v) ? v.join(', ') : v);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    try {
      const out = await route(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined }));
      const outHeaders = {};
      out.headers.forEach((v, k) => { if (k !== 'set-cookie') outHeaders[k] = v; });
      const cookies = out.headers.getSetCookie();
      if (cookies.length) outHeaders['set-cookie'] = cookies;
      res.writeHead(out.status, outHeaders);
      res.end(Buffer.from(await out.arrayBuffer()));
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Server error');
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { route } = await import('./index.js');
  const port = Number(process.env.PORT) || 3000;
  createDevServer(route).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));
}
