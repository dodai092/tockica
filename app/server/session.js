// Customer sessions (plan Task 4). The Node app owns the cookie and its expiry, not Supabase. Valid 30 days from the
// last visit, pushed out another 30 on every visit that slides, never past 180 days from the start.
// Every time is passed in, so tests can move the clock. Staff get their own cookie and table later (ADR 0004).
import { createHash, randomBytes } from 'node:crypto';

export const COOKIE_NAME = 'tockica_session';
const DAY = 864e5;
const SLIDE_DAYS = 30;
const CAP_DAYS = 180;

const hash = (token) => createHash('sha256').update(token).digest('hex');
const endFor = (createdAt, now) => new Date(Math.min(now.getTime() + SLIDE_DAYS * DAY, new Date(createdAt).getTime() + CAP_DAYS * DAY));
const cookieFor = (token, expiresAt, now) =>
  `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))}`;

export const sessionToken = (req) => {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
};

export async function createSession(db, accountId, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = endFor(now, now);
  await db.query(
    'insert into sessions (token_hash, account_id, created_at, last_seen_at, expires_at) values ($1, $2, $3, $3, $4)',
    [hash(token), accountId, now.toISOString(), expiresAt.toISOString()]
  );
  return { token, cookie: cookieFor(token, expiresAt, now) };
}

/** Returns { kind: 'customer', accountId, cookie } or null. `cookie` is set only when the visit slid the session. */
export async function getCustomerSession(db, req, now = new Date(), { slide = true } = {}) {
  const token = sessionToken(req);
  if (!token) return null;
  const h = hash(token);
  const row = (await db.query('select account_id, created_at, expires_at from sessions where token_hash = $1', [h])).rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    await db.query('delete from sessions where token_hash = $1', [h]);
    return null;
  }
  const session = { kind: 'customer', accountId: row.account_id };
  if (!slide) return session;
  const expiresAt = endFor(row.created_at, now);
  await db.query('update sessions set last_seen_at = $2, expires_at = $3 where token_hash = $1', [h, now.toISOString(), expiresAt.toISOString()]);
  return { ...session, cookie: cookieFor(token, expiresAt, now) };
}

export async function endSession(db, token, now = new Date()) {
  await db.query('delete from sessions where token_hash = $1', [hash(token)]);
  return { cookie: cookieFor('', now, now) };
}

/** Ends every session of an account, for example after a password reset. */
export async function endAllSessions(db, accountId) {
  await db.query('delete from sessions where account_id = $1', [accountId]);
}
