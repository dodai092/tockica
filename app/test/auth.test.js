// The Supabase client (server/auth.js): the requests it sends. Only the publishable key is ever used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAuth, AuthError } from '../server/auth.js';

const make = (responses) => {
  const sent = [];
  const fetchFn = async (url, init) => {
    sent.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const r = responses.shift();
    return { status: r.status, json: async () => r.body ?? {} };
  };
  return { sent, auth: createSupabaseAuth({ url: 'https://p.supabase.co/', anonKey: 'sb_publishable_x', fetchFn }) };
};

test('sendLink asks Supabase to mail the sign-in link and may create the user', async () => {
  const { sent, auth } = make([{ status: 200 }]);
  await auth.sendLink('ana@example.com');
  assert.equal(sent[0].url, 'https://p.supabase.co/auth/v1/otp');
  assert.deepEqual(sent[0].body, { email: 'ana@example.com', create_user: true });
  assert.equal(sent[0].headers.apikey, 'sb_publishable_x');
});

test('sendLink turns a rate limit or an outage into an unavailable error', async () => {
  for (const status of [429, 500]) {
    const { auth } = make([{ status }]);
    await assert.rejects(() => auth.sendLink('a@example.com'), (e) => e instanceof AuthError && e.code === 'unavailable');
  }
});

test('userFromToken asks Supabase who the token belongs to, and a bad token is invalid_token', async () => {
  const ok = make([{ status: 200, body: { id: 'u1', email: 'Ana@Example.com' } }]);
  assert.deepEqual(await ok.auth.userFromToken('tok'), { userId: 'u1', email: 'ana@example.com' });
  assert.equal(ok.sent[0].method, 'GET');
  assert.equal(ok.sent[0].url, 'https://p.supabase.co/auth/v1/user');
  assert.equal(ok.sent[0].headers.authorization, 'Bearer tok');
  const bad = make([{ status: 401, body: { error_code: 'bad_jwt' } }]);
  await assert.rejects(() => bad.auth.userFromToken('nope'), (e) => e.code === 'invalid_token');
  await assert.rejects(() => make([{ status: 503 }]).auth.userFromToken('x'), (e) => e.code === 'unavailable');
});

test('setPassword updates the user with their own access token, not a server key', async () => {
  const { sent, auth } = make([{ status: 200 }]);
  await auth.setPassword('tok', 'a-long-password');
  assert.equal(sent[0].method, 'PUT');
  assert.equal(sent[0].url, 'https://p.supabase.co/auth/v1/user');
  assert.equal(sent[0].headers.authorization, 'Bearer tok');
  assert.equal(sent[0].headers.apikey, 'sb_publishable_x');
  assert.deepEqual(sent[0].body, { password: 'a-long-password' });
});

test('setPassword reports a password Supabase finds too weak', async () => {
  const { auth } = make([{ status: 422, body: { error_code: 'weak_password' } }]);
  await assert.rejects(() => auth.setPassword('tok', 'aaaaaaaa'), (e) => e.code === 'weak_password');
});

test('sendResetLink asks Supabase to recover the account and never creates a user', async () => {
  const { sent, auth } = make([{ status: 200 }]);
  await auth.sendResetLink('ana@example.com');
  assert.equal(sent[0].url, 'https://p.supabase.co/auth/v1/recover');
  assert.deepEqual(sent[0].body, { email: 'ana@example.com' });
  assert.equal(sent[0].headers.apikey, 'sb_publishable_x');
  for (const status of [429, 500]) {
    await assert.rejects(() => make([{ status }]).auth.sendResetLink('a@example.com'), (e) => e instanceof AuthError && e.code === 'unavailable');
  }
});

test('sendStaffLink mails a sign-in link that comes back to the given page, and may create the user', async () => {
  const { sent, auth } = make([{ status: 200 }]);
  await auth.sendStaffLink('dora@example.com', 'https://studio.test/osoblje');
  assert.equal(sent[0].url, 'https://p.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Fstudio.test%2Fosoblje');
  assert.deepEqual(sent[0].body, { email: 'dora@example.com', create_user: true });
  for (const status of [429, 500]) {
    await assert.rejects(() => make([{ status }]).auth.sendStaffLink('a@example.com', 'https://x.test/osoblje'), (e) => e.code === 'unavailable');
  }
});
