// The credit ledger's entry points on the database. The rules (earliest expiry first, returned and legacy lots) stay in
// prototype/src/ledger.js, run through runInStore. Each function here is one unit of work.
import { grantPack, addLegacyPack, claimLegacyPacks } from '../../prototype/src/ledger.js';
import { runInStore } from './db/unit-of-work.js';
import { inTransaction } from './db/tx.js';

/** For handleCallback's grants.pack: a paid pack order becomes a lot, inside the callback's own transaction. */
export const grantPackForOrder = (tx, order, now = new Date()) =>
  runInStore(tx, { accountId: order.account_id }, (store) => grantPack(store, order.account_id, order.pack_id, now));

/** Classes waiting under this account's email become a lot. Returns the legacy packs that were claimed. */
export const claimLegacy = (db, accountId, now = new Date()) =>
  inTransaction(db, (tx) => runInStore(tx, { accountId }, (store) => claimLegacyPacks(store, store.accounts[0], now)));

/**
 * The owner types in classes someone still holds from the old setup. They wait for an account with that email, or become
 * a lot at once if the account exists already. Dunia knows the numbers from the start of December.
 */
export function addLegacyClasses(db, { email, classes, expiresOn }, now = new Date()) {
  return inTransaction(db, async (tx) => {
    const clean = String(email ?? '').trim().toLowerCase();
    const account = clean ? (await tx.query('select id from accounts where lower(email) = $1', [clean])).rows[0] : null;
    return runInStore(tx, { accountId: account?.id }, (store) => {
      const pack = addLegacyPack(store, { email, classes, expiresOn, now });
      if (store.accounts[0]) claimLegacyPacks(store, store.accounts[0], now);
      return pack;
    });
  });
}
