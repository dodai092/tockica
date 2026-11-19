// One repo, one Netlify site (ADR 0005, update 2026-11-19). The root netlify.toml builds the site, ships the app's login
// page beside it, and serves /api/* from the app's function, so the site and the app are the same domain with no proxy.
// The login page is one file, two paths: the language comes from the path (web/prijava.html), server/dev.js does the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const toml = await readFile(new URL('netlify.toml', root), 'utf8');
const rule = (from) => toml.split('[[redirects]]').slice(1).find((b) => new RegExp(`from\\s*=\\s*"${from}"`).test(b));

test('/prijava and /en/prijava are rewritten (not redirected) to prijava.html', () => {
  for (const from of ['/prijava', '/en/prijava']) {
    const block = rule(from);
    assert.ok(block, `a rule for ${from}`);
    assert.match(block, /to\s*=\s*"\/prijava\.html"/);
    assert.match(block, /status\s*=\s*200/);
  }
});

test('the site is published from site/dist and the API from the app function', () => {
  assert.match(toml, /publish\s*=\s*"site\/dist"/);
  assert.match(toml, /functions\s*=\s*"app\/server\/functions"/);
});

test('the build installs both, builds the site with its own script, and copies the app web files into the published folder', () => {
  const command = toml.match(/command\s*=\s*"([^"]+)"/)?.[1] ?? '';
  assert.match(command, /npm ci --prefix app/);
  assert.match(command, /npm ci --prefix site/);
  assert.match(command, /npm run build --prefix site/);
  assert.match(command, /cp -R app\/web\/\. site\/dist\//);
  assert.ok(command.indexOf('npm run build --prefix site') < command.indexOf('cp -R'), 'copy after the build, or the build wipes it');
});

test('no proxy to another address is left, and the site settings carried over', () => {
  assert.doesNotMatch(toml, /\.invalid|APP_ORIGIN|https?:\/\//);
  assert.match(toml, /pretty_urls\s*=\s*false/);
  assert.match(toml, /for\s*=\s*"\/_astro\/\*"/);
  assert.match(toml, /immutable/);
});

test('there is one netlify.toml: the old per-folder ones are gone', () => {
  assert.equal(existsSync(new URL('app/netlify.toml', root)), false);
  assert.equal(existsSync(new URL('site/netlify.toml', root)), false);
});
