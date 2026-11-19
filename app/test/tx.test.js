// inTransaction on a pg Pool, on a checked-out client and nested. A real pg client has connect() too, which a
// PGlite connection does not, so this file imitates that shape. Found on real Postgres 2026-11-18.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inTransaction } from '../server/db/tx.js';

const makePool = () => {
  const log = [];
  const client = {
    query: async (sql) => { log.push(sql); return { rows: [] }; },
    connect: async () => { throw new Error('Client has already been connected. You cannot reuse a client.'); },
    release: () => log.push('release'),
  };
  const pool = { totalCount: 0, query: client.query, connect: async () => { log.push('checkout'); return client; } };
  return { pool, client, log };
};

test('on a pool it checks out one client, runs begin and commit once, and gives the client back', async () => {
  const { pool, log } = makePool();
  await inTransaction(pool, async (tx) => { await tx.query('select 1'); });
  assert.deepEqual(log, ['checkout', 'begin', 'select 1', 'commit', 'release']);
});

test('a nested call on the same client joins the open transaction: no second connect, begin or commit', async () => {
  const { pool, log } = makePool();
  await inTransaction(pool, (tx) => inTransaction(tx, (inner) => inner.query('select 1')));
  assert.deepEqual(log, ['checkout', 'begin', 'select 1', 'commit', 'release']);
});

test('an error in the nested call rolls back the whole transaction once', async () => {
  const { pool, log } = makePool();
  await assert.rejects(() => inTransaction(pool, (tx) => inTransaction(tx, async () => { throw new Error('boom'); })), /boom/);
  assert.deepEqual(log, ['checkout', 'begin', 'rollback', 'release']);
});

test('on a single connection without connect() it also runs one begin and commit, nested or not', async () => {
  const log = [];
  const conn = { query: async (sql) => { log.push(sql); return { rows: [] }; } };
  await inTransaction(conn, (tx) => inTransaction(tx, (inner) => inner.query('select 1')));
  assert.deepEqual(log, ['begin', 'select 1', 'commit']);
  log.length = 0;
  await inTransaction(conn, () => {});
  assert.deepEqual(log, ['begin', 'commit']);
});
