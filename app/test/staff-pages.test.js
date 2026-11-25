// The staff home (web/osoblje.html) and the trainer screen (web/moji-treninzi.html). Static contracts: same look as the
// reception page, each page talks only to the routes it needs, and the trainer screen has no way to change a status.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createDevServer } from '../server/dev.js';

const read = (name) => readFile(new URL(`../web/${name}`, import.meta.url), 'utf8').catch(() => '');
const home = await read('osoblje.html');
const trainer = await read('moji-treninzi.html');
const paths = (html) => [...new Set([...html.matchAll(/['"`](\/api\/[^'"`?]*)/g)].map((m) => m[1]))].sort();

for (const [name, html] of [['osoblje.html', home], ['moji-treninzi.html', trainer]]) {
  test(`${name} exists, is Croatian, dark only, kept out of search, with the site tokens and no red or em dash`, () => {
    assert.ok(html.length > 0, `web/${name} exists`);
    assert.match(html, /<html lang="hr">/);
    assert.match(html, /<meta name="color-scheme" content="dark">/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /--btn:#f7f7f7/);
    assert.match(html, /--page:#232a35/);
    const code = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(code, /\bred\b|#f00\b/i);
    assert.doesNotMatch(html, /\u2014/);
    assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
    assert.doesNotMatch(html, /fonts\.googleapis|@import/);
  });
}

test('the staff home talks only to sign in, sign out and "who am I", and links to the two screens by role', () => {
  assert.deepEqual(paths(home), ['/api/osoblje/ja', '/api/osoblje/odjava', '/api/staff-login']);
  assert.match(home, /href: '\/osoblje-prijava\.html'/, 'the reception tile points at the reception page');
  assert.match(home, /href: '\/moji-treninzi\.html'/, 'the trainer tile points at the trainer screen');
  assert.match(home, /\['reception', 'owner'\]/, 'the reception tile is for reception and owner');
  assert.match(home, /\['instructor', 'owner'\]/, 'the trainer tile is for instructor and owner');
});

test('the trainer screen talks only to its list, its roster, sign in and sign out', () => {
  assert.deepEqual(paths(trainer), ['/api/osoblje/ja', '/api/osoblje/moji-treninzi', '/api/osoblje/moji-treninzi/trening', '/api/osoblje/odjava', '/api/staff-login']);
});

test('the trainer screen is read only: no status route, no status buttons, no roster write', () => {
  assert.doesNotMatch(trainer, /prijava\/status/);
  assert.doesNotMatch(trainer, /Dolazak|No-show, \$\{/);
  assert.doesNotMatch(trainer, /aria-pressed/);
  assert.doesNotMatch(trainer, /<button[^>]*class="ib"/);
});

test('the trainer screen and the staff home are keyboard and screen reader ready: landmark, one h1, labelled inputs, live status', () => {
  for (const html of [home, trainer]) {
    assert.match(html, /<main/);
    assert.equal((html.match(/<h1/g) ?? []).length, 1);
    assert.doesNotMatch(html, /tabindex="[1-9]/);
    assert.doesNotMatch(html, /<div[^>]*onclick|<span[^>]*onclick/i);
    assert.match(html, /:focus-visible/);
  }
  assert.match(home, /<label for="staffEmail"/);
  assert.match(home, /<label for="staffPassword"/);
  assert.match(trainer, /role="status"/);
});

let server, base;
before(async () => {
  server = createDevServer(async () => new Response('Not found', { status: 404 }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

test('the dev server serves both pages', async () => {
  for (const p of ['/osoblje', '/osoblje.html', '/moji-treninzi.html']) {
    const status = await new Promise((resolve, reject) => http.get(`${base}${p}`, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject));
    assert.equal(status, 200, p);
  }
});
