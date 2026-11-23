// The reception check-in page (web/osoblje-prijava.html, plan 2026-11-21-reception-check-in.md). A static contract: what the
// page must hold to stay on the studio's look and to stay usable. How it behaves in a browser is checked by hand.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createDevServer } from '../server/dev.js';

const html = await readFile(new URL('../web/osoblje-prijava.html', import.meta.url), 'utf8').catch(() => '');

test('the page exists, is Croatian, dark only and kept out of search', () => {
  assert.ok(html.length > 0, 'web/osoblje-prijava.html exists');
  assert.match(html, /<html lang="hr">/);
  assert.match(html, /<meta name="color-scheme" content="dark">/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.doesNotMatch(html, /user-scalable|maximum-scale/);
});

test('it uses the site tokens: near-white button with slate label, no red, no em dash, nothing from another site', () => {
  assert.match(html, /--btn:#f7f7f7/);
  assert.match(html, /--btn-text:#232a35/);
  assert.match(html, /--page:#232a35/);
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(code, /\bred\b|#f00\b|#e[0-9a-f]{1}[0-3][0-9a-f]{3}\b/i);
  assert.doesNotMatch(html, /—/);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
  assert.doesNotMatch(html, /@import|fonts\.googleapis/);
});

test('it talks only to the check-in routes and the staff login', () => {
  const paths = new Set([...html.matchAll(/['"`](\/api\/[^'"`?]*)/g)].map((m) => m[1]));
  assert.deepEqual([...paths].sort(), [
    '/api/osoblje/ja',
    '/api/osoblje/odjava',
    '/api/osoblje/prijava/status',
    '/api/osoblje/prijava/treninzi',
    '/api/osoblje/prijava/trening',
    '/api/staff-login',
  ].sort());
});

test('it is built for keyboard and screen readers: landmark, labelled inputs, named icon buttons, live region, no positive tabindex', () => {
  assert.match(html, /<main/);
  assert.match(html, /<h1/);
  assert.match(html, /role="status"/);
  assert.match(html, /<label for="staffEmail"/);
  assert.match(html, /<label for="staffPassword"/);
  assert.match(html, /autocomplete="username"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /aria-label/);
  assert.match(html, /:focus-visible/);
  assert.doesNotMatch(html, /outline:\s*none/);
  assert.doesNotMatch(html, /tabindex="[1-9]/);
  assert.doesNotMatch(html, /<div[^>]*onclick|<span[^>]*onclick/i);
});

test('both buttons stay on every row and show the press with aria-pressed, in the glossary words: no undo link, no chip', () => {
  assert.match(html, /aria-pressed/);
  assert.match(html, /No-show, \$\{who\}/);
  assert.match(html, /Dolazak, \$\{who\}/);
  assert.doesNotMatch(html, /Poništi|Nije došao|class="undo"|class: 'undo'|\.chip/);
  assert.match(html, /\.ib\[aria-pressed=true\]/);
});

test('messages never move the page: no message above the heading, errors in a reserved alert line below the legend, success announced in a hidden live region', () => {
  assert.doesNotMatch(html, /id="msg"/);
  assert.match(html, /<p id="err" class="slot" role="alert"><\/p>/);
  assert.match(html, /<p id="loginMsg" class="slot" role="alert"><\/p>/);
  assert.match(html, /<p id="announce" class="sr-only" role="status"><\/p>/);
  assert.match(html, /\.slot\{[^}]*min-height:24px/);
  assert.match(html, /\.sr-only\{[^}]*clip-path/);
  assert.ok(html.indexOf('id="err"') > html.indexOf('id="classTitle"'), 'the error line sits below the class heading, not above it');
  assert.ok(html.indexOf('id="err"') < html.indexOf('id="riders"'), 'and above the rider list');
});

let server, base;
before(async () => {
  server = createDevServer(async () => new Response('Not found', { status: 404 }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

test('the dev server serves it', async () => {
  const status = await new Promise((resolve, reject) => http.get(`${base}/osoblje-prijava.html`, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject));
  assert.equal(status, 200);
});
