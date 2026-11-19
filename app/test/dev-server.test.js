// The local development server (server/dev.js): the API plus the pages in web/. It must never serve anything outside web/,
// because the app folder holds .env with the database password and keys.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDevServer } from '../server/dev.js';

let server, base;
const raw = (path) =>
  new Promise((resolve, reject) => {
    http.get(`${base}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });

before(async () => {
  const route = async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/echo') return new Response(JSON.stringify({ method: req.method, body: await req.text() }), { headers: [['content-type', 'application/json'], ['set-cookie', 'a=1'], ['set-cookie', 'b=2']] });
    return new Response('Not found', { status: 404 });
  };
  server = createDevServer(route);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

test('/ serves the signup page', async () => {
  const res = await raw('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /<form/);
});

test('/prijava and /en/prijava serve the page, the logo is served as an image', async () => {
  for (const path of ['/prijava', '/en/prijava']) {
    const res = await raw(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /<form/);
  }
  const logo = await raw('/prijava-logo.svg');
  assert.equal(logo.status, 200);
  assert.match(logo.headers['content-type'], /image\/svg\+xml/);
});

test('the page loads nothing from another site and has no red button', async () => {
  const page = await raw('/prijava');
  assert.equal(page.status, 200);
  const body = page.body;
  assert.ok(!/(src|href)="https?:/i.test(body), 'no external resource');
  assert.ok(!/url\(\s*['"]?https?:/i.test(body), 'no external css resource');
  assert.ok(!/#d71920|215\s*,?\s*25\s*,?\s*32/i.test(body), 'no brand red in the page');
});

test('/api goes to the router, with the method, the body and every set-cookie header', async () => {
  const res = await new Promise((resolve) => {
    const req = http.request(`${base}/api/echo`, { method: 'POST' }, (r) => {
      let body = '';
      r.on('data', (c) => (body += c));
      r.on('end', () => resolve({ status: r.statusCode, body, headers: r.headers }));
    });
    req.end('hello');
  });
  assert.deepEqual(JSON.parse(res.body), { method: 'POST', body: 'hello' });
  assert.deepEqual(res.headers['set-cookie'], ['a=1', 'b=2']);
});

test('nothing outside web/ is served: not .env, not the server code, not a traversal', async () => {
  for (const path of ['/../.env', '/..%2f.env', '/%2e%2e/.env', '/../package.json', '/server/index.js', '/.env', '//etc/passwd', '/..%5c.env']) {
    const res = await raw(path);
    assert.equal(res.status, 404, path);
    assert.ok(!/DATABASE_URL|postgres/i.test(res.body), path);
  }
});

test('an unknown page is 404', async () => {
  assert.equal((await raw('/nope.html')).status, 404);
});
