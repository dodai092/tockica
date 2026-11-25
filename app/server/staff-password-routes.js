// Staff set their own password through a mailed link (ADR 0004, plan 2026-11-25-staff-access). Nobody else ever sees a
// password. A staff row without a Supabase user id is a person waiting for one. Both routes are open (this is how you get
// in), so they sit outside /api/osoblje/. Only the publishable key is used.
import { AuthError } from './auth.js';
import { isBlocked, recordAttempt } from './throttle.js';
import { createStaffSession } from './staff-session.js';
import { endAllSessions } from './session.js';

const json = (body, status = 200, headers) => Response.json(body, { status, headers });
const readJson = (req) => req.json().catch(() => ({}));
const post = (handler) => (req, session) => (req.method === 'POST' ? handler(req, session) : json({ error: 'Use POST' }, 405));
const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LATER = { error: 'Not available right now, try again later' };

/** Mails the link only to an active staff address, at most 3 an hour. True when a mail was handed to Supabase. */
export async function sendStaffLinkIfAllowed({ db, auth, email, origin, now }) {
  const site = origin.replace(/\/$/, '');
  const mail = lower(email);
  if (await isBlocked(db, 'staff-mail', mail, now)) return false;
  await recordAttempt(db, 'staff-mail', mail, now);
  if (!(await db.query('select 1 from staff where lower(email) = $1 and active', [mail])).rows.length) return false;
  await auth.sendStaffLink(mail, `${site}/osoblje`);
  return true;
}

/**
 * The same answer for any address, so it does not show who works here. That includes a Supabase outage: only a staff
 * address causes a send, so an error here would only ever show up for staff.
 */
export const staffPasswordLinkHandler = ({ db, auth, now = () => new Date(), siteUrl }) =>
  post(async (req) => {
    const email = lower((await readJson(req)).email);
    if (!EMAIL.test(email)) return json({ fields: { email: 'invalid' } }, 400);
    try {
      await sendStaffLinkIfAllowed({ db, auth, email, origin: siteUrl || new URL(req.url).origin, now: now() });
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      console.error('staff link not sent:', e.code);
    }
    return json({ ok: true }, 202);
  });

/** The token from the clicked link and the new password. Every older session of the person ends, as staff and as a rider. */
export const staffPasswordHandler = ({ db, auth, now = () => new Date() }) =>
  post(async (req) => {
    const body = await readJson(req);
    const when = now();
    let proven;
    try {
      if (typeof body.accessToken !== 'string' || !body.accessToken) throw new AuthError('invalid_token');
      proven = await auth.userFromToken(body.accessToken);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      return e.code === 'unavailable' ? json(LATER, 503) : json({ error: 'This link is wrong or has expired, ask for a new one' }, 401);
    }
    if (typeof body.password !== 'string' || body.password.length < 8) return json({ fields: { password: 'too short' } }, 400);
    // A row already connected to a different login is refused: the address alone must not move a staff account.
    const staff = (await db.query(
      'select id from staff where lower(email) = $1 and active and (supabase_user_id is null or supabase_user_id = $2)',
      [lower(proven.email), proven.userId]
    )).rows[0];
    if (!staff) return json({ error: 'Not allowed' }, 403);
    try {
      await auth.setPassword(body.accessToken, body.password);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      return e.code === 'weak_password' ? json({ fields: { password: 'too weak' } }, 400) : json(LATER, 503);
    }
    await db.query('update staff set supabase_user_id = $2 where id = $1', [staff.id, proven.userId]);
    await db.query('delete from staff_sessions where staff_id = $1', [staff.id]);
    // The same login may be a rider's too, so whoever held the old password is signed out there as well.
    const rider = (await db.query('select id from accounts where supabase_user_id = $1', [proven.userId])).rows[0];
    if (rider) await endAllSessions(db, rider.id);
    const { cookie } = await createStaffSession(db, staff.id, when);
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  });
