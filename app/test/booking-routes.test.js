// A rider's booking, cancel and waitlist (plan 2026-11-25-booking-routes). Real router, PGlite, a clock the tests move.
// The rules live in prototype/src/booking.js. These tests check the routes and the rows they read and write.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { runInTransaction } from '../server/db/unit-of-work.js';
import { createRoute } from '../server/index.js';
import { createSession } from '../server/session.js';
import { createStaffSession } from '../server/staff-session.js';
import { cancelBooking } from '../../prototype/src/booking.js';

let db, clock;
const now = () => clock;
const T0 = '2027-01-10T10:00:00Z';

before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());

beforeEach(async () => {
  clock = new Date(T0);
  await db.exec(`
    delete from outbox; delete from sessions; delete from staff_sessions; delete from staff; delete from waitlist;
    update bookings set credit_lot_id = null; delete from bookings; delete from spent_log; delete from lots;
    delete from classes; delete from instructors; delete from accounts;
    update settings set credits_enabled = false, booking_opens_on = '2027-01-04';
    insert into instructors (id, first_name, full_name, slug) values ('ins_1', 'Mirna', 'Mirna Zebec', 'mirna');
    insert into accounts (id, name, email) values ('acc_1', 'Ana Anic', 'ana@example.test'), ('acc_2', 'Bruno Bar', 'bruno@example.test'), ('acc_3', 'Cvita Cat', 'cvita@example.test');
    insert into classes (id, name, instructor_id, starts_at, release_opens_at, bike_count) values
      ('cls_1', 'Riders', 'ins_1', '2027-01-12T17:30:00Z', '2027-01-01T00:00:00Z', 20);
  `);
});

const mails = async () => (await db.query('select to_email, subject from outbox order by id')).rows;
const bookingRow = async (id) => (await db.query('select * from bookings where id = $1', [id])).rows[0];

test('cancelling while someone else is waiting mails the rider and the waiting address', async () => {
  await db.exec(`insert into bookings (id, class_id, bike_no, account_id) values ('bk_1', 'cls_1', 1, 'acc_1');
    insert into waitlist (id, class_id, account_id) values ('wl_2', 'cls_1', 'acc_2')`);
  await runInTransaction(db, { classId: 'cls_1', accountId: 'acc_1' }, (store) => cancelBooking(store, 'bk_1', new Date(T0)));
  assert.equal((await bookingRow('bk_1')).status, 'cancelled');
  const sent = await mails();
  assert.deepEqual(sent.map((m) => m.to_email), ['ana@example.test', 'bruno@example.test']);
  assert.match(sent[0].subject, /^Otkazano/);
  assert.match(sent[1].subject, /^Oslobodilo se mjesto/);
});

test('the rider who asks stays the first account, and a waiting rider is not loaded twice', async () => {
  await db.exec(`insert into waitlist (id, class_id, account_id) values ('wl_1', 'cls_1', 'acc_1'), ('wl_2', 'cls_1', 'acc_2')`);
  const ids = await runInTransaction(db, { classId: 'cls_1', accountId: 'acc_1' }, (store) => store.accounts.map((a) => a.id));
  assert.deepEqual(ids, ['acc_1', 'acc_2']);
});

const call = (path, { method = 'GET', body, raw, cookie } = {}) =>
  createRoute({ pool: () => db, auth: null, now })(new Request(`https://app.example.test${path}`, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  }));
const signIn = async (accountId) => (await createSession(db, accountId, clock)).cookie.split(';')[0];
const rider = async (accountId = 'acc_1') => {
  const cookie = await signIn(accountId);
  return {
    book: (body) => call('/api/bookings', { method: 'POST', body, cookie }),
    mine: () => call('/api/bookings', { cookie }),
    cancel: (id) => call('/api/bookings/cancel', { method: 'POST', body: { id }, cookie }),
    wait: (classId) => call('/api/waitlist', { method: 'POST', body: { classId }, cookie }),
    unwait: (classId) => call('/api/waitlist/leave', { method: 'POST', body: { classId }, cookie }),
    post: (path, opts) => call(path, { method: 'POST', cookie, ...opts }),
  };
};
const count = async (t) => (await db.query(`select count(*)::int n from ${t}`)).rows[0].n;
const codeOf = async (res) => [res.status, (await res.json()).code];

test('signed out is 401, and a staff cookie is not a rider', async () => {
  await db.exec("insert into staff (id, supabase_user_id, name, email, role) values ('st_1', 'sb_1', 'Desk', 'desk@studio.test', 'owner')");
  const staff = (await createStaffSession(db, 'st_1', clock)).cookie.split(';')[0];
  for (const cookie of [undefined, staff]) {
    assert.equal((await call('/api/bookings', { method: 'POST', body: { classId: 'cls_1', bikeNo: 3 }, cookie })).status, 401);
    assert.equal((await call('/api/bookings', { cookie })).status, 401);
  }
  assert.equal(await count('bookings'), 0);
});

test('a booking is stored for the signed-in rider only, with one confirmation mail', async () => {
  const res = await (await rider('acc_1')).book({ classId: 'cls_1', bikeNo: 3, accountId: 'acc_2', guestName: 'Someone Else' });
  assert.equal(res.status, 201);
  const row = await bookingRow((await res.json()).id);
  assert.deepEqual([row.account_id, row.class_id, row.bike_no, row.status, row.guest_name], ['acc_1', 'cls_1', 3, 'booked', null]);
  assert.equal(await count('bookings'), 1);
  assert.deepEqual((await mails()).map((m) => m.to_email), ['ana@example.test']);
});

test('a taken bike and a second bike in the same class are refused, another class is fine', async () => {
  await db.exec("insert into classes (id, name, instructor_id, starts_at, release_opens_at) values ('cls_2', 'Riders', 'ins_1', '2027-01-13T17:30:00Z', '2027-01-01T00:00:00Z')");
  const ana = await rider('acc_1');
  await ana.book({ classId: 'cls_1', bikeNo: 3 });
  assert.deepEqual(await codeOf(await (await rider('acc_2')).book({ classId: 'cls_1', bikeNo: 3 })), [409, 'bike_taken']);
  assert.deepEqual(await codeOf(await ana.book({ classId: 'cls_1', bikeNo: 4 })), [409, 'already_booked']);
  assert.equal((await ana.book({ classId: 'cls_2', bikeNo: 3 })).status, 201);
  assert.equal(await count('bookings'), 2);
});

test('every refusal of a booking has its own code and writes nothing', async () => {
  const ana = await rider('acc_1');
  const refuse = async (body, status, code) => {
    const res = await ana.book(body);
    const j = await res.json();
    assert.deepEqual([res.status, j.code], [status, code], code);
    return j;
  };
  await refuse({ classId: 'cls_1', bikeNo: 21 }, 400, 'bad_bike');
  await refuse({ classId: 'cls_nope', bikeNo: 3 }, 404, 'no_class');
  await db.exec('update classes set cancelled = true');
  await refuse({ classId: 'cls_1', bikeNo: 3 }, 409, 'not_bookable');
  await db.exec('update classes set cancelled = false');
  clock = new Date('2027-01-03T10:00:00Z');
  assert.equal((await refuse({ classId: 'cls_1', bikeNo: 3 }, 409, 'booking_not_open')).opensOn, '2027-01-04');
  clock = new Date(T0);
  await db.exec("update accounts set first_ride = true where id = 'acc_1'");
  await refuse({ classId: 'cls_1', bikeNo: 3 }, 409, 'waiver_required');
  await db.exec("update accounts set first_ride = false; update settings set credits_enabled = true");
  await refuse({ classId: 'cls_1', bikeNo: 3 }, 409, 'no_credit');
  assert.equal(await count('bookings'), 0);
  assert.equal(await count('outbox'), 0);
  assert.equal(await count('spent_log'), 0);
});

test('a broken or hostile body is 400, never a 500, and writes nothing', async () => {
  const ana = await rider('acc_1');
  const bodies = ['not json', 'null', '[]', '"text"', '{}', '{"classId":"cls_1"}', '{"classId":"cls_1","bikeNo":"3"}', '{"classId":"cls_1","bikeNo":3.5}',
    '{"classId":["cls_1"],"bikeNo":3}', '{"classId":"cls_1\\u0000","bikeNo":3}', `{"classId":"${'x'.repeat(10000)}","bikeNo":3}`];
  for (const raw of bodies) assert.equal((await ana.post('/api/bookings', { raw })).status, 400, raw.slice(0, 60));
  assert.equal((await call('/api/bookings', { method: 'DELETE', cookie: await signIn('acc_1') })).status, 405);
  assert.equal(await count('bookings'), 0);
});

test('the list shows only the rider\'s own upcoming bookings and waitlist places', async () => {
  await db.exec(`
    insert into instructors (id, first_name, full_name, slug) values ('ins_2', 'Ivana', 'Ivana K', 'ivana');
    insert into classes (id, name, instructor_id, actual_instructor_id, theme_name, starts_at, release_opens_at, cancelled) values
      ('cls_past', 'Riders', 'ins_1', null, null, '2027-01-09T17:30:00Z', '2027-01-01T00:00:00Z', false),
      ('cls_off', 'Riders', 'ins_1', null, null, '2027-01-14T17:30:00Z', '2027-01-01T00:00:00Z', true),
      ('cls_swap', 'Riders', 'ins_1', 'ins_2', 'Britney', '2027-01-11T17:30:00Z', '2027-01-01T00:00:00Z', false);
    insert into bookings (id, class_id, bike_no, account_id, status) values
      ('bk_a', 'cls_1', 3, 'acc_1', 'booked'), ('bk_s', 'cls_swap', 8, 'acc_1', 'booked'), ('bk_past', 'cls_past', 1, 'acc_1', 'booked'),
      ('bk_off', 'cls_off', 2, 'acc_1', 'booked'), ('bk_gone', 'cls_1', 4, 'acc_1', 'cancelled'), ('bk_other', 'cls_1', 5, 'acc_2', 'booked');
    insert into waitlist (id, class_id, account_id) values ('wl_a', 'cls_1', 'acc_1'), ('wl_past', 'cls_past', 'acc_1'), ('wl_b', 'cls_swap', 'acc_2')`);
  const res = await (await rider('acc_1')).mine();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.bookings, [
    { id: 'bk_s', classId: 'cls_swap', bikeNo: 8, startsAt: '2027-01-11T17:30:00.000Z', name: 'Britney', instructor: 'Ivana', cancelFreeUntil: '2027-01-11T11:30:00.000Z' },
    { id: 'bk_a', classId: 'cls_1', bikeNo: 3, startsAt: '2027-01-12T17:30:00.000Z', name: 'Riders', instructor: 'Mirna', cancelFreeUntil: '2027-01-12T11:30:00.000Z' },
  ]);
  assert.deepEqual(body.waitlist, [{ classId: 'cls_1', startsAt: '2027-01-12T17:30:00.000Z', name: 'Riders', instructor: 'Mirna' }]);
});

// Booked with a credit, so a free cancel and a late one differ in what comes back.
const bookWithCredit = async (startsAt) => {
  await db.query("update classes set starts_at = $1 where id = 'cls_1'", [startsAt]);
  await db.exec(`update settings set credits_enabled = true;
    insert into lots (id, account_id, expires_at, remaining, origin) values ('lot_1', 'acc_1', '2028-06-01T00:00:00Z', 1, 'legacy')`);
  const res = await (await rider('acc_1')).book({ classId: 'cls_1', bikeNo: 3 });
  assert.equal(res.status, 201);
  return (await res.json()).id;
};
const returned = async () => (await db.query("select count(*)::int n from lots where origin = 'returned'")).rows[0].n;

// 12 January, and 07:00 Zagreb on the Sundays the clocks move in 2027 (28 March, 31 October). On those two, the 6 hours
// before the class include the change, so counting on the wall clock would be an hour wrong.
for (const startsAt of ['2027-01-12T17:30:00Z', '2027-03-28T05:00:00Z', '2027-10-31T06:00:00Z']) {
  for (const [minutesBefore, status, credits] of [[360, 'cancelled', 1], [359, 'late_cancel', 0]]) {
    test(`cancel ${minutesBefore} minutes before a class on ${startsAt.slice(0, 10)} is ${status}`, async () => {
      const id = await bookWithCredit(startsAt);
      clock = new Date(Date.parse(startsAt) - minutesBefore * 60000);
      const res = await (await rider('acc_1')).cancel(id);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status });
      assert.equal((await bookingRow(id)).status, status);
      assert.equal(await returned(), credits);
    });
  }
}

const seat = (id, accountId = 'acc_1', bikeNo = 3, status = 'booked') =>
  db.query("insert into bookings (id, class_id, bike_no, account_id, status) values ($1, 'cls_1', $2, $3, $4)", [id, bikeNo, accountId, status]);
const everything = async () => ({
  bookings: (await db.query('select * from bookings order by id')).rows,
  waitlist: (await db.query('select * from waitlist order by id')).rows,
  mails: await mails(),
});

test('another rider\'s booking, an unknown id and a hostile id change nothing', async () => {
  await seat('bk_ana');
  const before = await everything();
  const bruno = await rider('acc_2');
  for (const id of ['bk_ana', 'bk_nope']) assert.deepEqual(await codeOf(await bruno.cancel(id)), [404, 'no_booking'], id);
  for (const id of [undefined, 7, ['bk_ana'], 'bk\u0000']) assert.equal((await bruno.cancel(id)).status, 400, String(id));
  assert.deepEqual(await everything(), before);
});

test('after the class has started, or after check-in, a rider cannot cancel', async () => {
  await seat('bk_ana');
  const before = await everything();
  clock = new Date('2027-01-12T17:30:00Z');
  assert.deepEqual(await codeOf(await (await rider('acc_1')).cancel('bk_ana')), [409, 'not_cancellable']);
  assert.deepEqual(await everything(), before);
  clock = new Date('2027-01-12T17:20:00Z');
  await db.exec("update bookings set status = 'attended'");
  assert.deepEqual(await codeOf(await (await rider('acc_1')).cancel('bk_ana')), [409, 'not_cancellable']);
  assert.equal((await bookingRow('bk_ana')).status, 'attended');
});

test('a second cancel is refused and the waiting rider is mailed once', async () => {
  await seat('bk_ana');
  await db.exec("insert into waitlist (id, class_id, account_id) values ('wl_b', 'cls_1', 'acc_2')");
  const ana = await rider('acc_1');
  assert.equal((await ana.cancel('bk_ana')).status, 200);
  assert.deepEqual(await codeOf(await ana.cancel('bk_ana')), [409, 'not_cancellable']);
  assert.equal((await mails()).filter((m) => m.to_email === 'bruno@example.test').length, 1);
});

const fill = async () => {
  await db.exec("update classes set bike_count = 2 where id = 'cls_1'");
  await seat('bk_1', 'acc_1', 1);
  await seat('bk_2', 'acc_2', 2);
};

test('join the waitlist of a full class once, and the freed bike goes to whoever books first', async () => {
  await fill();
  const cvita = await rider('acc_3');
  for (let i = 0; i < 2; i++) {
    const res = await cvita.wait('cls_1');
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true });
  }
  assert.equal(await count('waitlist'), 1);
  await (await rider('acc_1')).cancel('bk_1');
  assert.ok((await mails()).some((m) => m.to_email === 'cvita@example.test'));
  assert.equal((await cvita.book({ classId: 'cls_1', bikeNo: 1 })).status, 201);
  assert.equal(await count('waitlist'), 0, 'getting a bike ends the wait');
});

test('joining is refused with free bikes, with a bike in the class, after the start and for no such class', async () => {
  assert.deepEqual(await codeOf(await (await rider('acc_3')).wait('cls_1')), [409, 'not_full']);
  await fill();
  assert.deepEqual(await codeOf(await (await rider('acc_1')).wait('cls_1')), [409, 'already_booked']);
  assert.deepEqual(await codeOf(await (await rider('acc_3')).wait('cls_nope')), [404, 'no_class']);
  assert.equal((await (await rider('acc_3')).wait(7)).status, 400);
  clock = new Date('2027-01-12T17:30:00Z');
  assert.deepEqual(await codeOf(await (await rider('acc_3')).wait('cls_1')), [409, 'not_bookable']);
  assert.equal(await count('waitlist'), 0);
});

test('leaving removes only the rider\'s own place, also when not waiting', async () => {
  await db.exec("insert into waitlist (id, class_id, account_id) values ('wl_b', 'cls_1', 'acc_2'), ('wl_c', 'cls_1', 'acc_3')");
  const cvita = await rider('acc_3');
  for (let i = 0; i < 2; i++) assert.deepEqual(await (await cvita.unwait('cls_1')).json(), { ok: true });
  assert.deepEqual((await db.query('select id from waitlist')).rows.map((r) => r.id), ['wl_b']);
  assert.equal((await cvita.unwait('cls_nope')).status, 200);
  assert.equal((await cvita.unwait(null)).status, 400);
  assert.equal(await count('outbox'), 0);
});

test('the cancel and waitlist routes need a rider and a POST', async () => {
  await seat('bk_ana');
  for (const path of ['/api/bookings/cancel', '/api/waitlist', '/api/waitlist/leave']) {
    assert.equal((await call(path, { method: 'POST', body: { id: 'bk_ana', classId: 'cls_1' } })).status, 401, path);
    assert.equal((await call(path, { cookie: await signIn('acc_1') })).status, 405, path);
  }
  assert.equal((await bookingRow('bk_ana')).status, 'booked');
});
