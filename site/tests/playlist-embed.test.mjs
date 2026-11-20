// Instructor playlists: the page shows a prebuilt card at once (cover, name, first songs, a Spotify link) and Spotify's
// player loads behind it only after the page has loaded and gone idle, then fades in over the card. The card data is
// fetched by `npm run playlists`, never by a visitor. Reads the built pages, so run `npm run build` first.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import { chromium } from 'playwright';
import { instructors } from '../src/data/instructors.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const PORT = 4329;
const origin = `http://127.0.0.1:${PORT}`;
const playlists = JSON.parse(await readFile(new URL('../src/data/playlists.json', import.meta.url), 'utf8'));
const esc = (s) => s.replaceAll('&', '&amp;').replaceAll("'", '&#39;').replaceAll('"', '&quot;');
const read = (file) => readFile(new URL(`../dist/${file}`, import.meta.url), 'utf8');
const withPlaylist = instructors.filter((i) => i.playlist);
const dunia = instructors.find((i) => i.slug === 'dunia');
let browser;
let server;

// A plain static server over dist/. Not `astro preview`: only one preview of this project can run at a time and the
// instructor profile tests already use it.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' };

before(async () => {
  browser = await chromium.launch();
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, origin).pathname);
    const file = join(root, 'dist', path.endsWith('/') ? `${path}index.html` : path);
    const body = await readFile(file)
      .then((b) => ({ file, b }))
      .catch(() => readFile(join(file, 'index.html')).then((b) => ({ file: 'x.html', b })))
      .catch(() => null);
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[extname(body.file)] ?? 'application/octet-stream' });
    res.end(body.b);
  });
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
});

after(async () => {
  await browser?.close();
  server?.close();
});

for (const i of withPlaylist) {
  test(`${i.slug}: the playlist has a saved card (name, cover file, songs). Run npm run playlists after adding one`, () => {
    const p = playlists[i.playlist];
    assert.ok(p, `no entry for ${i.playlist}`);
    assert.ok(p.title, 'title');
    assert.ok(p.tracks.length > 0 && p.tracks.every((t) => t.title && t.artist), 'tracks with title and artist');
    assert.ok(existsSync(new URL(`../public/playlists/${i.playlist}.jpg`, import.meta.url)), 'cover file');
  });
}

for (const [lang, file] of [
  ['hr', 'instruktori/dunia/index.html'],
  ['en', 'en/instructors/dunia/index.html'],
]) {
  test(`${lang}: the card is in the HTML, the iframe has no src yet, and it comes after the next classes`, async () => {
    const html = await read(file);
    const p = playlists[dunia.playlist];
    const box = html.match(/<div[^>]*data-playlist="[^"]*"[\s\S]*?<\/iframe>/)?.[0];
    assert.ok(box, 'playlist box');
    assert.ok(box.includes(esc(p.title)), 'name on the card');
    assert.ok(box.includes(esc(p.tracks[0].title)), 'first song on the card');
    assert.ok(box.includes(`playlists/${dunia.playlist}.jpg`), 'cover');
    assert.ok(box.includes(`href="https://open.spotify.com/playlist/${dunia.playlist}"`), 'Spotify link');
    const iframe = box.match(/<iframe[^>]*>/)[0];
    assert.ok(!/\ssrc=/.test(iframe), 'the iframe must not load with the page');
    assert.ok(iframe.includes(`data-src="https://open.spotify.com/embed/playlist/${dunia.playlist}`), 'data-src');
    assert.ok(html.indexOf('data-playlist=') > html.indexOf('data-instructor-classes'), 'below the next classes');
  });
}

test('Spotify is not contacted before the page has loaded, then the player loads and replaces the card', async () => {
  const page = await browser.newPage();
  const spotify = [];
  let loaded = false;
  let before = null;
  await page.route('https://open.spotify.com/**', (route) => {
    spotify.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body>player</body>' });
  });
  page.on('load', () => {
    loaded = true;
    before = spotify.length;
  });
  await page.goto(`${origin}/instruktori/dunia`, { waitUntil: 'load' });
  assert.ok(loaded);
  assert.equal(before, 0, 'no Spotify request before the load event');
  const box = page.locator('[data-playlist]');
  await page.waitForFunction(() => document.querySelector('[data-playlist]')?.dataset.ready === 'true', null, {
    timeout: 5000,
  });
  assert.ok(
    spotify.some((u) => u.includes(`/embed/playlist/${dunia.playlist}`)),
    'the player was requested'
  );
  assert.equal(
    await box.locator('[data-playlist-card]').getAttribute('inert'),
    '',
    'the card is inert behind the player'
  );
  await page.close();
});

test('Without JavaScript the card and its Spotify link stay and nothing loads', async () => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const spotify = [];
  page.on('request', (r) => r.url().includes('spotify.com/embed') && spotify.push(r.url()));
  await page.goto(`${origin}/instruktori/dunia`, { waitUntil: 'load' });
  assert.equal(spotify.length, 0);
  assert.ok(await page.locator('[data-playlist-card] a[href^="https://open.spotify.com/playlist/"]').isVisible());
  await context.close();
});

for (const [name, width, w, h] of [
  ['phone', 375, 343, 152],
  ['desktop', 1280, 608, 452],
]) {
  test(`${name}: the playlist box is ${w} x ${h}, Spotify's compact player on a phone and two class cards wide on desktop`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('https://open.spotify.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body>player</body>' })
    );
    await page.goto(`${origin}/instruktori/dunia`, { waitUntil: 'load' });
    const size = await page.locator('[data-playlist]').boundingBox();
    assert.equal(Math.round(size.width), w);
    assert.equal(Math.round(size.height), h);
    await page.close();
  });
}
