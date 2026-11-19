import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../server/index.js';
import { handleHealth } from '../server/health.js';

const get = (path) => new Request(`https://app.example.test${path}`);

test('health answers 200 with ok true and db false when no database is configured', async () => {
  const res = await handleHealth(get('/api/health'), {});
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await res.json(), { ok: true, db: false });
});

test('health reports db true when the database answers', async () => {
  const pool = { query: async () => ({ rows: [{ ok: 1 }] }) };
  const res = await handleHealth(get('/api/health'), {}, () => pool);
  assert.deepEqual(await res.json(), { ok: true, db: true });
});

test('health stays 200 with db false when the database does not answer', async () => {
  const pool = { query: async () => { throw new Error('down'); } };
  const res = await handleHealth(get('/api/health'), {}, () => pool);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, db: false });
});

test('the pool is not made without DATABASE_URL, and is made once with it', async () => {
  const { getPool, closePool } = await import('../server/db/pool.js');
  assert.equal(getPool({}), null);
  const a = getPool({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x' });
  assert.equal(getPool({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x' }), a);
  await closePool();
});

test('the router sends /api/health to the health handler and anything else to 404', async () => {
  assert.equal((await route(get('/api/health'))).status, 200);
  assert.equal((await route(get('/api/nope'))).status, 404);
});

test('the rules layer is importable from the prototype', async () => {
  const { createStore } = await import('../../prototype/src/model.js');
  assert.ok(createStore(new Date()).classes);
});

test('an idle connection dropped by the database does not crash the process', async () => {
  const { getPool, closePool } = await import('../server/db/pool.js');
  const pool = getPool({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x' });
  const logged = [];
  const original = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    // pg raises this on the pool when the pooler closes an idle client. With no listener Node throws it.
    assert.doesNotThrow(() => pool.emit('error', Object.assign(new Error('terminating connection'), { code: '57P01' })));
  } finally {
    console.error = original;
    await closePool();
  }
  assert.match(logged.join(' '), /57P01/);
});
