import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// PUBLIC_BOOKING_OPENS_ON is the test-only override of the opening date (npm run test:sheet). A launch build must never
// carry it. `npm run build` runs scripts/check-launch-env.mjs first, so LAUNCH=1 stops the build while it is set.
const script = new URL('../scripts/check-launch-env.mjs', import.meta.url).pathname;
const run = (env) =>
  spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });

test('LAUNCH=1 with PUBLIC_BOOKING_OPENS_ON set exits 1 and names the variable', () => {
  const r = run({ LAUNCH: '1', PUBLIC_BOOKING_OPENS_ON: '2026-01-01' });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /PUBLIC_BOOKING_OPENS_ON/);
});

test('LAUNCH=1 without the override passes', () => {
  assert.equal(run({ LAUNCH: '1' }).status, 0);
});

test('the override alone (npm run test:sheet) passes', () => {
  assert.equal(run({ PUBLIC_BOOKING_OPENS_ON: '2026-01-01' }).status, 0);
});

test('npm run build runs the check before astro build', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.build, /^node scripts\/check-launch-env\.mjs && astro build/);
});
