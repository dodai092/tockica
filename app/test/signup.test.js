// Signup (plan Task 4b, update 2026-11-17 section 2.2): first name, last name, email, birth date, terms tick.
// No phone. The email is proven by the login layer before this runs, so it is not checked against a provider here.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openTestDb } from './db.js';
import { signUp, SignupError, DuplicateEmailError } from '../server/signup.js';

let db;

before(async () => {
  db = await openTestDb();
  const dir = new URL('../server/db/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
});
after(() => db.close());
beforeEach(() => db.exec('delete from accounts'));

const valid = { firstName: 'Ana', lastName: 'Horvat', email: 'ana@example.com', birthDate: '1990-05-17', acceptedTerms: true };
const early = new Date('2026-12-01T10:00:00Z');
const row = async () => (await db.query('select *, birth_date::text as birth_date_text from accounts')).rows[0];
const fieldsOf = async (input, now = early) => {
  try {
    await signUp(db, input, now);
  } catch (e) {
    if (e instanceof SignupError) return e.fields;
    throw e;
  }
  assert.fail('expected SignupError');
};

test('a signup stores the profile, the terms version and date, and no marketing consent', async () => {
  const account = await signUp(db, valid, early);
  const r = await row();
  assert.equal(account.id, r.id);
  assert.match(r.id, /^acc_/);
  assert.deepEqual(
    [r.first_name, r.last_name, r.name, r.email, r.birth_date_text],
    ['Ana', 'Horvat', 'Ana Horvat', 'ana@example.com', '1990-05-17']
  );
  assert.equal(r.terms_version, 1);
  assert.equal(new Date(r.terms_accepted_at).toISOString(), early.toISOString());
  assert.equal(r.marketing_opt_in, false);
  assert.equal(r.marketing_opt_in_at, null);
  assert.equal(r.phone, null);
});

test('marketing is a separate tick and records when it was given', async () => {
  await signUp(db, { ...valid, marketingOptIn: true }, early);
  const r = await row();
  assert.equal(r.marketing_opt_in, true);
  assert.equal(new Date(r.marketing_opt_in_at).toISOString(), early.toISOString());
});

test('a second signup with the same email in any case is refused and leaves one account', async () => {
  await signUp(db, valid, early);
  await assert.rejects(signUp(db, { ...valid, email: 'ANA@Example.com', firstName: 'Other' }, early), DuplicateEmailError);
  assert.equal((await db.query('select count(*)::int as n from accounts')).rows[0].n, 1);
});

test('joining the waitlist counts until the end of 31 December, studio time', async () => {
  await signUp(db, valid, new Date('2026-12-31T22:30:00Z')); // 23:30 in Zagreb
  assert.notEqual((await row()).waitlist_joined_at, null);
  await db.exec('delete from accounts');
  await signUp(db, valid, new Date('2026-12-31T23:30:00Z')); // 00:30 on 1 January in Zagreb
  assert.equal((await row()).waitlist_joined_at, null);
});

test('missing or bad fields are named, and nothing is saved', async () => {
  assert.deepEqual(await fieldsOf({ ...valid, firstName: '  ', lastName: '' }), { firstName: 'required', lastName: 'required' });
  assert.deepEqual(await fieldsOf({ ...valid, email: 'not-an-email' }), { email: 'invalid' });
  assert.deepEqual(await fieldsOf({ ...valid, acceptedTerms: false }), { acceptedTerms: 'required' });
  assert.deepEqual(await fieldsOf({ ...valid, birthDate: '' }), { birthDate: 'required' });
  assert.equal((await db.query('select count(*)::int as n from accounts')).rows[0].n, 0);
});

test('a birth date must be a real day in the past', async () => {
  assert.deepEqual(await fieldsOf({ ...valid, birthDate: '1990-02-31' }), { birthDate: 'invalid' });
  assert.deepEqual(await fieldsOf({ ...valid, birthDate: '17.05.1990' }), { birthDate: 'invalid' });
  assert.deepEqual(await fieldsOf({ ...valid, birthDate: '1899-12-31' }), { birthDate: 'invalid' });
  assert.deepEqual(await fieldsOf({ ...valid, birthDate: '2026-12-02' }), { birthDate: 'invalid' });
  await signUp(db, { ...valid, birthDate: '2026-12-01' }, early); // today is fine, the form has no age rule yet
});

test('names and email are trimmed', async () => {
  await signUp(db, { ...valid, firstName: ' Ana ', lastName: ' Horvat', email: ' ana@example.com ' }, early);
  const r = await row();
  assert.deepEqual([r.first_name, r.last_name, r.email], ['Ana', 'Horvat', 'ana@example.com']);
});
