// Limits on guessing passwords and on mail requests, per email address (plan item B8). Counted in the database, so every
// server instance sees the same numbers. Fake Supabase, real router, PGlite. The clock is passed in and moves in the tests.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { createRoute } from '../server/index.js';
import { AuthError } from '../server/auth.js';
import { isBlocked, recordAttempt, clearAttempts } from '../server/throttle.js';

let db, auth, clock;
const now = () => clock;
const T0 = '2027-01-11T08:00:00Z';
const later = (minutes) => new Date(new Date(clock).getTime() + minutes * 60000);

before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());

beforeEach(async () => {
  clock = new Date(T0);
  await db.exec('delete from auth_attempts; delete from staff_sessions; delete from sessions; delete from staff; delete from accounts;');
  await db.exec(`insert into accounts (id, name, email, supabase_user_id) values ('acc_ana', 'Ana H', 'ana@example.com', 'sb_ana');
    insert into staff (id, supabase_user_id, name, email, role, active) values ('st_owner', 'sb_owner', 'Owner', 'owner@studio.test', 'owner', true)`);
  const users = new Map([['ana@example.com', { id: 'sb_ana', password: 'ana-password' }], ['owner@studio.test', { id: 'sb_owner', password: 'owner-password' }], ['nobody@example.com', { id: 'sb_nobody', password: 'x-password' }]]);
  auth = {
    calls: { signIn: 0, sendLink: 0, sendReset: 0 },
    async signIn(email, password) {
      this.calls.signIn += 1;
      const u = users.get(email);
      if (!u || u.password !== password) throw new AuthError('invalid_credentials');
      return { userId: u.id, email };
    },
    async sendLink() { this.calls.sendLink += 1; },
    async sendResetLink() { this.calls.sendReset += 1; },
  };
});

const route = () => createRoute({ pool: () => db, auth, now });
const post = (path, body) => route()(new Request(`https://app.example.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const login = (email, password) => post('/api/login', { email, password });
const staffLogin = (email, password) => post('/api/staff-login', { email, password });
const fail = async (n, fn) => { for (let i = 0; i < n; i++) await fn(); };

test('an address is blocked at the limit, and free again once the oldest attempt leaves the window', async () => {
  await fail(4, () => recordAttempt(db, 'login', 'a@x.test', clock));
  assert.equal(await isBlocked(db, 'login', 'a@x.test', clock), false);
  await recordAttempt(db, 'login', 'a@x.test', clock);
  assert.equal(await isBlocked(db, 'login', 'a@x.test', clock), true);
  assert.equal(await isBlocked(db, 'login', 'a@x.test', later(14)), true);
  assert.equal(await isBlocked(db, 'login', 'a@x.test', later(16)), false);
});

test('kinds and addresses count separately, and case and spaces do not matter', async () => {
  await fail(5, () => recordAttempt(db, 'login', ' A@X.test ', clock));
  assert.equal(await isBlocked(db, 'login', 'a@x.test', clock), true);
  assert.equal(await isBlocked(db, 'staff-login', 'a@x.test', clock), false);
  assert.equal(await isBlocked(db, 'login', 'b@x.test', clock), false);
});

test('clearing resets the count', async () => {
  await fail(5, () => recordAttempt(db, 'login', 'a@x.test', clock));
  await clearAttempts(db, 'login', 'a@x.test');
  assert.equal(await isBlocked(db, 'login', 'a@x.test', clock), false);
});

test('the table keeps no plain email address, and rows older than a day are removed', async () => {
  await recordAttempt(db, 'login', 'secret.person@example.com', clock);
  const rows = (await db.query('select kind, key from auth_attempts')).rows;
  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0].key, /secret|@/);
  await recordAttempt(db, 'login', 'other@example.com', later(25 * 60));
  assert.equal((await db.query('select count(*)::int c from auth_attempts')).rows[0].c, 1);
});

test('customer login: five wrong passwords block the sixth try even with the right password, and Supabase is not asked', async () => {
  await fail(5, async () => assert.equal((await login('ana@example.com', 'wrong')).status, 401));
  const before = auth.calls.signIn;
  const res = await login('ana@example.com', 'ana-password');
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'Too many attempts, try again later' });
  assert.equal(auth.calls.signIn, before);
});

test('an address with no account gets the same block, so it shows nothing about who has an account', async () => {
  await fail(5, () => login('ghost@example.com', 'wrong'));
  const res = await login('ghost@example.com', 'wrong');
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'Too many attempts, try again later' });
});

test('after the window the right password works again', async () => {
  await fail(5, () => login('ana@example.com', 'wrong'));
  clock = later(16);
  assert.equal((await login('ana@example.com', 'ana-password')).status, 200);
});

test('a successful login clears the count', async () => {
  await fail(4, () => login('ana@example.com', 'wrong'));
  assert.equal((await login('ana@example.com', 'ana-password')).status, 200);
  await fail(4, () => login('ana@example.com', 'wrong'));
  assert.equal((await login('ana@example.com', 'ana-password')).status, 200);
});

test('a login with no account (403) is not a wrong password and does not count', async () => {
  await fail(7, async () => assert.equal((await login('nobody@example.com', 'x-password')).status, 403));
});

test('staff login: five wrong passwords block the Owner for that address only, and customer failures do not count against staff', async () => {
  await fail(5, () => login('owner@studio.test', 'wrong'));
  assert.equal((await staffLogin('owner@studio.test', 'owner-password')).status, 200);
  await fail(5, async () => assert.equal((await staffLogin('owner@studio.test', 'wrong')).status, 401));
  const res = await staffLogin('owner@studio.test', 'owner-password');
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'Too many attempts, try again later' });
  assert.equal((await login('ana@example.com', 'ana-password')).status, 200);
});

test('signup and reset mails: three per hour per address, the fourth gets the same answer and sends nothing', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await post('/api/signup/link', { email: 'new@example.com' })).status, 202);
  const fourth = await post('/api/signup/link', { email: 'new@example.com' });
  assert.equal(fourth.status, 202);
  assert.deepEqual(await fourth.json(), { ok: true });
  assert.equal(auth.calls.sendLink, 3);
  // Reset mails count apart from signup mails, and another address is not affected.
  assert.equal((await post('/api/password/link', { email: 'new@example.com' })).status, 202);
  assert.equal(auth.calls.sendReset, 1);
  assert.equal((await post('/api/signup/link', { email: 'other@example.com' })).status, 202);
  assert.equal(auth.calls.sendLink, 4);
  clock = later(61);
  await post('/api/signup/link', { email: 'new@example.com' });
  assert.equal(auth.calls.sendLink, 5);
});

test('a bad address is refused as before and does not use up the limit', async () => {
  await fail(5, async () => assert.equal((await post('/api/signup/link', { email: 'not-an-email' })).status, 400));
  assert.equal((await post('/api/signup/link', { email: 'ok@example.com' })).status, 202);
  assert.equal(auth.calls.sendLink, 1);
});

test('a Supabase outage is not a wrong password: it answers 503 and does not count', async () => {
  const real = auth.signIn;
  auth.signIn = async () => { throw new AuthError('unavailable'); };
  await fail(7, async () => assert.equal((await login('ana@example.com', 'ana-password')).status, 503));
  await fail(7, async () => assert.equal((await staffLogin('owner@studio.test', 'owner-password')).status, 503));
  auth.signIn = real;
  assert.equal((await login('ana@example.com', 'ana-password')).status, 200);
  assert.equal((await staffLogin('owner@studio.test', 'owner-password')).status, 200);
});
