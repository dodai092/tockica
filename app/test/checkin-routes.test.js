// Reception check-in routes (plan 2026-11-21-reception-check-in.md). Reception and owner list today's classes, open a
// roster and set a rider's status. A trainer sees the roster of their own classes, read only. Fake Supabase, real router,
// PGlite, fixed clock: 18:00 in Zagreb on 2027-01-11.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { createRoute } from '../server/index.js';
import { AuthError } from '../server/auth.js';

let db;
const NOW = new Date('2027-01-11T17:00:00Z');
const now = () => NOW;

const USERS = {
  'owner@studio.test': 'sb_owner',
  'desk@studio.test': 'sb_desk',
  'mirna@studio.test': 'sb_mirna',
  'ivana@studio.test': 'sb_ivana',
  'nolink@studio.test': 'sb_nolink',
};
const auth = {
  async signIn(email, password) {
    if (password !== 'pw' || !USERS[email]) throw new AuthError('invalid_credentials');
    return { userId: USERS[email], email };
  },
};

before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());

beforeEach(async () => {
  await db.exec('delete from auth_attempts; delete from staff_sessions; delete from staff_log; delete from outbox; delete from bookings; delete from classes; delete from staff; delete from accounts; delete from instructors');
  await db.exec(`
    insert into instructors (id, first_name, full_name, slug) values ('ins_1', 'Mirna', 'Mirna Zebec', 'mirna'), ('ins_2', 'Ivana', 'Ivana K', 'ivana');
    insert into staff (id, supabase_user_id, name, email, role, instructor_id) values
      ('st_owner', 'sb_owner', 'Dunia', 'owner@studio.test', 'owner', null),
      ('st_desk', 'sb_desk', 'Desk', 'desk@studio.test', 'reception', null),
      ('st_mirna', 'sb_mirna', 'Mirna', 'mirna@studio.test', 'instructor', 'ins_1'),
      ('st_ivana', 'sb_ivana', 'Ivana', 'ivana@studio.test', 'instructor', 'ins_2'),
      ('st_nolink', 'sb_nolink', 'No Link', 'nolink@studio.test', 'instructor', null);
    insert into accounts (id, name, email) values ('acc_1', 'Ana Anić', 'a@example.test'), ('acc_2', 'Bruno Bar', 'b@example.test'), ('acc_3', 'Cvita Cat', 'c@example.test');
    insert into classes (id, name, instructor_id, starts_at, duration_min, release_opens_at) values
      ('cls_early', 'Morning Ride', 'ins_1', '2027-01-11T10:00:00Z', 50, '2027-01-01T00:00:00Z'),
      ('cls_today', 'SOUL', 'ins_1', '2027-01-11T17:30:00Z', 50, '2027-01-01T00:00:00Z'),
      ('cls_tomorrow', 'Riders', 'ins_2', '2027-01-12T17:30:00Z', 50, '2027-01-01T00:00:00Z');
    insert into bookings (id, class_id, bike_no, account_id, guest_name, status) values
      ('bk_a', 'cls_today', 5, 'acc_1', null, 'booked'),
      ('bk_b', 'cls_today', 2, 'acc_2', null, 'booked'),
      ('bk_c', 'cls_today', 9, 'acc_3', 'Gost Ana', 'booked'),
      ('bk_x', 'cls_today', 11, 'acc_1', null, 'cancelled'),
      ('bk_e', 'cls_early', 1, 'acc_1', null, 'booked'),
      ('bk_t', 'cls_tomorrow', 1, 'acc_2', null, 'booked');
  `);
});

const app = () => createRoute({ pool: () => db, auth, now });
const call = (path, { method = 'GET', body, cookie } = {}) =>
  app()(new Request(`https://app.example.test${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
const as = async (email) => {
  const res = await call('/api/staff-login', { method: 'POST', body: { email, password: 'pw' } });
  return (res.headers.getSetCookie()[0] ?? '').split(';')[0];
};
const setStatus = (cookie, bookingId, status) => call('/api/osoblje/prijava/status', { method: 'POST', body: { bookingId, status }, cookie });
const statusOf = async (id) => (await db.query('select status, checked_in_at from bookings where id = $1', [id])).rows[0];

test('signed out gets 401 on every check-in route', async () => {
  for (const path of ['/api/osoblje/prijava/treninzi', '/api/osoblje/prijava/trening?id=cls_today', '/api/osoblje/moji-treninzi/trening?id=cls_today']) {
    assert.equal((await call(path)).status, 401, path);
  }
  assert.equal((await setStatus(null, 'bk_a', 'attended')).status, 401);
});

test('reception sees only today\'s classes, with counts, and the ended one is swept first', async () => {
  const res = await call('/api/osoblje/prijava/treninzi', { cookie: await as('desk@studio.test') });
  assert.equal(res.status, 200);
  const { classes } = await res.json();
  assert.deepEqual(classes.map((c) => c.id), ['cls_early', 'cls_today']);
  const today = classes.find((c) => c.id === 'cls_today');
  assert.deepEqual({ name: today.name, instructor: today.instructor, riders: today.riders, checkedIn: today.checkedIn }, { name: 'SOUL', instructor: 'Mirna', riders: 3, checkedIn: 0 });
  assert.equal((await statusOf('bk_e')).status, 'no_show', 'the class that ended is swept when reception opens the list');
});

test('the roster lists riders by bike, uses the guest name, and leaves cancelled bookings out', async () => {
  const res = await call('/api/osoblje/prijava/trening?id=cls_today', { cookie: await as('desk@studio.test') });
  assert.equal(res.status, 200);
  const { riders } = await res.json();
  assert.deepEqual(riders.map((r) => [r.bikeNo, r.name, r.status, r.bookingId]), [
    [2, 'Bruno Bar', 'booked', 'bk_b'],
    [5, 'Ana Anić', 'booked', 'bk_a'],
    [9, 'Gost Ana', 'booked', 'bk_c'],
  ]);
  assert.equal((await call('/api/osoblje/prijava/trening?id=cls_nope', { cookie: await as('desk@studio.test') })).status, 404);
});

test('reception checks a rider in and takes it back, and each change is logged with who made it', async () => {
  const cookie = await as('desk@studio.test');
  const res = await setStatus(cookie, 'bk_a', 'attended');
  assert.equal(res.status, 200);
  assert.equal((await statusOf('bk_a')).status, 'attended');
  assert.ok((await statusOf('bk_a')).checked_in_at);

  assert.equal((await setStatus(cookie, 'bk_a', 'booked')).status, 200);
  assert.equal((await statusOf('bk_a')).checked_in_at, null);

  const log = (await db.query(`select type, booking_id, class_id, account_id, detail, staff_id from staff_log order by id`)).rows;
  assert.deepEqual(log.map((l) => [l.type, l.booking_id, l.class_id, l.account_id, l.detail, l.staff_id]), [
    ['check_in', 'bk_a', 'cls_today', 'acc_1', 'booked to attended', 'st_desk'],
    ['check_in', 'bk_a', 'cls_today', 'acc_1', 'attended to booked', 'st_desk'],
  ]);
});

test('reception cannot change tomorrow\'s class or a cancelled booking, the owner can change tomorrow\'s', async () => {
  const desk = await as('desk@studio.test');
  assert.equal((await setStatus(desk, 'bk_t', 'attended')).status, 409);
  assert.equal((await setStatus(desk, 'bk_x', 'attended')).status, 409);
  assert.equal((await statusOf('bk_t')).status, 'booked');
  assert.equal((await statusOf('bk_x')).status, 'cancelled');
  assert.equal((await setStatus(await as('owner@studio.test'), 'bk_t', 'attended')).status, 200);
});

test('a bad request is refused: unknown booking 404, unknown status 400, wrong method 405', async () => {
  const desk = await as('desk@studio.test');
  assert.equal((await setStatus(desk, 'bk_nope', 'attended')).status, 404);
  assert.equal((await setStatus(desk, 'bk_a', 'cancelled')).status, 400);
  assert.equal((await setStatus(desk, 'bk_a', undefined)).status, 400);
  assert.equal((await call('/api/osoblje/prijava/status', { cookie: desk })).status, 405);
  assert.equal((await statusOf('bk_a')).status, 'booked');
});

test('a trainer cannot open the reception routes or change a status, and nothing changes', async () => {
  const mirna = await as('mirna@studio.test');
  assert.equal((await call('/api/osoblje/prijava/treninzi', { cookie: mirna })).status, 403);
  assert.equal((await call('/api/osoblje/prijava/trening?id=cls_today', { cookie: mirna })).status, 403);
  assert.equal((await setStatus(mirna, 'bk_a', 'attended')).status, 403);
  assert.equal((await statusOf('bk_a')).status, 'booked');
  assert.equal((await db.query('select count(*)::int as n from staff_log')).rows[0].n, 0);
});

test('a trainer sees the roster of their own class, read only, and not another trainer\'s', async () => {
  const mirna = await as('mirna@studio.test');
  const own = await call('/api/osoblje/moji-treninzi/trening?id=cls_today', { cookie: mirna });
  assert.equal(own.status, 200);
  const { riders } = await own.json();
  assert.deepEqual(riders.map((r) => [r.bikeNo, r.name, r.status]), [[2, 'Bruno Bar', 'booked'], [5, 'Ana Anić', 'booked'], [9, 'Gost Ana', 'booked']]);
  assert.equal((await call('/api/osoblje/moji-treninzi/trening?id=cls_tomorrow', { cookie: mirna })).status, 403);
  assert.equal((await call('/api/osoblje/moji-treninzi/trening?id=cls_today', { cookie: await as('nolink@studio.test') })).status, 403, 'an instructor login with no instructor link sees nothing');
});

test('a trainer who is the actual instructor of a swapped class sees it, the planned one no longer does', async () => {
  await db.exec(`update classes set actual_instructor_id = 'ins_2' where id = 'cls_today'`);
  assert.equal((await call('/api/osoblje/moji-treninzi/trening?id=cls_today', { cookie: await as('ivana@studio.test') })).status, 200);
  assert.equal((await call('/api/osoblje/moji-treninzi/trening?id=cls_today', { cookie: await as('mirna@studio.test') })).status, 403);
});

test('the owner can open any class on the trainer roster route', async () => {
  assert.equal((await call('/api/osoblje/moji-treninzi/trening?id=cls_tomorrow', { cookie: await as('owner@studio.test') })).status, 200);
});
