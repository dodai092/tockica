// Limits per email address, counted in the database so every server instance sees the same numbers (plan item B8).
// Password kinds count wrong passwords only. Mail kinds count every request. Per-address only: behind the site's proxy the
// real visitor IP is not known yet, and a wrong guess would block everyone behind one address. Every time is passed in.
import { createHash } from 'node:crypto';

export const LIMITS = {
  login: { max: 5, minutes: 15 },
  'staff-login': { max: 5, minutes: 15 },
  'signup-mail': { max: 3, minutes: 60 },
  'reset-mail': { max: 3, minutes: 60 },
  'staff-mail': { max: 3, minutes: 60 },
};
export const TOO_MANY = { error: 'Too many attempts, try again later' };
const KEEP_HOURS = 24;

const keyOf = (email) => createHash('sha256').update(String(email ?? '').trim().toLowerCase()).digest('hex');
const ago = (now, minutes) => new Date(new Date(now).getTime() - minutes * 60000).toISOString();

/** True when this address has used up the kind's attempts inside its window. */
export async function isBlocked(db, kind, email, now) {
  const { max, minutes } = LIMITS[kind];
  const row = (await db.query('select count(*)::int c from auth_attempts where kind = $1 and key = $2 and at > $3', [kind, keyOf(email), ago(now, minutes)])).rows[0];
  return row.c >= max;
}

export async function recordAttempt(db, kind, email, now) {
  await db.query('insert into auth_attempts (kind, key, at) values ($1, $2, $3)', [kind, keyOf(email), new Date(now).toISOString()]);
  await db.query('delete from auth_attempts where at < $1', [ago(now, KEEP_HOURS * 60)]);
}

/** A successful login forgets the wrong passwords before it. */
export async function clearAttempts(db, kind, email) {
  await db.query('delete from auth_attempts where kind = $1 and key = $2', [kind, keyOf(email)]);
}
