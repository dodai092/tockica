// The weekly Release (plan Task 8): Monday 10:00 Zagreb time, classes open two weeks ahead. The job is called every hour,
// by a scheduler that only knows UTC, so it decides for itself whether a release has happened. It must create each class
// once, whatever the clock changes do. The rules (which instant, which week) are prototype/src/schedule.js.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { runRelease } from '../server/jobs/release.js';

let db;
before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());

beforeEach(async () => {
  await db.exec(`
    update bookings set credit_lot_id = null; delete from bookings; delete from classes; delete from template_entries;
    delete from closed_days; delete from instructors;
    insert into instructors (id, first_name, full_name, slug) values ('ins_1', 'Mirna', 'Mirna Zebec', 'mirna');
    insert into template_entries (id, day_of_week, time_of_day, name, instructor_id, theme_name) values
      ('tpl_1', 1, '07:30', 'Riders', 'ins_1', null),
      ('tpl_2', 1, '17:30', 'Riders', 'ins_1', 'Britney Spears'),
      ('tpl_3', 6, '10:30', 'Riders', 'ins_1', null);
  `);
});

const at = (iso) => new Date(iso);
const days = async () => (await db.query(`select to_char(starts_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD') as d from classes order by starts_at`)).rows.map((r) => r.d);
const total = async () => (await db.query('select count(*)::int as n from classes')).rows[0].n;
const has = async (d) => (await days()).includes(d);
// One class by its start in studio time, "YYYY-MM-DD HH:MM".
const slot = async (when) =>
  (await db.query(`select 1 from classes where to_char(starts_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI') = $1`, [when])).rows.length === 1;

test('a release opens every class that starts before the next release plus two weeks, at 10:00 Zagreb time and not before', async () => {
  await runRelease(db, at('2027-01-04T08:59:00Z')); // 09:59 in Zagreb, the release of 28 December still stands
  assert.equal(await slot('2027-01-18 07:30'), true); // opened on 28 December
  assert.equal(await slot('2027-01-18 17:30'), false);
  const r = await runRelease(db, at('2027-01-04T09:00:00Z')); // 10:00
  assert.equal(await slot('2027-01-18 17:30'), true);
  assert.equal(await slot('2027-01-23 10:30'), true);
  assert.equal(await slot('2027-01-25 07:30'), true);
  assert.equal(await slot('2027-01-25 17:30'), false); // opens on 11 January
  assert.equal(r.created, 3);
});

test('a class that has already started is not created', async () => {
  await runRelease(db, at('2027-01-04T09:00:00Z')); // Monday 4 January 07:30 is over by 10:00
  assert.equal(await slot('2027-01-04 07:30'), false);
  assert.equal(await slot('2027-01-04 17:30'), true);
});

test('the whole run is idempotent: the same hour twice, and two runs at once, create each class once', async () => {
  await runRelease(db, at('2027-01-04T09:00:00Z'));
  const n = await total();
  assert.equal((await runRelease(db, at('2027-01-04T09:00:00Z'))).created, 0);
  assert.equal((await runRelease(db, at('2027-01-04T15:00:00Z'))).created, 0); // later the same day
  assert.equal(await total(), n);
  await db.exec('delete from classes');
  await Promise.all([runRelease(db, at('2027-01-04T09:00:00Z')), runRelease(db, at('2027-01-04T09:00:00Z'))]);
  assert.equal(await total(), n);
});

test('a closed day gets no classes, the rest of the week does', async () => {
  await db.exec(`insert into closed_days (day) values ('2027-01-18')`);
  await runRelease(db, at('2027-01-04T09:00:00Z'));
  assert.equal(await has('2027-01-18'), false);
  assert.equal(await has('2027-01-23'), true);
});

test('a class stores the release that opened it, an early Monday class opens a release earlier', async () => {
  await runRelease(db, at('2027-01-04T09:00:00Z'));
  const opens = async (day, time) =>
    (await db.query(`select release_opens_at from classes where to_char(starts_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI') = $1`, [`${day} ${time}`])).rows[0].release_opens_at;
  assert.equal(new Date(await opens('2027-01-18', '17:30')).toISOString(), '2027-01-04T09:00:00.000Z');
  assert.equal(new Date(await opens('2027-01-18', '07:30')).toISOString(), '2026-12-28T09:00:00.000Z');
});

test('spring clock change: on Monday 29 March 2027 the release is 10:00 summer time, 08:00 UTC', async () => {
  await runRelease(db, at('2027-03-29T07:59:00Z')); // 09:59 summer time, the release has not happened
  assert.equal(await slot('2027-04-12 17:30'), false);
  await runRelease(db, at('2027-03-29T08:00:00Z')); // 10:00
  assert.equal(await slot('2027-04-12 17:30'), true);
  const t = (await db.query(`select starts_at from classes where to_char(starts_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI') = '2027-03-29 17:30'`)).rows[0].starts_at;
  assert.equal(new Date(t).toISOString(), '2027-03-29T15:30:00.000Z'); // 17:30 in summer time, an hour earlier in UTC than in winter
});

test('autumn clock change: on Monday 1 November 2027 the release is 10:00 winter time, 09:00 UTC, not 08:00', async () => {
  await runRelease(db, at('2027-11-01T08:00:00Z')); // 09:00 winter time, a fixed UTC schedule would fire here
  assert.equal(await slot('2027-11-15 17:30'), false);
  await runRelease(db, at('2027-11-01T09:00:00Z'));
  assert.equal(await slot('2027-11-15 17:30'), true);
});

test('an edited class is not made again, and a run that skipped hours catches up within the week', async () => {
  await runRelease(db, at('2027-01-04T09:00:00Z'));
  await db.exec(`update classes set name = 'Riders (edited)', theme_name = 'Edited' where to_char(starts_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI') = '2027-01-18 17:30'`);
  const n = await total();
  await runRelease(db, at('2027-01-04T10:00:00Z'));
  assert.equal(await total(), n);
  await db.exec('delete from classes');
  await runRelease(db, at('2027-01-07T12:00:00Z')); // the job did not run on Monday, Thursday finds the same release
  assert.equal(await slot('2027-01-18 17:30'), true);
});
