// The site proxies the booking app's pages and API under tockicanai.hr (ADR 0005), so the login page and /api live on
// the site's own domain and the session cookie stays first-party. The app address is not decided yet: the placeholder
// host ends in .invalid, so a deploy before it is set fails loudly (502) instead of sending people somewhere wrong.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const toml = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
const rules = toml
  .split('[[redirects]]')
  .slice(1)
  .map((block) =>
    Object.fromEntries(
      [...block.matchAll(/^\s*(from|to|status|force)\s*=\s*"?([^"\n]+?)"?\s*$/gm)].map((m) => [m[1], m[2]])
    )
  );

const wanted = [
  ['/api/*', '/api/:splat'],
  ['/prijava', '/prijava'],
  ['/en/prijava', '/en/prijava'],
  ['/prijava-logo.svg', '/prijava-logo.svg'],
];

test('the booking app is proxied for the API, the login page in both languages and its logo', () => {
  for (const [from, path] of wanted) {
    const rule = rules.find((r) => r.from === from);
    assert.ok(rule, `a rule for ${from}`);
    assert.equal(rule.status, '200', `${from} is a proxy (200), not a redirect`);
    assert.equal(rule.force, 'true', `${from} wins over a file of the same name`);
    assert.ok(rule.to.endsWith(path), `${from} goes to ${path}`);
  }
  const origins = new Set(wanted.map(([from]) => new URL(rules.find((r) => r.from === from).to).origin));
  assert.equal(origins.size, 1, 'one app address for all of them');
});

test('LAUNCH=1: the app address is real, not the placeholder', { skip: process.env.LAUNCH !== '1' }, () => {
  assert.ok(
    !/TODO|\.invalid/.test(toml),
    'replace APP_ORIGIN_TODO.invalid in netlify.toml with the deployed app address'
  );
});
