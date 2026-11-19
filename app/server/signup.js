// Signup (plan Task 4b, update 2026-11-17 section 2.2). Creates the account row for a person the login layer has already
// proven owns the email. Fields: first name, last name, email, birth date, terms tick, marketing as its own tick. No phone.
// There is no minimum age yet: that is a question for Dunia's lawyer.
import { newId } from '../../prototype/src/model.js';
import { studioTime } from '../../prototype/src/time.js';
import { OFFER } from './offer.js';
import { claimLegacy } from './credits.js';

export class SignupError extends Error {
  constructor(fields) {
    super(`Invalid signup: ${Object.keys(fields).join(', ')}`);
    this.fields = fields;
  }
}
export class DuplicateEmailError extends Error {}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A real calendar day, written YYYY-MM-DD.
const isRealDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === s;
};

export function validateSignup(input, today) {
  const f = {};
  const first = (input.firstName ?? '').trim();
  const last = (input.lastName ?? '').trim();
  const email = (input.email ?? '').trim();
  const birth = (input.birthDate ?? '').trim();
  if (!first) f.firstName = 'required';
  if (!last) f.lastName = 'required';
  if (!email) f.email = 'required';
  else if (!EMAIL.test(email)) f.email = 'invalid';
  if (!birth) f.birthDate = 'required';
  else if (!isRealDay(birth) || birth < '1900-01-01' || birth > today) f.birthDate = 'invalid';
  if (input.acceptedTerms !== true) f.acceptedTerms = 'required';
  if (Object.keys(f).length) throw new SignupError(f);
  return { first, last, email, birth };
}

/** `db` is anything with query(sql, params) returning { rows }. Returns the new account row. */
export async function signUp(db, input, now = new Date()) {
  const today = studioTime.localDate(now.toISOString());
  const { first, last, email, birth } = validateSignup(input, today);
  const marketing = input.marketingOptIn === true;
  const joinedWaitlist = today <= OFFER.joinDeadline;
  const when = now.toISOString();
  let account;
  try {
    const { rows } = await db.query(
      `insert into accounts (id, supabase_user_id, name, first_name, last_name, email, birth_date,
         terms_accepted_at, terms_version, marketing_opt_in, marketing_opt_in_at, waitlist_joined_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, (select terms_version from settings), $9, $10, $11)
       returning *`,
      [newId('acc'), input.authUserId ?? null, `${first} ${last}`, first, last, email, birth, when, marketing, marketing ? when : null, joinedWaitlist ? when : null]
    );
    account = rows[0];
  } catch (e) {
    // Only the email index counts as a duplicate email. Another unique clash (the login id) is a different problem.
    if (/accounts_email_key/.test(`${e.constraint ?? ''} ${e.message}`)) throw new DuplicateEmailError(email);
    throw e;
  }
  // Classes the owner typed in for this email become the new account's credits. The account exists either way.
  await claimLegacy(db, account.id, now);
  return account;
}
