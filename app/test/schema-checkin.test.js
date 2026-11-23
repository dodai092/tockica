// Migration 011 (plan 2026-11-21-reception-check-in.md): a staff login can point at an instructor, so a trainer sees
// only their own classes, and a staff_log row says which staff member made the change.
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
    insert into instructors (id, first_name, full_name, slug) values ('ins_1', 'Mirna', 'Mirna Zebec', 'mirna');
    insert into staff (id, name, email, role) values ('st_desk', 'Desk', 'desk@studio.test', 'reception');
  `);
});
after(() => db.close());

test('a staff member can be linked to an instructor, and only to one that exists', async () => {
  await db.exec(`insert into staff (id, name, email, role, instructor_id) values ('st_mirna', 'Mirna', 'mirna@studio.test', 'instructor', 'ins_1')`);
  assert.equal((await db.query(`select instructor_id from staff where id = 'st_mirna'`)).rows[0].instructor_id, 'ins_1');
  await assert.rejects(
    db.exec(`insert into staff (id, name, email, role, instructor_id) values ('st_x', 'X', 'x@studio.test', 'instructor', 'ins_nope')`),
    /foreign key/i,
  );
});

test('a staff member without an instructor link stays valid', async () => {
  assert.equal((await db.query(`select instructor_id from staff where id = 'st_desk'`)).rows[0].instructor_id, null);
});

test('a staff log row records who made the change, and only a real staff member', async () => {
  await db.exec(`insert into staff_log (type, booking_id, detail, staff_id) values ('check_in', 'bk_1', 'booked to attended', 'st_desk')`);
  assert.equal((await db.query(`select staff_id from staff_log where booking_id = 'bk_1'`)).rows[0].staff_id, 'st_desk');
  await assert.rejects(db.exec(`insert into staff_log (type, staff_id) values ('check_in', 'st_nope')`), /foreign key/i);
});
