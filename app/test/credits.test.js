// The credit ledger on the database (plan Task 15, pulled forward by the update of 2026-11-17 section 2.9). The rules stay in
// prototype/src/ledger.js. These tests check that they read and write the right rows: lots, the spend log and legacy packs.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { runInTransaction, runInStore } from '../server/db/unit-of-work.js';
import { addLegacyClasses, claimLegacy, grantPackForOrder } from '../server/credits.js';
import { signUp } from '../server/signup.js';
import { createOrder, handleCallback } from '../server/orders.js';
import { spendCredit, returnCredit, balance, NoCreditError } from '../../prototype/src/ledger.js';
import { bookBike } from '../../prototype/src/booking.js';

let db;
before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());

const now = new Date('2027-01-10T10:00:00Z');
const day = (n) => new Date(now.getTime() + n * 86_400_000).toISOString();
const count = async (t) => (await db.query(`select count(*)::int as n from ${t}`)).rows[0].n;
const lots = async () => (await db.query('select id, remaining, origin, pack_id from lots order by expires_at, id')).rows;

beforeEach(async () => {
  await db.exec(`
    update bookings set credit_lot_id = null; delete from bookings; delete from classes; delete from instructors;
    delete from spent_log; delete from restored_log; delete from lots; delete from legacy_packs;
    delete from passes; truncate payment_events; delete from payments; delete from orders; delete from accounts; delete from packs;
    update settings set credits_enabled = true;
    insert into accounts (id, name, email, waitlist_joined_at) values ('acc_1', 'A', 'a@example.com', '2026-12-01T10:00:00Z');
    insert into packs (id, name, price_cents, classes, valid_days) values ('pk_5', '5 treninga', 6500, 5, 45);
    insert into instructors (id, first_name, full_name, slug) values ('ins_1', 'Mirna', 'Mirna Zebec', 'mirna');
    insert into classes (id, name, instructor_id, starts_at, release_opens_at, bike_count)
      values ('cls_1', 'Riders', 'ins_1', '${day(2)}', '${day(-1)}', 20), ('cls_2', 'Riders', 'ins_1', '${day(3)}', '${day(-1)}', 20);
  `);
});

const put = (id, remaining, expiresAt, origin = 'purchase') =>
  db.query(`insert into lots (id, account_id, pack_id, expires_at, remaining, origin) values ($1, 'acc_1', 'pk_5', $2, $3, $4)`, [id, expiresAt, remaining, origin]);

test('a credit is spent from the lot that expires first, and the spend is logged', async () => {
  await put('lot_late', 5, day(40));
  await put('lot_soon', 2, day(10));
  const lot = await runInStore(db, { accountId: 'acc_1' }, (store) => spendCredit(store, 'acc_1', now));
  assert.equal(lot.id, 'lot_soon');
  assert.deepEqual((await lots()).map((l) => [l.id, l.remaining]), [['lot_soon', 1], ['lot_late', 5]]);
  const log = (await db.query('select account_id, lot_id from spent_log')).rows;
  assert.deepEqual(log, [{ account_id: 'acc_1', lot_id: 'lot_soon' }]);
});

test('an empty or expired lot is not spent, and a failed spend writes nothing', async () => {
  await put('lot_empty', 0, day(10));
  await put('lot_old', 3, day(-1));
  await assert.rejects(runInTransaction(db, { accountId: 'acc_1' }, (store) => spendCredit(store, 'acc_1', now)), NoCreditError);
  assert.equal(await count('spent_log'), 0);
});

test('a booking spends a credit and keeps the lot id, and without a credit it books nothing', async () => {
  await assert.rejects(
    runInTransaction(db, { classId: 'cls_1', accountId: 'acc_1' }, (store) => bookBike(store, { classId: 'cls_1', bikeNo: 3, accountId: 'acc_1', now })),
    NoCreditError
  );
  assert.equal(await count('bookings'), 0);
  await put('lot_1', 1, day(30));
  await runInTransaction(db, { classId: 'cls_1', accountId: 'acc_1' }, (store) => bookBike(store, { classId: 'cls_1', bikeNo: 3, accountId: 'acc_1', now }));
  assert.equal((await db.query('select credit_lot_id from bookings')).rows[0].credit_lot_id, 'lot_1');
  assert.equal((await lots())[0].remaining, 0);
  await assert.rejects(
    runInTransaction(db, { classId: 'cls_2', accountId: 'acc_1' }, (store) => bookBike(store, { classId: 'cls_2', bikeNo: 3, accountId: 'acc_1', now })),
    NoCreditError
  );
});

test('a booking must point at a lot that exists', async () => {
  await assert.rejects(db.exec(`insert into bookings (id, class_id, bike_no, account_id, credit_lot_id) values ('bk_x', 'cls_1', 4, 'acc_1', 'lot_missing')`), /foreign key/i);
});

test('a returned credit is a new lot that lasts until the later of the old expiry and return plus the returned days', async () => {
  await put('lot_1', 0, day(3));
  await runInStore(db, { accountId: 'acc_1' }, (store) => returnCredit(store, store.lots[0], now, 7));
  const r = (await db.query(`select remaining, origin, expires_at from lots where origin = 'returned'`)).rows[0];
  assert.equal(r.remaining, 1);
  assert.equal(new Date(r.expires_at).toISOString(), day(7)); // return + 7 days is later than the old expiry
});

test('the balance counts usable credits only', async () => {
  await put('lot_a', 2, day(10));
  await put('lot_b', 3, day(-2));
  await put('lot_c', 0, day(10));
  assert.equal(await runInStore(db, { accountId: 'acc_1' }, (store) => balance(store, 'acc_1', now)), 2);
});

test('paying for a pack grants a lot with the pack\'s classes and validity, once', async () => {
  const o = await createOrder(db, { accountId: 'acc_1', kind: 'pack', packId: 'pk_5' }, now);
  const gateway = { parse: (b) => ({ valid: true, ...JSON.parse(b), status: 'succeeded' }) };
  const body = JSON.stringify({ providerRef: 'PW-1', orderId: o.id, amountCents: o.amount_cents });
  await handleCallback(db, gateway, { body }, now, { pack: grantPackForOrder });
  await handleCallback(db, gateway, { body }, now, { pack: grantPackForOrder });
  const l = (await db.query('select remaining, origin, pack_id, expires_at from lots')).rows;
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].remaining, l[0].origin, l[0].pack_id], [5, 'purchase', 'pk_5']);
  assert.equal(new Date(l[0].expires_at).toISOString(), day(45));
});

test('old classes typed in for an email wait unclaimed, and become a legacy lot when that person signs up', async () => {
  await addLegacyClasses(db, { email: ' Ana@Example.com ', classes: 3, expiresOn: '2027-03-31' }, now);
  const w = (await db.query('select email, classes, claimed_by from legacy_packs')).rows;
  assert.deepEqual(w, [{ email: 'ana@example.com', classes: 3, claimed_by: null }]);
  const acc = await signUp(db, { firstName: 'Ana', lastName: 'Horvat', email: 'ANA@example.com', birthDate: '1990-05-17', acceptedTerms: true }, now);
  const l = (await db.query('select account_id, remaining, origin, pack_id, expires_at from lots')).rows;
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].account_id, l[0].remaining, l[0].origin, l[0].pack_id], [acc.id, 3, 'legacy', null]);
  assert.equal(new Date(l[0].expires_at).toISOString(), '2027-03-31T21:59:00.000Z'); // 23:59 in Zagreb, summer time
  assert.equal((await db.query('select claimed_by from legacy_packs')).rows[0].claimed_by, acc.id);
  assert.deepEqual(await claimLegacy(db, acc.id, now), []); // nothing left to claim, no second lot
  assert.equal(await count('lots'), 1);
});

test('classes typed in for someone who already has an account are claimed at once', async () => {
  await addLegacyClasses(db, { email: 'a@example.com', classes: 2, expiresOn: '2027-02-28' }, now);
  const l = (await db.query('select account_id, remaining, origin from lots')).rows;
  assert.deepEqual(l, [{ account_id: 'acc_1', remaining: 2, origin: 'legacy' }]);
});

test('legacy classes need an email, a whole number of classes and a date', async () => {
  await assert.rejects(addLegacyClasses(db, { email: '', classes: 2, expiresOn: '2027-02-28' }, now), RangeError);
  await assert.rejects(addLegacyClasses(db, { email: 'x@example.com', classes: 0, expiresOn: '2027-02-28' }, now), RangeError);
  await assert.rejects(addLegacyClasses(db, { email: 'x@example.com', classes: 2, expiresOn: '28.02.2027' }, now), RangeError);
});
