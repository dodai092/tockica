// The public schedule feed (plan Task 5). The website reads it in the visitor's browser, so it must hold classes and bike
// numbers only: first names of instructors, never who booked what. Same path and shape as the site's mock
// (site/src/pages/api/schedule.json.ts, site/src/lib/schedule-feed.ts), so the proxy can swap one for the other.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { scheduleHandler } from '../server/public.js';
import { parseSchedule } from '../../site/src/lib/schedule-feed.ts';

let db;
const now = new Date('2027-01-11T08:00:00Z');
const feed = async (query = '') => {
  const res = await scheduleHandler({ db, now: () => now })(new Request(`https://app.example.test/api/schedule.json${query}`));
  return { res, body: await res.clone().json(), text: await res.text() };
};

before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec(`
    insert into accounts (id, name, email, first_name, last_name) values
      ('acc_1', 'Ana Horvat', 'ana.private@example.com', 'Ana', 'Horvat'), ('acc_2', 'Iva Kovac', 'iva.private@example.com', 'Iva', 'Kovac');
    insert into instructors (id, first_name, full_name, slug) values
      ('ins_1', 'Mirna', 'Mirna Zebec', 'mirna'), ('ins_2', 'Emma', 'Emma Stepinac', 'emma');
    insert into classes (id, name, instructor_id, actual_instructor_id, theme_name, starts_at, release_opens_at, bike_count, cancelled) values
      ('cls_b', 'Riders', 'ins_1', null, ' Britney Spears ', '2027-01-13T17:30:00Z', '2026-12-30T09:00:00Z', 20, false),
      ('cls_a', 'Riders', 'ins_1', 'ins_2', null, '2027-01-12T17:30:00Z', '2026-12-29T09:00:00Z', 20, false),
      ('cls_past', 'Riders', 'ins_1', null, null, '2027-01-10T17:30:00Z', '2026-12-27T09:00:00Z', 20, false),
      ('cls_off', 'Riders', 'ins_1', null, null, '2027-01-14T17:30:00Z', '2026-12-31T09:00:00Z', 20, true);
    insert into bookings (id, class_id, bike_no, account_id, guest_name, status) values
      ('bk_1', 'cls_a', 7, 'acc_1', null, 'booked'),
      ('bk_2', 'cls_a', 3, 'acc_2', 'Secret Guest', 'booked'),
      ('bk_3', 'cls_a', 9, 'acc_2', null, 'late_cancel'),
      ('bk_4', 'cls_a', 12, 'acc_1', null, 'cancelled');
  `);
});
after(() => db.close());

test('upcoming classes only, in start order, a cancelled or past class left out', async () => {
  const { body } = await feed();
  assert.deepEqual(body.classes.map((c) => c.id), ['cls_a', 'cls_b']);
});

test('free bikes and taken bike numbers follow the bookings that hold a bike', async () => {
  const [a, b] = (await feed()).body.classes;
  assert.deepEqual(a.takenBikes, [3, 7]); // a late or plain cancel frees the bike
  assert.deepEqual([a.freeBikes, a.capacity], [18, 20]);
  assert.deepEqual([b.takenBikes, b.freeBikes], [[], 20]);
});

test('the instructor is the substitute when there is one, by first name, and the theme line is trimmed, and left out when empty', async () => {
  const [a, b] = (await feed()).body.classes;
  assert.equal(a.instructor, 'Emma');
  assert.equal(b.instructor, 'Mirna');
  assert.equal(b.themeName, 'Britney Spears');
  assert.equal('themeName' in a, false);
});

test('nothing about customers is in the response, not names, emails or guest names', async () => {
  const { text, body } = await feed();
  for (const secret of ['Horvat', 'Kovac', 'private@example', 'Secret Guest', 'acc_1', 'acc_2', 'Zebec', 'Stepinac']) {
    assert.equal(text.includes(secret), false, secret);
  }
  const allowed = ['id', 'startsAt', 'name', 'themeName', 'instructor', 'freeBikes', 'capacity', 'takenBikes'];
  for (const c of body.classes) for (const k of Object.keys(c)) assert.ok(allowed.includes(k), k);
  assert.equal(body.source, 'app');
});

test('it is cached for a few seconds and is JSON', async () => {
  const { res } = await feed();
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=10');
});

test('the limit is applied, and a silly one is kept within bounds', async () => {
  assert.equal((await feed('?limit=1')).body.classes.length, 1);
  assert.equal((await feed('?limit=-5')).body.classes.length, 1);
  assert.equal((await feed('?limit=abc')).body.classes.length, 2);
});

test('the website accepts every class the feed sends', async () => {
  const { body } = await feed();
  const parsed = parseSchedule(body, now, 100);
  assert.equal(parsed.classes.length, body.classes.length);
});
