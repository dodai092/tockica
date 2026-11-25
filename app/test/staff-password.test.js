// Staff set their own password through a mailed link (plan 2026-11-25-staff-access, Task 1). A staff row without a
// Supabase user id is a person waiting for a password. Fake Supabase, real router, PGlite.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { createRoute } from '../server/index.js';
import { AuthError } from '../server/auth.js';
import { createStaffSession } from '../server/staff-session.js';
import { createSession } from '../server/session.js';

let db, auth, clock;
const now = () => clock;
const T0 = '2027-01-11T08:00:00Z';
const NEW = 'new@studio.test';

const makeAuth = () => {
  const ids = { 'new@studio.test': 'sb_new', 'owner@studio.test': 'sb_owner', 'desk@studio.test': 'sb_desk', 'gone@studio.test': 'sb_gone', 'rider@example.test': 'sb_rider', 'moved@studio.test': 'sb_other' };
  const sent = [];
  const set = [];
  const passwords = new Map();
  return {
    sent, set,
    async sendStaffLink(email, redirectTo) { sent.push({ email, redirectTo }); },
    async userFromToken(t) {
      const email = t.replace(/^tok:/, '');
      if (!t.startsWith('tok:') || !ids[email]) throw new AuthError('invalid_token');
      return { userId: ids[email], email };
    },
    async setPassword(t, password) {
      set.push(t);
      passwords.set(t.slice(4), password);
    },
    async signIn(email, password) {
      if (passwords.get(email) !== password) throw new AuthError('invalid_credentials');
      return { userId: ids[email], email };
    },
  };
};

before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());
beforeEach(async () => {
  clock = new Date(T0);
  auth = makeAuth();
  await db.exec('delete from auth_attempts; delete from staff_sessions; delete from staff;');
  await db.exec(`insert into staff (id, supabase_user_id, name, email, role, active) values
    ('st_new', null, 'New Person', 'new@studio.test', 'reception', true),
    ('st_owner', 'sb_owner', 'Dunia Owner', 'owner@studio.test', 'owner', true),
    ('st_desk', 'sb_desk', 'Desk Person', 'desk@studio.test', 'reception', true),
    ('st_gone', null, 'Left Studio', 'gone@studio.test', 'reception', false),
    ('st_moved', 'sb_first', 'Moved Person', 'moved@studio.test', 'reception', true)`);
});

const route = () => createRoute({ pool: () => db, auth, now });
const post = (path, body, cookie) =>
  route()(new Request(`https://app.example.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const get = (path, cookie) => route()(new Request(`https://app.example.test${path}`, { headers: cookie ? { cookie } : {} }));
const ask = (email) => post('/api/staff-password/link', { email });
const setPw = (email, password = 'a-long-password') => post('/api/staff-password', { accessToken: `tok:${email}`, password });
const cookieOf = (res) => (res.headers.getSetCookie()[0] ?? '').split(';')[0];
const rows = async () => (await db.query('select id, supabase_user_id from staff order by id')).rows;
const sessionsOf = async (id) => (await db.query('select count(*)::int n from staff_sessions where staff_id = $1', [id])).rows[0].n;

test('active staff and an unknown address get the same 202, and only staff cause a mail that lands on /osoblje', async () => {
  const a = await ask('  New@Studio.test ');
  const b = await ask('rider@example.test');
  assert.equal(a.status, 202);
  assert.equal(b.status, 202);
  assert.deepEqual(await a.json(), await b.json());
  assert.deepEqual(auth.sent, [{ email: NEW, redirectTo: 'https://app.example.test/osoblje' }]);
});

test('a switched-off person gets 202 and no mail', async () => {
  assert.equal((await ask('gone@studio.test')).status, 202);
  assert.equal(auth.sent.length, 0);
});

test('the fourth request in an hour sends nothing, and an hour later it sends again', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await ask(NEW)).status, 202);
  assert.equal(auth.sent.length, 3);
  clock = new Date(clock.getTime() + 61 * 60000);
  await ask(NEW);
  assert.equal(auth.sent.length, 4);
});

test('a bad address is 400, GET is 405, and a Supabase outage on the link looks like any other answer', async () => {
  assert.equal((await ask('not an email')).status, 400);
  assert.equal((await get('/api/staff-password/link')).status, 405);
  assert.equal((await get('/api/staff-password')).status, 405);
  auth.sendStaffLink = async () => { throw new AuthError('unavailable'); };
  assert.equal((await ask(NEW)).status, 202);
});

test('the first password connects the Supabase user and signs the person in', async () => {
  const res = await setPw(NEW);
  assert.equal(res.status, 200);
  assert.match(res.headers.getSetCookie().join('\n'), /tockica_staff=[^;]+;.*HttpOnly.*Secure/);
  assert.equal(auth.set.length, 1);
  assert.equal((await rows()).find((r) => r.id === 'st_new').supabase_user_id, 'sb_new');
  assert.equal((await get('/api/osoblje/ja', cookieOf(res))).status, 200);
  assert.equal((await post('/api/staff-login', { email: NEW, password: 'a-long-password' })).status, 200);
});

test('a forgotten password ends the older staff sessions of that person only', async () => {
  const old = (await createStaffSession(db, 'st_desk', clock)).cookie.split(';')[0];
  await createStaffSession(db, 'st_owner', clock);
  const res = await setPw('desk@studio.test');
  assert.equal(res.status, 200);
  assert.equal((await get('/api/osoblje/ja', old)).status, 401);
  assert.equal((await get('/api/osoblje/ja', cookieOf(res))).status, 200);
  assert.equal(await sessionsOf('st_owner'), 1);
});

test('not staff, switched off, or a row connected to another login: 403, no password changed, nothing written', async () => {
  const before = await rows();
  for (const email of ['rider@example.test', 'gone@studio.test', 'moved@studio.test']) {
    const res = await setPw(email);
    assert.equal(res.status, 403, email);
    assert.deepEqual(res.headers.getSetCookie(), [], email);
  }
  assert.equal(auth.set.length, 0);
  assert.deepEqual(await rows(), before);
});

test('a bad or expired token is 401, 7 characters is 400, Supabase down is 503, a weak password is 400', async () => {
  assert.equal((await post('/api/staff-password', { accessToken: 'expired', password: 'a-long-password' })).status, 401);
  assert.equal((await post('/api/staff-password', { password: 'a-long-password' })).status, 401);
  assert.equal((await setPw(NEW, 'seven77')).status, 400);
  assert.equal(auth.set.length, 0);
  auth.setPassword = async () => { throw new AuthError('weak_password'); };
  assert.equal((await setPw(NEW)).status, 400);
  auth.setPassword = async () => { throw new AuthError('unavailable'); };
  assert.equal((await setPw(NEW)).status, 503);
  auth.userFromToken = async () => { throw new AuthError('unavailable'); };
  assert.equal((await setPw(NEW)).status, 503);
  assert.equal((await rows()).find((r) => r.id === 'st_new').supabase_user_id, null);
});

// One email, one password. A new password set here must also put out whoever holds the old one on the rider side.
test('a staff member who also rides loses older rider sessions with the new password, and other riders do not', async () => {
  await db.exec('delete from sessions; delete from accounts');
  await db.exec(`insert into accounts (id, name, first_name, last_name, email, supabase_user_id) values
    ('acc_desk', 'Desk Person', 'Desk', 'Person', 'desk@studio.test', 'sb_desk'),
    ('acc_rider', 'Rider One', 'Rider', 'One', 'rider@example.test', 'sb_rider')`);
  const mine = (await createSession(db, 'acc_desk', clock)).cookie.split(';')[0];
  const other = (await createSession(db, 'acc_rider', clock)).cookie.split(';')[0];
  assert.equal((await get('/api/me', mine)).status, 200);
  assert.equal((await setPw('desk@studio.test', 'seven77')).status, 400);
  assert.equal((await get('/api/me', mine)).status, 200, 'a refused password ends nothing');
  assert.equal((await setPw('desk@studio.test')).status, 200);
  assert.equal((await get('/api/me', mine)).status, 401);
  assert.equal((await get('/api/me', other)).status, 200);
});

// The address in the mail must not follow whatever host a request arrived on (previews, the *.netlify.app name).
test('the mailed link goes to the site address when one is set, whatever host the request used', async () => {
  const app = createRoute({ pool: () => db, auth, now, siteUrl: 'https://www.studio.test/' });
  await app(new Request('https://deploy-preview-7.example.test/api/staff-password/link', { method: 'POST', body: JSON.stringify({ email: NEW }) }));
  assert.deepEqual(auth.sent.map((s) => s.redirectTo), ['https://www.studio.test/osoblje']);
});
