// Signup, login, logout and /api/me through the real router, with a fake Supabase (ADR 0007, plan Task 4).
// Signup proves the email first: a link is mailed, and only the person who clicks it holds the token that lets them choose
// the password and get the account. Nothing is saved before that, so someone who asks for a link for another person's
// address gets nothing.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { createRoute } from '../server/index.js';
import { AuthError } from '../server/auth.js';
import { createStaffSession } from '../server/staff-session.js';

let db, auth, clock;
const now = () => clock;
const EMAIL = 'ana@example.com';
const form = { password: 'a-long-password', firstName: 'Ana', lastName: 'Horvat', birthDate: '1990-05-17', acceptedTerms: true };

const makeAuth = () => {
  const users = new Map(); // email -> { id, password }
  const calls = { sendLink: 0, sendReset: 0, setPassword: 0 };
  const byToken = (t) => [...users.entries()].find(([, u]) => u.token === t);
  return {
    users, calls,
    // What the person gets by clicking the mailed link. Only the owner of the mailbox can do this.
    clickLink: (email) => users.get(email).token,
    async sendLink(email) {
      calls.sendLink += 1;
      if (!users.has(email)) users.set(email, { id: `sb_${users.size + 1}`, password: null, token: `tok_${Math.random().toString(36).slice(2)}` });
    },
    async sendResetLink() {
      calls.sendReset += 1;
    },
    async userFromToken(t) {
      const found = byToken(t);
      if (!found) throw new AuthError('invalid_token');
      return { userId: found[1].id, email: found[0] };
    },
    async setPassword(t, password) {
      calls.setPassword += 1;
      byToken(t)[1].password = password;
    },
    async signIn(email, password) {
      const u = users.get(email);
      if (!u || !u.password || u.password !== password) throw new AuthError('invalid_credentials');
      return { userId: u.id, email };
    },
  };
};
const post = (route, path, body, cookie) =>
  route(new Request(`https://app.example.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const get = (route, path, cookie) => route(new Request(`https://app.example.test${path}`, { headers: cookie ? { cookie } : {} }));
const cookieOf = (res) => res.headers.get('set-cookie')?.split(';')[0];
const count = async (t) => (await db.query(`select count(*)::int n from ${t}`)).rows[0].n;

before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());
beforeEach(async () => {
  await db.exec('delete from auth_attempts; delete from sessions; delete from accounts');
  auth = makeAuth();
  clock = new Date('2026-12-30T10:00:00Z');
});
const app = () => createRoute({ pool: () => db, auth, now });
const link = async (route, email) => {
  await post(route, '/api/signup/link', { email });
  return auth.clickLink(email);
};
const signedUp = async (route) => cookieOf(await post(route, '/api/signup', { ...form, accessToken: await link(route, EMAIL) }));

test('asking for a link sends it, answers the same for any address and saves nothing', async () => {
  const route = app();
  const a = await post(route, '/api/signup/link', { email: 'new@example.com' });
  const b = await post(route, '/api/signup/link', { email: 'New@Example.com' });
  assert.equal(a.status, 202);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(auth.calls.sendLink, 2);
  assert.equal((await post(route, '/api/signup/link', { email: 'not an email' })).status, 400);
  assert.equal(auth.calls.sendLink, 2, 'a bad address sends nothing');
  assert.equal(await count('accounts'), 0);
});

test('the token from the link creates the account from the form, sets the password and starts a session', async () => {
  const route = app();
  const res = await post(route, '/api/signup', { ...form, accessToken: await link(route, EMAIL) });
  assert.equal(res.status, 201);
  assert.match(res.headers.get('set-cookie'), /tockica_session=.+HttpOnly/);
  const a = (await db.query('select * from accounts')).rows[0];
  assert.deepEqual([a.first_name, a.last_name, a.email, a.supabase_user_id], ['Ana', 'Horvat', EMAIL, 'sb_1']);
  assert.equal(new Date(a.terms_accepted_at).toISOString(), '2026-12-30T10:00:00.000Z');
  assert.ok(a.waitlist_joined_at, 'signed up before the end of 31 December');
  assert.equal(auth.users.get(EMAIL).password, form.password);
});

test('the email comes from the token, not from the form', async () => {
  const route = app();
  const res = await post(route, '/api/signup', { ...form, email: 'someone.else@example.com', accessToken: await link(route, EMAIL) });
  assert.equal(res.status, 201);
  assert.equal((await db.query('select email from accounts')).rows[0].email, EMAIL);
});

test('signing up after 31 December does not join the waitlist', async () => {
  clock = new Date('2027-01-05T10:00:00Z');
  const route = app();
  await post(route, '/api/signup', { ...form, accessToken: await link(route, EMAIL) });
  assert.equal((await db.query('select waitlist_joined_at from accounts')).rows[0].waitlist_joined_at, null);
});

test('a made-up or missing token creates nothing and sets no password', async () => {
  const route = app();
  await link(route, EMAIL);
  for (const accessToken of ['tok_wrong', '', undefined]) {
    const res = await post(route, '/api/signup', { ...form, accessToken });
    assert.equal(res.status, 401);
  }
  assert.equal(await count('accounts'), 0);
  assert.equal(auth.calls.setPassword, 0);
});

test('someone who asked for a link for another address cannot finish, and the owner can', async () => {
  const route = app();
  await post(route, '/api/signup/link', { email: 'victim@example.com' }); // the attacker asks, the mail goes to the victim
  const guess = await post(route, '/api/signup', { ...form, accessToken: 'tok_sb_1', password: 'attacker-password', firstName: 'Evil' });
  assert.equal(guess.status, 401, 'without the mailed link there is no token');
  const own = await post(route, '/api/signup', { ...form, accessToken: auth.clickLink('victim@example.com'), password: 'owner-password-1', firstName: 'Vera' });
  assert.equal(own.status, 201);
  assert.equal(auth.users.get('victim@example.com').password, 'owner-password-1');
  assert.equal((await db.query('select first_name from accounts')).rows[0].first_name, 'Vera');
});

test('a bad form is refused with the field names and nothing is changed', async () => {
  const route = app();
  const accessToken = await link(route, EMAIL);
  const res = await post(route, '/api/signup', { ...form, accessToken, firstName: '', password: 'short', acceptedTerms: false });
  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys((await res.json()).fields).sort(), ['acceptedTerms', 'firstName', 'password']);
  assert.equal(auth.calls.setPassword, 0);
  assert.equal((await post(route, '/api/signup', { ...form, accessToken })).status, 201);
});

test('an email that already has an account is refused and its password is not touched', async () => {
  const route = app();
  await signedUp(route);
  const again = await link(route, EMAIL); // anyone can ask for another link, and Supabase signs the owner in with it
  const res = await post(route, '/api/signup', { ...form, accessToken: again, password: 'someone-elses-pw-1' });
  assert.equal(res.status, 409);
  assert.equal(auth.users.get(EMAIL).password, form.password);
  assert.equal(await count('accounts'), 1);
});

test('an account holding that email under another login is a conflict and no password is set', async () => {
  await db.exec(`insert into accounts (id, name, email, supabase_user_id) values ('acc_old', 'Ana Old', 'ana@example.com', 'sb_other')`);
  const route = app();
  const res = await post(route, '/api/signup', { ...form, accessToken: await link(route, EMAIL) });
  assert.equal(res.status, 409);
  assert.equal(auth.calls.setPassword, 0);
});

test('login works with the chosen password, and starts another session', async () => {
  const route = app();
  await signedUp(route);
  const res = await post(route, '/api/login', { email: 'ANA@example.com', password: form.password });
  assert.equal(res.status, 200);
  assert.equal(await count('accounts'), 1);
  assert.equal(await count('sessions'), 2);
});

test('a wrong password, an unknown email and an address that only asked for a link get the same refusal', async () => {
  const route = app();
  await signedUp(route);
  await post(route, '/api/signup/link', { email: 'asked@example.com' });
  const refusals = await Promise.all([
    post(route, '/api/login', { email: 'ana@example.com', password: 'wrong-password' }),
    post(route, '/api/login', { email: 'nobody@example.com', password: 'whatever-it-is' }),
    post(route, '/api/login', { email: 'asked@example.com', password: 'whatever-it-is' }),
  ]);
  for (const r of refusals) assert.equal(r.status, 401);
  const bodies = await Promise.all(refusals.map((r) => r.json()));
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(bodies[0], bodies[2]);
});

test('a login with a password but no account is refused', async () => {
  auth.users.set('ghost@example.com', { id: 'sb_9', password: 'a-long-password' });
  const res = await post(app(), '/api/login', { email: 'ghost@example.com', password: 'a-long-password' });
  assert.equal(res.status, 403);
  assert.equal(await count('accounts'), 0);
});

test('/api/me needs the cookie, answers the signed-in account and slides the cookie', async () => {
  const route = app();
  const cookie = await signedUp(route);
  assert.equal((await get(route, '/api/me')).status, 401);
  clock = new Date('2027-01-20T10:00:00Z');
  const res = await get(route, '/api/me', cookie);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { firstName: 'Ana', lastName: 'Horvat', email: 'ana@example.com' });
  assert.match(res.headers.get('set-cookie'), /Max-Age=2592000/);
});

test('the public schedule feed does not slide the session', async () => {
  const route = app();
  const cookie = await signedUp(route);
  const res = await get(route, '/api/schedule.json', cookie);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('logout ends the session and clears the cookie', async () => {
  const route = app();
  const cookie = await signedUp(route);
  const out = await post(route, '/api/logout', {}, cookie);
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await get(route, '/api/me', cookie)).status, 401);
});

const loginCookie = async (route, password) => cookieOf(await post(route, '/api/login', { email: EMAIL, password }));

test('asking for a reset link answers the same for any address and creates nothing', async () => {
  const route = app();
  await signedUp(route);
  const a = await post(route, '/api/password/link', { email: EMAIL });
  const b = await post(route, '/api/password/link', { email: 'nobody@example.com' });
  assert.equal(a.status, 202);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(auth.calls.sendReset, 2);
  assert.equal(auth.users.size, 1, 'a reset request never makes a user');
  assert.equal((await post(route, '/api/password/link', { email: 'not an email' })).status, 400);
  assert.equal(auth.calls.sendReset, 2);
});

test('the token from the reset link sets a new password, and the old one stops working', async () => {
  const route = app();
  await signedUp(route);
  await post(route, '/api/password/link', { email: EMAIL });
  const res = await post(route, '/api/password/reset', { accessToken: auth.clickLink(EMAIL), password: 'a-new-long-password' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /tockica_session=.+HttpOnly/);
  assert.equal(await loginCookie(route, form.password), undefined);
  assert.ok(await loginCookie(route, 'a-new-long-password'));
});

test('a reset ends every other session of that account and signs the person in again', async () => {
  const route = app();
  const first = await signedUp(route);
  const second = await loginCookie(route, form.password);
  const res = await post(route, '/api/password/reset', { accessToken: auth.clickLink(EMAIL), password: 'a-new-long-password' });
  const fresh = cookieOf(res);
  assert.equal((await get(route, '/api/me', first)).status, 401);
  assert.equal((await get(route, '/api/me', second)).status, 401);
  assert.equal((await get(route, '/api/me', fresh)).status, 200);
});

test('a made-up or missing token changes nothing', async () => {
  const route = app();
  const cookie = await signedUp(route);
  for (const accessToken of ['tok_wrong', '', undefined]) {
    assert.equal((await post(route, '/api/password/reset', { accessToken, password: 'a-new-long-password' })).status, 401);
  }
  assert.equal(auth.users.get(EMAIL).password, form.password);
  assert.equal((await get(route, '/api/me', cookie)).status, 200, 'the session survives');
});

test('a reset for a login that has no account is refused and sets no password', async () => {
  const route = app();
  const token = await link(route, 'ghost@example.com'); // asked for a signup link, never finished
  const res = await post(route, '/api/password/reset', { accessToken: token, password: 'a-new-long-password' });
  assert.equal(res.status, 403);
  assert.equal(auth.calls.setPassword, 0);
  assert.equal(await count('accounts'), 0);
});

test('a short password is refused and nothing changes', async () => {
  const route = app();
  const cookie = await signedUp(route);
  const res = await post(route, '/api/password/reset', { accessToken: auth.clickLink(EMAIL), password: 'short' });
  assert.equal(res.status, 400);
  assert.deepEqual((await res.json()).fields, { password: 'too short' });
  assert.equal(auth.users.get(EMAIL).password, form.password);
  assert.equal((await get(route, '/api/me', cookie)).status, 200);
});

// One email, one Supabase user, one password (plan 2026-11-25-staff-access, Task 3). So a password change through the
// customer pages also ends that person's staff sessions.
const staffCookies = async (userId) => {
  await db.exec('delete from staff_sessions; delete from staff');
  await db.query(
    `insert into staff (id, supabase_user_id, name, email, role, active) values
       ('st_ana', $1, 'Ana Horvat', 'ana@example.com', 'reception', true),
       ('st_other', 'sb_other', 'Other Person', 'other@studio.test', 'reception', true)`,
    [userId]
  );
  const cookies = {};
  for (const id of ['st_ana', 'st_other']) cookies[id] = (await createStaffSession(db, id, clock)).cookie.split(';')[0];
  return cookies;
};

test('a signup by a staff email ends that staff session and nobody else\'s', async () => {
  const route = app();
  const accessToken = await link(route, EMAIL);
  const staff = await staffCookies('sb_1');
  assert.equal((await get(route, '/api/osoblje/ja', staff.st_ana)).status, 200);
  assert.equal((await post(route, '/api/signup', { ...form, accessToken })).status, 201);
  assert.equal((await get(route, '/api/osoblje/ja', staff.st_ana)).status, 401);
  assert.equal((await get(route, '/api/osoblje/ja', staff.st_other)).status, 200);
});

test('a password reset by a staff email ends that staff session and nobody else\'s', async () => {
  const route = app();
  await signedUp(route);
  const staff = await staffCookies('sb_1');
  const res = await post(route, '/api/password/reset', { accessToken: auth.clickLink(EMAIL), password: 'a-new-long-password' });
  assert.equal(res.status, 200);
  assert.equal((await get(route, '/api/osoblje/ja', staff.st_ana)).status, 401);
  assert.equal((await get(route, '/api/osoblje/ja', staff.st_other)).status, 200);
});

test('a refused reset leaves the staff session alone', async () => {
  const route = app();
  await signedUp(route);
  const staff = await staffCookies('sb_1');
  await post(route, '/api/password/reset', { accessToken: auth.clickLink(EMAIL), password: 'short' });
  assert.equal((await get(route, '/api/osoblje/ja', staff.st_ana)).status, 200);
});
