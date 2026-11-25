// Signup, login, logout and "who am I" (ADR 0007, plan Task 4). Thin: Supabase proves the email and the password,
// server/signup.js holds the rules for the profile, server/session.js holds the cookie.
import { studioTime } from '../../prototype/src/time.js';
import { AuthError } from './auth.js';
import { signUp, validateSignup, SignupError, DuplicateEmailError } from './signup.js';
import { createSession, endSession, endAllSessions, sessionToken } from './session.js';
import { isBlocked, recordAttempt, clearAttempts, TOO_MANY } from './throttle.js';
import { endStaffSessionsOfUser } from './staff-session.js';

const json = (body, status = 200, headers) => Response.json(body, { status, headers });
const readJson = (req) => req.json().catch(() => ({}));
const post = (handler) => (req, session) => (req.method === 'POST' ? handler(req, session) : json({ error: 'Use POST' }, 405));
const WRONG = { error: 'Wrong email or password' };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

// Mails a link to the address. The answer is the same for any address, so it shows nothing about who has an account.
// Three mails an hour per address: over that the answer stays the same and nothing is sent, so nobody can fill a mailbox
// or use up the few mails Supabase's own sender allows.
const linkHandler = (kind, send) => ({ db, auth, now = () => new Date() }) =>
  post(async (req) => {
    const email = lower((await readJson(req)).email);
    if (!EMAIL.test(email)) return json({ fields: { email: 'invalid' } }, 400);
    if (await isBlocked(db, kind, email, now())) return json({ ok: true }, 202);
    await recordAttempt(db, kind, email, now());
    try {
      await send(auth, email);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      return json({ error: 'Not available right now, try again later' }, 503);
    }
    return json({ ok: true }, 202);
  });

/** Step 1 of signup: mail the sign-in link. */
export const signupLinkHandler = linkHandler('signup-mail', (auth, email) => auth.sendLink(email));

/** Step 1 of a password reset: mail the reset link. */
export const passwordLinkHandler = linkHandler('reset-mail', (auth, email) => auth.sendResetLink(email));

/**
 * Step 2: the form, the password and the token from the clicked link in one request. The token proves the email, and
 * only the person who has the mailbox gets it. An address that already has an account is refused before any password
 * is touched. Nothing was saved before this.
 */
export function signupHandler({ db, auth, now = () => new Date() }) {
  return post(async (req) => {
    const body = await readJson(req);
    const when = now();
    const unavailable = () => json({ error: 'Signup is not available right now, try again later' }, 503);

    let proven;
    try {
      if (typeof body.accessToken !== 'string' || !body.accessToken) throw new AuthError('invalid_token');
      proven = await auth.userFromToken(body.accessToken);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      return e.code === 'unavailable' ? unavailable() : json({ error: 'This link is wrong or has expired, ask for a new one' }, 401);
    }
    const email = lower(proven.email);

    const fields = {};
    try {
      validateSignup({ ...body, email }, studioTime.localDate(when.toISOString()));
    } catch (e) {
      if (!(e instanceof SignupError)) throw e;
      Object.assign(fields, e.fields);
    }
    if (typeof body.password !== 'string' || body.password.length < 8) fields.password = 'too short';
    if (Object.keys(fields).length) return json({ fields }, 400);

    const taken = (await db.query('select 1 from accounts where supabase_user_id = $1 or lower(email) = $2', [proven.userId, email])).rows[0];
    if (taken) return json({ error: 'This email already has an account, log in instead' }, 409);

    try {
      await auth.setPassword(body.accessToken, body.password);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      return e.code === 'weak_password' ? json({ fields: { password: 'too weak' } }, 400) : unavailable();
    }
    await endStaffSessionsOfUser(db, proven.userId);
    let account;
    try {
      account = await signUp(db, { ...body, email, authUserId: proven.userId }, when);
    } catch (e) {
      if (e instanceof DuplicateEmailError) return json({ error: 'This email already has an account, log in instead' }, 409);
      throw e;
    }
    const { cookie } = await createSession(db, account.id, when);
    return json({ ok: true }, 201, { 'set-cookie': cookie });
  });
}

export function loginHandler({ db, auth, now = () => new Date() }) {
  return post(async (req) => {
    const body = await readJson(req);
    const email = lower(body.email);
    if (!email || typeof body.password !== 'string' || !body.password) return json(WRONG, 401);
    // Checked before Supabase is asked, for any address, so a blocked address looks the same whether it has an account or not.
    if (await isBlocked(db, 'login', email, now())) return json(TOO_MANY, 429);
    let user;
    try {
      user = await auth.signIn(email, body.password);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      if (e.code === 'unavailable') return json({ error: 'Login is not available right now, try again later' }, 503);
      await recordAttempt(db, 'login', email, now());
      return json(WRONG, 401);
    }
    await clearAttempts(db, 'login', email);
    const account = (await db.query('select id from accounts where supabase_user_id = $1', [user.userId])).rows[0];
    if (!account) return json({ error: 'There is no account for this login' }, 403);
    const { cookie } = await createSession(db, account.id, now());
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  });
}

/**
 * Step 2 of a password reset: the token from the clicked link and the new password. Only a login that has an account can
 * reset. Every other session of the account ends, so a stolen session does not survive the reset, and the person is signed in.
 */
export function passwordResetHandler({ db, auth, now = () => new Date() }) {
  return post(async (req) => {
    const body = await readJson(req);
    const when = now();
    let proven;
    try {
      if (typeof body.accessToken !== 'string' || !body.accessToken) throw new AuthError('invalid_token');
      proven = await auth.userFromToken(body.accessToken);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      return e.code === 'unavailable'
        ? json({ error: 'Not available right now, try again later' }, 503)
        : json({ error: 'This link is wrong or has expired, ask for a new one' }, 401);
    }
    if (typeof body.password !== 'string' || body.password.length < 8) return json({ fields: { password: 'too short' } }, 400);
    const account = (await db.query('select id from accounts where supabase_user_id = $1', [proven.userId])).rows[0];
    if (!account) return json({ error: 'There is no account for this login' }, 403);
    try {
      await auth.setPassword(body.accessToken, body.password);
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      return e.code === 'weak_password'
        ? json({ fields: { password: 'too weak' } }, 400)
        : json({ error: 'Not available right now, try again later' }, 503);
    }
    await endStaffSessionsOfUser(db, proven.userId);
    await endAllSessions(db, account.id);
    const { cookie } = await createSession(db, account.id, when);
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  });
}

export function logoutHandler({ db, now = () => new Date() }) {
  return post(async (req) => {
    const token = sessionToken(req);
    const { cookie } = token ? await endSession(db, token, now()) : { cookie: undefined };
    return json({ ok: true }, 200, cookie ? { 'set-cookie': cookie } : undefined);
  });
}

export function meHandler({ db }) {
  return async (_req, session) => {
    const a = (await db.query('select first_name, last_name, email from accounts where id = $1', [session.accountId])).rows[0];
    return json({ firstName: a.first_name, lastName: a.last_name, email: a.email });
  };
}
