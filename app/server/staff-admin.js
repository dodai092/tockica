// Making a staff member and resetting a staff password without SQL (ADR 0004). Run from the command line (scripts/staff.js)
// by someone with the service key, never from a web route: a mailed reset link would make the mailbox a second way in,
// and the Owner password is the only barrier today. The password is returned once, the caller decides where it goes.
import { randomBytes } from 'node:crypto';
import { STAFF_ROLES } from './guard.js';

export class StaffAdminError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

const newPassword = () => randomBytes(18).toString('base64url') + 'aA1!';
const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** Supabase user first (confirmed, no mail), then the staff row. If the row fails, the user is removed again. */
export async function createStaff({ db, admin, email, name, role }) {
  const mail = lower(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new StaffAdminError('bad_email');
  if (typeof name !== 'string' || !name.trim()) throw new StaffAdminError('bad_name');
  if (!STAFF_ROLES.includes(role)) throw new StaffAdminError('bad_role');
  if ((await db.query('select 1 from staff where lower(email) = $1', [mail])).rows.length) throw new StaffAdminError('exists');

  const password = newPassword();
  const { userId } = await admin.createUser(mail, password);
  const staffId = `staff-${randomBytes(4).toString('hex')}`;
  try {
    await db.query('insert into staff (id, supabase_user_id, name, email, role, active) values ($1, $2, $3, $4, $5, true)', [staffId, userId, name.trim(), mail, role]);
  } catch (e) {
    await admin.deleteUser(userId);
    throw e;
  }
  return { staffId, userId, password };
}

/** New password, and every open staff session of that person ends, so a stolen cookie stops working. */
export async function resetStaffPassword({ db, admin, email }) {
  const row = (await db.query('select id, supabase_user_id from staff where lower(email) = $1', [lower(email)])).rows[0];
  if (!row) throw new StaffAdminError('not_found');
  if (!row.supabase_user_id) throw new StaffAdminError('no_user');
  const password = newPassword();
  await admin.setPassword(row.supabase_user_id, password);
  await db.query('delete from staff_sessions where staff_id = $1', [row.id]);
  return { staffId: row.id, password };
}
