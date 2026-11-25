// Load, run, write back (plan Task 3). The rules in prototype/src work on a store-shaped object. This opens a
// transaction, locks the class row, loads only the rows the scope names into that shape, runs fn on it, writes the
// difference back and commits. Any error rolls back and propagates, so a rejected booking leaves nothing behind.
import { BikeTakenError } from '../../../prototype/src/booking.js';

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const fromRow = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v instanceof Date ? v.toISOString() : v]));

// Collections written back, in the order they are written: a booking points at a lot, a spend points at a lot.
// A null key means insert only. Others are read only: changing one inside fn throws instead of being lost.
const WRITE = {
  lots: 'id',
  bookings: 'id',
  waitlist: 'id',
  waivers: 'id',
  outbox: null,
  spentLog: null,
  restoredLog: null,
  legacyPacks: 'id',
};
const TABLE = { spentLog: 'spent_log', restoredLog: 'restored_log', legacyPacks: 'legacy_packs' };
const tbl = (k) => TABLE[k] ?? k;
const READ_ONLY = ['accounts', 'classes', 'instructors', 'packs'];

/**
 * Load, run, write back, inside the transaction `db` is already in. `db` is a single connection. Used on its own to
 * run a rule inside a bigger transaction (a paid callback grants a pack), and by runInTransaction below.
 */
export async function runInStore(db, scope, fn) {
  const q = async (sql, params) => (await db.query(sql, params)).rows.map(fromRow);
  const store = {
    accounts: [], classes: [], instructors: [], bookings: [], waitlist: [], waivers: [], outbox: [],
    lots: [], spentLog: [], restoredLog: [], legacyPacks: [], packs: [],
  };

  if (scope.classId) {
    // The lock is what makes two people booking the same class take turns.
    store.classes = await q('select * from classes where id = $1 for update', [scope.classId]);
    store.bookings = await q('select * from bookings where class_id = $1', [scope.classId]);
    store.waitlist = await q('select * from waitlist where class_id = $1', [scope.classId]);
  }
  if (scope.accountId) {
    store.accounts = await q('select * from accounts where id = $1', [scope.accountId]);
    store.waivers = await q('select * from waivers where account_id = $1', [scope.accountId]);
    // Locked, so one account booking two classes at once cannot spend the same last credit twice.
    store.lots = await q('select * from lots where account_id = $1 for update', [scope.accountId]);
    const email = store.accounts[0]?.email.trim().toLowerCase();
    if (email) store.legacyPacks = await q('select * from legacy_packs where email = $1 and claimed_by is null for update', [email]);
  }
  if (scope.classId) {
    // Whoever waits for this class gets a mail when a bike is freed, so their addresses are needed too. After the
    // scope's own account, which stays accounts[0].
    const waiting = await q('select a.* from accounts a join waitlist w on w.account_id = a.id where w.class_id = $1 and a.id is distinct from $2 order by w.created_at, a.id', [scope.classId, scope.accountId ?? null]);
    store.accounts.push(...waiting);
  }
  store.packs = await q('select id, name, classes, valid_days from packs');
  store.instructors = (await q('select id, full_name from instructors')).map((i) => ({ id: i.id, name: i.fullName }));
  // The opening day is a plain studio date. Read as text so no time zone can move it.
  const s = (await q("select *, to_char(booking_opens_on, 'YYYY-MM-DD') as opens from settings"))[0];
  store.settings = {
    dayOfWeek: s.releaseDayOfWeek,
    hour: s.releaseHour,
    weeksAhead: s.weeksAhead,
    returnedCreditDays: s.returnedCreditDays,
    credits: s.creditsEnabled,
    bookingOpensOn: s.opens,
    maxBikesPerClass: 1, // Antun, 2026-11-25: one bike per account in a class for now.
  };
  store.waiverText = { version: s.termsVersion, text: '' };

  const before = Object.fromEntries(Object.keys({ ...WRITE, accounts: 0, classes: 0, instructors: 0, packs: 0 }).map((k) => [k, JSON.stringify(store[k])]));
  const loaded = Object.fromEntries(Object.keys(WRITE).map((k) => [k, new Map(store[k].map((r) => [r.id, JSON.stringify(r)]))]));

  const result = await fn(store);

  for (const k of READ_ONLY) {
    if (JSON.stringify(store[k]) !== before[k]) throw new Error(`runInTransaction: ${k} is read only in this scope`);
  }
  for (const [key, pk] of Object.entries(WRITE)) {
    const table = tbl(key);
    const now = store[key];
    if (pk) {
      const seen = new Set();
      for (const row of now) {
        seen.add(row.id);
        const old = loaded[key].get(row.id);
        if (old === undefined) await insert(db, table, row);
        else if (old !== JSON.stringify(row)) await update(db, table, row);
      }
      for (const id of loaded[key].keys()) {
        if (!seen.has(id)) await db.query(`delete from ${table} where id = $1`, [id]);
      }
    } else {
      for (const row of now) await insert(db, table, key === 'outbox' ? flatten(row) : row);
    }
  }
  return result;
}

export async function runInTransaction(pool, scope, fn) {
  const db = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    await db.query('begin');
    const result = await runInStore(db, scope, fn);
    await db.query('commit');
    return result;
  } catch (e) {
    await db.query('rollback').catch(() => {});
    // The unique index is the backstop behind the in-memory check.
    if (e.code === '23505' && e.constraint === 'bookings_bike_taken') throw new BikeTakenError(undefined);
    throw e;
  } finally {
    if (db !== pool) db.release();
  }
}

// An outbox entry from the rules ({ to, subject, body, action: { label, url } }) as a pending row.
function flatten({ to, from, subject, body, action }) {
  return { to, ...(from ? { from } : {}), subject, body, ...(action ? { actionLabel: action.label, actionUrl: action.url } : {}) };
}

const columns = (row) => Object.keys(row).filter((k) => row[k] !== undefined);
const col = (k) => (k === 'to' || k === 'from' ? `${k}_email` : snake(k));

async function insert(db, table, row) {
  const ks = columns(row);
  await db.query(
    `insert into ${table} (${ks.map(col).join(', ')}) values (${ks.map((_, i) => `$${i + 1}`).join(', ')})`,
    ks.map((k) => row[k])
  );
}

async function update(db, table, row) {
  const ks = columns(row).filter((k) => k !== 'id');
  await db.query(`update ${table} set ${ks.map((k, i) => `${col(k)} = $${i + 1}`).join(', ')} where id = $${ks.length + 1}`, [
    ...ks.map((k) => row[k]),
    row.id,
  ]);
}
