// The Riders Room lines carry no bike count, and Croatian writes the offer price as €99. Reads the built pages, so run
// `npm run build` first.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (page) => readFile(new URL(`../dist/${page}`, import.meta.url), 'utf8');

for (const [page, line] of [
  ['index.html', 'Spin treninzi u Riders Roomu.'],
  ['en/index.html', 'Spin classes in the Riders Room.'],
  ['pocetna/index.html', 'Naš signature 50-minutni rhythm spin.'],
  ['en/home/index.html', 'Our signature 50-minute rhythm spin class.'],
]) {
  test(`${page}: the Riders Room line ends after "${line}"`, async () => {
    const html = await read(page);
    const at = html.indexOf(line);
    assert.ok(at >= 0, 'the line is on the page');
    assert.match(html.slice(at + line.length), /^\s*</, 'nothing follows it in its element');
  });
}

for (const page of ['index.html', 'hvala-lista/index.html']) {
  test(`${page}: the Croatian offer price is written €99`, async () => {
    const html = await read(page);
    assert.ok(html.includes('€99'));
    assert.doesNotMatch(html, /99(\s|&nbsp;|&#160;)*€/);
  });
}
