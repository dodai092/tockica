// Supabase Auth admin API, with the service key. Only the staff command line (scripts/staff.js) uses this, the server
// that answers requests never loads it, so the service key does not live in the request path. No mail is sent: the admin
// API makes a user already confirmed and sets a password directly.
import { StaffAdminError } from './staff-admin.js';

export function createSupabaseAdmin({ url, serviceKey, fetchFn = fetch }) {
  const base = url.replace(/\/$/, '') + '/auth/v1/admin/users';
  const call = async (path, method, body) => {
    const r = await fetchFn(base + path, {
      method,
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new StaffAdminError('supabase', `Supabase answered ${r.status}`);
    return r.json().catch(() => ({}));
  };
  return {
    async createUser(email, password) {
      const j = await call('', 'POST', { email, password, email_confirm: true });
      if (!j.id) throw new StaffAdminError('supabase', 'Supabase returned no user id');
      return { userId: j.id };
    },
    async setPassword(userId, password) {
      await call(`/${userId}`, 'PUT', { password });
    },
    async deleteUser(userId) {
      await call(`/${userId}`, 'DELETE');
    },
  };
}
