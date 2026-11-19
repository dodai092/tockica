// The purchase flow (plan update 2026-11-17 section 2.10). The server sets the price and decides who may buy, the payment
// provider's callback grants what was bought, and coming back to the site grants nothing.
// The gateway is a small interface because PayWay's real signing and callback are not known yet:
//   gateway.parse(body, headers) -> { valid, providerRef, orderId, amountCents, status: 'succeeded' | 'failed' }
// A paid pack is granted by the function handed in as grants.pack (credits.js grantPackForOrder) inside the same transaction.
import { newId } from '../../prototype/src/model.js';
import { studioTime } from '../../prototype/src/time.js';
import { OFFER } from './offer.js';
import { inTransaction } from './db/tx.js';

const ORDER_MINUTES = 30;

export class OrderError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const clash = (e, name) => new RegExp(name).test(`${e.constraint ?? ''} ${e.message}`);
const studioDay = (when) => studioTime.localDate(new Date(when).toISOString());

/** The caller wraps this in a transaction when a cap is set, so the cap check and the insert take turns. */
export async function createOrder(db, { accountId, kind, packId }, now = new Date()) {
  const today = studioDay(now);
  const account = (await db.query('select id, waitlist_joined_at from accounts where id = $1', [accountId])).rows[0];
  if (!account) throw new OrderError('not_eligible');
  let amount;
  let pack = null;
  if (kind === 'waitlist_offer') {
    if (!account.waitlist_joined_at || studioDay(account.waitlist_joined_at) > OFFER.joinDeadline) throw new OrderError('not_eligible');
    if (today < OFFER.saleFrom || today > OFFER.saleTo) throw new OrderError('sale_closed');
    await db.query('select 1 from settings for update');
    const s = (
      await db.query(
        `select max_passes,
                (select count(*)::int from passes where kind = 'waitlist_offer')
                + (select count(*)::int from orders where product_kind = 'waitlist_offer' and status = 'pending') as taken
         from settings`
      )
    ).rows[0];
    if (s.max_passes !== null && s.taken >= s.max_passes) throw new OrderError('sold_out');
    amount = OFFER.priceCents;
  } else if (kind === 'pack') {
    pack = (await db.query('select id, price_cents from packs where id = $1 and active', [packId])).rows[0];
    if (!pack) throw new OrderError('unknown_pack');
    amount = pack.price_cents;
  } else {
    throw new OrderError('unknown_pack');
  }
  try {
    const expires = new Date(now.getTime() + ORDER_MINUTES * 60_000).toISOString();
    return (
      await db.query(
        `insert into orders (id, account_id, product_kind, pack_id, amount_cents, expires_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [newId('or'), accountId, kind, pack?.id ?? null, amount, expires, now.toISOString()]
      )
    ).rows[0];
  } catch (e) {
    if (clash(e, 'orders_one_open_offer')) throw new OrderError('already_ordered');
    throw e;
  }
}

/** Orders still pending after their time are expired. Money that arrives later is still granted. */
export async function expireOrders(db, now = new Date()) {
  const r = await db.query(`update orders set status = 'expired' where status = 'pending' and expires_at <= $1 returning id`, [now.toISOString()]);
  return r.rows.length;
}

/** What the page the customer returns to reads. It never grants anything, and shows only the account's own order. */
export async function orderState(db, orderId, accountId) {
  return (await db.query('select id, status, product_kind, amount_cents from orders where id = $1 and account_id = $2', [orderId, accountId])).rows[0] ?? null;
}

/**
 * The provider's callback. The raw body is stored first, whatever happens next. Then the signature, the order and the
 * amount are checked, and the payment, the order's state and the grant are written together or not at all.
 * A callback with a provider reference seen before changes nothing.
 */
export async function handleCallback(db, gateway, { body, headers }, now = new Date(), grants = {}) {
  let ev;
  try {
    ev = gateway.parse(body, headers);
  } catch {
    ev = { valid: false };
  }
  await db.query('insert into payment_events (provider_ref, body) values ($1, $2)', [ev.providerRef ?? null, body]);
  if (!ev.valid) throw new OrderError('bad_callback');

  return inTransaction(db, async (tx) => {
    const order = (await tx.query('select * from orders where id = $1 for update', [ev.orderId])).rows[0];
    if (!order) throw new OrderError('bad_callback');
    if (ev.amountCents !== order.amount_cents) throw new OrderError('amount_mismatch');
    if ((await tx.query('select 1 from payments where provider_ref = $1', [ev.providerRef])).rows.length) {
      return { duplicate: true, orderId: order.id };
    }
    const day = studioDay(now);
    const pay = (status) =>
      tx.query(
        `insert into payments (id, order_id, provider_ref, amount_cents, status, paid_at) values ($1, $2, $3, $4, $5, $6)`,
        [newId('pay'), order.id, ev.providerRef, order.amount_cents, status, status === 'succeeded' ? now.toISOString() : null]
      );

    if (ev.status === 'failed') {
      await pay('failed');
      await tx.query(`update orders set status = 'failed' where id = $1 and status = 'pending'`, [order.id]);
      return { duplicate: false, orderId: order.id, status: 'failed' };
    }

    try {
      await pay('succeeded');
    } catch (e) {
      if (clash(e, 'payments_one_success_per_order')) throw new OrderError('double_payment');
      throw e;
    }
    await tx.query(`update orders set status = 'paid' where id = $1`, [order.id]);
    if (order.product_kind === 'waitlist_offer') {
      try {
        await tx.query(
          `insert into passes (id, account_id, kind, valid_from, valid_to, price_cents, order_id, paid_on)
           values ($1, $2, 'waitlist_offer', $3, $4, $5, $6, $3)`,
          [newId('ps'), order.account_id, day, studioTime.addDays(day, OFFER.days), order.amount_cents, order.id]
        );
      } catch (e) {
        if (clash(e, 'passes_one_offer_per_account')) throw new OrderError('double_payment');
        throw e;
      }
    } else if (grants.pack) {
      await grants.pack(tx, order, now);
    } else {
      throw new OrderError('pack_grant_missing');
    }
    return { duplicate: false, orderId: order.id, status: 'paid' };
  });
}
