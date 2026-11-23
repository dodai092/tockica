// The scheduled function around the sweep, like server/functions/release.js: thin, answers 503 with no database,
// and runs every 15 minutes so No-show shows up soon after a class ends. Reception also sweeps when it opens a class.
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.DATABASE_URL;
const fn = await import('../server/functions/checkin-sweep.js');

test('it runs every 15 minutes', () => {
  assert.equal(fn.config.schedule, '*/15 * * * *');
});

test('without a database it answers 503 and does nothing', async () => {
  assert.equal((await fn.default()).status, 503);
});
