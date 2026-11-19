// The guard is closed by default (plan Task 4, ADR 0004): a route does nothing for anyone until it is registered
// with who may open it, customers and staff are separate kinds of session, and a role is checked on the server.
// Sessions come from getSession(req). Until the login exists the tests hand in fake ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuardedRouter } from '../server/guard.js';

const sessions = {
  customer: { kind: 'customer', accountId: 'acc_1' },
  reception: { kind: 'staff', staffId: 'st_1', role: 'reception' },
  instructor: { kind: 'staff', staffId: 'st_2', role: 'instructor' },
  owner: { kind: 'staff', staffId: 'st_3', role: 'owner' },
};
const as = (who) => (req) => (who ? sessions[who] : null);
const get = (path) => new Request(`https://app.example.test${path}`);
const ok = () => Response.json({ ok: true });

function build(who) {
  const r = createGuardedRouter({ getSession: as(who) });
  r.open('/api/schedule', ok);
  r.customer('/api/moj-racun', ok);
  r.staff('/api/osoblje/recepcija', ['reception', 'owner'], ok);
  r.staff('/api/osoblje/vracanje-kredita', ['owner'], ok);
  r.staff('/api/osoblje/cijene', ['owner'], ok);
  r.staff('/api/osoblje/moji-treninzi', ['instructor', 'owner'], ok);
  return r;
}

test('an open route answers anyone, a signed-out visitor gets 401 on the rest', async () => {
  const r = build(null);
  assert.equal((await r.handle(get('/api/schedule'))).status, 200);
  assert.equal((await r.handle(get('/api/moj-racun'))).status, 401);
  assert.equal((await r.handle(get('/api/osoblje/recepcija'))).status, 401);
});

test('a customer gets 403 on every staff route', async () => {
  const r = build('customer');
  for (const route of r.routes.filter((x) => x.area === 'staff')) {
    assert.equal((await r.handle(get(route.path))).status, 403, route.path);
  }
  assert.equal((await r.handle(get('/api/moj-racun'))).status, 200);
});

test('reception gets 403 on credit restore and prices, owner gets through', async () => {
  const reception = build('reception');
  assert.equal((await reception.handle(get('/api/osoblje/vracanje-kredita'))).status, 403);
  assert.equal((await reception.handle(get('/api/osoblje/cijene'))).status, 403);
  assert.equal((await reception.handle(get('/api/osoblje/recepcija'))).status, 200);
  const owner = build('owner');
  assert.equal((await owner.handle(get('/api/osoblje/vracanje-kredita'))).status, 200);
  assert.equal((await owner.handle(get('/api/osoblje/cijene'))).status, 200);
});

test('an instructor opens only the routes that list the instructor role', async () => {
  const r = build('instructor');
  assert.equal((await r.handle(get('/api/osoblje/moji-treninzi'))).status, 200);
  assert.equal((await r.handle(get('/api/osoblje/recepcija'))).status, 403);
});

test('a staff session is not a customer: customer routes answer 403, the person needs a customer account', async () => {
  assert.equal((await build('owner').handle(get('/api/moj-racun'))).status, 403);
});

test('a path that was never registered is 404 for everyone, including the owner', async () => {
  assert.equal((await build('owner').handle(get('/api/osoblje/nova-stranica'))).status, 404);
});

test('a staff route cannot be registered without roles, outside /api/osoblje, or with an unknown role', () => {
  const r = createGuardedRouter({ getSession: as(null) });
  assert.throws(() => r.staff('/api/osoblje/x', [], ok), /at least one role/i);
  assert.throws(() => r.staff('/api/schedule', ['owner'], ok), /osoblje/i);
  assert.throws(() => r.staff('/api/osoblje/y', ['boss'], ok), /role/i);
  assert.throws(() => r.open('/api/osoblje/z', ok), /osoblje/i);
  assert.throws(() => r.customer('/api/osoblje/z', ok), /osoblje/i);
});
