// Staff sessions (ADR 0004): the person is the Staff table, not the customer accounts table, and the cookie is separate from
// the customer one. A session lasts 12 hours idle, 7 days at most. Only a sha256 hash is stored. The role and the active flag are read from the staff
// row on every request, so deactivating someone or changing a role applies at once. Every time is passed in.
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'tockica_staff';
const IDLE_HOURS = 12;
const CAP_DAYS = 7;

const hash = (token) => createHash('sha256').update(token).digest('hex');
const cookieValue = (req, name) => {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [n, ...rest] = part.trim().split('=');
    if (n === name) return rest.join('=');
  }
  return null;
};
const cookie = (name, value, path, seconds) => `${name}=${value}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(seconds))}`;
const sessionEnd = (createdAt, now) => new Date(Math.min(now.getTime() + IDLE_HOURS * 3600e3, new Date(createdAt).getTime() + CAP_DAYS * 864e5));

export async function createStaffSession(db, staffId, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const end = sessionEnd(now, now);
  await db.query('insert into staff_sessions (token_hash, staff_id, created_at, last_seen_at, expires_at) values ($1, $2, $3, $3, $4)', [hash(token), staffId, now.toISOString(), end.toISOString()]);
  return { cookie: cookie(SESSION_COOKIE, token, '/api', (end.getTime() - now.getTime()) / 1000) };
}

/** { kind: 'staff', staffId, role, cookie } or null. `cookie` re-sends the slid expiry. A left member has no session. */
export async function getStaffSession(db, req, now = new Date()) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return null;
  const h = hash(token);
  const row = (await db.query(
    `select s.created_at, s.expires_at, t.id as staff_id, t.role, t.active
       from staff_sessions s join staff t on t.id = s.staff_id where s.token_hash = $1`, [h]
  )).rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime() || !row.active) {
    await db.query('delete from staff_sessions where token_hash = $1', [h]);
    return null;
  }
  const end = sessionEnd(row.created_at, now);
  await db.query('update staff_sessions set last_seen_at = $2, expires_at = $3 where token_hash = $1', [h, now.toISOString(), end.toISOString()]);
  return { kind: 'staff', staffId: row.staff_id, role: row.role, cookie: cookie(SESSION_COOKIE, token, '/api', (end.getTime() - now.getTime()) / 1000) };
}

export async function endStaffSession(db, req) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (token) await db.query('delete from staff_sessions where token_hash = $1', [hash(token)]);
  return { cookie: cookie(SESSION_COOKIE, '', '/api', 0) };
}
