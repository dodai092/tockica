// The deployed app serves the login page the way the dev server does (server/dev.js): /prijava and /en/prijava are the
// one page, prijava.html. The site proxies these paths (site/netlify.toml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const toml = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');

test('/prijava and /en/prijava are rewritten (not redirected) to prijava.html', () => {
  for (const from of ['/prijava', '/en/prijava']) {
    const block = toml.split('[[redirects]]').slice(1).find((b) => new RegExp(`from\\s*=\\s*"${from}"`).test(b));
    assert.ok(block, `a rule for ${from}`);
    assert.match(block, /to\s*=\s*"\/prijava\.html"/);
    assert.match(block, /status\s*=\s*200/);
  }
});
