// One entry point for every /api route. Handlers stay thin and hold no booking rules (those live in prototype/src).
// Every route goes through the guard: a path nobody registered is a 404. Open routes never look at the session,
// so the public feed and the login itself never slide it.
import { createGuardedRouter, STAFF_ROLES } from './guard.js';
import { getPool } from './db/pool.js';
import { createSupabaseAuth } from './auth.js';
import { getCustomerSession } from './session.js';
import { getStaffSession } from './staff-session.js';
import { staffLoginHandler, staffLogoutHandler, staffMeHandler } from './staff-routes.js';
import { handleHealth } from './health.js';
import { scheduleHandler } from './public.js';
import { signupLinkHandler, signupHandler, passwordLinkHandler, passwordResetHandler, loginHandler, logoutHandler, meHandler } from './auth-routes.js';

const envAuth = (env) => (env.SUPABASE_URL && env.SUPABASE_ANON_KEY ? createSupabaseAuth({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY }) : null);

export function createRoute({ pool = getPool, auth = envAuth(process.env), now } = {}) {
  const clock = now ?? (() => new Date());
  const getSession = async (req, route) => {
    const db = route.area === 'open' ? null : pool(process.env);
    if (!db) return null;
    // Customers and staff are separate accounts with separate cookies: a route only ever reads its own kind.
    return route.area === 'staff' ? getStaffSession(db, req, clock()) : getCustomerSession(db, req, clock());
  };
  const r = createGuardedRouter({ getSession });
  const unavailable = () => Response.json({ error: 'Not available right now' }, { status: 503 });
  // The guard hands a handler (req, session). `use` opens the database, and the login helper, for the handler it builds.
  const use = (build, { needsAuth = false } = {}) => (req, session) => {
    const db = pool(process.env);
    if (!db || (needsAuth && !auth)) return unavailable();
    return build({ db, auth, now: clock })(req, session);
  };

  r.open('/api/health', (req) => handleHealth(req, process.env, pool));
  r.open('/api/schedule.json', use(({ db, now: n }) => scheduleHandler({ db, now: n })));
  r.open('/api/signup/link', use(signupLinkHandler, { needsAuth: true }));
  r.open('/api/signup', use(signupHandler, { needsAuth: true }));
  r.open('/api/password/link', use(passwordLinkHandler, { needsAuth: true }));
  r.open('/api/password/reset', use(passwordResetHandler, { needsAuth: true }));
  r.open('/api/login', use(loginHandler, { needsAuth: true }));
  r.open('/api/staff-login', use(staffLoginHandler, { needsAuth: true }));
  r.staff('/api/osoblje/odjava', STAFF_ROLES, use(staffLogoutHandler));
  r.staff('/api/osoblje/ja', STAFF_ROLES, use(staffMeHandler));
  r.customer('/api/logout', use(logoutHandler));
  r.customer('/api/me', use(meHandler));
  return (req) => r.handle(req);
}

export const route = createRoute();
