// The no-show sweep (plan 2026-11-21-reception-check-in.md): when a class has ended, every booking still Booked
// becomes No-show. One transaction per class, so one bad class cannot undo the others. Fixed clock, PGlite.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { sweepEndedClasses } from '../server/checkin-sweep.js';

let db;
const NOW = new Date('2027-01-11T17:00:00Z');
const minutesFromNow = (n) => new Date(NOW.getTime() + n * 60000).toISOString();

before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());

beforeEach(async () => {
  await db.exec('delete from outbox; delete from bookings; delete from classes; delete from accounts; delete from instructors');
  await db.exec(`
    insert into instructors (id, first_name, full_name, slug) values ('ins_1', 'Mirna', 'Mirna Zebec', 'mirna');
    insert into accounts (id, name, email) values ('acc_1', 'A', 'a@example.test'), ('acc_2', 'B', 'b@example.test'), ('acc_3', 'C', 'c@example.test');
  `);
  // ended: started 90 min ago, 50 min long. running: started 10 min ago.
  for (const [id, startsInMin] of [['cls_ended', -90], ['cls_running', -10]]) {
    await db.query(`insert into classes (id, name, instructor_id, starts_at, duration_min, release_opens_at) values ($1, 'Riders', 'ins_1', $2, 50, $3)`, [id, minutesFromNow(startsInMin), minutesFromNow(-10000)]);
  }
  await db.exec(`
    insert into bookings (id, class_id, bike_no, account_id, status) values
      ('bk_1', 'cls_ended', 1, 'acc_1', 'booked'),
      ('bk_2', 'cls_ended', 2, 'acc_2', 'booked'),
      ('bk_3', 'cls_ended', 3, 'acc_3', 'attended'),
      ('bk_4', 'cls_running', 1, 'acc_1', 'booked');
  `);
});

const statuses = async () => Object.fromEntries((await db.query('select id, status from bookings order by id')).rows.map((r) => [r.id, r.status]));

test('bookings still Booked in an ended class become No-show, attended ones and a running class stay', async () => {
  const changed = await sweepEndedClasses(db, NOW);

  assert.equal(changed, 2);
  assert.deepEqual(await statuses(), { bk_1: 'no_show', bk_2: 'no_show', bk_3: 'attended', bk_4: 'booked' });
});

test('a second run changes nothing', async () => {
  await sweepEndedClasses(db, NOW);
  assert.equal(await sweepEndedClasses(db, NOW), 0);
  assert.deepEqual(await statuses(), { bk_1: 'no_show', bk_2: 'no_show', bk_3: 'attended', bk_4: 'booked' });
});

test('the class that is still running is picked up once it has ended', async () => {
  await sweepEndedClasses(db, NOW);
  assert.equal(await sweepEndedClasses(db, new Date(NOW.getTime() + 41 * 60000)), 1);
  assert.equal((await statuses()).bk_4, 'no_show');
});

test('the sweep sends no mail', async () => {
  await sweepEndedClasses(db, NOW);
  assert.equal((await db.query('select count(*)::int as n from outbox')).rows[0].n, 0);
});
