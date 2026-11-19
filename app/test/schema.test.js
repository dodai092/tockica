// Applies every file in migrations/ to PGlite, or to real Postgres with TEST_REAL_DB=1 (test/db.js), and checks the rules the schema must hold.
// PGlite has one connection, so it cannot show the 20-parallel-booking race. That is plan Task 3, against real Postgres.
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
    insert into instructors (id, first_name, full_name, slug) values ('ins_1', 'Mirna', 'Mirna Zebec', 'mirna');
    insert into classes (id, name, instructor_id, starts_at, release_opens_at) values ('cls_1', 'Riders', 'ins_1', now(), now());
  `);
});

after(() => db.close());

const book = (id, account, bike, status = 'booked') =>
  db.query(`insert into bookings (id, class_id, bike_no, account_id, status) values ($1, 'cls_1', $2, $3, $4)`, [id, bike, account, status]);

test('one bike, one active booking per class', async () => {
  await book('bk_1', 'acc_1', 7);
  await assert.rejects(book('bk_2', 'acc_2', 7), /unique|duplicate/i);
});

test('a cancelled or late-cancelled booking frees the bike, an attended one keeps it', async () => {
  await db.exec(`update bookings set status = 'late_cancel' where id = 'bk_1'`);
  await book('bk_3', 'acc_2', 7);
  await db.exec(`update bookings set status = 'attended' where id = 'bk_3'`);
  await assert.rejects(book('bk_4', 'acc_1', 7), /unique|duplicate/i);
});

test('bike numbers outside 1 to 20 are refused', async () => {
  await assert.rejects(book('bk_5', 'acc_1', 21), /check/i);
  await assert.rejects(book('bk_6', 'acc_1', 0), /check/i);
});

test('a waiver is signed once per account, and needs an account or a booking', async () => {
  await db.exec(`insert into waiver_texts (version, body) values (1, 'x')`);
  await db.exec(`insert into waivers (id, account_id, name, version) values ('wv_1', 'acc_1', 'A', 1)`);
  await assert.rejects(db.exec(`insert into waivers (id, account_id, name, version) values ('wv_2', 'acc_1', 'A', 1)`), /unique/i);
  await assert.rejects(db.exec(`insert into waivers (id, name, version) values ('wv_3', 'G', 1)`), /check/i);
});

test('emails are unique whatever the case', async () => {
  await assert.rejects(db.exec(`insert into accounts (id, name, email) values ('acc_3', 'C', 'A@EXAMPLE.com')`), /unique/i);
});

test('the settings table holds exactly one row', async () => {
  assert.equal((await db.query('select count(*)::int as n from settings')).rows[0].n, 1);
  await assert.rejects(db.exec(`insert into settings (id) values (false)`), /check/i);
});
