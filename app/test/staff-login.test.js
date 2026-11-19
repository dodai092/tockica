// Staff login (ADR 0004): email and password, checked by Supabase, and the person must be an active row in the staff table.
// No second step for now (ADR 0004 update 2026-11-19). Customers and staff are separate accounts with separate cookies.
// Fake Supabase, real router, PGlite. Times are passed in, so the clock moves in the tests.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { createRoute } from '../server/index.js';
import { AuthError } from '../server/auth.js';

let db, auth, clock;
const now = () => clock;
const T0 = '2027-01-11T08:00:00Z';
const minutes = (n) => new Date(new Date(clock).getTime() + n * 60000);
const at = (h) => new Date(new Date(T0).getTime() + h * 3600e3); // h hours after login

const makeAuth = () => {
  const users = new Map([
    ['owner@studio.test', { id: 'sb_owner', password: 'owner-password' }],
    ['desk@studio.test', { id: 'sb_desk', password: 'desk-password' }],
    ['gone@studio.test', { id: 'sb_gone', password: 'gone-password' }],
    ['rider@example.test', { id: 'sb_rider', password: 'rider-password' }],
  ]);
  return {
    async signIn(email, password) {
      const u = users.get(email);
      if (!u || u.password !== password) throw new AuthError('invalid_credentials');
      return { userId: u.id, email };
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
    ('st_owner', 'sb_owner', 'Dunia Owner', 'owner@studio.test', 'owner', true),
    ('st_desk', 'sb_desk', 'Desk Person', 'desk@studio.test', 'reception', true),
    ('st_gone', 'sb_gone', 'Left Studio', 'gone@studio.test', 'reception', false)`);
});

const route = () => createRoute({ pool: () => db, auth, now });
const post = (path, body, cookie) =>
  route()(new Request(`https://app.example.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const get = (path, cookie) => route()(new Request(`https://app.example.test${path}`, { headers: cookie ? { cookie } : {} }));
const cookieOf = (res) => (res.headers.getSetCookie()[0] ?? '').split(';')[0];
const login = (email = 'owner@studio.test', password = 'owner-password') => post('/api/staff-login', { email, password });
const fullLogin = async (email, password) => {
  const res = await login(email, password);
  return { res, cookie: cookieOf(res) };
};

test('the right password for an active staff member starts the staff session', async () => {
  const { res, cookie } = await fullLogin();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.match(res.headers.getSetCookie().join('\n'), /tockica_staff=[^;]+;.*HttpOnly.*Secure/);
  const me = await get('/api/osoblje/ja', cookie);
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { name: 'Dunia Owner', email: 'owner@studio.test', role: 'owner' });
});

test('wrong password, unknown address, a customer-only login, a left member and an empty form all get the same answer and no cookie', async () => {
  const attempts = [
    ['owner@studio.test', 'wrong'],
    ['nobody@studio.test', 'x'],
    ['rider@example.test', 'rider-password'],
    ['gone@studio.test', 'gone-password'],
    ['', ''],
  ];
  const answers = [];
  for (const [email, password] of attempts) {
    const res = await login(email, password);
    assert.equal(res.status, 401, email);
    assert.deepEqual(res.headers.getSetCookie(), [], email);
    answers.push(await res.json());
  }
  assert.ok(answers.every((a) => JSON.stringify(a) === JSON.stringify(answers[0])), 'same body for every reason');
});

test('when Supabase is down the answer is 503, not a wrong password', async () => {
  auth.signIn = async () => { throw new AuthError('unavailable'); };
  assert.equal((await login()).status, 503);
});

test('only POST logs in', async () => {
  assert.equal((await get('/api/staff-login')).status, 405);
});

test('customer and staff cookies do not open each other\'s routes', async () => {
  const { cookie } = await fullLogin();
  assert.equal((await get('/api/me', cookie)).status, 401, 'a staff cookie is not a customer session');
  assert.equal((await get('/api/osoblje/ja', 'tockica_session=whatever')).status, 401, 'a customer cookie is not a staff session');
});

test('a staff session is 12 hours idle, slides on use, and ends 7 days after login at the latest', async () => {
  const { cookie } = await fullLogin();
  clock = at(11);
  assert.equal((await get('/api/osoblje/ja', cookie)).status, 200);
  clock = at(22);
  assert.equal((await get('/api/osoblje/ja', cookie)).status, 200, 'the visit 11 hours ago pushed it out');
  clock = at(22 + 13);
  assert.equal((await get('/api/osoblje/ja', cookie)).status, 401, 'idle for 13 hours');

  clock = new Date(T0);
  const second = await fullLogin();
  for (let h = 10; h <= 160; h += 10) {
    clock = at(h); // a visit every 10 hours keeps it from going idle
    assert.equal((await get('/api/osoblje/ja', second.cookie)).status, 200, `after ${h} hours`);
  }
  clock = at(7 * 24 + 1); // idle for 9 hours only, so it is the 7 day cap that ends it
  assert.equal((await get('/api/osoblje/ja', second.cookie)).status, 401, 'past the 7 day cap');
});

test('logout ends the session', async () => {
  const { cookie } = await fullLogin();
  assert.equal((await post('/api/osoblje/odjava', {}, cookie)).status, 200);
  assert.equal((await get('/api/osoblje/ja', cookie)).status, 401);
});

test('deactivating a member or changing the role applies on the next request', async () => {
  const { cookie } = await fullLogin('desk@studio.test', 'desk-password');
  assert.equal((await (await get('/api/osoblje/ja', cookie)).json()).role, 'reception');
  await db.exec("update staff set role = 'instructor' where id = 'st_desk'");
  assert.equal((await (await get('/api/osoblje/ja', cookie)).json()).role, 'instructor');
  await db.exec("update staff set active = false where id = 'st_desk'");
  assert.equal((await get('/api/osoblje/ja', cookie)).status, 401);
});

test('only a stored hash is kept, never the cookie value', async () => {
  const { cookie } = await fullLogin();
  const token = cookie.split('=')[1];
  const rows = (await db.query('select token_hash from staff_sessions')).rows;
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].token_hash.includes(token));
});
