// The router in server/index.js: what is open, what is closed, and that the handlers get the database they need.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { createRoute } from '../server/index.js';

let db;
const now = () => new Date('2027-01-11T08:00:00Z');
const get = (path) => new Request(`https://app.example.test${path}`);

before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec(`
    insert into instructors (id, first_name, full_name, slug) values ('ins_1', 'Mirna', 'Mirna Zebec', 'mirna');
    insert into classes (id, name, instructor_id, starts_at, release_opens_at, bike_count)
      values ('cls_a', 'Riders', 'ins_1', '2027-01-12T17:30:00Z', '2026-12-29T09:00:00Z', 20);
  `);
});
after(() => db.close());

test('/api/schedule.json is open to a signed-out visitor and reads the database', async () => {
  const res = await createRoute({ pool: () => db, now })(get('/api/schedule.json'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, 'app');
  assert.deepEqual(body.classes.map((c) => c.id), ['cls_a']);
});

test('/api/health answers through the router and reports the database', async () => {
  const res = await createRoute({ pool: () => db, now })(get('/api/health'));
  assert.deepEqual(await res.json(), { ok: true, db: true });
});

test('with no database the schedule says 503 and health says db false', async () => {
  const route = createRoute({ pool: () => null, now });
  assert.equal((await route(get('/api/schedule.json'))).status, 503);
  assert.deepEqual(await (await route(get('/api/health'))).json(), { ok: true, db: false });
});

test('a path nobody registered is 404, including anything under /api/osoblje', async () => {
  const route = createRoute({ pool: () => db, now });
  assert.equal((await route(get('/api/nope'))).status, 404);
  assert.equal((await route(get('/api/osoblje/cijene'))).status, 404);
});
