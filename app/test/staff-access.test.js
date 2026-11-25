// The owner's staff routes (plan 2026-11-25-staff-access, Task 2): list, add, edit, switch off, send the link again.
// Fake Supabase, real router, PGlite.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { createRoute } from '../server/index.js';
import { AuthError } from '../server/auth.js';
import { createStaffSession } from '../server/staff-session.js';
import { createSession } from '../server/session.js';

let db, auth, clock;
const now = () => clock;
const BASE = '/api/osoblje/pristup';

before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec("insert into instructors (id, first_name, full_name, slug) values ('ins_ana', 'Ana', 'Ana Anic', 'ana'), ('ins_iva', 'Iva', 'Iva Ivic', 'iva')");
});
after(() => db.close());
beforeEach(async () => {
  clock = new Date('2027-01-11T08:00:00Z');
  const sent = [];
  auth = { sent, async sendStaffLink(email, redirectTo) { sent.push({ email, redirectTo }); } };
  await db.exec('delete from auth_attempts; delete from staff_sessions; delete from sessions; delete from accounts; delete from staff;');
  await db.exec(`insert into staff (id, supabase_user_id, name, email, role, active, instructor_id) values
    ('st_owner', 'sb_owner', 'Dunia Owner', 'owner@studio.test', 'owner', true, null),
    ('st_desk', 'sb_desk', 'Desk Person', 'desk@studio.test', 'reception', true, null),
    ('st_wait', null, 'Waiting Trainer', 'wait@studio.test', 'instructor', true, 'ins_ana'),
    ('st_off', 'sb_off', 'Left Studio', 'off@studio.test', 'reception', false, null)`);
});

const route = () => createRoute({ pool: () => db, auth, now });
const call = (path, { method = 'GET', body, cookie } = {}) =>
  route()(new Request(`https://app.example.test${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }));
const cookieFor = async (staffId) => (await createStaffSession(db, staffId, clock)).cookie.split(';')[0];
const snapshot = async () => (await db.query('select * from staff order by id')).rows;
const row = async (id) => (await db.query('select * from staff where id = $1', [id])).rows[0];
const owner = async () => {
  const cookie = await cookieFor('st_owner');
  return {
    list: () => call(BASE, { cookie }),
    add: (body) => call(BASE, { method: 'POST', body, cookie }),
    edit: (body) => call(`${BASE}/izmjena`, { method: 'POST', body, cookie }),
    link: (id) => call(`${BASE}/link`, { method: 'POST', body: { id }, cookie }),
  };
};
const NEW = { name: ' Dora Novak ', email: ' Dora@Studio.TEST ', role: 'instructor', instructorId: 'ins_iva' };

test('only the owner opens these routes, and a refused request changes nothing', async () => {
  await db.exec("insert into staff (id, supabase_user_id, name, email, role, active, instructor_id) values ('st_ins', 'sb_ins', 'Trainer', 'ins@studio.test', 'instructor', true, 'ins_iva')");
  await db.exec("insert into accounts (id, name, first_name, last_name, email) values ('acc_1', 'Ana', 'Ana', 'A', 'ana@example.test')");
  const customer = (await createSession(db, 'acc_1', clock)).cookie.split(';')[0];
  const who = [[await cookieFor('st_desk'), 403], [await cookieFor('st_ins'), 403], [customer, 401], [undefined, 401]];
  const requests = [
    [BASE, {}],
    [BASE, { method: 'POST', body: NEW }],
    [`${BASE}/izmjena`, { method: 'POST', body: { id: 'st_wait', active: false } }],
    [`${BASE}/link`, { method: 'POST', body: { id: 'st_wait' } }],
  ];
  const before = await snapshot();
  for (const [cookie, status] of who) {
    for (const [path, opts] of requests) assert.equal((await call(path, { ...opts, cookie })).status, status, `${path} ${status}`);
  }
  assert.deepEqual(await snapshot(), before);
  assert.equal(auth.sent.length, 0);
});

test('the list shows everyone with a status, marks the own row, and offers the instructor profiles', async () => {
  const res = await (await owner()).list();
  assert.equal(res.status, 200);
  const body = await res.json();
  const by = Object.fromEntries(body.people.map((p) => [p.id, p]));
  assert.deepEqual(by.st_wait, { id: 'st_wait', name: 'Waiting Trainer', email: 'wait@studio.test', role: 'instructor', instructorId: 'ins_ana', status: 'waiting', self: false });
  assert.deepEqual([by.st_owner.status, by.st_owner.self, by.st_desk.status, by.st_off.status], ['active', true, 'active', 'off']);
  assert.deepEqual(body.instructors, [{ id: 'ins_ana', name: 'Ana Anic' }, { id: 'ins_iva', name: 'Iva Ivic' }]);
});

test('adding a person makes a waiting row with a lower-case email and mails one link', async () => {
  const res = await (await owner()).add(NEW);
  assert.equal(res.status, 201);
  const { id, mailSent } = await res.json();
  assert.equal(mailSent, true);
  const r = await row(id);
  assert.deepEqual([r.name, r.email, r.role, r.instructor_id, r.supabase_user_id, r.active], ['Dora Novak', 'dora@studio.test', 'instructor', 'ins_iva', null, true]);
  assert.deepEqual(auth.sent, [{ email: 'dora@studio.test', redirectTo: 'https://app.example.test/osoblje' }]);
});

test('a duplicate email in any case is 409, and bad input is 400 with the field named', async () => {
  const o = await owner();
  const before = await snapshot();
  assert.equal((await o.add({ ...NEW, email: 'DESK@studio.test' })).status, 409);
  const bad = [
    [{ ...NEW, email: 'nope' }, 'email'],
    [{ ...NEW, name: '  ' }, 'name'],
    [{ ...NEW, role: 'admin' }, 'role'],
    [{ ...NEW, instructorId: 'ins_nobody' }, 'instructorId'],
    [{ ...NEW, instructorId: null }, 'instructorId'],
  ];
  for (const [body, field] of bad) {
    const res = await o.add(body);
    assert.equal(res.status, 400, field);
    assert.ok((await res.json()).fields[field], field);
  }
  assert.deepEqual(await snapshot(), before);
  assert.equal(auth.sent.length, 0);
});

test('other roles may be added without a profile', async () => {
  const o = await owner();
  assert.equal((await o.add({ name: 'Second Owner', email: 'two@studio.test', role: 'owner' })).status, 201);
  assert.equal((await o.add({ name: 'Desk Two', email: 'desk2@studio.test', role: 'reception', instructorId: '' })).status, 201);
});

test('when the mail fails the row stays and the answer says so, so the owner can send again', async () => {
  const o = await owner();
  auth.sendStaffLink = async () => { throw new AuthError('unavailable'); };
  const res = await o.add(NEW);
  assert.equal(res.status, 201);
  const { id, mailSent } = await res.json();
  assert.equal(mailSent, false);
  assert.ok(await row(id));
  const again = await o.link(id);
  assert.equal(again.status, 202);
  assert.deepEqual(await again.json(), { mailSent: false });
});

test('sending the link again mails the person, but not someone switched off, and an unknown id is 404', async () => {
  const o = await owner();
  const res = await o.link('st_wait');
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { mailSent: true });
  assert.deepEqual(await (await o.link('st_off')).json(), { mailSent: false });
  assert.deepEqual(auth.sent.map((s) => s.email), ['wait@studio.test']);
  assert.equal((await o.link('st_nobody')).status, 404);
});

test('switching off ends that person\'s sessions at once, and switching on brings the earlier status back', async () => {
  const o = await owner();
  await cookieFor('st_desk');
  assert.equal((await o.edit({ id: 'st_desk', active: false })).status, 200);
  assert.equal((await db.query("select count(*)::int n from staff_sessions where staff_id = 'st_desk'")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from staff_sessions where staff_id = 'st_owner'")).rows[0].n, 1);
  await o.edit({ id: 'st_wait', active: false });
  await o.edit({ id: 'st_wait', active: true });
  await o.edit({ id: 'st_desk', active: true });
  const people = (await (await o.list()).json()).people;
  assert.equal(people.find((p) => p.id === 'st_wait').status, 'waiting');
  assert.equal(people.find((p) => p.id === 'st_desk').status, 'active');
});

test('the owner cannot switch off or change the role of their own row', async () => {
  const o = await owner();
  const before = await snapshot();
  assert.equal((await o.edit({ id: 'st_owner', active: false })).status, 409);
  assert.equal((await o.edit({ id: 'st_owner', role: 'reception' })).status, 409);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await o.edit({ id: 'st_owner', instructorId: 'ins_ana' })).status, 200);
});

test('an edit changes role and profile, and refuses one that leaves a trainer without a profile', async () => {
  const o = await owner();
  assert.equal((await o.edit({ id: 'st_desk', role: 'instructor', instructorId: 'ins_iva' })).status, 200);
  assert.deepEqual([(await row('st_desk')).role, (await row('st_desk')).instructor_id], ['instructor', 'ins_iva']);
  const before = await snapshot();
  const bad = [
    [{ id: 'st_off', role: 'instructor' }, 'instructorId'],
    [{ id: 'st_wait', instructorId: null }, 'instructorId'],
    [{ id: 'st_wait', instructorId: 'ins_nobody' }, 'instructorId'],
    [{ id: 'st_off', role: 'admin' }, 'role'],
    [{ id: 'st_off', active: 'yes' }, 'active'],
  ];
  for (const [body, field] of bad) {
    const res = await o.edit(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok((await res.json()).fields[field], field);
  }
  assert.equal((await o.edit({ id: 'st_nobody', active: false })).status, 404);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await o.edit({ id: 'st_wait', role: 'reception', instructorId: null })).status, 200);
});

test('switching off a trainer row that was made without a profile still works', async () => {
  await db.exec("update staff set instructor_id = null where id = 'st_wait'");
  assert.equal((await (await owner()).edit({ id: 'st_wait', active: false })).status, 200);
});

test('adding and resending also use the set site address', async () => {
  const cookie = await cookieFor('st_owner');
  const app = createRoute({ pool: () => db, auth, now, siteUrl: 'https://www.studio.test' });
  const send = (path, body) => app(new Request(`https://other.example.test${path}`, { method: 'POST', headers: { cookie }, body: JSON.stringify(body) }));
  assert.equal((await send(BASE, NEW)).status, 201);
  assert.equal((await send(`${BASE}/link`, { id: 'st_wait' })).status, 202);
  assert.deepEqual(auth.sent.map((s) => s.redirectTo), ['https://www.studio.test/osoblje', 'https://www.studio.test/osoblje']);
});

test('without the Supabase settings the owner still sees the list, and adding says 503 and writes nothing', async () => {
  const cookie = await cookieFor('st_owner');
  const app = createRoute({ pool: () => db, auth: null, now });
  const req = (method, body) => app(new Request(`https://app.example.test${BASE}`, { method, headers: { cookie }, body: body && JSON.stringify(body) }));
  assert.equal((await req('GET')).status, 200);
  const before = await snapshot();
  assert.equal((await req('POST', NEW)).status, 503);
  assert.deepEqual(await snapshot(), before);
});
