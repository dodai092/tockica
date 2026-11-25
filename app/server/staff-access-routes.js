// The owner's staff management (ADR 0004, plan 2026-11-25-staff-access). The owner never sees or sets a password: a new
// row waits (no Supabase user id) until the person opens the mailed link. Rows are switched off, never deleted.
import { randomBytes } from 'node:crypto';
import { AuthError } from './auth.js';
import { sendStaffLinkIfAllowed } from './staff-password-routes.js';

const ROLES = ['owner', 'reception', 'instructor'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const json = (body, status = 200) => Response.json(body, { status });
const readJson = async (req) => (await req.json().catch(() => null)) ?? {};
const post = (handler) => (req, session) => (req.method === 'POST' ? handler(req, session) : json({ error: 'Use POST' }, 405));
const byId = async (db, id) => (await db.query('select id, email, role, active, instructor_id from staff where id = $1', [String(id ?? '')])).rows[0];
const NOT_FOUND = { error: 'No such person' };

const profileError = async (db, role, instructorId) => {
  if (!instructorId) return role === 'instructor' ? 'required' : null;
  return (await db.query('select 1 from instructors where id = $1', [instructorId])).rows.length ? null : 'invalid';
};

/** True when the mail was handed to Supabase. False when it was not: switched off, over the limit, or Supabase failed. */
const mailLink = async (args) => {
  try {
    return await sendStaffLinkIfAllowed(args);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    console.error('staff link not sent:', e.code);
    return false;
  }
};

/** GET lists everyone, POST adds a person and mails them the link. */
export const staffAccessHandler = ({ db, auth, now = () => new Date(), siteUrl }) => async (req, session) => {
  if (req.method === 'GET') {
    const people = (await db.query('select id, name, email, role, instructor_id, active, supabase_user_id from staff order by lower(name), id')).rows;
    const instructors = (await db.query('select id, full_name from instructors order by full_name')).rows;
    return json({
      people: people.map((p) => ({
        id: p.id, name: p.name, email: p.email, role: p.role, instructorId: p.instructor_id,
        status: !p.active ? 'off' : p.supabase_user_id ? 'active' : 'waiting',
        self: p.id === session.staffId,
      })),
      instructors: instructors.map((i) => ({ id: i.id, name: i.full_name })),
    });
  }
  if (req.method !== 'POST') return json({ error: 'Use GET or POST' }, 405);
  if (!auth) return json({ error: 'Not available right now' }, 503);

  const body = await readJson(req);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const instructorId = body.instructorId || null;
  const fields = {};
  if (!name) fields.name = 'required';
  if (!EMAIL.test(email)) fields.email = 'invalid';
  if (!ROLES.includes(body.role)) fields.role = 'invalid';
  const profile = await profileError(db, body.role, instructorId);
  if (profile) fields.instructorId = profile;
  if (Object.keys(fields).length) return json({ fields }, 400);

  const id = `staff-${randomBytes(4).toString('hex')}`;
  // The unique index on lower(email) decides, so two adds at the same moment cannot both get in.
  const added = await db.query(
    'insert into staff (id, name, email, role, active, instructor_id) values ($1, $2, $3, $4, true, $5) on conflict ((lower(email))) do nothing returning id',
    [id, name, email, body.role, instructorId]
  );
  if (!added.rows.length) return json({ error: 'This email is already on the list' }, 409);
  return json({ id, mailSent: await mailLink({ db, auth, email, origin: siteUrl || new URL(req.url).origin, now: now() }) }, 201);
};

/** Changes role, instructor profile or the active flag. Fields that are not sent stay as they are. */
export const staffAccessEditHandler = ({ db }) =>
  post(async (req, session) => {
    const body = await readJson(req);
    const person = await byId(db, body.id);
    if (!person) return json(NOT_FOUND, 404);
    const role = body.role === undefined ? person.role : body.role;
    const instructorId = body.instructorId === undefined ? person.instructor_id : body.instructorId || null;
    const active = body.active === undefined ? person.active : body.active;
    if (body.role !== undefined && !ROLES.includes(body.role)) return json({ fields: { role: 'invalid' } }, 400);
    if (typeof active !== 'boolean') return json({ fields: { active: 'invalid' } }, 400);
    // This also means there is always one owner left: the one who is asking.
    if (person.id === session.staffId && (!active || role !== person.role)) return json({ error: 'You cannot switch off or change the role of your own account' }, 409);
    if (body.role !== undefined || body.instructorId !== undefined) {
      const profile = await profileError(db, role, instructorId);
      if (profile) return json({ fields: { instructorId: profile } }, 400);
    }
    await db.query('update staff set role = $2, instructor_id = $3, active = $4 where id = $1', [person.id, role, instructorId, active]);
    if (!active) await db.query('delete from staff_sessions where staff_id = $1', [person.id]);
    return json({ ok: true });
  });

/** Sends the password link again. */
export const staffAccessLinkHandler = ({ db, auth, now = () => new Date(), siteUrl }) =>
  post(async (req) => {
    const person = await byId(db, (await readJson(req)).id);
    if (!person) return json(NOT_FOUND, 404);
    return json({ mailSent: await mailLink({ db, auth, email: person.email, origin: siteUrl || new URL(req.url).origin, now: now() }) }, 202);
  });
