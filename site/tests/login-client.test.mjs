// The site's side of the booking app login (ADR 0007): the three calls it makes to /api on its own domain, and the small
// flag that tells it this browser has logged in, so a visitor who never did costs no request on page load.
import assert from 'node:assert/strict';
import test from 'node:test';
import { clearHint, fetchMe, hasHint, login, logout, setHint } from '../src/lib/login.ts';

const reply =
  (status, body = {}) =>
  async () => ({ status, json: async () => body });
const recorder = (status, body) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { status, json: async () => body ?? {} };
  };
  return { fn, calls };
};
const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('login posts the email and password as JSON to /api/login on the same origin', async () => {
  const { fn, calls } = recorder(200);
  const r = await login('ana@example.com', 'a-long-password', fn);
  assert.deepEqual(r, { ok: true });
  assert.equal(calls[0].url, '/api/login');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'ana@example.com', password: 'a-long-password' });
});

test('login names why it failed: wrong credentials, no account, or not available', async () => {
  assert.deepEqual(await login('a@b.hr', 'x', reply(401)), { ok: false, reason: 'credentials' });
  assert.deepEqual(await login('a@b.hr', 'x', reply(403)), { ok: false, reason: 'no-account' });
  assert.deepEqual(await login('a@b.hr', 'x', reply(503)), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await login('a@b.hr', 'x', reply(500)), { ok: false, reason: 'unavailable' });
  const down = async () => {
    throw new TypeError('network');
  };
  assert.deepEqual(await login('a@b.hr', 'x', down), { ok: false, reason: 'unavailable' });
});

test('fetchMe returns the account, null when signed out, and unknown when the app cannot be reached', async () => {
  const me = { firstName: 'Ana', lastName: 'Horvat', email: 'ana@example.com' };
  assert.deepEqual(await fetchMe(reply(200, me)), me);
  assert.equal(await fetchMe(reply(401)), null);
  assert.equal(await fetchMe(reply(503)), 'unknown');
  assert.equal(
    await fetchMe(async () => {
      throw new TypeError('network');
    }),
    'unknown'
  );
});

test('fetchMe sends the cookie with the request and only reads the three profile fields', async () => {
  const { fn, calls } = recorder(200, { firstName: 'Ana', lastName: 'Horvat', email: 'a@b.hr', secret: 'x' });
  const me = await fetchMe(fn);
  assert.equal(calls[0].url, '/api/me');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.deepEqual(Object.keys(me).sort(), ['email', 'firstName', 'lastName']);
});

test('logout posts to /api/logout and says whether the app confirmed it', async () => {
  const { fn, calls } = recorder(200);
  assert.equal(await logout(fn), true);
  assert.equal(calls[0].url, '/api/logout');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(await logout(reply(500)), false);
  assert.equal(
    await logout(async () => {
      throw new TypeError('network');
    }),
    false
  );
});

test('the hint is set, read and cleared, and a blocked storage never throws', () => {
  const s = memory();
  assert.equal(hasHint(s), false);
  setHint(s);
  assert.equal(hasHint(s), true);
  clearHint(s);
  assert.equal(hasHint(s), false);
  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  };
  assert.doesNotThrow(() => setHint(blocked));
  assert.equal(hasHint(blocked), false);
  assert.doesNotThrow(() => clearHint(blocked));
});

test('the hint holds no personal data', () => {
  const s = memory();
  setHint(s);
  const stored = [...['tockica.login-hint']].map((k) => s.getItem(k));
  assert.equal(stored[0], '1');
});
