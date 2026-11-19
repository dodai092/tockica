// Staff login routes (ADR 0004). Thin, like auth-routes.js: Supabase checks the password, the staff table says who may come in,
// server/staff-session.js holds the session and its cookie. There is no second step for now (ADR 0004 update 2026-11-19).
// The login route is open (it is how you get in), so it sits outside /api/osoblje/, where the guard allows only staff routes.
import { AuthError } from './auth.js';
import { isBlocked, recordAttempt, clearAttempts, TOO_MANY } from './throttle.js';
import { createStaffSession, endStaffSession } from './staff-session.js';

const json = (body, status = 200, cookies = []) => {
  const headers = new Headers();
  for (const c of cookies) headers.append('set-cookie', c);
  return Response.json(body, { status, headers });
};
const readJson = (req) => req.json().catch(() => ({}));
const post = (handler) => (req, session) => (req.method === 'POST' ? handler(req, session) : json({ error: 'Use POST' }, 405));
const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
// One answer for every reason a login fails, so it does not say who works here.
const WRONG = { error: 'Wrong email or password' };
const LATER = { error: 'Not available right now, try again later' };

/** Password. Only an active staff member, matched by the Supabase user id, gets a session. */
export const staffLoginHandler = ({ db, auth, now = () => new Date() }) =>
  post(async (req) => {
    const body = await readJson(req);
    const email = lower(body.email);
    if (!email || typeof body.password !== 'string' || !body.password) return json(WRONG, 401);
    if (await isBlocked(db, 'staff-login', email, now())) return json(TOO_MANY, 429);
    let user;
    try {
      user = await auth.signIn(email, body.password);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      if (e.code === 'unavailable') return json(LATER, 503);
      await recordAttempt(db, 'staff-login', email, now());
      return json(WRONG, 401);
    }
    const staff = (await db.query('select id from staff where supabase_user_id = $1 and active', [user.userId])).rows[0];
    if (!staff) {
      await recordAttempt(db, 'staff-login', email, now());
      return json(WRONG, 401);
    }
    await clearAttempts(db, 'staff-login', email);
    const { cookie } = await createStaffSession(db, staff.id, now());
    return json({ ok: true }, 200, [cookie]);
  });

export const staffLogoutHandler = ({ db }) =>
  post(async (req) => json({ ok: true }, 200, [(await endStaffSession(db, req)).cookie]));

export const staffMeHandler = ({ db }) => async (_req, session) => {
  const s = (await db.query('select name, email, role from staff where id = $1', [session.staffId])).rows[0];
  return json({ name: s.name, email: s.email, role: s.role });
};
