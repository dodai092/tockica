// The purchase flow (plan update 2026-11-17 section 2.10), against a fake gateway. PayWay's real signing, callback
// shape and refund call are unknown until its API document arrives, so the gateway is a small interface here:
//   parse(body, headers) -> { valid, providerRef, orderId, amountCents, status: 'succeeded' | 'failed' }
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { createOrder, handleCallback, expireOrders, orderState, OrderError } from '../server/orders.js';

let db;
before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());

const sale = new Date('2027-01-10T10:00:00Z');
const fake = {
  parse: (body) => {
    const m = JSON.parse(body);
    return { valid: m.sig === 'ok', providerRef: m.ref ?? null, orderId: m.orderId, amountCents: m.amountCents, status: m.status ?? 'succeeded' };
  },
};
const cb = (o) => JSON.stringify({ sig: 'ok', ref: 'PW-1', orderId: o.id, amountCents: o.amount_cents, ...o.extra });
const count = async (t) => (await db.query(`select count(*)::int as n from ${t}`)).rows[0].n;
const code = async (p) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof OrderError) return e.code;
    throw e;
  }
  assert.fail('expected OrderError');
};

beforeEach(async () => {
  await db.exec(`
    delete from passes; truncate payment_events; delete from payments; delete from orders; delete from accounts; delete from packs;
    update settings set max_passes = null;
    insert into accounts (id, name, email, waitlist_joined_at) values
      ('acc_1', 'A', 'a@example.com', '2026-12-01T10:00:00Z'),
      ('acc_2', 'B', 'b@example.com', '2026-12-20T10:00:00Z'),
      ('acc_late', 'L', 'l@example.com', '2027-01-02T10:00:00Z'),
      ('acc_none', 'N', 'n@example.com', null);
    insert into packs (id, name, price_cents, classes, valid_days, active) values
      ('pk_5', '5 treninga', 6500, 5, 45, true), ('pk_old', 'Old', 3000, 1, 30, false);
  `);
});

test('the offer order takes its price from the server, whatever the client sends', async () => {
  const o = await createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer', amountCents: 1 }, sale);
  assert.equal(o.amount_cents, 9900);
  assert.equal(o.status, 'pending');
  assert.ok(new Date(o.expires_at) > sale);
});

test('only people who joined by 31 December can buy the offer, and only 4 to 31 January', async () => {
  assert.equal(await code(createOrder(db, { accountId: 'acc_none', kind: 'waitlist_offer' }, sale)), 'not_eligible');
  assert.equal(await code(createOrder(db, { accountId: 'acc_late', kind: 'waitlist_offer' }, sale)), 'not_eligible');
  const sold = (iso) => createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, new Date(iso));
  assert.equal(await code(sold('2027-01-03T22:30:00Z')), 'sale_closed'); // 23:30 on 3 January in Zagreb
  assert.equal(await code(sold('2027-01-31T23:30:00Z')), 'sale_closed'); // 00:30 on 1 February in Zagreb
  await sold('2027-01-03T23:30:00Z'); // 00:30 on 4 January, open
});

test('one open offer order per account, a new one after it expires', async () => {
  await createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, sale);
  assert.equal(await code(createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, sale)), 'already_ordered');
  const later = new Date(sale.getTime() + 2 * 3600 * 1000);
  assert.equal(await expireOrders(db, later), 1);
  await createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, later);
});

test('with a cap set, a sold-out offer cannot be ordered', async () => {
  await db.exec(`update settings set max_passes = 1`);
  await createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, sale);
  assert.equal(await code(createOrder(db, { accountId: 'acc_2', kind: 'waitlist_offer' }, sale)), 'sold_out');
});

test('a pack order takes its price from the packs table and refuses an inactive pack', async () => {
  const o = await createOrder(db, { accountId: 'acc_1', kind: 'pack', packId: 'pk_5', amountCents: 1 }, sale);
  assert.equal(o.amount_cents, 6500);
  assert.equal(await code(createOrder(db, { accountId: 'acc_1', kind: 'pack', packId: 'pk_old' }, sale)), 'unknown_pack');
});

test('a paid callback records the payment, marks the order paid and grants a 30 day pass from the day of purchase', async () => {
  const o = await createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, sale);
  const r = await handleCallback(db, fake, { body: cb(o) }, sale);
  assert.equal(r.duplicate, false);
  assert.equal((await orderState(db, o.id, 'acc_1')).status, 'paid');
  const p = (await db.query(`select valid_from::text as f, valid_to::text as t, price_cents, order_id, paid_on::text as paid from passes`)).rows;
  assert.deepEqual(p, [{ f: '2027-01-10', t: '2027-02-09', price_cents: 9900, order_id: o.id, paid: '2027-01-10' }]);
  assert.equal(await count('payments'), 1);
});

test('the same callback twice grants once', async () => {
  const o = await createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, sale);
  await handleCallback(db, fake, { body: cb(o) }, sale);
  const again = await handleCallback(db, fake, { body: cb(o) }, sale);
  assert.equal(again.duplicate, true);
  assert.equal(await count('passes'), 1);
  assert.equal(await count('payments'), 1);
  assert.equal(await count('payment_events'), 2);
});

test('a bad signature or a wrong amount is refused, logged, and grants nothing', async () => {
  const o = await createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, sale);
  const bad = JSON.stringify({ sig: 'forged', ref: 'PW-9', orderId: o.id, amountCents: 9900 });
  assert.equal(await code(handleCallback(db, fake, { body: bad }, sale)), 'bad_callback');
  assert.equal(await code(handleCallback(db, fake, { body: cb({ ...o, amount_cents: 100 }) }, sale)), 'amount_mismatch');
  assert.equal(await code(handleCallback(db, fake, { body: cb({ id: 'or_missing', amount_cents: 9900 }) }, sale)), 'bad_callback');
  assert.equal(await count('passes'), 0);
  assert.equal(await count('payments'), 0);
  assert.equal(await count('payment_events'), 3);
  assert.equal((await orderState(db, o.id, 'acc_1')).status, 'pending');
});

test('coming back to the site without a callback grants nothing, a callback without coming back grants', async () => {
  const o = await createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, sale);
  assert.equal((await orderState(db, o.id, 'acc_1')).status, 'pending');
  assert.equal(await count('passes'), 0);
  assert.equal(await orderState(db, o.id, 'acc_2'), null); // somebody else's order is not visible
  await handleCallback(db, fake, { body: cb(o) }, sale);
  assert.equal(await count('passes'), 1);
});

test('money that arrives after the order expired is still granted', async () => {
  const o = await createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, sale);
  const later = new Date(sale.getTime() + 3 * 3600 * 1000);
  await expireOrders(db, later);
  await handleCallback(db, fake, { body: cb(o) }, later);
  assert.equal((await orderState(db, o.id, 'acc_1')).status, 'paid');
  assert.equal(await count('passes'), 1);
});

test('a failed payment marks the order failed, grants nothing and lets the account try again', async () => {
  const o = await createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, sale);
  await handleCallback(db, fake, { body: cb({ ...o, extra: { status: 'failed' } }) }, sale);
  assert.equal((await orderState(db, o.id, 'acc_1')).status, 'failed');
  assert.equal(await count('passes'), 0);
  await createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, sale);
});

test('a second payment for an order that is already paid is raised, not granted', async () => {
  const o = await createOrder(db, { accountId: 'acc_1', kind: 'waitlist_offer' }, sale);
  await handleCallback(db, fake, { body: cb(o) }, sale);
  const second = JSON.stringify({ sig: 'ok', ref: 'PW-2', orderId: o.id, amountCents: 9900, status: 'succeeded' });
  assert.equal(await code(handleCallback(db, fake, { body: second }, sale)), 'double_payment');
  assert.equal(await count('passes'), 1);
  assert.equal(await count('payment_events'), 2);
});

test('a pack is granted through the grant that is handed in, once, until the ledger exists', async () => {
  const o = await createOrder(db, { accountId: 'acc_1', kind: 'pack', packId: 'pk_5' }, sale);
  const granted = [];
  const grants = { pack: async (_tx, order) => granted.push(order.pack_id) };
  await handleCallback(db, fake, { body: cb(o) }, sale, grants);
  await handleCallback(db, fake, { body: cb(o) }, sale, grants);
  assert.deepEqual(granted, ['pk_5']);
  assert.equal(await code(handleCallback(db, fake, { body: JSON.stringify({ sig: 'ok', ref: 'PW-5', orderId: (await createOrder(db, { accountId: 'acc_2', kind: 'pack', packId: 'pk_5' }, sale)).id, amountCents: 6500 }) }, sale)), 'pack_grant_missing');
});
