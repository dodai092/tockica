// Plan Task 3, the gate ADR 0005 requires: 20 people book the same bike in the same class at the same instant.
// Needs real Postgres (DATABASE_URL, the Supabase session pooler). Skipped when it is not set.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { runInTransaction } from '../server/db/unit-of-work.js';
import { bookBike, BikeTakenError } from '../../prototype/src/booking.js';

const real = Boolean(process.env.DATABASE_URL);
const run = Math.random().toString(36).slice(2, 8);
const classId = `cls_race_${run}`;
// Its own class: whoever won bike 7 may not take a second bike in the first one (one bike per account per class).
const otherClassId = `cls_race2_${run}`;
const insId = `ins_race_${run}`;
const accounts = Array.from({ length: 20 }, (_, i) => `acc_race_${run}_${i}`);
// The guard keeps booking closed until the opening day (settings). Pretend it is after it, the race is what is under test.
const OPEN_NOW = new Date('2027-01-05T10:00:00+01:00');
let pool;

before(async () => {
  if (!real) return;
  // Fewer connections than callers on purpose: the rest queue, as they would on the live pooler.
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 10 });
  await pool.query(`insert into instructors (id, first_name, full_name, slug) values ($1, 'Test', 'Test Race', $2)`, [insId, `race-${run}`]);
  for (const id of [classId, otherClassId]) {
    await pool.query(
      `insert into classes (id, name, instructor_id, starts_at, release_opens_at) values ($1, 'Race', $2, $3, $4)`,
      [id, insId, new Date(OPEN_NOW.getTime() + 2 * 864e5), new Date(OPEN_NOW.getTime() - 864e5)]
    );
  }
  for (const id of accounts) await pool.query(`insert into accounts (id, name, email) values ($1, 'Race Test', $2)`, [id, `${id}@example.com`]);
});

after(async () => {
  if (!real) return;
  await pool.query('delete from outbox where to_email like $1', [`acc_race_${run}%`]);
  await pool.query('delete from bookings where class_id = any($1)', [[classId, otherClassId]]);
  await pool.query('delete from classes where id = any($1)', [[classId, otherClassId]]);
  await pool.query('delete from accounts where id = any($1)', [accounts]);
  await pool.query('delete from instructors where id = $1', [insId]);
  await pool.end();
});

test('20 parallel bookings of one bike: exactly one wins, the rest get BikeTakenError', { skip: !real }, async () => {
  const now = OPEN_NOW;
  const results = await Promise.allSettled(
    accounts.map((accountId) =>
      runInTransaction(pool, { classId, accountId }, (store) => bookBike(store, { classId, bikeNo: 7, accountId, now }))
    )
  );
  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected');
  assert.equal(won.length, 1, `winners: ${won.length}`);
  assert.equal(lost.length, 19);
  // "Bike 7" means the rules saw the winner's committed row after taking the lock. The unique index would say "Bike undefined".
  for (const r of lost) {
    assert.ok(r.reason instanceof BikeTakenError, `unexpected: ${r.reason}`);
    assert.match(r.reason.message, /Bike 7 /);
  }
  const rows = (await pool.query(`select * from bookings where class_id = $1 and bike_no = 7 and status = 'booked'`, [classId])).rows;
  assert.equal(rows.length, 1);
  // The confirmation mail was written by the same transaction, only for the winner.
  const mails = (await pool.query('select count(*)::int n from outbox where to_email like $1', [`acc_race_${run}%`])).rows[0].n;
  assert.equal(mails, 1);
});

test('different bikes in the same class all succeed in parallel', { skip: !real }, async () => {
  const now = OPEN_NOW;
  const results = await Promise.allSettled(
    accounts.slice(0, 10).map((accountId, i) =>
      runInTransaction(pool, { classId: otherClassId, accountId }, (store) => bookBike(store, { classId: otherClassId, bikeNo: 10 + i, accountId, now }))
    )
  );
  assert.deepEqual(results.filter((r) => r.status === 'rejected').map((r) => String(r.reason)), []);
});
