// Supabase Auth over its REST API (ADR 0007). Supabase proves the email with a mailed link and checks the password.
// The app starts its own session. Only the publishable key is used here, never a server key. Every method returns plain
// data, so tests can hand in a fake with the same shape.
export class AuthError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function createSupabaseAuth({ url, anonKey, fetchFn = fetch }) {
  const base = url.replace(/\/$/, '');
  const call = async (path, body, { method = 'POST', token } = {}) => {
    const headers = { apikey: anonKey, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
    const r = await fetchFn(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  };
  const down = (status) => status === 429 || status >= 500;

  return {
    /** Mails the sign-in link. Creates the Supabase user if the address is new. The answer is the same for any address. */
    async sendLink(email) {
      const { status } = await call('/auth/v1/otp', { email, create_user: true });
      if (down(status)) throw new AuthError('unavailable');
      if (status >= 400) throw new AuthError('link_not_sent');
    },
    /** Mails a staff member a sign-in link that comes back to redirectTo, where they set a password. */
    async sendStaffLink(email, redirectTo) {
      const { status } = await call(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, { email, create_user: true });
      if (down(status)) throw new AuthError('unavailable');
      if (status >= 400) throw new AuthError('link_not_sent');
    },
    /** Mails the password reset link. Never creates a user. The answer is the same for any address. */
    async sendResetLink(email) {
      const { status } = await call('/auth/v1/recover', { email });
      if (down(status)) throw new AuthError('unavailable');
      if (status >= 400) throw new AuthError('link_not_sent');
    },
    /** Who a token from the clicked link belongs to: { userId, email }. Throws invalid_token or unavailable. */
    async userFromToken(accessToken) {
      const { status, j } = await call('/auth/v1/user', undefined, { method: 'GET', token: accessToken });
      if (down(status)) throw new AuthError('unavailable');
      if (status !== 200 || !j.id) throw new AuthError('invalid_token');
      return { userId: j.id, email: String(j.email ?? '').toLowerCase() };
    },
    /** Sets the password of the user the access token belongs to. Throws weak_password or unavailable. */
    async setPassword(accessToken, password) {
      const { status, j } = await call('/auth/v1/user', { password }, { method: 'PUT', token: accessToken });
      if (down(status)) throw new AuthError('unavailable');
      if (status >= 400) throw new AuthError(j.error_code === 'weak_password' ? 'weak_password' : 'password_not_set');
    },
    /** Returns { userId, email }. Throws AuthError: invalid_credentials or unavailable. */
    async signIn(email, password) {
      const { status, j } = await call('/auth/v1/token?grant_type=password', { email, password });
      if (down(status)) throw new AuthError('unavailable');
      if (status !== 200) throw new AuthError('invalid_credentials');
      return { userId: j.user.id, email: j.user.email };
    },
  };
}
