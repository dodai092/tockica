// Creating a staff member and resetting a staff password without SQL (ADR 0004). Fake Supabase admin client, PGlite.
// No mail is sent: the Supabase admin API makes the user already confirmed and sets the password directly.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { createStaff, resetStaffPassword, StaffAdminError } from '../server/staff-admin.js';
import { createSupabaseAdmin } from '../server/supabase-admin.js';

let db, admin, calls;
before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());

beforeEach(async () => {
  await db.exec('delete from staff_sessions; delete from staff;');
  calls = [];
  let n = 0;
  admin = {
    async createUser(email, password) { calls.push(['createUser', email, password]); return { userId: `sb_new${++n}` }; },
    async deleteUser(id) { calls.push(['deleteUser', id]); },
    async setPassword(id, password) { calls.push(['setPassword', id, password]); },
  };
});

const staffRows = async () => (await db.query('select id, supabase_user_id, name, email, role, active from staff')).rows;

test('create makes the Supabase user and an active staff row with that user id, and returns a strong password once', async () => {
  const r = await createStaff({ db, admin, email: ' Owner@Studio.TEST ', name: 'Dunia', role: 'owner' });
  assert.equal(r.userId, 'sb_new1');
  assert.ok(r.password.length >= 20);
  assert.deepEqual(calls[0], ['createUser', 'owner@studio.test', r.password]);
  const rows = await staffRows();
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], id: undefined }, { id: undefined, supabase_user_id: 'sb_new1', name: 'Dunia', email: 'owner@studio.test', role: 'owner', active: true });
  assert.equal(rows[0].id, r.staffId);
});

test('an unknown role, a bad email or an empty name is refused before any user is made', async () => {
  for (const bad of [{ role: 'boss' }, { email: 'not-an-email' }, { name: '  ' }]) {
    await assert.rejects(createStaff({ db, admin, email: 'a@studio.test', name: 'A', role: 'owner', ...bad }), StaffAdminError);
  }
  assert.equal(calls.length, 0);
  assert.equal((await staffRows()).length, 0);
});

test('a second staff row for the same email is refused and no user is made', async () => {
  await createStaff({ db, admin, email: 'a@studio.test', name: 'A', role: 'owner' });
  calls.length = 0;
  await assert.rejects(createStaff({ db, admin, email: 'A@studio.test', name: 'B', role: 'reception' }), (e) => e instanceof StaffAdminError && e.code === 'exists');
  assert.equal(calls.length, 0);
});

test('when the staff row cannot be inserted, the new Supabase user is deleted again', async () => {
  await db.query(`insert into staff (id, supabase_user_id, name, email, role, active) values ('st_x', 'sb_new1', 'X', 'x@studio.test', 'owner', true)`);
  await assert.rejects(createStaff({ db, admin, email: 'a@studio.test', name: 'A', role: 'owner' }));
  assert.deepEqual(calls.at(-1), ['deleteUser', 'sb_new1']);
  assert.equal((await staffRows()).length, 1);
});

test('when Supabase refuses to make the user, nothing is stored', async () => {
  admin.createUser = async () => { throw new StaffAdminError('supabase'); };
  await assert.rejects(createStaff({ db, admin, email: 'a@studio.test', name: 'A', role: 'owner' }), (e) => e.code === 'supabase');
  assert.equal((await staffRows()).length, 0);
});

test('reset sets a new password for that person and ends only their staff sessions', async () => {
  await db.exec(`insert into staff (id, supabase_user_id, name, email, role, active) values
    ('st_a', 'sb_a', 'A', 'a@studio.test', 'owner', true), ('st_b', 'sb_b', 'B', 'b@studio.test', 'reception', true)`);
  const t = '2027-01-11T08:00:00Z';
  await db.exec(`insert into staff_sessions (token_hash, staff_id, created_at, last_seen_at, expires_at) values
    ('h1', 'st_a', '${t}', '${t}', '2027-01-18T08:00:00Z'), ('h2', 'st_a', '${t}', '${t}', '2027-01-18T08:00:00Z'), ('h3', 'st_b', '${t}', '${t}', '2027-01-18T08:00:00Z')`);
  const r = await resetStaffPassword({ db, admin, email: 'A@studio.test' });
  assert.ok(r.password.length >= 20);
  assert.deepEqual(calls, [['setPassword', 'sb_a', r.password]]);
  const left = (await db.query('select token_hash from staff_sessions order by token_hash')).rows.map((x) => x.token_hash);
  assert.deepEqual(left, ['h3']);
});

test('reset for an unknown email, or a row with no Supabase user, is refused and changes nothing', async () => {
  await assert.rejects(resetStaffPassword({ db, admin, email: 'nobody@studio.test' }), (e) => e.code === 'not_found');
  await db.exec(`insert into staff (id, name, email, role, active) values ('st_n', 'N', 'n@studio.test', 'owner', true)`);
  await assert.rejects(resetStaffPassword({ db, admin, email: 'n@studio.test' }), (e) => e.code === 'no_user');
  assert.equal(calls.length, 0);
});

test('the Supabase admin client sends the service key, confirms the email, and maps failures to StaffAdminError', async () => {
  const seen = [];
  const reply = (status, body) => async (url, init) => { seen.push({ url, method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) }); return new Response(JSON.stringify(body), { status }); };
  let a = createSupabaseAdmin({ url: 'https://p.example.test/', serviceKey: 'SVC', fetchFn: reply(200, { id: 'u1' }) });
  assert.deepEqual(await a.createUser('a@studio.test', 'pw'), { userId: 'u1' });
  assert.equal(seen[0].url, 'https://p.example.test/auth/v1/admin/users');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].headers.authorization, 'Bearer SVC');
  assert.deepEqual(seen[0].body, { email: 'a@studio.test', password: 'pw', email_confirm: true });
  await a.setPassword('u1', 'pw2');
  assert.equal(seen[1].url, 'https://p.example.test/auth/v1/admin/users/u1');
  assert.equal(seen[1].method, 'PUT');
  assert.deepEqual(seen[1].body, { password: 'pw2' });
  await a.deleteUser('u1');
  assert.equal(seen[2].method, 'DELETE');
  a = createSupabaseAdmin({ url: 'https://p.example.test', serviceKey: 'SVC', fetchFn: reply(422, { msg: 'exists' }) });
  await assert.rejects(a.createUser('a@studio.test', 'pw'), StaffAdminError);
  await assert.rejects(a.setPassword('u1', 'pw'), StaffAdminError);
});

test('the server runtime never loads the service-key client', () => {
  const dir = new URL('../server/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js') && !['staff-admin.js', 'supabase-admin.js'].includes(n))) {
    assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /supabase-admin|staff-admin/, f);
  }
});
