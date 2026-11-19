// Customer session (plan Task 4, accepted 2026-11-11): HttpOnly Secure SameSite=Lax cookie, valid 30 days from the last
// visit and pushed out 30 more on every visit, absolute cap 180 days. The app owns the cookie and its expiry.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { createSession, getCustomerSession, endSession, COOKIE_NAME } from '../server/session.js';

let db;
const day = 864e5;
const t0 = new Date('2027-01-05T10:00:00Z');
const at = (d) => new Date(t0.getTime() + d * day);
const reqWith = (token) => new Request('https://app.example.test/api/x', { headers: token ? { cookie: `other=1; ${COOKIE_NAME}=${token}` } : {} });

before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec(`insert into accounts (id, name, email) values ('acc_1', 'Ana Horvat', 'ana@example.com')`);
});
after(() => db.close());
beforeEach(() => db.exec('delete from sessions'));

test('a new session sets a cookie that is HttpOnly, Secure, SameSite=Lax and lasts 30 days', async () => {
  const { cookie } = await createSession(db, 'acc_1', t0);
  assert.match(cookie, new RegExp(`^${COOKIE_NAME}=[A-Za-z0-9_-]{40,};`));
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(flag), flag);
  assert.match(cookie, /Max-Age=2592000\b/);
});

test('the database holds a hash of the cookie value, never the value itself', async () => {
  const { token } = await createSession(db, 'acc_1', t0);
  const rows = (await db.query('select * from sessions')).rows;
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows[0]).includes(token));
});

test('a visit on day 29 keeps the session and pushes the end out another 30 days', async () => {
  const { token } = await createSession(db, 'acc_1', t0);
  const s = await getCustomerSession(db, reqWith(token), at(29));
  assert.deepEqual({ kind: s.kind, accountId: s.accountId }, { kind: 'customer', accountId: 'acc_1' });
  assert.match(s.cookie, /Max-Age=2592000\b/);
  assert.ok(await getCustomerSession(db, reqWith(token), at(58)), 'still valid 29 days after the day 29 visit');
});

test('a visit on day 31 after the last visit finds no session', async () => {
  const { token } = await createSession(db, 'acc_1', t0);
  assert.equal(await getCustomerSession(db, reqWith(token), at(31)), null);
});

test('daily visits cannot go past 180 days from the start, and the last cookie is shortened to the cap', async () => {
  const { token } = await createSession(db, 'acc_1', t0);
  let last;
  for (let d = 1; d <= 179; d += 1) last = await getCustomerSession(db, reqWith(token), at(d));
  assert.ok(last, 'day 179 is still inside the cap');
  assert.match(last.cookie, /Max-Age=86400\b/, 'one day left, not 30');
  assert.equal(await getCustomerSession(db, reqWith(token), at(181)), null);
});

test('a visit that must not slide (the public feed) does not extend the session', async () => {
  const { token } = await createSession(db, 'acc_1', t0);
  const s = await getCustomerSession(db, reqWith(token), at(20), { slide: false });
  assert.ok(s);
  assert.equal(s.cookie, undefined);
  assert.equal(await getCustomerSession(db, reqWith(token), at(31)), null);
});

test('no cookie, a made-up value or an ended session finds nothing', async () => {
  assert.equal(await getCustomerSession(db, reqWith(null), t0), null);
  assert.equal(await getCustomerSession(db, reqWith('not-a-real-token'), t0), null);
  const { token } = await createSession(db, 'acc_1', t0);
  await endSession(db, token);
  assert.equal(await getCustomerSession(db, reqWith(token), t0), null);
});

test('ending a session also gives a cookie that clears it in the browser', async () => {
  const { token } = await createSession(db, 'acc_1', t0);
  const { cookie } = await endSession(db, token);
  assert.match(cookie, /Max-Age=0\b/);
});
