// Migrations 003 (profile fields, Waitlist offer passes, booking opening day) and 004 (orders, payments, payment events).
// Same set-up as schema.test.js: every migration on PGlite, or on real Postgres with TEST_REAL_DB=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';

let db;

before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec(`
    insert into accounts (id, name, email) values ('acc_1', 'A', 'a@example.com'), ('acc_2', 'B', 'b@example.com');
    insert into packs (id, name, price_cents, classes, valid_days) values ('pk_5', '5 treninga', 6500, 5, 45);
  `);
});

after(() => db.close());

const order = (id, account, kind, pack, cents = 10000, status = 'pending') =>
  db.query(
    `insert into orders (id, account_id, product_kind, pack_id, amount_cents, status, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + interval '1 hour')`,
    [id, account, kind, pack, cents, status]
  );

test('an account holds first name, last name, birth date and the time it joined the waitlist', async () => {
  await db.exec(`update accounts set first_name = 'Ana', last_name = 'Horvat', birth_date = '1990-05-17',
    waitlist_joined_at = '2026-12-01T10:00:00Z' where id = 'acc_1'`);
  const r = (await db.query(`select first_name, last_name, birth_date::text as d, waitlist_joined_at is not null as joined from accounts where id = 'acc_1'`)).rows[0];
  assert.deepEqual(r, { first_name: 'Ana', last_name: 'Horvat', d: '1990-05-17', joined: true });
});

test('booking opens on 4 January 2027 by default, and the offer cap is empty until Dunia sets one', async () => {
  const s = (await db.query(`select booking_opens_on::text as d, max_passes from settings`)).rows[0];
  assert.equal(s.d, '2027-01-04');
  assert.equal(s.max_passes, null);
  await assert.rejects(db.exec(`update settings set max_passes = 0`), /check/i);
});

test('one Waitlist offer pass per account, and it must end after it starts', async () => {
  const pass = (id, account, from, to) =>
    db.query(`insert into passes (id, account_id, kind, valid_from, valid_to, price_cents) values ($1, $2, 'waitlist_offer', $3, $4, 10000)`, [id, account, from, to]);
  await pass('ps_1', 'acc_1', '2027-01-05', '2027-02-04');
  await assert.rejects(pass('ps_2', 'acc_1', '2027-01-06', '2027-02-05'), /unique/i);
  await assert.rejects(pass('ps_3', 'acc_2', '2027-02-05', '2027-02-05'), /check/i);
});

test('a pack order needs a pack, an offer order must not have one, and money is never negative', async () => {
  await order('or_1', 'acc_1', 'pack', 'pk_5', 6500);
  await assert.rejects(order('or_2', 'acc_1', 'pack', null, 6500), /check/i);
  await assert.rejects(order('or_3', 'acc_2', 'waitlist_offer', 'pk_5', 10000), /check/i);
  await assert.rejects(order('or_4', 'acc_1', 'pack', 'pk_5', -1), /check/i);
  await assert.rejects(order('or_5', 'acc_1', 'pack', 'pk_5', 6500, 'done'), /check/i);
});

test('an account has at most one open or paid Waitlist offer order, an expired one does not count', async () => {
  await order('or_6', 'acc_2', 'waitlist_offer', null);
  await assert.rejects(order('or_7', 'acc_2', 'waitlist_offer', null), /unique/i);
  await db.exec(`update orders set status = 'expired' where id = 'or_6'`);
  await order('or_8', 'acc_2', 'waitlist_offer', null);
});

test('a provider reference is unique, and an order has one succeeded payment', async () => {
  const pay = (id, orderId, ref, status = 'succeeded') =>
    db.query(`insert into payments (id, order_id, provider_ref, amount_cents, status) values ($1, $2, $3, 6500, $4)`, [id, orderId, ref, status]);
  await pay('pay_1', 'or_1', 'PW-1');
  await assert.rejects(pay('pay_2', 'or_1', 'PW-1'), /unique/i);
  await assert.rejects(pay('pay_3', 'or_1', 'PW-2'), /unique/i);
  await pay('pay_4', 'or_1', 'PW-3', 'failed');
});

test('payment events are append-only', async () => {
  await db.exec(`insert into payment_events (provider_ref, body) values ('PW-1', '{"paid":true}')`);
  await assert.rejects(db.exec(`update payment_events set body = 'x'`), /append-only/i);
  await assert.rejects(db.exec(`delete from payment_events`), /append-only/i);
});

test('a pass can point at the order that paid for it', async () => {
  await db.exec(`update passes set order_id = 'or_8' where id = 'ps_1'`);
  await assert.rejects(db.exec(`update passes set order_id = 'or_missing' where id = 'ps_1'`), /foreign key/i);
});
