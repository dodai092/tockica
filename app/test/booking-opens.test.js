// No bike can be taken before settings.booking_opens_on (update 2026-11-17 section 2.6), whatever the screen shows.
// The greyed button on the website is only a hint, this is the check that counts. Studio days, Europe/Zagreb.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { runInTransaction } from '../server/db/unit-of-work.js';
import { bookBike, BookingNotOpenError } from '../../prototype/src/booking.js';

let db;
before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());

beforeEach(async () => {
  await db.exec(`
    update bookings set credit_lot_id = null; delete from bookings; delete from classes; delete from instructors;
    delete from spent_log; delete from lots; delete from accounts;
    update settings set credits_enabled = true, booking_opens_on = '2027-01-04';
    insert into accounts (id, name, email) values ('acc_1', 'A', 'a@example.com');
    insert into instructors (id, first_name, full_name, slug) values ('ins_1', 'Mirna', 'Mirna Zebec', 'mirna');
    insert into classes (id, name, instructor_id, starts_at, release_opens_at)
      values ('cls_1', 'Riders', 'ins_1', '2027-01-12T16:30:00Z', '2026-12-01T09:00:00Z');
    insert into lots (id, account_id, expires_at, remaining, origin) values ('lot_1', 'acc_1', '2027-06-01T00:00:00Z', 3, 'legacy');
  `);
});

const book = (iso) =>
  runInTransaction(db, { classId: 'cls_1', accountId: 'acc_1' }, (store) =>
    bookBike(store, { classId: 'cls_1', bikeNo: 5, accountId: 'acc_1', now: new Date(iso) })
  );
const rows = async () => ({
  bookings: (await db.query('select count(*)::int as n from bookings')).rows[0].n,
  remaining: (await db.query(`select remaining from lots where id = 'lot_1'`)).rows[0].remaining,
});

test('a booking before the opening day is refused, writes nothing and costs no credit', async () => {
  await assert.rejects(book('2027-01-03T22:30:00Z'), BookingNotOpenError); // 23:30 on 3 January in Zagreb
  assert.deepEqual(await rows(), { bookings: 0, remaining: 3 });
});

test('from the first minute of the opening day in Zagreb a booking goes through', async () => {
  await book('2027-01-03T23:30:00Z'); // 00:30 on 4 January in Zagreb
  assert.deepEqual(await rows(), { bookings: 1, remaining: 2 });
});

test('the opening day is a plain studio date, not shifted by the server time zone', async () => {
  await db.exec(`update settings set booking_opens_on = '2027-02-10'; update classes set starts_at = '2027-02-20T16:30:00Z'`);
  await book('2027-02-09T23:30:00Z'); // 00:30 on 10 February in Zagreb, so open
  await db.exec(`delete from bookings; update lots set remaining = 3`);
  const early = await book('2027-02-09T22:30:00Z').catch((e) => e); // 23:30 on 9 February, still closed
  assert.ok(early instanceof BookingNotOpenError);
  assert.equal(early.opensOn, '2027-02-10');
});
