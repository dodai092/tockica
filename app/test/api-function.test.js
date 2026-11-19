// The Netlify Function for /api/*: it must claim the whole /api tree and hand every request to the guarded router.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { config } from '../server/functions/api.js';

test('the function owns /api/*', () => {
  assert.equal(config.path, '/api/*');
});

test('a request goes through the guarded router: an unregistered path is a 404, not a crash', async () => {
  const res = await handler(new Request('https://app.example.test/api/not-a-route'));
  assert.equal(res.status, 404);
});

test('a registered open route answers through it', async () => {
  const res = await handler(new Request('https://app.example.test/api/health'));
  assert.ok([200, 503].includes(res.status), `status ${res.status}`);
  assert.match(res.headers.get('content-type') ?? '', /json/);
});
